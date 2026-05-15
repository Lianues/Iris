/** @jsxImportSource @opentui/react */

import React, { useMemo } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { GeneratingTimer, type RetryInfo } from './GeneratingTimer';
import { MessageItem, type ChatMessage, type MessagePart } from './MessageItem';
import type { MutableRefObject } from 'react';
import type { MilestoneSnapshotLike } from 'irises-extension-sdk';
import { MilestoneListView } from './MilestoneListView';
import type { QueuedMessage } from '../hooks/use-message-queue';

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingParts: MessagePart[];
  isStreaming: boolean;
  isGenerating: boolean;
  retryInfo: RetryInfo | null;
  modelName: string;
  generatingLabel?: string;
  /** 有待审批/待应用的工具时暂停计时 */
  timerPaused?: boolean;
  /** 有工具正在执行（executing/queued），此时不显示 generating 计时器 */
  hasActiveTools?: boolean;
  /** Ctrl+O 按下时递增，仅最后一条 assistant 消息响应 */
  thoughtsToggleSignal?: number;
  /** 传入 ref 以供外部（如 F6 复制模式）程序化滚动 */
  scrollBoxRef?: MutableRefObject<any>;
  /** 已提交但正在等待当前回复完成后发送的本地队列消息，用 user 样式即时预览 */
  queuedMessages?: QueuedMessage[];
  /** F6 应用内复制模式：拖选时允许滚轮扩展选择范围 */
  copyMode?: boolean;
  /** 当前会话 milestone/task 清单快照 */
  milestoneSnapshot?: MilestoneSnapshotLike | null;
  /** F6 复制模式下，开始新一轮拖选时清空跨滚动快照 */
  onCopySelectionStart?: () => void;
  /** F6 复制模式下，拖选/滚轮过程中记录当前可见选区快照 */
  onCopySelectionSnapshot?: (text: string) => void;
}

export function ChatMessageList({
  messages,
  streamingParts,
  isStreaming,
  isGenerating,
  retryInfo,
  modelName,
  generatingLabel,
  timerPaused,
  thoughtsToggleSignal,
  hasActiveTools,
  scrollBoxRef,
  queuedMessages,
  copyMode,
  milestoneSnapshot,
  onCopySelectionStart,
  onCopySelectionSnapshot,
}: ChatMessageListProps) {
  const { height: termHeight } = useTerminalDimensions();

  const captureSelectionSnapshot = (scrollBox: any) => {
    const text = scrollBox?.ctx?.getSelection?.()?.getSelectedText?.() ?? '';
    if (text.trim()) onCopySelectionSnapshot?.(text);
  };

  const scheduleSelectionSnapshot = (scrollBox: any, updateSelection = false) => {
    setTimeout(() => {
      if (updateSelection) scrollBox?.ctx?.requestSelectionUpdate?.();
      captureSelectionSnapshot(scrollBox);
    }, 0);
  };

  // 让鼠标滚轮灵敏度与 F6 复制模式保持一致。
  // F6 复制模式下 useMouse=false，终端将滚轮转换为方向键，
  // 方向键触发 ScrollBar.scrollBy(1/5, "viewport")，即每次滚动视口高度的 1/5。
  // 而正常模式下鼠标滚轮每次仅滚动 1 行（baseDelta=1 × multiplier=1），速度过慢。
  // 此处通过 scrollAcceleration 将倍率设为 ≈ viewportHeight/5，使两种模式体感一致。
  const scrollAccel = useMemo(() => {
    const chatViewportHeight = Math.max(5, termHeight - 8);
    const step = Math.max(1, Math.round(chatViewportHeight / 5));
    return { tick: () => step, reset: () => {} };
  }, [termHeight]);

  // 仅当最后一条普通 assistant 消息正处于「活跃生成」状态时才视为 active：
  // - isStreaming：流式数据正在到来（包括 notification turn）
  // - isGenerating && parts.length === 0：刚创建的占位消息，等待 stream:start
  // 已有内容的 assistant 消息（如 compact 期间的上一轮回复）不应被视为 active，
  // 否则独立的 GeneratingTimer 无法渲染。
  // 命令/错误/通知汇总消息可能在流式输出期间插入，不能成为 liveParts 挂载目标。
  const activeAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== 'assistant' || message.isCommand || message.isError || message.isNotificationSummary) continue;
      return (isStreaming || (isGenerating && message.parts.length === 0)) ? i : -1;
    }
    return -1;
  })();
  const hasActiveAssistant = activeAssistantIndex >= 0;

  // 找到最后一条 assistant 消息的 index（用于 Ctrl+O 定向切换）
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant' && !message.isCommand && !message.isError && !message.isNotificationSummary) { lastAssistantIndex = i; break; }
  }

  const queuedPreviewMessages = useMemo<ChatMessage[]>(() => (queuedMessages ?? []).map((msg) => ({
    id: `queued-preview-${msg.id}`,
    role: 'user',
    parts: [{ type: 'text', text: msg.text }],
    createdAt: msg.createdAt,
    isQueuedPreview: true,
  })), [queuedMessages]);

  return (
    <scrollbox
      ref={scrollBoxRef}
      flexGrow={1}
      stickyScroll
      stickyStart="bottom"
      paddingRight={1}
      scrollAcceleration={scrollAccel}
      onMouseDown={copyMode ? function (_event: any) {
        onCopySelectionStart?.();
      } : undefined}
      onMouseDrag={copyMode ? function (this: any) {
        scheduleSelectionSnapshot(this);
      } : undefined}
      onMouseScroll={copyMode ? function (this: any) {
        scheduleSelectionSnapshot(this, true);
      } : undefined}
      onMouseUp={copyMode ? function (this: any) {
        scheduleSelectionSnapshot(this);
      } : undefined}
    >
      {messages.map((message, index) => {
        const isLastActive = index === activeAssistantIndex;
        const liveParts = isLastActive && streamingParts.length > 0 ? streamingParts : undefined;
        const hasVisibleContent = message.parts.length > 0 || !!liveParts;

        if (isLastActive && !hasVisibleContent) {
          return (
            <box key={message.id} flexDirection="column" paddingBottom={1}>
              <GeneratingTimer isGenerating={isGenerating} retryInfo={retryInfo} label={generatingLabel} paused={timerPaused} />
            </box>
          );
        }

        return (
          <box key={message.id} flexDirection="column" paddingBottom={1}>
            <MessageItem
              msg={message}
              liveParts={liveParts}
              isStreaming={isLastActive ? isStreaming : undefined}
              modelName={modelName}
              thoughtsToggleSignal={index === lastAssistantIndex ? thoughtsToggleSignal : undefined}
            />
            {isLastActive && isStreaming && streamingParts.length === 0 ? (
              <GeneratingTimer isGenerating={isGenerating} retryInfo={retryInfo} label={generatingLabel} paused={timerPaused} />
            ) : null}
          </box>
        );
      })}

      {milestoneSnapshot && milestoneSnapshot.items.length > 0 ? (
        <box flexDirection="column" paddingBottom={1}>
          <MilestoneListView snapshot={milestoneSnapshot} standalone />
        </box>
      ) : null}

      {isGenerating && !hasActiveAssistant && streamingParts.length === 0 && !hasActiveTools ? (
        <box flexDirection="column" paddingBottom={1}>
          <GeneratingTimer isGenerating={isGenerating} retryInfo={retryInfo} label={generatingLabel} paused={timerPaused} />
        </box>
      ) : null}

      {queuedPreviewMessages.map((message) => (
        <box key={message.id} flexDirection="column" paddingBottom={1}>
          <MessageItem
            msg={message}
            modelName={modelName}
          />
        </box>
      ))}
    </scrollbox>
  );
}
