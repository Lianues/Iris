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
 */
async function executeSingle(
  call: FunctionCallPart,
  registry: ToolRegistry,
  toolState?: ToolStateManager,
  invocationId?: string,
  toolPolicies: Record<string, ToolPolicyConfig> = {},
): Promise<FunctionResponsePart> {
  const toolName = call.functionCall.name;
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
    if (!policy.autoApprove) {
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
 *按执行计划执行所有工具调用。
 *
 * ToolStateManager 和 invocationIds 均可选：
 *   - 提供时：维护工具状态生命周期（queued → executing → success/error）
 *   - 省略时：纯执行，无状态追踪（适用于子代理、CLI 等场景）
 *
 * 返回的 responseParts 保持与原始 calls 相同的顺序。
 */
export async function executePlan(
  calls: FunctionCallPart[],
  plan: ExecutionBatch[],
  registry: ToolRegistry,
  toolState?: ToolStateManager,
  invocationIds?: string[],
  toolPolicies: Record<string, ToolPolicyConfig> = {},
): Promise<FunctionResponsePart[]> {
  const responseParts: FunctionResponsePart[] = new Array(calls.length);

  for (const batch of plan) {
    if (batch.parallel && batch.indices.length > 1) {
      const names = batch.indices.map(i => calls[i].functionCall.name).join(', ');
      logger.info(`并行执行 ${batch.indices.length} 个工具: [${names}]`);

      const results = await Promise.all(
        batch.indices.map(i =>
          executeSingle(calls[i], registry, toolState, invocationIds?.[i], toolPolicies)
        ),
      );
      for (let j = 0; j < batch.indices.length; j++) {
        responseParts[batch.indices[j]] = results[j];
      }
    } else {
      for (const i of batch.indices) {
        responseParts[i] = await executeSingle(calls[i], registry, toolState, invocationIds?.[i], toolPolicies);
      }
    }
  }

  return responseParts;
}
