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
import { PromptAssembler } from '../prompt/assembler';
import { createLogger } from '../logger';
import {
  Content, Part, LLMRequest,
  isFunctionCallPart, extractText,
  FunctionCallPart, FunctionResponsePart,
} from '../types';
import { LLMTier } from '../llm/router';

const logger = createLogger('ToolLoop');

/** LLM 调用函数签名 —— 调用方注入具体实现 */
export type LLMCaller = (request: LLMRequest, tier: LLMTier) => Promise<Content>;

/** ToolLoop 配置（可变引用，支持热重载） */
export interface ToolLoopConfig {
  maxRounds: number;
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
  /** 首轮 LLM 层级（默认 primary） */
  primaryTier?: LLMTier;
  /** 后续轮次 LLM 层级（默认 secondary） */
  secondaryTier?: LLMTier;
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
    const primaryTier = options?.primaryTier ?? 'primary';
    const secondaryTier = options?.secondaryTier ?? 'secondary';
    let rounds = 0;

    while (rounds < this.config.maxRounds) {
      rounds++;
      const tier: LLMTier = rounds === 1 ? primaryTier : secondaryTier;

      // 组装请求
      const request = this.prompt.assemble(
        history, this.tools.getDeclarations(), undefined, options?.extraParts,
      );

      // 调用 LLM（具体方式由 callLLM 决定）
      const modelContent = await callLLM(request, tier);
      history.push(modelContent);

      // 检查工具调用
      const functionCalls = modelContent.parts.filter(isFunctionCallPart);
      if (functionCalls.length === 0) {
        const text = extractText(modelContent.parts);
        return { text, history };
      }

      // 执行工具（通过 scheduler 分批调度）
      const responseParts = await this.executeTools(functionCalls);
      history.push({ role: 'user', parts: responseParts });
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
      return executePlan(calls, plan, this.tools, this.toolState, invocations.map(i => i.id));
    }

    // 无状态管理：纯执行
    return executePlan(calls, plan, this.tools);
  }
}
