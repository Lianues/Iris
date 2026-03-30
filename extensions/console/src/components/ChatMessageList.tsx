/** @jsxImportSource @opentui/react */

import React from 'react';
import { GeneratingTimer, type RetryInfo } from './GeneratingTimer';
import { MessageItem, type ChatMessage, type MessagePart } from './MessageItem';

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingParts: MessagePart[];
  isStreaming: boolean;
  isGenerating: boolean;
  retryInfo: RetryInfo | null;
  modelName: string;
}

export function ChatMessageList({
  messages,
  streamingParts,
  isStreaming,
  isGenerating,
  retryInfo,
  modelName,
}: ChatMessageListProps) {
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = isGenerating && lastMessage?.role === 'assistant';

  return (
    <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
      {messages.map((message, index) => {
        const isLastActive = lastIsActiveAssistant && index === messages.length - 1;
        const liveParts = isLastActive && streamingParts.length > 0 ? streamingParts : undefined;
        const hasVisibleContent = message.parts.length > 0 || !!liveParts;

        if (isLastActive && !hasVisibleContent) {
          return (
            <box key={message.id} flexDirection="column" paddingBottom={1}>
              <GeneratingTimer isGenerating={isGenerating} retryInfo={retryInfo} />
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
            />
            {isLastActive && isStreaming && streamingParts.length === 0 ? (
              <GeneratingTimer isGenerating={isGenerating} retryInfo={retryInfo} />
            ) : null}
          </box>
        );
      })}

      {isGenerating && !lastIsActiveAssistant && streamingParts.length === 0 ? (
        <box flexDirection="column" paddingBottom={1}>
          <GeneratingTimer isGenerating={isGenerating} retryInfo={retryInfo} />
        </box>
      ) : null}
    </scrollbox>
  );
}
