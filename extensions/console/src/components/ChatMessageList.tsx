/** @jsxImportSource @opentui/react */

import React, { useMemo } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { GeneratingTimer, type RetryInfo } from './GeneratingTimer';
import { MessageItem, type ChatMessage, type MessagePart } from './MessageItem';
import type { MutableRefObject } from 'react';

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
}: ChatMessageListProps) {
  const { height: termHeight } = useTerminalDimensions();

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

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  // 仅当最后一条 assistant 消息正处于「活跃生成」状态时才视为 active：
  // - isStreaming：流式数据正在到来（包括 notification turn）
  // - isGenerating && parts.length === 0：刚创建的占位消息，等待 stream:start
  // 已有内容的 assistant 消息（如 compact 期间的上一轮回复）不应被视为 active，
  // 否则独立的 GeneratingTimer 无法渲染。
  const lastIsActiveAssistant = lastMessage?.role === 'assistant' && (
    isStreaming || (isGenerating && lastMessage.parts.length === 0)
  );

  // 找到最后一条 assistant 消息的 index（用于 Ctrl+O 定向切换）
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') { lastAssistantIndex = i; break; }
  }

  return (
    <scrollbox ref={scrollBoxRef} flexGrow={1} stickyScroll stickyStart="bottom" paddingRight={1} scrollAcceleration={scrollAccel}>
      {messages.map((message, index) => {
        const isLastActive = lastIsActiveAssistant && index === messages.length - 1;
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

      {isGenerating && !lastIsActiveAssistant && streamingParts.length === 0 && !hasActiveTools ? (
        <box flexDirection="column" paddingBottom={1}>
          <GeneratingTimer isGenerating={isGenerating} retryInfo={retryInfo} label={generatingLabel} paused={timerPaused} />
        </box>
      ) : null}
    </scrollbox>
  );
}
