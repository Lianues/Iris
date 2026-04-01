/**
 * 流式 LLM 调用与 chunk 合并
 */

import { EventEmitter } from 'events';
import type { LLMRouter } from '../../llm/router';
import type { Content, Part, LLMRequest, UsageMetadata } from '../../types';
import { createLogger } from '../../logger';

const logger = createLogger('Backend');

// ============ Thought Timing ============

export interface ThoughtTimingState {
  activeStartedAt?: number;
}

// ============ Part 合并 ============

/**
 * 将新 Part 追加/合并到 parts 数组中。
 * 如果新 Part 与数组最后一个 Part 同类型（均为 text 或均为 thought），
 * 则原地拼接文本，避免产生过多碎片化的 Part。
 */
export function appendMergedPart(parts: Part[], nextPart: Part, now: number, thoughtTiming?: ThoughtTimingState): Part {
  let normalizedPart = nextPart;
  if ('text' in nextPart && nextPart.thought === true) {
    if (thoughtTiming && thoughtTiming.activeStartedAt == null) {
      thoughtTiming.activeStartedAt = now;
    }
    normalizedPart = {
      ...nextPart,
      thoughtDurationMs: thoughtTiming?.activeStartedAt != null ? now - thoughtTiming.activeStartedAt : nextPart.thoughtDurationMs,
    };
  } else if (thoughtTiming) {
    thoughtTiming.activeStartedAt = undefined;
  }

  const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
  if (lastPart && 'text' in lastPart && ('text' in normalizedPart || 'thoughtSignatures' in normalizedPart)) {
    const lastThought = lastPart.thought === true;
    const nextThought = normalizedPart.thought === true;
    if (lastThought === nextThought) {
      // 如果新 part 有签名且与上一个不同，则不合并，以保留位置
      const lastSigs = JSON.stringify(lastPart.thoughtSignatures || {});
      const nextSigs = JSON.stringify(normalizedPart.thoughtSignatures || {});
      const isSignatureOnlyPart = !normalizedPart.text && nextSigs !== '{}';

      // 流式结束时如果补来一个"仅签名"块，则回填到上一段同类型文本，避免丢签名或产生空白块
      if (isSignatureOnlyPart && lastSigs === '{}') {
        lastPart.thoughtSignatures = {
          ...(lastPart.thoughtSignatures || {}),
          ...(normalizedPart.thoughtSignatures || {}),
        };
        if (normalizedPart.thoughtDurationMs != null) {
          lastPart.thoughtDurationMs = normalizedPart.thoughtDurationMs;
        }
        return lastPart;
      }

      // 只有在签名一致，或者新块没有签名时才合并
      if (nextSigs === '{}' || lastSigs === nextSigs) {
        if (normalizedPart.text) {
          lastPart.text = (lastPart.text || '') + normalizedPart.text;
        }
        if (normalizedPart.thoughtDurationMs != null) {
          lastPart.thoughtDurationMs = normalizedPart.thoughtDurationMs;
        }
        return lastPart;
      }
    }
  }
  parts.push(normalizedPart);
  return normalizedPart;
}

// ============ 流式 LLM 调用 ============

/**
 * 通过流式 API 调用 LLM 并收集完整响应。
 * 调用过程中通过 emitter 发出 stream:start / stream:parts / stream:chunk / stream:end / usage 事件。
 */
export async function callLLMStream(
  router: LLMRouter,
  emitter: EventEmitter,
  sessionId: string,
  request: LLMRequest,
  modelName?: string,
  signal?: AbortSignal,
  /** 流式中每产生一个完整的 functionCall part 时回调，供 StreamingToolExecutor 提前启动工具执行 */
  onFunctionCallReady?: (call: import('../../types').FunctionCallPart) => void,
): Promise<Content> {
  const parts: Part[] = [];
  let usageMetadata: UsageMetadata | undefined;
  let streamOutputFirstChunkAt: number | undefined;
  let streamOutputLastChunkAt: number | undefined;
  let streamOutputChunkCount = 0;
  const thoughtTiming: ThoughtTimingState = {};

  emitter.emit('stream:start', sessionId);

  const llmStream = router.chatStream(request, modelName, signal);
  for await (const chunk of llmStream) {
    const deltaParts: Part[] = [];

    if (chunk.partsDelta && chunk.partsDelta.length > 0) {
      deltaParts.push(...chunk.partsDelta);
    } else {
      if (chunk.textDelta) {
        deltaParts.push({ text: chunk.textDelta });
      }
      if (chunk.functionCalls) {
        deltaParts.push(...chunk.functionCalls);
      }
    }

    if (deltaParts.length > 0) {
      const emittedParts: Part[] = [];
      const now = Date.now();
      if (streamOutputFirstChunkAt == null) {
        streamOutputFirstChunkAt = now;
      }
      streamOutputLastChunkAt = now;
      streamOutputChunkCount++;
      for (const part of deltaParts) {
        const merged = appendMergedPart(parts, part, now, thoughtTiming);
        // appendMergedPart 返回的是 parts 数组中累积后的对象引用（原地拼接），
        // 不能直接作为增量发送，否则前端会收到全量内容导致重复。
        // 这里用原始的 delta part 浅拷贝作为增量发送。
        const delta: Part = { ...part };
        // 如果是 thought 类型，补上 appendMergedPart 计算出的 timing 信息
        if ('text' in delta && 'text' in merged
          && delta.thought === true && merged.thoughtDurationMs != null) {
          delta.thoughtDurationMs = merged.thoughtDurationMs;
        }
        emittedParts.push(delta);
      }
      emitter.emit('stream:parts', sessionId, emittedParts);

      // 流式边执行工具：每当一个完整的 functionCall part 出现在 deltaParts 中，
      // 立即通知外部启动工具执行。functionCall part 不会被 appendMergedPart 合并
      // （只有 text/thought 才合并），所以 deltaParts 里出现的每个 functionCall
      // 都是一个完整的独立调用。
      if (onFunctionCallReady) {
        for (const part of deltaParts) {
          if ('functionCall' in part) {
            onFunctionCallReady(part as import('../../types').FunctionCallPart);
          }
        }
      }
    }

    if (chunk.textDelta) {
      emitter.emit('stream:chunk', sessionId, chunk.textDelta);
    }
    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;

    // 当 LLM 代理将流式响应缓冲后一次性返回时，async generator 的所有 yield
    // 通过微任务链连续恢复，res.write() 调用不会真正 flush 到 TCP socket。
    // 插入宏任务断点让事件循环走过 I/O 阶段，确保每个 chunk 的 SSE 数据
    // 被操作系统发送到客户端，使浏览器端能逐步接收到流式事件。
    if (deltaParts.length > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  // 诊断日志：流式 chunk 到达时间分布
  if (streamOutputChunkCount > 0) {
    const spread = (streamOutputLastChunkAt ?? 0) - (streamOutputFirstChunkAt ?? 0);
    logger.info(`[Stream] ${streamOutputChunkCount} chunks, spread=${spread}ms (first→last)`);
  }

  // 确保最后一个 chunk 的 SSE 数据已刷新到 TCP socket，再发送 stream:end
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  emitter.emit('stream:end', sessionId, usageMetadata);
  if (usageMetadata) {
    emitter.emit('usage', sessionId, usageMetadata);
  }

  if (parts.length === 0) parts.push({ text: '' });

  const content: Content = {
    role: 'model',
    parts,
    createdAt: streamOutputFirstChunkAt ?? Date.now(),
    modelName: modelName || router.getCurrentModelName(),
  };
  if (usageMetadata) content.usageMetadata = usageMetadata;
  if (
    streamOutputChunkCount >= 3 &&
    streamOutputFirstChunkAt != null &&
    streamOutputLastChunkAt != null
  ) content.streamOutputDurationMs = streamOutputLastChunkAt - streamOutputFirstChunkAt;

  return content;
}
