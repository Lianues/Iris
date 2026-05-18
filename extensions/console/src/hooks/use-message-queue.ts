import { useCallback, useRef, useState } from 'react';

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: number;
}

export interface UseMessageQueueReturn {
  /** 当前队列快照（响应式） */
  queue: QueuedMessage[];
  /** 入队到指定位置（队首），用于"立即发送"等场景 */
  prepend: (text: string) => QueuedMessage;
  /** 入队，返回新创建的 QueuedMessage */
  enqueue: (text: string) => QueuedMessage;
  /** 出队（FIFO），队列空时返回 undefined */
  dequeue: () => QueuedMessage | undefined;
  /** 查看队首（不移除） */
  peek: () => QueuedMessage | undefined;
  /** 编辑指定消息的文本 */
  edit: (id: string, newText: string) => boolean;
  /** 移除指定消息 */
  remove: (id: string) => boolean;
  /** 将指定消息上移一位，返回是否成功 */
  moveUp: (id: string) => boolean;
  /** 将指定消息下移一位，返回是否成功 */
  moveDown: (id: string) => boolean;
  /** 清空队列 */
  clear: () => void;
  /** 队列长度 */
  size: number;
}

let queueIdCounter = 0;

export function useMessageQueue(): UseMessageQueueReturn {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);

  // 同步更新 ref 和 state
  const sync = useCallback((next: QueuedMessage[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const prepend = useCallback((text: string): QueuedMessage => {
    const msg: QueuedMessage = {
      id: `queued-${++queueIdCounter}`,
      text,
      createdAt: Date.now(),
    };
    const next = [msg, ...queueRef.current];
    sync(next);
    return msg;
  }, [sync]);

  const enqueue = useCallback((text: string): QueuedMessage => {
    const msg: QueuedMessage = {
      id: `queued-${++queueIdCounter}`,
      text,
      createdAt: Date.now(),
    };
    const next = [...queueRef.current, msg];
    sync(next);
    return msg;
  }, [sync]);

  const dequeue = useCallback((): QueuedMessage | undefined => {
    const current = queueRef.current;
    if (current.length === 0) return undefined;
    const [first, ...rest] = current;
    sync(rest);
    return first;
  }, [sync]);

  const peek = useCallback((): QueuedMessage | undefined => {
    return queueRef.current[0];
  }, []);

  const edit = useCallback((id: string, newText: string): boolean => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0) return false;
    const next = [...current];
    next[index] = { ...next[index], text: newText };
    sync(next);
    return true;
  }, [sync]);

  const remove = useCallback((id: string): boolean => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0) return false;
    const next = current.filter((m) => m.id !== id);
    sync(next);
    return true;
  }, [sync]);

  const moveUp = useCallback((id: string): boolean => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index <= 0) return false;
    const next = [...current];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    sync(next);
    return true;
  }, [sync]);

  const moveDown = useCallback((id: string): boolean => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0 || index >= current.length - 1) return false;
    const next = [...current];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    sync(next);
    return true;
  }, [sync]);

  const clear = useCallback(() => {
    sync([]);
  }, [sync]);

  return {
    queue,
    prepend,
    enqueue,
    dequeue,
    peek,
    edit,
    remove,
    moveUp,
    moveDown,
    clear,
    size: queue.length,
  };
}
