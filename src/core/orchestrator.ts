/**
 * 核心协调器
 *
 * 串联所有模块，管理完整的消息处理流程：
 *   用户消息 → 存储 → 提示词组装 → LLM 调用 → 工具执行循环 → 回复用户
 *
 * 协调器不包含任何业务逻辑，仅负责流程编排。
 */

import { PlatformAdapter } from '../platforms/base';
import { LLMRouter, LLMTier } from '../llm/router';
import { StorageProvider } from '../storage/base';
import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { buildExecutionPlan, executePlan } from '../tools/scheduler';
import { PromptAssembler } from '../prompt/assembler';
import { MemoryProvider } from '../memory/base';
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
  /** 是否自动召回记忆（默认 true） */
  autoRecall?: boolean;
  /** Agent 协调指导文本 */
  agentGuidance?: string;
}

export class Orchestrator {
  private platform: PlatformAdapter;
  private router: LLMRouter;
  private storage: StorageProvider;
  private tools: ToolRegistry;
  private toolState: ToolStateManager;
  private prompt: PromptAssembler;
  private maxToolRounds: number;
  private stream: boolean;
  private autoRecall: boolean;
  private agentGuidance?: string;
  private memory?: MemoryProvider;

  constructor(
    platform: PlatformAdapter,
    router: LLMRouter,
    storage: StorageProvider,
    tools: ToolRegistry,
    toolState: ToolStateManager,
    prompt: PromptAssembler,
    config?: OrchestratorConfig,
    memory?: MemoryProvider,
  ) {
    this.platform = platform;
    this.router = router;
    this.storage = storage;
    this.tools = tools;
    this.toolState = toolState;
    this.prompt = prompt;
    this.maxToolRounds = config?.maxToolRounds ?? 10;
    this.stream = config?.stream ?? false;
    this.autoRecall = config?.autoRecall ?? true;
    this.agentGuidance = config?.agentGuidance;
    this.memory = memory;
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

    // 将工具状态管理器传递给平台（平台可选择监听以实时显示状态）
    this.platform.setToolStateManager(this.toolState);

    this.platform.onClear(async (sessionId) => {
      await this.storage.clearHistory(sessionId);
    });

    await this.platform.start();
    const mode = this.stream ? '流式' : '非流式';
    const tierInfo = this.router.getTierInfo();
    const tierDesc = [
      `primary=${tierInfo.primary}`,
      tierInfo.secondary ? `secondary=${tierInfo.secondary}` : null,
      tierInfo.light ? `light=${tierInfo.light}` : null,
    ].filter(Boolean).join(' ');
    logger.info(`已启动 | 平台=${this.platform.name} LLM=[${tierDesc}] 模式=${mode} 工具数=${this.tools.size}`);
  }

  /** 停止 */
  async stop(): Promise<void> {
    await this.platform.stop();
    logger.info('已停止');
  }

  /** 热重载：替换 LLM 路由器 */
  reloadLLM(newRouter: LLMRouter): void {
    this.router = newRouter;
    const tierInfo = newRouter.getTierInfo();
    const tierDesc = [
      `primary=${tierInfo.primary}`,
      tierInfo.secondary ? `secondary=${tierInfo.secondary}` : null,
      tierInfo.light ? `light=${tierInfo.light}` : null,
    ].filter(Boolean).join(' ');
    logger.info(`LLM 已热重载: [${tierDesc}]`);
  }

  /** 热重载：更新运行时参数 */
  reloadConfig(opts: { stream?: boolean; maxToolRounds?: number; systemPrompt?: string }): void {
    if (opts.stream !== undefined) this.stream = opts.stream;
    if (opts.maxToolRounds !== undefined) this.maxToolRounds = opts.maxToolRounds;
    if (opts.systemPrompt !== undefined) this.prompt.setSystemPrompt(opts.systemPrompt);
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.maxToolRounds}`);
  }

  /** 获取路由器引用 */
  getRouter(): LLMRouter {
    return this.router;
  }

  // ============ 核心流程 ============

  private async handleMessage(sessionId: string, userParts: Part[]): Promise<void> {
    // 1. 存储用户消息
    await this.storage.addMessage(sessionId, { role: 'user', parts: userParts });

    // 1.5 构建 per-request 额外上下文
    let extraParts: Part[] | undefined;

    // 记忆自动召回（autoRecall=false 时跳过，由 recall agent 代替）
    if (this.memory && this.autoRecall) {
      try {
        const userText = userParts.filter(isTextPart).map(p => p.text).join('');
        const context = await this.memory.buildContext(userText);
        if (context) {
          extraParts = [{ text: context }];
        }
      } catch (err) {
        logger.warn('查询记忆失败:', err);
      }
    }

    // Agent 协调指导（作为 extraParts 注入，不受 setSystemPrompt 热重载影响）
    if (this.agentGuidance) {
      if (!extraParts) extraParts = [];
      extraParts.push({ text: this.agentGuidance });
    }

    // 2. LLM 对话 + 工具执行循环
    let rounds = 0;
    while (rounds < this.maxToolRounds) {
      rounds++;

      // 决定本轮使用的 LLM 层级：第 1 轮用 primary，后续用 secondary
      const tier: LLMTier = rounds === 1 ? 'primary' : 'secondary';

      // 2a. 获取历史并组装请求
      const history = await this.storage.getHistory(sessionId);
      const request = this.prompt.assemble(history, this.tools.getDeclarations(), undefined, extraParts);

      // 2b. 调用 LLM（流式或非流式）
      let modelContent: Content;
      let textAlreadySent = false;

      if (this.stream) {
        const result = await this.callLLMStream(sessionId, request, tier);
        modelContent = result.content;
        textAlreadySent = true;
      } else {
        const response = await this.router.chat(request, tier);
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
        if (!textAlreadySent) {
          const text = modelContent.parts.filter(isTextPart).map(p => p.text).join('');
          if (text) await this.platform.sendMessage(sessionId, text);
        }
        return;
      }

      // 2e. 发送伴随工具调用的文本（流式模式已在 callLLMStream 中处理）
      if (!textAlreadySent) {
        const text = modelContent.parts.filter(isTextPart).map(p => p.text).join('');
        if (text) await this.platform.sendMessage(sessionId, text);
      }

      // 2f. 执行工具
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
    tier: LLMTier = 'primary',
  ): Promise<{ content: Content }> {
    let fullText = '';
    const collectedCalls: FunctionCallPart[] = [];
    let usageMetadata: UsageMetadata | undefined;
    let thoughtSignature: string | undefined;

    const llmStream = this.router.chatStream(request, tier);

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
    // 1. 创建所有 invocation（状态 queued，UI 可立即展示）
    const invocations = functionCalls.map(call =>
      this.toolState.create(
        call.functionCall.name,
        call.functionCall.args as Record<string, unknown>,
        'queued',
      ),
    );
    const invocationIds = invocations.map(inv => inv.id);

    // 2. 分批调度执行（连续只读工具并行，其余串行）
    const plan = buildExecutionPlan(functionCalls, this.tools);
    const responseParts = await executePlan(functionCalls, plan, invocationIds, this.tools, this.toolState);

    await this.storage.addMessage(sessionId, { role: 'user', parts: responseParts });
  }
}

