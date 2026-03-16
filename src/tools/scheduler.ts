/**
 * 工具执行调度器
 *
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
import { FunctionCallPart, FunctionResponsePart } from '../types';
import { createLogger } from '../logger';
import { ToolPolicyConfig } from '../config';

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
 * 判断工具调用是否应该自动批准。
 *
 * 对 shell 工具支持 allowPatterns / denyPatterns 细粒度控制：
 *   优先级：denyPatterns > allowPatterns > autoApprove
 *
 *   1. 命令匹配 denyPatterns  → 必须手动确认（即使 autoApprove: true）
 *   2. 命令匹配 allowPatterns → 自动执行（即使 autoApprove: false）
 *   3. 都不匹配              → 回退到 autoApprove 布尔值
 */
function shouldAutoApprove(
  call: FunctionCallPart,
  policy: ToolPolicyConfig,
): boolean {
  const hasPatterns = policy.allowPatterns?.length || policy.denyPatterns?.length;

  // 非 shell 工具 或 未配置任何模式 → 直接用 autoApprove
  if (call.functionCall.name !== 'shell' || !hasPatterns) {
    return policy.autoApprove;
  }

  const command = extractShellCommand(call);
  if (!command) return policy.autoApprove;

  // 1. denyPatterns 最高优先
  if (policy.denyPatterns?.length && matchesAnyPattern(command, policy.denyPatterns)) {
    return false;
  }

  // 2. allowPatterns 次之
  if (policy.allowPatterns?.length && matchesAnyPattern(command, policy.allowPatterns)) {
    return true;
  }

  // 3. 兜底
  return policy.autoApprove;
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

/**
 * 执行单个工具调用。
 *
 * 当 autoApprove 为 false 时，先将状态切到 awaiting_approval 并阻塞，
 * 等待外部代码（平台层）将状态转为 executing（批准）或 error（拒绝）。
 *
 * 支持 AbortSignal：执行前检查，已 abort 时直接返回错误。
 */
async function executeSingle(
  call: FunctionCallPart,
  registry: ToolRegistry,
  toolState?: ToolStateManager,
  invocationId?: string,
  toolPolicies: Record<string, ToolPolicyConfig> = {},
  signal?: AbortSignal,
): Promise<FunctionResponsePart> {
  const toolName = call.functionCall.name;

  // 执行前检查 abort
  if (signal?.aborted) {
    const abortMsg = 'Operation aborted';
    if (toolState && invocationId) {
      toolState.transition(invocationId, 'error', { error: abortMsg });
    }
    return {
      functionResponse: {
        name: toolName,
        callId: call.functionCall.callId,
        response: { error: abortMsg },
      },
    };
  }

  // 检查工具策略
  const policy = toolPolicies[toolName];
  if (!policy) {
    const errorMsg = `工具未被允许执行: ${toolName}。请先在 tools.yaml 中配置该工具。`;
    if (toolState && invocationId) {
      toolState.transition(invocationId, 'error', { error: errorMsg });
    }
    logger.warn(errorMsg);
    return {
      functionResponse: {
        name: toolName,
        response: { error: errorMsg },
      },
    };
  }

  if (toolState && invocationId) {
    if (!shouldAutoApprove(call, policy)) {
      // 需要用户批准
      toolState.transition(invocationId, 'awaiting_approval');
      const approved = await toolState.waitForApproval(invocationId);
      if (!approved) {
        return {
          functionResponse: {
            name: toolName,
            response: { error: '用户已拒绝执行该工具' },
          },
        };
      }
    } else {
      toolState.transition(invocationId, 'executing');
    }
  }
  logger.info(`执行工具: ${call.functionCall.name}${invocationId ? ` (${invocationId})` : ''}`);

  try {
    const result = await registry.execute(
      call.functionCall.name,
      call.functionCall.args as Record<string, unknown>,
    );
    if (toolState && invocationId) {
      toolState.transition(invocationId, 'success', { result });
    }
    return {
      functionResponse: {
        name: call.functionCall.name,
        callId: call.functionCall.callId,
        response: { result } as Record<string, unknown>,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (toolState && invocationId) {
      toolState.transition(invocationId, 'error', { error: errorMsg });
    }
    logger.error(`工具执行失败: ${call.functionCall.name}:`, errorMsg);
    return {
      functionResponse: {
        name: call.functionCall.name,
        callId: call.functionCall.callId,
        response: { error: errorMsg },
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
  toolPolicies: Record<string, ToolPolicyConfig> = {},
  signal?: AbortSignal,
): Promise<FunctionResponsePart[]> {
  const responseParts: FunctionResponsePart[] = new Array(calls.length);

  for (const batch of plan) {
    // 每批执行前检查 abort
    if (signal?.aborted) {
      for (const i of batch.indices) {
        if (!responseParts[i]) {
          const abortMsg = 'Operation aborted';
          if (toolState && invocationIds?.[i]) {
            try { toolState.transition(invocationIds[i], 'error', { error: abortMsg }); } catch { /* 状态已经终态 */ }
          }
          responseParts[i] = {
            functionResponse: {
              name: calls[i].functionCall.name,
              callId: calls[i].functionCall.callId,
              response: { error: abortMsg },
            },
          };
        }
      }
      continue;
    }

    if (batch.parallel && batch.indices.length > 1) {
      const names = batch.indices.map(i => calls[i].functionCall.name).join(', ');
      logger.info(`并行执行 ${batch.indices.length} 个工具: [${names}]`);

      const results = await Promise.all(
        batch.indices.map(i =>
          executeSingle(calls[i], registry, toolState, invocationIds?.[i], toolPolicies, signal)
        ),
      );
      for (let j = 0; j < batch.indices.length; j++) {
        responseParts[batch.indices[j]] = results[j];
      }
    } else {
      for (const i of batch.indices) {
        responseParts[i] = await executeSingle(calls[i], registry, toolState, invocationIds?.[i], toolPolicies, signal);
      }
    }
  }

  return responseParts;
}
