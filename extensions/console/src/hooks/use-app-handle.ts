import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToolInvocation, UsageMetadata } from '@irises/extension-sdk';
import type { ChatMessage, MessagePart, NotificationPayload } from '../components/MessageItem';
import type { RetryInfo } from '../components/GeneratingTimer';
import type { MessageMeta, ToolDetailData, ToolDetailBreadcrumb } from '../app-types';
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
  setGeneratingLabel(label: string | undefined): void;
  clearMessages(): void;
  setUserTokens(tokenCount: number): void;
  addSummaryMessage(summaryText: string, tokenCount?: number): void;
  commitTools(): void;
  setUsage(usage: UsageMetadata): void;
  setRetryInfo(info: RetryInfo | null): void;
  finalizeResponse(durationMs: number): void;
  /** 标记下一个 turn 为 notification turn（由平台在 turn:start 事件中调用） */
  setNotificationContext(description?: string): void;
  /** 清除 notification turn 标记（由平台在 done 事件中调用） */
  clearNotificationContext(): void;
  /** 更新后台运行中的异步子代理数量（由平台监听 agent:notification 事件后调用） */
  updateBackgroundTaskCount(delta: number): void;
  /** 更新后台运行中的委派任务数量（delegate_to_agent），与子代理分开计数 */
  updateDelegateTaskCount(delta: number): void;
  /**
   * 更新指定后台任务的 token 计数（由平台监听 agent:notification token-update 事件后调用）。
   * taskId=null 且 tokens=0 时表示清除已结束任务的记录。
   */
  updateBackgroundTaskTokens(taskId: string, tokens: number): void;
  /** 移除已结束任务的 token 记录 */
  removeBackgroundTaskTokens(taskId: string): void;
  /** 收到 chunk 心跳时推进 spinner 帧（只有数据真正流动时 spinner 才转） */
  advanceBackgroundTaskSpinner(): void;
  /** 设置通知的结构化内容（由平台在 notification:payloads 事件中调用） */
  setNotificationPayloads(payloads: NotificationPayload[]): void;
  /**
   * 从消息队列中出队下一条消息。
   * 由 App 组件通过 drainCallbackRef 注册实际实现。
   * 返回下一条消息的文本，队列为空时返回 undefined。
   */
  drainQueue(): string | undefined;
  /** 打开工具详情视图 */
  openToolDetail(data: ToolDetailData, breadcrumb: ToolDetailBreadcrumb[]): void;
  /** 更新当前工具详情数据（Handle 事件驱动） */
  updateToolDetailData(data: ToolDetailData): void;
  /** 关闭工具详情（弹出导航栈或完全退出） */
  closeToolDetail(): void;
  /** 打开工具列表视图 */
  openToolList(tools: ToolInvocation[]): void;
}

interface UseAppHandleOptions {
  onReady: (handle: AppHandle) => void;
  undoRedoRef: MutableRefObject<UndoRedoStack>;
  /** App 组件设置的队列出队回调，drainQueue 时调用 */
  drainCallbackRef: MutableRefObject<(() => string | undefined) | null>;
}

export interface UseAppHandleReturn {
  messages: ChatMessage[];
  streamingParts: MessagePart[];
  isStreaming: boolean;
  isGenerating: boolean;
  generatingLabel: string | undefined;
  contextTokens: number;
  retryInfo: RetryInfo | null;
  pendingApprovals: ToolInvocation[];
  pendingApplies: ToolInvocation[];
  toolInvocations: ToolInvocation[];
  /** 当前后台运行中的异步子代理数量 */
  backgroundTaskCount: number;
  /** 当前后台运行中的委派任务数量（delegate_to_agent），与子代理分开计数 */
  delegateTaskCount: number;
  /** 所有后台运行中的异步子代理的 token 总数 */
  backgroundTaskTokens: number;
  /** chunk 心跳驱动的 spinner 帧索引（只有数据流动时才递增） */
  backgroundTaskSpinnerFrame: number;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  commitTools: () => void;
  toolDetailData: ToolDetailData | null;
  toolDetailStack: ToolDetailBreadcrumb[];
  toolListItems: ToolInvocation[];
}

export function useAppHandle({ onReady, undoRedoRef, drainCallbackRef }: UseAppHandleOptions): UseAppHandleReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingLabel, setGeneratingLabelState] = useState<string | undefined>();
  const [contextTokens, setContextTokens] = useState(0);
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ToolInvocation[]>([]);
  const [pendingApplies, setPendingApplies] = useState<ToolInvocation[]>([]);
  const [toolInvocations, setToolInvocationsState] = useState<ToolInvocation[]>([]);
  const [backgroundTaskCount, setBackgroundTaskCount] = useState(0);
  // [职责分离] 委派任务独立计数，不与异步子代理的 spinner / token 混用
  const [delegateTaskCount, setDelegateTaskCount] = useState(0);
  // 各后台任务的 token 计数（key=taskId, value=tokens），汇总后作为 backgroundTaskTokens 展示
  const backgroundTaskTokenMapRef = useRef<Map<string, number>>(new Map());
  const [backgroundTaskTokens, setBackgroundTaskTokens] = useState(0);
  // chunk 心跳驱动的 spinner 帧计数器（不是定时器，只在数据真正流动时递增）
  const spinnerFrameRef = useRef(0);
  const [backgroundTaskSpinnerFrame, setBackgroundTaskSpinnerFrame] = useState(0);
  const [toolDetailData, setToolDetailData] = useState<ToolDetailData | null>(null);
  const [toolDetailStack, setToolDetailStack] = useState<ToolDetailBreadcrumb[]>([]);
  const [toolListItems, setToolListItems] = useState<ToolInvocation[]>([]);

  const streamPartsRef = useRef<MessagePart[]>([]);
  const toolInvocationsRef = useRef<ToolInvocation[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uncommittedStreamPartsRef = useRef<MessagePart[]>([]);
  const lastUsageRef = useRef<UsageMetadata | null>(null);
  /** 当前是否处于 notification turn（由 turn:start 设置，done 清除） */
  const notificationContextRef = useRef<{ active: boolean; description?: string }>({ active: false });

  const commitTools = useCallback(() => {
    toolInvocationsRef.current = [];
    setToolInvocationsState([]);
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
        // 发送新用户消息时，清除错误消息、命令消息、以及残留的空 assistant 占位消息
        setMessages((prev) => [
          ...prev.filter((m) => !m.isError && !m.isCommand && !(m.role === 'assistant' && m.parts.length === 0)),
          { id: nextMsgId(), role, parts: [textPart], createdAt: Date.now(), ...meta },
        ]);
      },
      addErrorMessage(text) {
        // 添加错误消息前，先移除可能存在的空 assistant 占位消息
        setMessages((prev) => [
          ...prev.filter((m) => !(m.role === 'assistant' && m.parts.length === 0)),
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
        const isNotif = notificationContextRef.current.active;
        const notifDesc = notificationContextRef.current.description;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          // 普通 turn 内的多轮 tool loop 复用同一条 assistant 消息（stream:start 在同一 turn 内多次调用）。
          // notification turn 必须创建新消息，不能合并到上一轮用户 turn 的 assistant 消息中。
          if (last?.role === 'assistant' && !isNotif) return prev;
          return [...prev, {
            id: nextMsgId(),
            role: 'assistant',
            parts: [],
            ...(isNotif ? { isNotification: true, notificationDescription: notifDesc } : {}),
          }];
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
        const isNotif = notificationContextRef.current.active;
        const notifDesc = notificationContextRef.current.description;
        const notifMeta = isNotif ? { isNotification: true as const, notificationDescription: notifDesc } : {};
        setMessages((prev) => {
          if (normalizedParts.length === 0 && !meta) return prev;
          const last = prev[prev.length - 1];
          if (normalizedParts.length === 0) {
            if (!last || last.role !== 'assistant') return prev;
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, ...meta, ...notifMeta };
            return copy;
          }
          if (prev.length === 0) return [{ id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta, ...notifMeta }];
          if (last.role !== 'assistant') return [...prev, { id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta, ...notifMeta }];
          // notification turn 不应合并到上一轮非-notification 的 assistant 消息中，
          // 否则通知内容会混入普通回复，NotificationPayloadBlock 也不会渲染。
          if (isNotif && !last.isNotification) {
            return [...prev, { id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta, ...notifMeta }];
          }
          const copy = [...prev];
          let finalParts = mergeMessageParts([...last.parts, ...normalizedParts]);
          // 流式阶段 setToolInvocations 可能因 parts 为空而被跳过，
          // 此时 toolInvocationsRef 中已暂存了工具执行状态。
          // 在 parts 定序完成后补充应用，确保工具状态（✓/✗/结果）正确显示。
          const pending = toolInvocationsRef.current;
          if (pending.length > 0 && finalParts.some(p => p.type === 'tool_use')) {
            finalParts = mergeMessageParts(applyToolInvocationsToParts(finalParts, pending));
          }
          copy[copy.length - 1] = { ...last, parts: finalParts, ...meta, ...notifMeta };
          return copy;
        });
      },
      setToolInvocations(invocations) {
        const copy = [...invocations];
        toolInvocationsRef.current = copy;
        setToolInvocationsState(copy);
        setPendingApprovals(copy.filter((invocation) => invocation.status === 'awaiting_approval'));
        setPendingApplies(copy.filter((invocation) => invocation.status === 'awaiting_apply'));
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          // 如果 parts 为空（startStream 刚创建的占位消息，finalize 尚未完成），
          // 跳过本次更新——避免将 tool_use 插入空数组导致工具显示在 thinking 上方。
          // invocations 已保存在 toolInvocationsRef，将在 finalizeAssistantParts 中补充应用。
          if (last.parts.length === 0) return prev;
          // 不追加 leftover：多轮 ToolLoop 中新一轮的 invocations 应等待
          // finalizeAssistantParts 创建对应 tool_use 槽位后再映射，
          // 避免在旧轮内容和新轮内容之间错误地插入工具。
          const nextParts = applyToolInvocationsToParts(last.parts, copy, false);
          const copyMessages = [...prev];
          copyMessages[copyMessages.length - 1] = { ...last, parts: mergeMessageParts(nextParts) };
          return copyMessages;
        });
      },
      setGenerating(generating) {
        if (!generating) {
          // 中断生成时 stream:end 可能未触发，streamPartsRef 中仍有未提交内容。
          // 优先使用 uncommittedStreamPartsRef（正常结束路径），
          // 否则回退到 streamPartsRef（abort 路径），确保已接收的内容不丢失。
          const uncommitted = uncommittedStreamPartsRef.current.length > 0
            ? uncommittedStreamPartsRef.current
            : streamPartsRef.current;
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
        if (!generating) setGeneratingLabelState(undefined);
        setRetryInfo(null);
      },
      setGeneratingLabel(label) {
        setGeneratingLabelState(label);
      },
      clearMessages() {
        setMessages([]);
        setStreamingParts([]);
        streamPartsRef.current = [];
        uncommittedStreamPartsRef.current = [];
      },
      commitTools,
      setUserTokens(tokenCount: number) {
        setMessages((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'user') {
              const copy = [...prev];
              copy[i] = { ...copy[i], tokenIn: tokenCount };
              return copy;
            }
          }
          return prev;
        });
      },
      addSummaryMessage(summaryText: string, tokenCount?: number) {
        setMessages((prev) => [
          ...prev.filter((m) => !m.isCommand),
          {
            id: nextMsgId(),
            role: 'user',
            parts: [{ type: 'text', text: summaryText }],
            isSummary: true,
            tokenIn: tokenCount,
          },
        ]);
      },
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
            cachedTokenIn: usage?.cachedContentTokenCount,
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
      setNotificationContext(description?: string) {
        // 保留已有的 description（agent:notification 先于 turn:start 触发，
        // turn:start 不带 description 时不应覆盖）
        notificationContextRef.current = {
          active: true,
          description: description ?? notificationContextRef.current.description,
        };
      },
      clearNotificationContext() {
        notificationContextRef.current = { active: false };
      },
      setNotificationPayloads(payloads: NotificationPayload[]) {
        // 立即插入一条独立的通知汇总消息到聊天区，不等待主 LLM 回复。
        // 这样用户可以在主 LLM 开始响应之前就看到各子代理的完成状态。
        setMessages((prev) => [...prev, {
          id: nextMsgId(), role: 'assistant', parts: [],
          isNotificationSummary: true, notificationPayloads: payloads, createdAt: Date.now(),
        }]);
      },
      updateBackgroundTaskCount(delta: number) {
        // delta > 0 表示新增后台任务（registered），delta < 0 表示任务结束（completed/failed/killed）
        setBackgroundTaskCount((prev) => Math.max(0, prev + delta));
      },
      updateDelegateTaskCount(delta: number) {
        // [职责分离] 委派任务独立计数，不影响子代理的 spinner / token 动画
        setDelegateTaskCount((prev) => Math.max(0, prev + delta));
      },
      updateBackgroundTaskTokens(taskId: string, tokens: number) {
        // 更新指定任务的 token 数，并重新汇总所有任务的总 token 数
        backgroundTaskTokenMapRef.current.set(taskId, tokens);
        let total = 0;
        for (const v of backgroundTaskTokenMapRef.current.values()) total += v;
        setBackgroundTaskTokens(total);
      },
      removeBackgroundTaskTokens(taskId: string) {
        // 任务结束后移除该任务的 token 记录
        backgroundTaskTokenMapRef.current.delete(taskId);
        let total = 0;
        for (const v of backgroundTaskTokenMapRef.current.values()) total += v;
        setBackgroundTaskTokens(total);
      },
      advanceBackgroundTaskSpinner() {
        // 每收到一个 chunk 心跳就推进 spinner 帧。
        // 节流：每 4 个心跳才更新一次 React state，避免过于频繁的渲染。
        // ref 始终递增，但 setState 按节流步长触发。
        spinnerFrameRef.current += 1;
        if (spinnerFrameRef.current % 4 === 0) {
          setBackgroundTaskSpinnerFrame(spinnerFrameRef.current);
        }
      },
      openToolDetail(data: ToolDetailData, breadcrumb: ToolDetailBreadcrumb[]) {
        setToolDetailData(data);
        setToolDetailStack(breadcrumb);
      },
      updateToolDetailData(data: ToolDetailData) {
        setToolDetailData(data);
      },
      closeToolDetail() {
        setToolDetailStack(prev => {
          if (prev.length > 1) return prev; // 上层导航由 App.tsx 的回调处理
          return [];
        });
        setToolDetailData(null);
      },
      drainQueue() {
        return drainCallbackRef.current?.() ?? undefined;
      },
      openToolList(tools: ToolInvocation[]) {
        setToolListItems(tools);
      },
    };

    onReady(handle);
  }, [commitTools, drainCallbackRef, onReady, undoRedoRef]);

  return {
    messages,
    streamingParts,
    isStreaming,
    isGenerating,
    generatingLabel,
    contextTokens,
    retryInfo,
    pendingApprovals,
    pendingApplies,
    toolInvocations,
    backgroundTaskCount,
    delegateTaskCount,
    backgroundTaskTokens,
    backgroundTaskSpinnerFrame,
    setMessages,
    commitTools,
    toolDetailData,
    toolDetailStack,
    toolListItems,
  };
}
