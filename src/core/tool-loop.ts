/**
 * 核心工具循环
 *
 * 封装「LLM 调用 → 工具执行 → 再调 LLM」的循环逻辑。
 * 纯计算，不包含任何 I/O（平台、存储、流式输出）。
 *
 * 调用方通过注入 LLMCaller 控制 LLM 的调用方式（普通/流式/mock）。
 *
 * 复用场景：
 *   - Orchestrator：包装 ToolLoop + 存储/平台/流式/记忆
 *   - Agent 工具：直接创建 ToolLoop（替代 AgentExecutor）
 *   - CLI：直接创建 ToolLoop，传入提示词即可运行
 */

import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { buildExecutionPlan, executePlan } from '../tools/scheduler';
import { ToolPolicyConfig } from '../config';
import { PromptAssembler } from '../prompt/assembler';
import { createLogger } from '../logger';
import {
  Content, Part, LLMRequest,
  isFunctionCallPart, extractText,
  FunctionCallPart, FunctionResponsePart,
} from '../types';

const logger = createLogger('ToolLoop');

/** LLM 调用函数签名 —— 调用方注入具体实现 */
export type LLMCaller = (request: LLMRequest, modelName?: string, signal?: AbortSignal) => Promise<Content>;

/** ToolLoop 配置（可变引用，支持热重载） */
export interface ToolLoopConfig {
  maxRounds: number;
  /** 按工具名称定义执行策略；未配置的工具视为不允许执行 */
  toolPolicies: Record<string, ToolPolicyConfig>;
}

/** ToolLoop 执行结果 */
export interface ToolLoopResult {
  /** 最终文本输出 */
  text: string;
  /** 完整对话历史（含本次所有新消息） */
  history: Content[];
}

/** 每轮执行的可选参数 */
export interface ToolLoopRunOptions {
  /** 额外系统提示词片段（per-request） */
  extraParts?: Part[];
  /** 新消息追加到历史时的回调（用于实时持久化） */
  onMessageAppend?: (content: Content) => Promise<void>;
  /** 固定使用的模型名称；不填时由调用方自行决定默认模型 */
  modelName?: string;
  /** 中断信号；触发后当前轮次的 LLM 调用和工具执行会被取消 */
  signal?: AbortSignal;
}

export class ToolLoop {
  constructor(
    private tools: ToolRegistry,
    private prompt: PromptAssembler,
    private config: ToolLoopConfig,
    private toolState?: ToolStateManager,
  ) {}

  /**
   * 执行工具循环。
   *
   * @param history  对话历史（会被原地修改，追加新消息）
   * @param callLLM  LLM 调用函数（由调用方注入）
   * @param options  可选参数
   */
  async run(
    history: Content[],
    callLLM: LLMCaller,
    options?: ToolLoopRunOptions,
  ): Promise<ToolLoopResult> {
    let rounds = 0;

    while (rounds < this.config.maxRounds) {
      // 检查中断信号
      if (options?.signal?.aborted) {
        return { text: '已中断。', history };
      }

      rounds++;

      // 组装请求
      const allowedToolNames = new Set(Object.keys(this.config.toolPolicies));
      const request = this.prompt.assemble(
        history, this.tools.getDeclarations().filter(d => allowedToolNames.has(d.name)), undefined, options?.extraParts,
      );

      // 调用 LLM（具体方式由 callLLM 决定）
      let modelContent: Content;
      try {
        modelContent = await callLLM(request, options?.modelName, options?.signal);
      } catch (err: unknown) {
        if (options?.signal?.aborted) {
          return { text: '已中断。', history };
        }
        // LLM 调用失败时不中断整个对话，返回错误信息让上层可以保存已有历史
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`LLM 调用失败 (round=${rounds}): ${errorMsg}`);
        return {
          text: `LLM 调用出错: ${errorMsg}`,
          history,
        };
      }
      history.push(modelContent);
      await options?.onMessageAppend?.(modelContent);

      // 检查工具调用
      const functionCalls = modelContent.parts.filter(isFunctionCallPart);
      if (functionCalls.length === 0) {
        const text = extractText(modelContent.parts);
        return { text, history };
      }

      // 执行工具（通过 scheduler 分批调度）
      const responseParts = await this.executeTools(functionCalls);
      const toolResponseContent: Content = { role: 'user', parts: responseParts };
      history.push(toolResponseContent);
      await options?.onMessageAppend?.(toolResponseContent);
    }

    logger.warn(`工具轮次超过上限 (${this.config.maxRounds})`);
    return {
      text: `工具执行轮次超过上限（${this.config.maxRounds}），已中断。`,
      history,
    };
  }

  private async executeTools(calls: FunctionCallPart[]): Promise<FunctionResponsePart[]> {
    const plan = buildExecutionPlan(calls, this.tools);

    if (this.toolState) {
      // 有状态管理：创建 invocation 实例，追踪生命周期
      const invocations = calls.map(call =>
        this.toolState!.create(
          call.functionCall.name,
          call.functionCall.args as Record<string, unknown>,
          'queued',
        ),
      );
      return executePlan(calls, plan, this.tools, this.toolState, invocations.map(i => i.id), this.config.toolPolicies);
    }

    // 无状态管理：纯执行
    return executePlan(calls, plan, this.tools, undefined, undefined, this.config.toolPolicies);
  }
}
