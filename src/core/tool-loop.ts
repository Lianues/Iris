/**
 * 核心工具循环
 *
 * 封装「LLM 调用 → 工具执行 → 再调 LLM」的循环逻辑。
 * 纯计算，不包含任何 I/O（平台、存储、流式输出）。
 *
 * 调用方通过注入 LLMCaller 控制 LLM 的调用方式（普通/流式/mock）。
 *
 * 支持 AbortSignal：
 *   - 每轮循环前检查 signal.aborted
 *   - 透传给 LLMCaller 和工具执行器
 *   - abort 时清理历史，保证格式合法
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
  /** 按工具名称定义执行策略；未配置的工具默认 autoApprove: false */
  toolPolicies: Record<string, ToolPolicyConfig>;
}

/** ToolLoop 执行结果 */
export interface ToolLoopResult {
  /** 最终文本输出 */
  text: string;
  /** 完整对话历史（含本次所有新消息） */
  history: Content[];
  /** 是否因 abort 而中止 */
  aborted?: boolean;
}

/** 每轮执行的可选参数 */
export interface ToolLoopRunOptions {
  /** 额外系统提示词片段（per-request） */
  extraParts?: Part[];
  /** 新消息追加到历史时的回调（用于实时持久化） */
  onMessageAppend?: (content: Content) => Promise<void>;
  /** 固定使用的模型名称；不填时由调用方自行决定默认模型 */
  modelName?: string;
  /** 中止信号：触发后安全退出循环并清理历史 */
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
    const signal = options?.signal;
    let rounds = 0;
    // 记录进入循环前的历史长度，用于 abort 时的清理基准
    const historyBaseLength = history.length;

    while (rounds < this.config.maxRounds) {
      // 每轮开始前检查 abort
      if (signal?.aborted) {
        return this.buildAbortResult(history, historyBaseLength);
      }

      rounds++;

      // 组装请求
      // toolPolicies 仅控制执行策略（autoApprove/deny），不过滤工具声明。
      // 所有已注册工具的声明均传给 LLM，未配置 policy 的工具执行时默认需审批。
      const declarations = this.tools.getDeclarations();
      const request = this.prompt.assemble(
        history, declarations, undefined, options?.extraParts,
      );

      // 调用 LLM（具体方式由 callLLM 决定）
      let modelContent: Content;
      try {
        modelContent = await callLLM(request, options?.modelName, signal);
      } catch (err: unknown) {
        // abort 引起的错误：安全退出
        if (signal?.aborted) {
          return this.buildAbortResult(history, historyBaseLength);
        }
        // 其他 LLM 调用失败：不中断整个对话，返回错误信息让上层可以保存已有历史
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`LLM 调用失败 (round=${rounds}): ${errorMsg}`);
        return {
          text: `LLM 调用出错: ${errorMsg}`,
          history,
        };
      }

      // abort 可能在 LLM 调用过程中触发，但 callLLM 没有抛异常（比如流式已读完部分数据）
      if (signal?.aborted) {
        // modelContent 已产生但我们被 abort 了，不追加到历史
        return this.buildAbortResult(history, historyBaseLength);
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
      const responseParts = await this.executeTools(functionCalls, signal);

      // 工具执行后再次检查 abort
      if (signal?.aborted) {
        // 此时 modelContent（含 functionCall）已追加到历史，但 tool response 未追加。
        // 需要回滚这条不完整的 model 消息。
        return this.buildAbortResult(history, historyBaseLength);
      }

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

  /**
   * 构建 abort 结果：清理历史中不完整的消息，保证格式合法。
   *
   * 清理策略：
   *   1. 从历史末尾往前扫描，找到本轮新增的消息
   *   2. 如果末尾是包含 functionCall 的 model 消息（工具调用中中止），丢弃它
   *   3. 如果末尾是纯文本的 model 消息（输出中中止），保留它
   *   4. 如果末尾是纯 thought 消息（思维链中中止），丢弃它
   */
  private buildAbortResult(history: Content[], historyBaseLength: number): ToolLoopResult {
    logger.info('工具循环被中止，清理历史');

    // 从末尾往前清理本轮新增的不完整消息
    while (history.length > historyBaseLength) {
      const last = history[history.length - 1];

      if (last.role === 'model') {
        const hasFunctionCall = last.parts.some(isFunctionCallPart);
        if (hasFunctionCall) {
          // model 消息包含 functionCall，但对应的 functionResponse 未追加 → 丢弃
          history.pop();
          continue;
        }

        const visibleText = extractText(last.parts);
        const hasOnlyThought = last.parts.every(p =>
          ('thought' in p && p.thought === true) || ('text' in p && !p.text)
        );

        if (hasOnlyThought || !visibleText) {
          // 纯 thought 或空内容 → 丢弃
          history.pop();
          continue;
        }

        // 有可见文本（输出中中止）→ 保留，视为正常截断
        break;
      }

      if (last.role === 'user') {
        // 检查是否是 tool response（包含 functionResponse part）
        const isToolResponse = last.parts.some(p => 'functionResponse' in p);
        if (isToolResponse) {
          // 孤立的 tool response，其对应的 model functionCall 可能已被清除
          // 或者 abort 发生在工具执行后、下一轮 LLM 调用前
          // 检查前一条是否是匹配的 model functionCall
          if (history.length >= 2) {
            const prev = history[history.length - 2];
            if (prev.role === 'model' && prev.parts.some(isFunctionCallPart)) {
              // model(functionCall) + user(functionResponse) 是完整对，保留
              break;
            }
          }
          // 孤立的 tool response → 丢弃
          history.pop();
          continue;
        }
        // 普通用户消息 → 保留
        break;
      }

      // 其他角色（不应存在）→ 安全起见丢弃
      history.pop();
    }

    const text = this.extractLastVisibleText(history);
    return { text, history, aborted: true };
  }

  /** 从历史末尾提取最后一条 model 消息的可见文本 */
  private extractLastVisibleText(history: Content[]): string {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'model') {
        const text = extractText(history[i].parts);
        if (text) return text;
      }
    }
    return '';
  }

  private async executeTools(calls: FunctionCallPart[], signal?: AbortSignal): Promise<FunctionResponsePart[]> {
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
      return executePlan(calls, plan, this.tools, this.toolState, invocations.map(i => i.id), this.config.toolPolicies, signal);
    }

    // 无状态管理：纯执行
    return executePlan(calls, plan, this.tools, undefined, undefined, this.config.toolPolicies, signal);
  }
}
