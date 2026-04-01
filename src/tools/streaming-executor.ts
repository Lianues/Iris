/**
 * 流式工具执行器
 *
 * 在 LLM 流式输出过程中，每收到一个完整的 functionCall part 就立即开始执行，
 * 不等 LLM 输出完全结束。这样工具执行和 LLM 输出可以重叠，减少总等待时间。
 *
 * 并发控制：
 *   - parallel=true 的工具可以与其他 parallel=true 的工具并行执行
 *   - parallel=false 的工具必须独占执行（等待所有先前的工具完成）
 *   - 结果按原始顺序输出（与模型输出顺序一致）
 *
 * 对标 Claude Code 的 StreamingToolExecutor.ts。
 */

import type { FunctionCallPart, FunctionResponsePart, ToolAttachment } from '../types';
import { isFunctionCallPart } from '../types';
import type { ToolRegistry } from './registry';
import type { ToolStateManager } from './state';
import type { ToolsConfig } from '../config';
import type { BeforeToolExecInterceptor, AfterToolExecInterceptor } from '../extension';
import { executeSingleTool } from './scheduler';
import { createLogger } from '../logger';

const logger = createLogger('StreamingToolExecutor');

/** 跟踪中的工具 */
interface TrackedTool {
  /** 原始索引（模型输出顺序） */
  index: number;
  call: FunctionCallPart;
  /** 是否可并行执行 */
  isParallel: boolean;
  /** 执行 promise（已启动后有值） */
  promise?: Promise<FunctionResponsePart>;
  /** 执行结果（完成后有值） */
  result?: FunctionResponsePart;
}

export class StreamingToolExecutor {
  private tracked: TrackedTool[] = [];
  private nextIndex = 0;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly toolState: ToolStateManager | undefined,
    private readonly toolsConfig: ToolsConfig,
    private readonly signal: AbortSignal | undefined,
    private readonly beforeToolExec: BeforeToolExecInterceptor | undefined,
    private readonly afterToolExec: AfterToolExecInterceptor | undefined,
    private readonly onAttachments: ((attachments: ToolAttachment[]) => void) | undefined,
    private readonly sessionId: string | undefined,
  ) {}

  /**
   * 添加一个工具调用。立即尝试启动执行。
   * 由 callLLMStream 在流式中检测到新的 functionCall part 时调用。
   */
  addTool(call: FunctionCallPart): void {
    const tool = this.registry.get(call.functionCall.name);
    let isParallel = false;
    if (tool?.parallel) {
      if (typeof tool.parallel === 'function') {
        try {
          const args = call.functionCall.args as Record<string, unknown>;
          isParallel = tool.parallel(args) === true;
        } catch { isParallel = false; }
      } else {
        isParallel = tool.parallel === true;
      }
    }

    const tracked: TrackedTool = {
      index: this.nextIndex++,
      call,
      isParallel,
    };
    this.tracked.push(tracked);

    // 尝试立即启动
    this.tryStartNext();
  }

  /**
   * 获取已添加的工具数量。
   */
  get size(): number {
    return this.tracked.length;
  }

  /**
   * 等待所有已添加的工具执行完毕，按原始顺序返回结果。
   * 由 ToolLoop 在流式结束后调用。
   */
  async waitForAll(): Promise<FunctionResponsePart[]> {
    // 启动所有尚未启动的工具（流结束后不会再有新工具添加，可以放心启动）
    this.tryStartAll();

    // 等待所有 promise
    await Promise.all(this.tracked.map(t => t.promise).filter(Boolean));

    // 按原始顺序返回
    return this.tracked.map(t => t.result!).filter(Boolean);
  }

  /**
   * 尝试启动下一个可以执行的工具。
   *
   * 规则：
   *   - 如果当前有 non-parallel 工具正在执行，不启动任何新工具
   *   - 如果下一个待启动的工具是 non-parallel，且当前有任何工具在执行，不启动
   *   - 如果下一个待启动的工具是 parallel，且当前没有 non-parallel 工具在执行，立即启动
   */
  private tryStartNext(): void {
    for (const tool of this.tracked) {
      if (tool.promise) continue; // 已启动

      // 检查是否可以启动
      const executing = this.tracked.filter(t => t.promise && !t.result);
      const hasNonParallelExecuting = executing.some(t => !t.isParallel);

      if (hasNonParallelExecuting) {
        // 有 non-parallel 工具正在执行，不启动任何新工具
        break;
      }

      if (!tool.isParallel && executing.length > 0) {
        // 当前工具是 non-parallel，但当前有其他工具在执行，等待
        break;
      }

      // 可以启动
      this.startTool(tool);
    }
  }

  /**
   * 启动所有尚未启动的工具（流结束后调用）。
   * 流结束后不会再有新工具添加，所以可以放心启动剩余的。
   * 仍然遵守并发规则：non-parallel 工具会串行等待前面的完成。
   */
  private tryStartAll(): void {
    for (const tool of this.tracked) {
      if (tool.promise) continue;
      this.startTool(tool);
    }
  }

  /**
   * 启动单个工具的执行。
   */
  private startTool(tool: TrackedTool): void {
    // 创建 toolState invocation（如果有状态管理）
    let invocationId: string | undefined;
    if (this.toolState) {
      const inv = this.toolState.create(
        tool.call.functionCall.name,
        tool.call.functionCall.args as Record<string, unknown>,
        'queued',
        this.sessionId,
      );
      invocationId = inv.id;
    }

    logger.info(`流式边执行: 启动工具 ${tool.call.functionCall.name} (index=${tool.index})`);

    // 启动执行（不 await）
    tool.promise = executeSingleTool(
      tool.call,
      this.registry,
      this.toolState,
      invocationId,
      this.toolsConfig,
      this.signal,
      this.beforeToolExec,
      this.afterToolExec,
      this.onAttachments,
    ).then(result => {
      tool.result = result;
      // 工具完成后尝试启动下一个（non-parallel 工具完成后可能解锁后续工具）
      this.tryStartNext();
      return result;
    });
  }
}
