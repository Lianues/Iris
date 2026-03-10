/**
 * 工具执行调度器
 *
 * 负责将 LLM 输出的一组工具调用分批并执行。
 *
 * 调度策略：
 *   - 默认串行：每个工具独占一批，顺序执行。
 *   - 局部并行：连续的 parallel=true 工具归为同一批，并发执行。
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

const logger = createLogger('ToolScheduler');

// ============ 类型 ============

/** 一个执行批次 */
export interface ExecutionBatch {
  /** 此批次包含的调用索引（对应原始 functionCalls 数组） */
  indices: number[];
  /** 此批次是否并行执行 */
  parallel: boolean;
}

// ============ 分批 ============

/**
 * 将一组工具调用按调度策略分批。
 *
 * 规则：
 *   1. 连续的 parallel=true 工具归为同一批（并行执行）
 *   2. parallel=false 的工具独占一批（串行执行）
 *   3. 未注册的工具视为串行
 */
export function buildExecutionPlan(
  calls: FunctionCallPart[],
  registry: ToolRegistry,
): ExecutionBatch[] {
  const batches: ExecutionBatch[] = [];
  let i = 0;

  while (i < calls.length) {
    const tool = registry.get(calls[i].functionCall.name);
    const canParallel = tool?.parallel === true;

    if (!canParallel) {
      // 串行工具：独占一批
      batches.push({ indices: [i], parallel: false });
      i++;
    } else {
      // 并行工具：累积连续的 parallel=true
      const batch: number[] = [];
      while (i < calls.length) {
        const t = registry.get(calls[i].functionCall.name);
        if (t?.parallel !== true) break;
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
 * 执行单个工具调用，管理 ToolStateManager 状态转换。
 */
async function executeSingle(
  call: FunctionCallPart,
  invocationId: string,
  registry: ToolRegistry,
  toolState: ToolStateManager,
): Promise<FunctionResponsePart> {
  toolState.transition(invocationId, 'executing');
  logger.info(`执行工具: ${call.functionCall.name} (${invocationId})`);

  try {
    const result = await registry.execute(
      call.functionCall.name,
      call.functionCall.args as Record<string, unknown>,
    );
    toolState.transition(invocationId, 'success', { result });
    return {
      functionResponse: {
        name: call.functionCall.name,
        response: { result } as Record<string, unknown>,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    toolState.transition(invocationId, 'error', { error: errorMsg });
    logger.error(`工具执行失败: ${call.functionCall.name} (${invocationId}):`, errorMsg);
    return {
      functionResponse: {
        name: call.functionCall.name,
        response: { error: errorMsg },
      },
    };
  }
}

/**
 * 按执行计划执行所有工具调用。
 *
 * 调用方先通过 ToolStateManager.create() 创建所有 invocation（状态 queued），
 * 然后将 invocation ID 数组和执行计划一起传入。
 *
 * 返回的 responseParts 保持与原始 calls 相同的顺序。
 */
export async function executePlan(
  calls: FunctionCallPart[],
  plan: ExecutionBatch[],
  invocationIds: string[],
  registry: ToolRegistry,
  toolState: ToolStateManager,
): Promise<FunctionResponsePart[]> {
  // 预分配结果数组，保证顺序与原始 calls 一致
  const responseParts: FunctionResponsePart[] = new Array(calls.length);

  for (const batch of plan) {
    if (batch.parallel && batch.indices.length > 1) {
      // 并行执行
      const names = batch.indices.map(i => calls[i].functionCall.name).join(', ');
      logger.info(`并行执行 ${batch.indices.length} 个工具: [${names}]`);

      const results = await Promise.all(
        batch.indices.map(i =>
          executeSingle(calls[i], invocationIds[i], registry, toolState)
        ),
      );
      for (let j = 0; j < batch.indices.length; j++) {
        responseParts[batch.indices[j]] = results[j];
      }
    } else {
      // 串行执行
      for (const i of batch.indices) {
        responseParts[i] = await executeSingle(calls[i], invocationIds[i], registry, toolState);
      }
    }
  }

  return responseParts;
}
