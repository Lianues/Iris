/**
 * 工具执行调度器
 *
 * @module
 * 负责将 LLM 输出的一组工具调用分批并执行。
 *
 * 调度策略：
 *   - 默认串行：每个工具独占一批，顺序执行。
 *   - 局部并行：连续判定为 parallel=true 的工具归为同一批，并发执行。
 *
 * 示例：
 *   输入： [read_a, read_b, modify_a, read_c, read_d]
 *   分批： [read_a, read_b]  →  [modify_a]  →  [read_c, read_d]
 *   执行：  并行            串行            并行
 */

import { ToolRegistry } from './registry';
import { ToolStateManager } from './state';
import { coerceToolArgs, getToolArgsArrayValidationError } from './coerce-args';
import type { ToolParameterSchema } from './coerce-args';
import { validateToolArgs } from './validate-args';
import { FunctionCallPart, FunctionResponsePart, InlineDataPart, TERMINAL_TOOL_STATUSES } from '../types';
import { createLogger } from '../logger';
import type { ToolAttachment, ToolExecutionContext } from '../types';
import { ToolPolicyConfig, ToolsConfig } from '../config';
import type { BeforeToolExecInterceptor, AfterToolExecInterceptor } from '../extension';
import type { ToolExecutionHandle } from './handle';

const logger = createLogger('ToolScheduler');

// ============ Shell 命令模式匹配 ============

/**
 * 将 glob / 正则模式转换为 RegExp。
 *
 * 支持的语法：
 *   - `*` / `**`  匹配任意字符序列
 *   - `?`         匹配单个字符
 *   - `/regex/flags`  以 `/` 包裹的字符串按用户自定义正则解析
 */
function patternToRegex(pattern: string): RegExp {
  // 用户直接写正则：/pattern/flags
  const regexLiteral = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexLiteral) {
    return new RegExp(regexLiteral[1], regexLiteral[2]);
  }

  // glob → regex
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      // * 和 ** 语义等价：匹配任意字符
      regex += '.*';
      i += (pattern[i + 1] === '*') ? 2 : 1;
    } else if (ch === '?') {
      regex += '.';
      i++;
    } else {
      // escape regex special chars
      regex += ch.replace(/[\\^$.|+()[\]{}]/g, '\\' + '$' + '&');
      i++;
    }
  }

  return new RegExp(`^${regex}$`);
}

/**
 * 检查命令是否匹配模式列表中的任一规则。
 */
function matchesAnyPattern(command: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    try {
      if (patternToRegex(pattern).test(command)) return true;
    } catch {
      logger.warn(`无效的 shell 命令模式，已跳过: "${pattern}"`);
    }
  }
  return false;
}

/**
 * 提取 shell 工具调用中的 command 字符串。
 */
function extractShellCommand(call: FunctionCallPart): string {
  const args = call.functionCall.args as Record<string, unknown> | undefined;
  return typeof args?.command === 'string' ? args.command : '';
}

/**
 * 判断是否为“命令类工具”。
 *
 * 仅用于 command 字符串相关逻辑（allow/denyPatterns、approvedByUser 透传）。
 */
function isCommandToolName(toolName: string): boolean {
  return toolName === 'shell' || toolName === 'bash';
}

/**
 * 工具是否声明“由 handler 自己管理审批”。
 *
 * 典型场景：
 * - shell / bash 这类命令工具：需要先跑静态白名单 / AI 分类器，再在必要时请求确认
 * - extension 私有工具：希望通过自身配置贡献决定 autoApprove，而不是耦合宿主 tools.yaml
 */
function isHandlerManagedApprovalTool(call: FunctionCallPart, registry: ToolRegistry): boolean {
  return registry.get(call.functionCall.name)?.approvalMode === 'handler';
}

/**
 * 从 shell 命令生成可记忆的命令模式。
 *
 * 取前两个 token 作为基础模式（第二个以 `-` 开头时只取第一个），
 * 同时生成“完整命令精确匹配”和“前缀通配”两条规则。
 *
 * 为什么需要两条：旧的单一 "cmd *" 规则只匹配带额外参数的命令，
 * 例如 "npm test *" 无法匹配 "npm test" 本身，导致 TUI 中对无参数命令
 * 选择“始终允许”后，下次相同命令仍然弹确认。
 * 精确匹配使用完整命令而不是基础模式，避免 "git push origin main" 额外允许
 * 裸 "git push" 这类更宽泛的命令。
 *
 * 示例：
 *   "npm install express" → ["npm install express", "npm install *"]
 *   "git push origin main" → ["git push origin main", "git push *"]
 *   "python -m pytest" → ["python -m pytest", "python *"]
 *   "ls" → ["ls", "ls *"]
 */
export function generateCommandPatterns(command: string): string[] {
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!normalized) return ['*'];

  const tokens = normalized.split(' ');
  const prefixBase = tokens.length <= 1 || tokens[1].startsWith('-')
    ? tokens[0]
    : `${tokens[0]} ${tokens[1]}`;

  return Array.from(new Set([normalized, `${prefixBase} *`]));
}

/** @deprecated 使用 generateCommandPatterns，同时写入精确模式和前缀通配模式。 */
export function generateCommandPattern(command: string): string {
  const patterns = generateCommandPatterns(command);
  return patterns[patterns.length - 1] ?? '*';
}

/**
 * 判断工具调用是否应该自动批准（跳过 scheduler Y/N）。
 *
 * 对 handler-managed 的命令类工具（shell / bash，3 层优先级）：
 *   1. denyPatterns 匹配 → 不自动批准（弹 Y/N，跳过分类器直接让用户决定）
 *   2. 其他情况 → 自动批准，安全判定交给 handler 内层
 *      （allowPatterns / autoApprove 通过 userExplicitlyApproved 控制是否跳过分类器）
 *
 * 对非命令类工具：行为不变，按 autoApprove 配置决定。
 */
function shouldAutoApprove(
  call: FunctionCallPart,
  policy: ToolPolicyConfig,
  registry: ToolRegistry,
): boolean {
  if (isHandlerManagedApprovalTool(call, registry)) {
    if (isCommandToolName(call.functionCall.name)) {
    // denyPatterns 匹配 → 不自动批准（触发 scheduler Y/N）
      const command = extractShellCommand(call);
      if (policy.denyPatterns?.length && matchesAnyPattern(command, policy.denyPatterns)) {
        return false;
      }
    }
    // 其余 handler-managed 工具默认放行到 handler，自身决定是否 requestApproval。
    return true;
  }

  // 非命令类工具：按 autoApprove 配置决定
  return policy.autoApprove;
}

/**
 * 判断当前工具调用是否处在真正可交互的审批上下文中。
 *
 * 为什么要单独判断：
 * - Console 前台会话可以弹出 Y/N 与 diff 审批视图；
 * - cross-agent:hidden session 虽然也有 ToolStateManager，但前端根本不会切到该 session，
 *   因而任何 awaiting_approval / awaiting_apply 都会把后台任务卡死；
 * - sub_agent 等无 ToolStateManager 的场景同样属于非交互上下文。
 *
 * 目前约定：sessionId 以 cross-agent: 开头的委派会话视为隐藏后台会话，不可做交互审批。
 */
function canUseInteractiveApproval(toolState?: ToolStateManager, invocationId?: string): boolean {
  if (!toolState || !invocationId) return false;
  const sessionId = toolState.get(invocationId)?.sessionId;
  if (typeof sessionId === 'string' && sessionId.startsWith('cross-agent:')) {
    return false;
  }
  return true;
}

/**
 * 从批量工具的结构化返回值中提取总体执行结果。
 *
 * 为什么要做这一步：
 * read/write/insert/delete 等批量工具会把单项失败收敛为 failCount，
 * handler 本身并不会 throw。调度层如果只看“有返回值”就一律判 success，
 * 前端会出现绿色勾，但实际上业务可能 100% 失败。
 */
function analyzeStructuredToolResult(result: unknown): { status: 'success' | 'warning' | 'error'; error?: string } | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;

  if (record.cancelled === true) {
    return { status: 'warning', error: typeof record.message === 'string' ? record.message : '用户取消了工具交互。' };
  }

  const successCount = typeof record.successCount === 'number' ? record.successCount : undefined;
  const failCount = typeof record.failCount === 'number' ? record.failCount : undefined;
  const totalCount = typeof record.totalCount === 'number' ? record.totalCount : undefined;
  if (successCount == null || failCount == null || totalCount == null) return undefined;

  if (failCount <= 0) return { status: 'success' };

  const firstError = Array.isArray(record.results)
    ? (record.results as Array<Record<string, unknown>>).find(item => typeof item?.error === 'string')?.error as string | undefined
    : undefined;

  if (successCount <= 0) {
    return {
      status: 'error',
      error: firstError ?? `工具执行失败：${failCount}/${totalCount} 项失败。`,
    };
  }

  return {
    status: 'warning',
    error: firstError ?? `工具部分失败：${failCount}/${totalCount} 项失败。`,
  };
}

// ============ 类型 ============

/** 一个执行批次 */
export interface ExecutionBatch {
  /** 此批次包含的调用索引（对应原始 functionCalls 数组） */
  indices: number[];
  /** 此批次是否并行执行 */
  parallel: boolean;
}

function normalizeParallelArgs(call: FunctionCallPart): Record<string, unknown> {
  const args = call.functionCall.args;
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

function isParallelCall(call: FunctionCallPart, registry: ToolRegistry): boolean {
  const tool = registry.get(call.functionCall.name);
  if (!tool?.parallel) return false;

  if (typeof tool.parallel === 'function') {
    try {
      return tool.parallel(normalizeParallelArgs(call)) === true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`工具并行判定失败，按串行处理: ${call.functionCall.name}: ${errorMsg}`);
      return false;
    }
  }

  return tool.parallel === true;
}

// ============ 分批 ============

/**
 * 将一组工具调用按调度策略分批。
 *
 * 规则：
 *   1. 连续判定为 parallel=true 的工具归为同一批（并行执行）
 *   2. 判定为 parallel=false 的工具独占一批（串行执行）
 *   3. 未注册的工具视为串行
 */
export function buildExecutionPlan(
  calls: FunctionCallPart[],
  registry: ToolRegistry,
): ExecutionBatch[] {
  const batches: ExecutionBatch[] = [];
  let i = 0;

  while (i < calls.length) {
    const canParallel = isParallelCall(calls[i], registry);

    if (!canParallel) {
      batches.push({ indices: [i], parallel: false });
      i++;
    } else {
      const batch: number[] = [];
      while (i < calls.length) {
        if (!isParallelCall(calls[i], registry)) break;
        batch.push(i);
        i++;
      }
      batches.push({ indices: batch, parallel: batch.length > 1 });
    }
  }

  return batches;
}

// ============ 执行 ============

const OPERATION_ABORTED_ERROR = 'Operation aborted';

/**
 * 合并多个 AbortSignal，任一触发即 abort。
 * 用于合并会话级 signal 和工具级 signal。
 */
function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  // Node 20+ / Bun 支持 AbortSignal.any()
  if ('any' in AbortSignal) {
    return (AbortSignal as any).any(valid);
  }
  // fallback: 手动合并
  const controller = new AbortController();
  for (const s of valid) {
    if (s.aborted) { controller.abort(s.reason); return controller.signal; }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

class ToolAbortError extends Error {
  constructor(readonly reason?: unknown) {
    super(OPERATION_ABORTED_ERROR);
    this.name = 'ToolAbortError';
  }
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof ToolAbortError) return true;
  if (signal?.aborted) return true;
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message === OPERATION_ABORTED_ERROR;
  }
  return false;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ToolAbortError(signal.reason);
}

/**
 * 将任意异步等待点与 AbortSignal race。
 *
 * 注意：被 race 的原始 Promise 后续可能仍会 settle；这里始终给它挂上
 * then/catch，避免提前返回后产生 unhandled rejection。
 */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new ToolAbortError(signal.reason));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ToolAbortError(signal.reason));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      },
    );
  });
}

function markInvocationAborted(toolState?: ToolStateManager, invocationId?: string): void {
  if (!toolState || !invocationId) return;
  try {
    toolState.transition(invocationId, 'error', { error: OPERATION_ABORTED_ERROR });
  } catch {
    // 可能已进入终态，忽略
  }
}

function createAbortResponse(call: FunctionCallPart, durationMs?: number): FunctionResponsePart {
  return {
    functionResponse: {
      name: call.functionCall.name,
      callId: call.functionCall.callId,
      response: { error: OPERATION_ABORTED_ERROR },
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  };
}

/**
 * 创建带节流的进度上报函数。
 *
 * leading + trailing 模式（150ms 默认间隔）：
 * - 首次调用立即推送（leading edge），用户立刻看到反馈
 * - 150ms 窗口内后续调用合并，窗口结束时推送最新值（trailing edge）
 * - dispose() 刷新最后一个待推送值并停止接受新调用
 *
 * 错误隔离：内部 try-catch 包裹 toolState.transition()，
 * 防止错误冒泡到 handler 的 onChunk/onTokens 回调中
 * 中断 LLM 流式读取循环（参考 LangChain PR #10102 的错误隔离设计）。
 */
function createThrottledReportProgress(
  toolState: ToolStateManager,
  invocationId: string,
  intervalMs: number = 150,
): { reportProgress: (data: Record<string, unknown>) => void; dispose: () => void } {
  let lastFlushTime = 0;
  let pendingData: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  /** 将 pendingData 推送到 ToolStateManager */
  const flush = () => {
    if (!pendingData) return;
    try {
      toolState.transition(invocationId, 'executing', { progress: pendingData });
    } catch {
      // 错误隔离：transition 失败（如状态已终态）不应影响工具执行
    }
    pendingData = null;
  };

  /** handler 调用此函数推送进度 */
  const reportProgress = (data: Record<string, unknown>) => {
    if (disposed) return;
    pendingData = data;

    const now = Date.now();
    const elapsed = now - lastFlushTime;

    if (elapsed >= intervalMs) {
      // leading edge：超过节流间隔，立即推送
      lastFlushTime = now;
      if (timer) { clearTimeout(timer); timer = null; }
      flush();
    } else if (!timer) {
      // trailing edge：间隔内首次调用，调度延迟推送
      timer = setTimeout(() => {
        timer = null;
        lastFlushTime = Date.now();
        flush();
      }, intervalMs - elapsed);
    }
    // else: timer 已调度，pendingData 已更新为最新值，trailing 触发时会推送
  };

  /** 销毁：清除定时器，刷新最后的待推送数据，然后标记已销毁 */
  const dispose = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    // 先 flush 再 disposed=true：确保最后一个进度值在终态转换前送达
    flush();
    disposed = true;
  };

  return { reportProgress, dispose };
}

/**
 * 执行单个工具调用。
 *
 * 当 autoApprove 为 false 时，先将状态切到 awaiting_approval 并阻塞，
 * 等待外部代码（平台层）将状态转为 executing（批准）或 error（拒绝）。
 *
 * 支持 AbortSignal：执行前检查，已 abort 时直接返回错误。
 */
// 导出为 executeSingleTool，供 StreamingToolExecutor 直接调用。
// 函数名在模块内保持 executeSingle 以兼容现有 executePlan 的调用，
// 通过 export { executeSingle as executeSingleTool } 对外暴露。
export { executeSingle as executeSingleTool };
async function executeSingle(
  call: FunctionCallPart,
  registry: ToolRegistry,
  toolState?: ToolStateManager,
  invocationId?: string,
  toolsConfig: ToolsConfig = { permissions: {} },
  signal?: AbortSignal,
  beforeToolExec?: BeforeToolExecInterceptor,
  afterToolExec?: AfterToolExecInterceptor,
  onAttachments?: (attachments: ToolAttachment[]) => void,
): Promise<FunctionResponsePart> {
  const toolName = call.functionCall.name;
  const handle = toolState && invocationId ? toolState.getHandle(invocationId) : undefined;
  // 合并会话级 signal 和工具级 signal（Handle.abort() 触发工具级 signal）。
  // 该 signal 覆盖审批、分类器、插件钩子与 handler 执行的所有等待点。
  const effectiveSignal = combineAbortSignals(signal, handle?.signal);

  // 执行前检查 abort
  if (effectiveSignal?.aborted) {
    markInvocationAborted(toolState, invocationId);
    return createAbortResponse(call);
  }

  // 检查工具策略
  const policy = toolsConfig.permissions[toolName];
  // 未配置的工具默认需要确认（autoApprove: false）
  // 在有 toolState 的平台（Console）会弹出审批，
  // 不支持交互审批的平台（如 WXWork）应使用 autoApproveHandle 自动批准。
  const effectivePolicy: ToolPolicyConfig = policy ?? { autoApprove: false };
  const toolDef = registry.get(toolName);

  // 全局开关（最高优先级）
  const globalSkipConfirmation = toolsConfig.autoApproveAll === true || toolsConfig.autoApproveConfirmation === true;
  const globalSkipDiff = toolsConfig.autoApproveAll === true || toolsConfig.autoApproveDiff === true;
  const autoApproved = globalSkipConfirmation || shouldAutoApprove(call, effectivePolicy, registry);
  const interactiveApproval = canUseInteractiveApproval(toolState, invocationId);
  const willUseDiffApprovalView = interactiveApproval && !globalSkipDiff && shouldShowDiffPreview(call, effectivePolicy);

  // 追踪用户是否通过交互审批明确批准了此次调用（用于 handler-managed 工具）
  let userExplicitlyApproved = false;

  // 对非命令类工具：autoApprove 跳过审批时，标记为用户已批准。
  // 对 handler-managed 的命令类工具：以下场景设置 approvedByUser，让 handler 跳过 AI 分类器：
  //   - 全局跳过确认（autoApproveAll / autoApproveConfirmation）
  //   - 工具级 autoApprove: true
  //   - allowPatterns 匹配
  // 默认（autoApprove: false + 无 pattern 匹配）→ handler 正常跑分类器（不变）。
  const isCommandTool = isCommandToolName(toolName);
  const handlerManagedApproval = toolDef?.approvalMode === 'handler';
  if (!handlerManagedApproval) {
    if (autoApproved) {
      userExplicitlyApproved = true;
    }
  } else if (isCommandTool && (globalSkipConfirmation || (autoApproved && effectivePolicy.autoApprove))) {
    // autoApproved 条件确保 denyPatterns 匹配时（autoApproved=false）autoApprove 不生效，
    // 维持 denyPatterns > autoApprove 的优先级。
    // globalSkipConfirmation 是最高优先级，不受 denyPatterns 约束（因为它已在 autoApproved 计算中生效）。
    userExplicitlyApproved = true;
  } else if (isCommandTool && autoApproved && effectivePolicy.allowPatterns?.length) {
    // 仅在 denyPatterns 未匹配时（autoApproved = true）才检查 allowPatterns，
    // 确保 denyPatterns 优先级高于 allowPatterns。
    const command = extractShellCommand(call);
    if (matchesAnyPattern(command, effectivePolicy.allowPatterns)) {
      userExplicitlyApproved = true;
    }
  } else if (handlerManagedApproval && globalSkipConfirmation) {
    userExplicitlyApproved = true;
  }

  if (!autoApproved) {
    // [安全修复] 非交互上下文不能等待人工确认，否则后台委派 / 子代理会永久卡死。
    if (!interactiveApproval) {
      // 命令类工具: handler 有自己的安全流水线（分类器/force），不在 scheduler 层硬拦截。
      // fall through 到 handler，让 handler 的分类器/force 机制处理。
      if (!handlerManagedApproval) {
        const approvalError = `当前执行上下文无法进行人工确认，工具「${toolName}」被权限策略拦截。请在目标 Agent 的 tools.yaml 中为该工具开启 autoApprove。`;
        if (toolState && invocationId) {
          toolState.transition(invocationId, 'error', { error: approvalError });
        }
        return {
          functionResponse: {
            name: toolName,
            callId: call.functionCall.callId,
            response: { error: approvalError },
          },
        };
      }
    }
  }

  if (interactiveApproval && toolState && invocationId) {
    // ── 一类审批：autoApprove 控制，底部 Y/N ──
    // 如果本次会进入 Console diff 审批视图，则 diff 视图本身就是人机审批，
    // 不再先弹一次通用 Y/N，避免同一个写入类工具需要审批两次。
    if (!autoApproved && !willUseDiffApprovalView) {
      toolState.transition(invocationId, 'awaiting_approval');
      const approved = await toolState.waitForApproval(invocationId, effectiveSignal);
      if (!approved) {
        if (effectiveSignal?.aborted) return createAbortResponse(call);
        return {
          functionResponse: {
            name: toolName,
            callId: call.functionCall.callId,
            response: { error: '用户已拒绝执行该工具' },
          },
        };
      }
      // approved → 用户明确批准，状态已被 handle.approve() 转为 executing
      userExplicitlyApproved = true;
    }

    // ── 二类审批：showApprovalView 控制，diff 预览视图（执行前） ──
    // [行为修复] showApprovalView 是 Console TUI 专用交互视图。
    // 对隐藏后台 session / 无 ToolState 的非交互场景，不再把它当作阻塞条件。
    if (willUseDiffApprovalView) {
      toolState.transition(invocationId, 'awaiting_apply');
      const applied = await toolState.waitForApply(invocationId, effectiveSignal);
      if (!applied) {
        if (effectiveSignal?.aborted) return createAbortResponse(call);
        return {
          functionResponse: {
            name: toolName,
            callId: call.functionCall.callId,
            response: { error: '用户在 diff 预览中拒绝了执行' },
          },
        };
      }
      // applied → 用户明确批准，状态已被 handle.apply() 转为 executing
      userExplicitlyApproved = true;
    } else if (autoApproved) {
      // 两类审批都跳过时才需要手动设置 executing
      toolState.transition(invocationId, 'executing');
    }
  } else if (toolState && invocationId) {
    // [状态修复] 隐藏后台 session 虽然有 ToolState，但没有可见审批 UI。
    // 当该上下文允许继续执行时，需要主动转为 executing，避免 queued → success 的非法跳转。
    toolState.transition(invocationId, 'executing');
  }
  logger.info(`执行工具: ${call.functionCall.name}${invocationId ? ` (${invocationId})` : ''}`);

  // 插件钩子: onBeforeToolExec
  let effectiveArgs = call.functionCall.args as Record<string, unknown>;

  // ── 参数类型容错 + Schema 校验（在插件钩子之前执行） ──
  // 目的：在工具 handler 和插件钩子看到参数之前，先做类型修正和合法性校验。
  // 这样插件钩子拿到的已经是修正后的参数，handler 不会因为类型错误崩溃，
  // 校验失败时模型能收到可读的错误描述并自行修正重试。
  const toolSchema = toolDef?.declaration.parameters as ToolParameterSchema | undefined;
  if (toolSchema) {
    // 1. 类型容错：boolean/number/array 字符串静默转换
    effectiveArgs = coerceToolArgs(effectiveArgs, toolSchema);

    // 2. 数组专项校验：coerceToolArgs 处理后仍不是数组的，直接报错
    const arrayError = getToolArgsArrayValidationError(toolName, effectiveArgs, toolSchema);
    if (arrayError) {
      if (toolState && invocationId) {
        toolState.transition(invocationId, 'error', { error: arrayError });
      }
      return {
        functionResponse: {
          name: toolName, callId: call.functionCall.callId,
          response: { error: arrayError },
        },
      };
    }

    // 3. 完整 schema 校验：必需字段、类型匹配、多余字段
    const schemaError = validateToolArgs(toolName, effectiveArgs, toolSchema);
    if (schemaError) {
      if (toolState && invocationId) {
        toolState.transition(invocationId, 'error', { error: schemaError });
      }
      return {
        functionResponse: {
          name: toolName, callId: call.functionCall.callId,
          response: { error: schemaError },
        },
      };
    }
  }

  if (beforeToolExec) {
    try {
      const interception = await raceWithAbort(Promise.resolve(beforeToolExec(toolName, effectiveArgs)), effectiveSignal);
      if (interception) {
        if (interception.blocked) {
          if (toolState && invocationId) {
            toolState.transition(invocationId, 'error', { error: interception.reason });
          }
          return {
            functionResponse: {
              name: toolName,
              callId: call.functionCall.callId,
              response: { error: `[插件拦截] ${interception.reason}` },
            },
          };
        }
        if (interception.args) {
          effectiveArgs = interception.args;
        }
      }
    } catch (err) {
      if (isAbortError(err, effectiveSignal)) {
        markInvocationAborted(toolState, invocationId);
        return createAbortResponse(call);
      }
      /* 拦截器错误不阻止执行 */
    }
  }

    // 创建工具执行上下文：带节流的进度上报 + 中止信号 + Handle 能力。
    // 仅在有 ToolStateManager 和 invocationId 时创建 reportProgress（CLI 等场景跳过）。
    let progressCtx: ReturnType<typeof createThrottledReportProgress> | undefined;
    if (toolState && invocationId) {
      progressCtx = createThrottledReportProgress(toolState, invocationId);
    }
    const executionContext: ToolExecutionContext = {
      reportProgress: progressCtx?.reportProgress,
      signal: effectiveSignal,
      approvedByUser: userExplicitlyApproved || undefined,
      // requestApproval: handler 执行过程中可调用此方法请求 Y/N 弹窗确认。
      // 仅在可交互上下文（Console 前台会话）中提供。
      // 用途：命令类 handler 在 AI 分类器拒绝后弹出 Y/N，而不是返回错误让 LLM 对话确认。
      requestApproval: (interactiveApproval && toolState && invocationId)
        ? async () => {
            toolState.transition(invocationId, 'awaiting_approval');
            return toolState.waitForApproval(invocationId, effectiveSignal);
          }
        : undefined,
      invocationId,
      appendOutput: handle
        ? (entry) => handle.appendOutput(entry)
        : undefined,
      onMessage: handle
        ? (listener) => {
            handle.on('_upstream', listener);
            return () => { handle.off('_upstream', listener); };
          }
        : undefined,
    };

  const execStart = Date.now();
  try {
    // 执行工具 handler，支持两种返回类型：
    // - Promise<unknown>：普通一次性返回（现有所有工具的默认行为）
    // - AsyncIterable<unknown>：generator 模式，yield 中间值作为进度更新
    // 进度也可通过 executionContext.reportProgress 回调直接推送（回调驱动场景）。
    // 两种机制是互斥的替代方案，不应在同一个工具中混用。
    // registry.execute 可能返回 Promise（async handler 包裹 generator 的情况）
    // 或直接返回 AsyncIterable。先 await 解包可能的 Promise 层。
    const rawReturn = await raceWithAbort(
      Promise.resolve().then(() => registry.execute(toolName, effectiveArgs, executionContext)),
      effectiveSignal,
    );
    let result: unknown;

    // 检测 AsyncIterable（async handler 返回 generator 时，await 后得到 generator 对象）
    if (rawReturn != null && typeof rawReturn === 'object' && Symbol.asyncIterator in rawReturn) {
      // 迭代消费 generator 的所有 yield 值
      let lastValue: unknown;
      let frameCounter = 0;
      const iterator = (rawReturn as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await raceWithAbort(Promise.resolve(iterator.next()), effectiveSignal);
          if (next.done) break;
          const intermediate = next.value;
          lastValue = intermediate;
          frameCounter++;
          // 将 yield 的中间值作为 progress 推送到 ToolStateManager，
          // 通过 Handle 的 progress 事件推送到前端 ToolCall 组件。
          // 节流：每 4 个 yield 推送一次，避免高频渲染。
          if (toolState && invocationId && frameCounter % 4 === 0) {
            const progress = (typeof lastValue === 'object' && lastValue !== null)
              ? lastValue as Record<string, unknown>
              : { value: lastValue };
            toolState.transition(invocationId, 'executing', { progress });
          }
        }
      } catch (err) {
        if (isAbortError(err, effectiveSignal)) {
          // 不等待 return()，避免非协作 generator 卡住中止路径；只做尽力清理。
          void Promise.resolve(iterator.return?.()).catch(() => {});
        }
        throw err;
      }
      result = lastValue;
    } else {
      // 普通 Promise 返回：registry.execute 已在上方与 AbortSignal race。
      result = rawReturn;
    }
    throwIfAborted(effectiveSignal);
    const durationMs = Date.now() - execStart;

    // 保存原始返回值，用于 MCP 附件识别兜底（afterToolExec 可能改变 result 的结构）
    const rawResult = result;

    // 插件钩子：工具执行后拦截器（上游 main 新增）
    if (afterToolExec) {
      try {
        const interception = await raceWithAbort(
          Promise.resolve(afterToolExec(toolName, effectiveArgs, result, durationMs)),
          effectiveSignal,
        );
        if (interception) {
          result = interception.result;
        }
      } catch (err: unknown) {
        if (isAbortError(err, effectiveSignal)) throw err;
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`插件 onAfterToolExec 执行失败，已忽略: ${toolName}: ${errorMsg}`);
      }
    }

    // MCP 结果识别：优先检查 afterToolExec 后的 result，回退到原始 rawResult。
    // MCP 工具返回 { text, attachments }，把 text 留给 LLM，附件旁路给平台层。
    const isMCPEnvelope = (v: unknown): v is { text: string; attachments: ToolAttachment[] } =>
      v != null && typeof v === 'object' && !Array.isArray(v)
      && typeof (v as any).text === 'string'
      && Array.isArray((v as any).attachments);
    const isMCPResult = isMCPEnvelope(result) || isMCPEnvelope(rawResult);
    const mcpSource = isMCPEnvelope(result) ? result : (isMCPEnvelope(rawResult) ? rawResult : undefined);

    // 现有约定：普通工具也可以通过 __response / __parts 返回富结果。
    // 这是旧链路，保留不动，避免影响已有的截图/音频工具。
    const isRichResult = !isMCPResult
      && result != null
      && typeof result === 'object'
      && !Array.isArray(result)
      && '__response' in (result as Record<string, unknown>);

    let response: Record<string, unknown>;
    let responseParts: InlineDataPart[] | undefined;
    let stateResult: unknown = result;

    if (isMCPResult) {
      // mcpSource 已在上面通过 isMCPEnvelope 确定，此处断言安全
      const mcp = mcpSource!;
      response = { result: mcp.text };
      logger.info(`[executeSingle] MCP 结果识别: tool=${toolName}, text长度=${mcp.text.length}, attachments=${mcp.attachments.length}`);
      stateResult = mcp.text;

      // 附件不进入 functionResponse.parts，否则会被历史/上下文继续携带。
      // 这里通过回调旁路给平台层，让 Telegram / Discord / Lark 自己发图。
      if (mcp.attachments.length > 0) {
        onAttachments?.(mcp.attachments);
      }
    } else if (isRichResult) {
      const rich = result as Record<string, unknown>;
      response = (rich.__response as Record<string, unknown>) ?? {};
      responseParts = Array.isArray(rich.__parts) ? rich.__parts as InlineDataPart[] : undefined;
      // Skill 上下文修改器：传递到 FunctionResponsePart，由 ToolLoop 提取并剥离
      if (rich.__contextModifier) response.__contextModifier = rich.__contextModifier;
    } else {
      response = { result } as Record<string, unknown>;
    }

    // [状态修复] 批量工具可能通过 failCount 表达业务失败而不 throw。
    // 调度层必须把“全失败 / 部分失败”映射到 error / warning，避免 UI 出现假成功绿勾。
    const analyzedOutcome = analyzeStructuredToolResult(result);
    if (analyzedOutcome?.status === 'error') {
      response = { error: analyzedOutcome.error ?? '工具执行失败', result };
    }

    // 销毁进度上报：刷新最后一个待推送值，然后停止接受新调用。
    // 必须在 transition 到终态之前调用，否则 trailing timer 可能在终态后
    // 触发 executing → success/error 的非法状态转换。
    progressCtx?.dispose();
    if (toolState && invocationId) {
      // [防护] handler 可能已通过 requestApproval 将状态设为终态（如用户拒绝审批），
      // 此时不应再尝试状态转换，否则会因终态无出边而抛出异常。
      const currentInv = toolState.get(invocationId);
      if (currentInv && !TERMINAL_TOOL_STATUSES.has(currentInv.status)) {
        // [状态修复] 根据结构化结果选择 success / warning / error，
        // 避免批量工具全失败时仍落成 success。
        if (analyzedOutcome?.status === 'error') {
          toolState.transition(invocationId, 'error', { error: analyzedOutcome.error ?? '工具执行失败' });
        } else if (analyzedOutcome?.status === 'warning') {
          toolState.transition(invocationId, 'warning', {
            result: stateResult,
            error: analyzedOutcome.error,
          });
        } else {
          // 存储尽量轻量的结果。MCP 图片附件已经通过 onAttachments 旁路发送，
          // 这里不保留 Buffer，避免状态对象被大块二进制拖重。
          toolState.transition(invocationId, 'success', { result: stateResult });
        }
      }
    }
    return {
      functionResponse: {
        name: call.functionCall.name,
        callId: call.functionCall.callId,
        response,
        durationMs,
        ...(responseParts ? { parts: responseParts } : {}),
      },
    };
  } catch (err: unknown) {
    const aborted = isAbortError(err, effectiveSignal);
    const errorMsg = aborted ? OPERATION_ABORTED_ERROR : (err instanceof Error ? err.message : String(err));
    const durationMs = Date.now() - execStart;
    // 销毁进度上报（防止 trailing timer 在终态后触发非法状态转换）
    progressCtx?.dispose();
    if (toolState && invocationId) {
      try {
        toolState.transition(invocationId, 'error', { error: errorMsg });
      } catch {
        // 可能已在终态（如 handler 内 requestApproval 被用户拒绝），忽略二次转换错误
      }
    }
    if (aborted) {
      logger.info(`工具执行被中止: ${call.functionCall.name}${invocationId ? ` (${invocationId})` : ''}`);
    } else {
      logger.error(`工具执行失败: ${call.functionCall.name}:`, errorMsg);
    }
    return {
      functionResponse: {
        name: call.functionCall.name,
        callId: call.functionCall.callId,
        response: { error: errorMsg },
        durationMs,
      },
    };
  }
}

/**
 * 按执行计划执行所有工具调用。
 *
 * ToolStateManager 和 invocationIds 均可选：
 *   - 提供时：维护工具状态生命周期（queued → executing → success/error）
 *   - 省略时：纯执行，无状态追踪（适用于子代理、CLI 等场景）
 *
 * 返回的 responseParts 保持与原始 calls 相同的顺序。
 *
 * 支持 AbortSignal：每批执行前检查，已 abort 时剩余工具直接返回错误。
 */
export async function executePlan(
  calls: FunctionCallPart[],
  plan: ExecutionBatch[],
  registry: ToolRegistry,
  toolState?: ToolStateManager,
  invocationIds?: string[],
  toolsConfig: ToolsConfig = { permissions: {} },
  signal?: AbortSignal,
  beforeToolExec?: BeforeToolExecInterceptor,
  afterToolExec?: AfterToolExecInterceptor,
  onAttachments?: (attachments: ToolAttachment[]) => void,
): Promise<FunctionResponsePart[]> {
  const responseParts: FunctionResponsePart[] = new Array(calls.length);

  for (const batch of plan) {
    // 每批执行前检查 abort
    if (signal?.aborted) {
      for (const i of batch.indices) {
        if (!responseParts[i]) {
          markInvocationAborted(toolState, invocationIds?.[i]);
          responseParts[i] = createAbortResponse(calls[i]);
        }
      }
      continue;
    }

    if (batch.parallel && batch.indices.length > 1) {
      const names = batch.indices.map(i => calls[i].functionCall.name).join(', ');
      logger.info(`并行执行 ${batch.indices.length} 个工具: [${names}]`);

      const results = await Promise.all(
        batch.indices.map(i =>
          executeSingle(calls[i], registry, toolState, invocationIds?.[i], toolsConfig, signal, beforeToolExec, afterToolExec, onAttachments)
        ),
      );
      for (let j = 0; j < batch.indices.length; j++) {
        responseParts[batch.indices[j]] = results[j];
      }
    } else {
      for (const i of batch.indices) {
        responseParts[i] = await executeSingle(calls[i], registry, toolState, invocationIds?.[i], toolsConfig, signal, beforeToolExec, afterToolExec, onAttachments);
      }
    }
  }

  return responseParts;
}


// ============ 预览审批判断 ============

/** 工具执行前，是否需要进入 awaiting_apply 打开 diff 预览（二类审批） */
function shouldShowDiffPreview(
  call: FunctionCallPart,
  policy: ToolPolicyConfig,
): boolean {
  if (policy.showApprovalView !== true) return false;
  const toolName = call.functionCall.name;
  if (
    toolName === 'apply_diff' ||
    toolName === 'write_file' ||
    toolName === 'insert_code' ||
    toolName === 'delete_code'
  ) {
    return true;
  }
  if (toolName === 'search_in_files') {
    const args = (call.functionCall.args ?? {}) as Record<string, unknown>;
    return ((args.mode as string | undefined) ?? 'search') === 'replace';
  }
  return false;
}
