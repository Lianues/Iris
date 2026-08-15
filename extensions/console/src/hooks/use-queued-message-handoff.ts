import { useEffect, useRef } from 'react';
import type { QueuedMessage } from './use-message-queue';

interface UseQueuedMessageHandoffOptions {
  isGenerating: boolean;
  paused: boolean;
  queueSize: number;
  dequeue: () => QueuedMessage | undefined;
  onSubmit: (text: string) => void;
}

/**
 * 当 TUI 恢复空闲时，把本地队列的第一条消息交给平台层。
 *
 * 普通 chat turn 会在平台层继续排流剩余消息；这里仅负责 compact 等
 * 独立前台操作结束后的首次交接。pending ref 防止 generating 状态
 * 尚未完成下一次渲染时，重复提交多条消息。
 */
export function useQueuedMessageHandoff({
  isGenerating,
  paused,
  queueSize,
  dequeue,
  onSubmit,
}: UseQueuedMessageHandoffOptions): void {
  const handoffPendingRef = useRef(false);

  useEffect(() => {
    if (isGenerating) {
      handoffPendingRef.current = false;
      return;
    }

    if (paused || queueSize === 0 || handoffPendingRef.current) return;

    const next = dequeue();
    if (!next) return;

    handoffPendingRef.current = true;
    onSubmit(next.text);
  }, [dequeue, isGenerating, onSubmit, paused, queueSize]);
}
