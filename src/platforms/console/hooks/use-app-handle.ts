import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToolInvocation, UsageMetadata } from '../../../types';
import type { ChatMessage, MessagePart } from '../components/MessageItem';
import type { RetryInfo } from '../components/GeneratingTimer';
import type { MessageMeta } from '../app-types';
import {
  appendAssistantParts,
  appendMergedMessagePart,
  applyToolInvocationsToParts,
  mergeMessageParts,
  nextMsgId,
} from '../message-utils';
import { clearRedo, type UndoRedoStack } from '../undo-redo';

export interface AppHandle {
  addMessage(role: 'user' | 'assistant', content: string, meta?: MessageMeta): void;
  addStructuredMessage(role: 'user' | 'assistant', parts: MessagePart[], meta?: MessageMeta): void;
  addErrorMessage(text: string): void;
  startStream(): void;
  pushStreamParts(parts: MessagePart[]): void;
  endStream(): void;
  finalizeAssistantParts(parts: MessagePart[], meta?: MessageMeta): void;
  setToolInvocations(invocations: ToolInvocation[]): void;
  setGenerating(generating: boolean): void;
  clearMessages(): void;
  commitTools(): void;
  setUsage(usage: UsageMetadata): void;
  setRetryInfo(info: RetryInfo | null): void;
  finalizeResponse(durationMs: number): void;
}

interface UseAppHandleOptions {
  onReady: (handle: AppHandle) => void;
  undoRedoRef: MutableRefObject<UndoRedoStack>;
}

export interface UseAppHandleReturn {
  messages: ChatMessage[];
  streamingParts: MessagePart[];
  isStreaming: boolean;
  isGenerating: boolean;
  contextTokens: number;
  retryInfo: RetryInfo | null;
  pendingApprovals: ToolInvocation[];
  pendingApplies: ToolInvocation[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  commitTools: () => void;
}

export function useAppHandle({ onReady, undoRedoRef }: UseAppHandleOptions): UseAppHandleReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [contextTokens, setContextTokens] = useState(0);
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ToolInvocation[]>([]);
  const [pendingApplies, setPendingApplies] = useState<ToolInvocation[]>([]);

  const streamPartsRef = useRef<MessagePart[]>([]);
  const toolInvocationsRef = useRef<ToolInvocation[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uncommittedStreamPartsRef = useRef<MessagePart[]>([]);
  const lastUsageRef = useRef<UsageMetadata | null>(null);

  const commitTools = useCallback(() => {
    toolInvocationsRef.current = [];
    setPendingApprovals([]);
    setPendingApplies([]);
  }, []);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handle: AppHandle = {
      addMessage(role, content, meta) {
        clearRedo(undoRedoRef.current);
        const textPart: MessagePart = { type: 'text', text: content };
        if (role === 'assistant') {
          setMessages((prev) => appendAssistantParts(prev, [textPart], meta));
          return;
        }
        setMessages((prev) => [
          ...prev.filter((message) => !message.isError && !message.isCommand),
          { id: nextMsgId(), role, parts: [textPart], ...meta },
        ]);
      },
      addErrorMessage(text) {
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), role: 'assistant', parts: [{ type: 'text', text }], isError: true },
        ]);
      },
      addStructuredMessage(role, parts, meta) {
        clearRedo(undoRedoRef.current);
        const normalizedParts = mergeMessageParts(parts);
        if (normalizedParts.length === 0) return;
        if (role === 'assistant') {
          setMessages((prev) => appendAssistantParts(prev, normalizedParts, meta));
          return;
        }
        setMessages((prev) => [...prev, { id: nextMsgId(), role, parts: normalizedParts, ...meta }]);
      },
      startStream() {
        if (toolInvocationsRef.current.length > 0) commitTools();
        setIsStreaming(true);
        uncommittedStreamPartsRef.current = [];
        streamPartsRef.current = [];
        setStreamingParts([]);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') return prev;
          return [...prev, { id: nextMsgId(), role: 'assistant', parts: [] }];
        });
      },
      pushStreamParts(parts) {
        for (const part of parts) appendMergedMessagePart(streamPartsRef.current, { ...part } as MessagePart);
        if (!throttleTimerRef.current) {
          throttleTimerRef.current = setTimeout(() => {
            throttleTimerRef.current = null;
            setStreamingParts([...streamPartsRef.current]);
          }, 60);
        }
      },
      endStream() {
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        uncommittedStreamPartsRef.current = [...streamPartsRef.current];
        streamPartsRef.current = [];
        setStreamingParts([...uncommittedStreamPartsRef.current]);
      },
      finalizeAssistantParts(parts, meta) {
        const normalizedParts = mergeMessageParts(parts);
        uncommittedStreamPartsRef.current = [];
        setStreamingParts([]);
        setIsStreaming(false);
        setMessages((prev) => {
          if (normalizedParts.length === 0 && !meta) return prev;
          const last = prev[prev.length - 1];
          if (normalizedParts.length === 0) {
            if (!last || last.role !== 'assistant') return prev;
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, ...meta };
            return copy;
          }
          if (prev.length === 0) return [{ id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta }];
          if (last.role !== 'assistant') return [...prev, { id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta }];
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, parts: mergeMessageParts([...last.parts, ...normalizedParts]), ...meta };
          return copy;
        });
      },
      setToolInvocations(invocations) {
        const copy = [...invocations];
        toolInvocationsRef.current = copy;
        setPendingApprovals(copy.filter((invocation) => invocation.status === 'awaiting_approval'));
        setPendingApplies(copy.filter((invocation) => invocation.status === 'awaiting_apply'));
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          const nextParts = applyToolInvocationsToParts(last.parts, copy);
          const copyMessages = [...prev];
          copyMessages[copyMessages.length - 1] = { ...last, parts: mergeMessageParts(nextParts) };
          return copyMessages;
        });
      },
      setGenerating(generating) {
        if (!generating) {
          const uncommitted = uncommittedStreamPartsRef.current;
          if (uncommitted.length > 0) {
            setMessages((prev) => appendAssistantParts(prev, uncommitted));
            uncommittedStreamPartsRef.current = [];
          }
          setStreamingParts([]);
          streamPartsRef.current = [];
          setIsStreaming(false);
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.role === 'assistant' && last.parts.length === 0) return prev.slice(0, -1);
            return prev;
          });
        }
        setIsGenerating(generating);
        setRetryInfo(null);
      },
      clearMessages() {
        setMessages([]);
        setStreamingParts([]);
        streamPartsRef.current = [];
        uncommittedStreamPartsRef.current = [];
      },
      commitTools,
      setUsage(usage) {
        setContextTokens(usage.totalTokenCount ?? 0);
        lastUsageRef.current = usage;
      },
      finalizeResponse(durationMs) {
        const usage = lastUsageRef.current;
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          const copy = [...prev];
          copy[copy.length - 1] = {
            ...last,
            tokenIn: usage?.promptTokenCount,
            tokenOut: usage?.candidatesTokenCount,
            durationMs,
          };
          return copy;
        });
        lastUsageRef.current = null;
      },
      setRetryInfo(info) {
        setRetryInfo(info);
      },
    };

    onReady(handle);
  }, [commitTools, onReady, undoRedoRef]);

  return {
    messages,
    streamingParts,
    isStreaming,
    isGenerating,
    contextTokens,
    retryInfo,
    pendingApprovals,
    pendingApplies,
    setMessages,
    commitTools,
  };
}
