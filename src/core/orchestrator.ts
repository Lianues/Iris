/**
 * 核心协调器
 *
 * 串联所有模块，管理完整的消息处理流程：
 *   用户消息 → 存储 → 提示词组装 → LLM 调用 → 工具执行循环 → 回复用户
 *
 * 协调器不包含任何业务逻辑，仅负责流程编排。
 */

import { PlatformAdapter } from '../platforms/base';
import { LLMProvider } from '../llm/providers/base';
import { StorageProvider } from '../storage/base';
import { ToolRegistry } from '../tools/registry';
import { PromptAssembler } from '../prompt/assembler';
import { createLogger } from '../logger';
import {
  Content, Part, LLMRequest, UsageMetadata,
  isFunctionCallPart, isTextPart,
  FunctionCallPart, FunctionResponsePart,
} from '../types';

const logger = createLogger('Orchestrator');

export interface OrchestratorConfig {
  /** 工具执行最大轮次（防止无限循环） */
  maxToolRounds?: number;
  /** 是否启用流式输出 */
  stream?: boolean;
}

export class Orchestrator {
  private platform: PlatformAdapter;
  private llm: LLMProvider;
  private storage: StorageProvider;
  private tools: ToolRegistry;
  private prompt: PromptAssembler;
  private maxToolRounds: number;
  private stream: boolean;

  constructor(
    platform: PlatformAdapter,
    llm: LLMProvider,
    storage: StorageProvider,
    tools: ToolRegistry,
    prompt: PromptAssembler,
    config?: OrchestratorConfig,
  ) {
    this.platform = platform;
    this.llm = llm;
    this.storage = storage;
    this.tools = tools;
    this.prompt = prompt;
    this.maxToolRounds = config?.maxToolRounds ?? 10;
    this.stream = config?.stream ?? false;
  }

  /** 启动：注册消息回调并启动平台 */
  async start(): Promise<void> {
    this.platform.onMessage(async (msg) => {
      try {
        await this.handleMessage(msg.sessionId, msg.parts);
      } catch (err) {
        logger.error(`处理消息失败 (session=${msg.sessionId}):`, err);
        try {
          const errorText = err instanceof Error ? err.message : String(err);
          await this.platform.sendMessage(msg.sessionId, `发生错误: ${errorText}`);
        } catch {
          // 发送错误消息也失败，只记录日志
        }
      }
    });

    await this.platform.start();
    const mode = this.stream ? '流式' : '非流式';
    logger.info(`已启动 | 平台=${this.platform.name} LLM=${this.llm.name} 模式=${mode} 工具数=${this.tools.size}`);
  }

  /** 停止 */
  async stop(): Promise<void> {
    await this.platform.stop();
    logger.info('已停止');
  }

  // ============ 核心流程 ============

  private async handleMessage(sessionId: string, userParts: Part[]): Promise<void> {
    // 1. 存储用户消息
    await this.storage.addMessage(sessionId, { role: 'user', parts: userParts });

    // 2. LLM 对话 + 工具执行循环
    let rounds = 0;
    while (rounds < this.maxToolRounds) {
      rounds++;

      // 2a. 获取历史并组装请求
      const history = await this.storage.getHistory(sessionId);
      const request = this.prompt.assemble(history, this.tools.getDeclarations());

      // 2b. 调用 LLM（流式或非流式）
      let modelContent: Content;
      let textAlreadySent = false;

      if (this.stream) {
        const result = await this.callLLMStream(sessionId, request);
        modelContent = result.content;
        textAlreadySent = true;
      } else {
        const response = await this.llm.chat(request);
    modelContent = response.content;
        if (response.usageMetadata) {
          modelContent.usageMetadata = response.usageMetadata;
        }
      }

      // 2c. 存储模型回复
      await this.storage.addMessage(sessionId, modelContent);

      // 2d. 检查工具调用
      const functionCalls = modelContent.parts.filter(isFunctionCallPart);

      if (functionCalls.length === 0) {
        // 无工具调用，发送文本给用户（流式已在 callLLMStream 中发送）
        if (!textAlreadySent) {
          const text = modelContent.parts.filter(isTextPart).map(p =>p.text).join('');
          if (text) await this.platform.sendMessage(sessionId, text);
        }
        return;
      }

      // 2e. 执行工具
      await this.executeTools(sessionId, functionCalls);
    }

    logger.warn(`工具执行轮次超过上限 (${this.maxToolRounds})`);
    await this.platform.sendMessage(sessionId, '工具执行轮次超过上限，已中断。');
  }

  // ============ 流式调用 ============

  /**
   * 流式调用 LLM：边接收边输出文本，同时累积完整的 Content。
   */
  private async callLLMStream(
    sessionId: string,
    request: LLMRequest,
  ): Promise<{ content: Content }> {
    let fullText = '';
    const collectedCalls: FunctionCallPart[] = [];
    let usageMetadata: UsageMetadata | undefined;
    let thoughtSignature: string | undefined;

    const llmStream = this.llm.chatStream!(request);

    //包装为纯文本流，交给平台输出
    const textStream = (async function* () {
      for await (const chunk of llmStream) {
        if (chunk.textDelta) {
          fullText += chunk.textDelta;
          yield chunk.textDelta;
        }
        if (chunk.functionCalls) collectedCalls.push(...chunk.functionCalls);
        if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
        if (chunk.thoughtSignature) thoughtSignature = chunk.thoughtSignature;
      }
    })();

    await this.platform.sendMessageStream(sessionId, textStream);

    // 累积为完整 Content
    const parts: Part[] = [];
    if (fullText) {
      const textPart: any = { text: fullText };
      if (thoughtSignature) textPart.thoughtSignature = thoughtSignature;
      parts.push(textPart);
    }
    parts.push(...collectedCalls.map(c => thoughtSignature ? { ...c, thoughtSignature } as any : c));
    if (parts.length === 0) parts.push({ text: '' });

    const content: Content = { role: 'model', parts };
    if (usageMetadata) content.usageMetadata = usageMetadata;

    return { content };
  }

  // ============ 工具执行 ============

  private async executeTools(sessionId: string, functionCalls: FunctionCallPart[]): Promise<void> {
    const responseParts: FunctionResponsePart[] = [];

    for (const call of functionCalls) {
      logger.info(`执行工具: ${call.functionCall.name}`);
      try {
        const result = await this.tools.execute(
          call.functionCall.name,
          call.functionCall.args as Record<string, unknown>,
        );
        responseParts.push({
          functionResponse: {
            name: call.functionCall.name,
            response: { result } as Record<string, unknown>,
          },
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`工具执行失败: ${call.functionCall.name}:`, errorMsg);
        responseParts.push({
          functionResponse: {
            name: call.functionCall.name,
            response: { error: errorMsg },
          },
        });
      }
    }

    await this.storage.addMessage(sessionId, { role: 'user',parts: responseParts });
  }
}
