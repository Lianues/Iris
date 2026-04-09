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
 *   - abort 时清理历史并补全中断响应，保证格式合法
 *
 * 复用场景：
 *   - Orchestrator：包装 ToolLoop + 存储/平台/流式/记忆
 *   - Agent 工具：直接创建 ToolLoop（替代 AgentExecutor）
 *   - CLI：直接创建 ToolLoop，传入提示词即可运行
 */

import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { buildExecutionPlan, executePlan } from '../tools/scheduler';
import type { SafetyContext } from '../tools/scheduler';
import type { StreamingToolExecutor } from '../tools/streaming-executor';
import { ToolsConfig, ToolPolicyConfig } from '../config';
import type { SkillContextModifier } from '../config/types';
import { PromptAssembler } from '../prompt/assembler';
import type {
  BeforeToolExecInterceptor,
  AfterToolExecInterceptor,
  BeforeLLMCallInterceptor,
  AfterLLMCallInterceptor,
} from '../extension';
import { createLogger } from '../logger';
import {
  extractText, isFunctionCallPart,
} from '../types';
import type { Content, Part, LLMRequest, FunctionCallPart, FunctionResponsePart, ToolAttachment } from '../types';
import { cleanupTrailingHistory } from './history-sanitizer';

const logger = createLogger('ToolLoop');

/** LLM 调用函数签名 —— 调用方注入具体实现 */
export type LLMCaller = (request: LLMRequest, modelName?: string, signal?: AbortSignal) => Promise<Content>;

/** ToolLoop 配置（可变引用，支持热重载） */
export interface ToolLoopConfig {
  maxRounds: number;
  /** 工具配置（含全局开关和按工具策略） */
  toolsConfig: ToolsConfig;
  /** LLM 调用报错时是否自动重试 */
  retryOnError?: boolean;
  /** 自动重试最大次数（默认 3） */
  maxRetries?: number;
  /** 插件工具执行前拦截器（由 Backend 从插件钩子组合生成） */
  beforeToolExec?: BeforeToolExecInterceptor;
  /** 插件工具执行后拦截器（由 Backend 从插件钩子组合生成） */
  afterToolExec?: AfterToolExecInterceptor;
  /** 插件 LLM 请求前拦截器（由 Backend 从插件钩子组合生成） */
  beforeLLMCall?: BeforeLLMCallInterceptor;
  /** 插件 LLM 响应后拦截器（由 Backend 从插件钩子组合生成） */
  afterLLMCall?: AfterLLMCallInterceptor;
  /** 安全上下文（安全引擎 + ReviewService） */
  safetyCtx?: SafetyContext;
}

/** ToolLoop 执行结果 */
export interface ToolLoopResult {
  /** 最终文本输出 */
  text: string;
  /** 错误信息（LLM 调用失败等）—— 不应存入对话历史 */
  error?: string;
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
  /** 一轮模型输出完成后的回调（在插件 afterLLMCall 之后、写入历史之前） */
  onModelContent?: (content: Content, round: number) => Promise<void> | void;
  /**
   * 工具执行时产生的附件（例如 MCP 返回的图片）。
   *
   * 这些附件不进入 LLM 上下文，由平台层直接发送给用户，
   * 避免把 base64 当作文本塞进历史。
   */
  onAttachments?: (attachments: ToolAttachment[]) => void;
  /** 固定使用的模型名称；不填时由调用方自行决定默认模型 */
  modelName?: string;
  /** 中止信号：触发后安全退出循环并清理历史 */
  signal?: AbortSignal;
  /** LLM 调用重试时的回调（attempt 从 1 开始） */
  onRetry?: (attempt: number, maxRetries: number, error: string) => void;
  /** 关联的会话 ID（多会话并发时用于工具状态隔离） */
  sessionId?: string;
  /**
   * 流式工具执行器（可选）。
   *
   * 由 Backend 在流式模式下注入。当提供时，callLLMStream 会在流式输出过程中
   * 通过 executor.addTool() 提前启动工具执行，ToolLoop 在 LLM 返回后
   * 使用 executor.waitForAll() 获取结果，跳过自己的 executeTools。
   */
  streamingToolExecutor?: StreamingToolExecutor;
}

export class ToolLoop {
  /** Skill 调用后的模型覆盖（本轮 run() 内有效） */
  private _modelOverride?: string;

  /**
   * run() 入口时 permissions 对象的快照，用于 run() 退出时恢复。
   *
   * 设计说明：Iris 的 toolsConfig 是 Backend 级共享引用，StreamingToolExecutor
   * 在 Backend 中创建时也直接引用该对象。为使两条执行路径（streaming / non-streaming）
   * 都能感知 skill 的权限覆盖，extractAndApplyContextModifiers 直接原地修改
   * 共享的 permissions 对象（合并而非替换，保留 classifier 等原有字段）。
   *
   * run() 退出时（通过 try/finally）用快照恢复原始值，保证修改不泄漏到
   * 下一次 run() 调用（跨 turn / 跨 session）。
   * TurnLock 保证同 session 不会并发 run()。
   */
  private _permissionsSnapshot?: Record<string, ToolPolicyConfig>;

  constructor(
    private tools: ToolRegistry,
    private prompt: PromptAssembler,
    private config: ToolLoopConfig,
    private toolState?: ToolStateManager,
  ) {}

  /** 获取关联的 ToolStateManager（sub-agent 工厂需要拿到引用） */
  getToolState(): ToolStateManager | undefined {
    return this.toolState;
  }

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
    this._modelOverride = undefined;

    // 只有主 ToolLoop（有 toolState）才做 permissions 快照/恢复。
    //
    // 子代理 ToolLoop 无 toolState，不参与此机制：
    //   - 同步子代理：父级被阻塞，子代理的 skill 修改会被父级的 finally 清理。
    //   - 异步子代理：若参与快照/恢复，其恢复时机晚于父级，会把父级已清理的
    //     修改重新写回共享 permissions（stale snapshot 覆盖问题）。
    //   - fork 子代理（invoke_skill）：已在创建时浅拷贝 toolsConfig，天然隔离。
    const shouldManagePermissions = !!this.toolState;
    if (shouldManagePermissions) {
      this._permissionsSnapshot = { ...this.config.toolsConfig.permissions };
    }

    try {
      return await this.runInner(history, callLLM, options);
    } finally {
      if (shouldManagePermissions && this._permissionsSnapshot) {
        this.config.toolsConfig.permissions = this._permissionsSnapshot;
        this._permissionsSnapshot = undefined;
      }
    }
  }

  private async runInner(
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
        return await this.buildAbortResult(history, historyBaseLength, options?.onMessageAppend);
      }

      rounds++;

      // 组装请求
      // toolsConfig 仅控制执行策略（autoApprove/deny），不过滤工具声明。
      // 所有已注册工具的声明均传给 LLM，未配置 policy 的工具执行时默认需审批。
      const declarations = this.tools.getDeclarations();
      let request = this.prompt.assemble(
        history, declarations, undefined, options?.extraParts,
      );

      // 插件钩子：LLM 请求前拦截
      if (this.config.beforeLLMCall) {
        try {
          const interception = await this.config.beforeLLMCall(request, rounds);
          if (interception) {
            request = interception.request;
          }
        } catch (err) {
          logger.warn(`beforeLLMCall 执行失败 (round=${rounds}):`, err);
        }
      }

      // 调用 LLM（具体方式由 callLLM 决定）
      let modelContent: Content;
      try {
        modelContent = await this.callLLMWithRetry(callLLM, request, options, rounds, signal);
      } catch (err) {
        if (signal?.aborted) return await this.buildAbortResult(history, historyBaseLength, options?.onMessageAppend);
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`LLM 调用失败 (round=${rounds}): ${errorMsg}`);
        return { text: '', error: `LLM 调用出错: ${errorMsg}`, history };
      }

      // abort 可能在 LLM 调用过程中触发，但 callLLM 没有抛异常（比如流式已读完部分数据）
      if (signal?.aborted) {
        // modelContent 已产生但我们被 abort 了，不追加到历史
        return await this.buildAbortResult(history, historyBaseLength, options?.onMessageAppend);
      }

      // 插件钩子：LLM 响应后拦截
      if (this.config.afterLLMCall) {
        try {
          const interception = await this.config.afterLLMCall(modelContent, rounds);
          if (interception) {
            modelContent = interception.content;
          }
        } catch (err) {
          logger.warn(`afterLLMCall 执行失败 (round=${rounds}):`, err);
        }
      }

      if (signal?.aborted) {
        return await this.buildAbortResult(history, historyBaseLength, options?.onMessageAppend);
      }

      await options?.onModelContent?.(modelContent, rounds);

      history.push(modelContent);
      await options?.onMessageAppend?.(modelContent);

      // 检查工具调用
      const functionCalls = modelContent.parts.filter(isFunctionCallPart);
      if (functionCalls.length === 0) {
        const text = extractText(modelContent.parts);
        return { text, history };
      }

      // 执行工具
      let responseParts: FunctionResponsePart[];
      const executor = options?.streamingToolExecutor;
      if (executor && executor.size > 0) {
        // 流式边执行模式：LLM 流式输出过程中已通过 executor.addTool() 提前启动了工具执行，
        // 这里等待所有已启动的工具完成并收集结果。
        // 比传统的 executeTools 少等一段时间（流式输出和工具执行重叠的部分）。
        logger.info(`流式边执行: ${executor.size} 个工具已在流式期间启动，等待完成`);
        responseParts = await executor.waitForAll();
      } else {
        // 传统模式：LLM 返回完整响应后才开始执行工具（非流式，或子代理场景）
        responseParts = await this.executeTools(functionCalls, signal, options?.onAttachments, options?.sessionId);
      }

      // 工具执行后再次检查 abort
      if (signal?.aborted) {
        // 此时 modelContent（含 functionCall）已追加到历史，但 tool response 未追加 → 补全中断响应。
        return await this.buildAbortResult(history, historyBaseLength, options?.onMessageAppend);
      }

      // 提取并应用 Skill 上下文修改器（在写入历史前执行，避免内部对象进入 LLM 上下文）
      this.extractAndApplyContextModifiers(responseParts);

      const toolResponseContent: Content = { role: 'user', parts: responseParts };
      history.push(toolResponseContent);
      await options?.onMessageAppend?.(toolResponseContent);
    }

    logger.warn(`工具轮次超过上限 (${this.config.maxRounds})`);
    return {
      text: '',
      error: `工具执行轮次超过上限（${this.config.maxRounds}），已中断。`,
      history,
    };
  }

  /**
   * 带重试的 LLM 调用。
   *
   * 重试策略：指数退避（1s → 2s → 4s → …），上限 10s。
   * 每次重试前通过 onRetry 回调通知调用方（用于 UI 显示）。
   */
  private async callLLMWithRetry(
    callLLM: LLMCaller,
    request: LLMRequest,
    options: ToolLoopRunOptions | undefined,
    round: number,
    signal?: AbortSignal,
  ): Promise<Content> {
    const maxRetries = this.config.retryOnError ? (this.config.maxRetries ?? 3) : 0;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        const errorMsg = lastError?.message ?? 'unknown error';
        logger.warn(`LLM 调用重试 (round=${round}, attempt ${attempt}/${maxRetries}): ${errorMsg}`);
        options?.onRetry?.(attempt, maxRetries, errorMsg);
        await new Promise<void>(resolve => setTimeout(resolve, delay));
        if (signal?.aborted) throw new Error('aborted');
      }

      try {
        return await callLLM(request, options?.modelName ?? this._modelOverride, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError!;
  }

  /**
   * 构建 abort 结果：清理历史中不完整的消息，补全中断响应，保证格式合法。
   *
   * 清理策略：
   *   1. model 含 functionCall（无对应 response）→ 保留并追加中断提示作为响应
   *   2. model 纯 thought 或空内容 → 丢弃
   *   3. model 有可见文本 → 保留（视为正常截断）
   *   4. 孤立的 tool response → 丢弃
   *   5. 完整的 functionCall + functionResponse 对 → 保留
   */
  private async buildAbortResult(
    history: Content[],
    historyBaseLength: number,
    onMessageAppend?: (content: Content) => Promise<void>,
  ): Promise<ToolLoopResult> {
    logger.info('工具循环被中止，清理历史');

    const appended = cleanupTrailingHistory(history, historyBaseLength);

    // 持久化新追加的中断响应（如果有）
    for (const msg of appended) {
      await onMessageAppend?.(msg);
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

  /**
   * 从工具响应中提取并应用 Skill 上下文修改器。
   *
   * 当 invoke_skill 工具返回 __contextModifier 时：
   *   1. 自动放行指定工具（原地修改共享 toolsConfig.permissions，合并保留原有字段）
   *   2. 覆盖后续 LLM 调用的模型
   *
   * permissions 的修改对 StreamingToolExecutor 也可见（共享引用），
   * 通过 run() 的 try/finally 在退出时从快照恢复，保证不泄漏。
   *
   * 提取后从响应中删除 __contextModifier，防止内部对象进入 LLM 历史。
   */
  private extractAndApplyContextModifiers(responseParts: FunctionResponsePart[]): void {
    for (const part of responseParts) {
      const resp = part.functionResponse.response as Record<string, unknown> | undefined;
      if (!resp?.__contextModifier) continue;

      const mod = resp.__contextModifier as SkillContextModifier;

      // 1. 自动放行工具（原地修改共享 permissions，合并保留 classifier 等原有字段）
      if (mod.autoApproveTools) {
        const permissions = this.config.toolsConfig.permissions;
        for (const toolName of mod.autoApproveTools) {
          permissions[toolName] = {
            ...(permissions[toolName] ?? { autoApprove: false }),
            autoApprove: true,
          };
        }
        logger.info(`Skill 上下文修改: 自动放行工具 [${mod.autoApproveTools.join(', ')}]`);
      }

      // 2. 模型覆盖
      if (mod.modelOverride) {
        this._modelOverride = mod.modelOverride;
        logger.info(`Skill 上下文修改: 模型覆盖为 ${mod.modelOverride}`);
      }

      // 从响应中剥离（不进入 LLM 历史）
      delete resp.__contextModifier;
    }
  }

  private async executeTools(
    calls: FunctionCallPart[],
    signal?: AbortSignal,
    onAttachments?: (attachments: ToolAttachment[]) => void,
    sessionId?: string,
  ): Promise<FunctionResponsePart[]> {
    const plan = buildExecutionPlan(calls, this.tools);

    if (this.toolState) {
      // 有状态管理：创建 invocation 实例，追踪生命周期
      const invocations = calls.map(call =>
        this.toolState!.create(
          call.functionCall.name,
          call.functionCall.args as Record<string, unknown>,
          'queued',
          sessionId,
        ),
      );
      return executePlan(
        calls,
        plan,
        this.tools,
        this.toolState,
        invocations.map(i => i.id),
        this.config.toolsConfig,
        signal,
        this.config.beforeToolExec,
        this.config.afterToolExec,
        onAttachments,
        this.config.safetyCtx,
      );
    }

    // 无状态管理：纯执行
    return executePlan(
      calls,
      plan,
      this.tools,
      undefined,
      undefined,
      this.config.toolsConfig,
      signal,
      this.config.beforeToolExec,
      this.config.afterToolExec,
      onAttachments,
      this.config.safetyCtx,
    );
  }
}
