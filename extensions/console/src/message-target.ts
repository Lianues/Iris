export interface MessageTargetLike {
  role: 'user' | 'assistant';
  isCommand?: boolean;
  isError?: boolean;
  isSummary?: boolean;
  isNotificationSummary?: boolean;
}

/**
 * 找到当前流/工具轮次可复用的 assistant。命令消息可以临时盖在 assistant 后面，
 * 但绝不能跨过新的 user/summary 边界回写到旧回复。
 */
export function findLiveAssistantTargetIndex(messages: MessageTargetLike[]): number {
  if (messages.length === 0) return -1;
  const tailIndex = messages.length - 1;
  const tail = messages[tailIndex];
  if (
    tail.role === 'assistant'
    && !tail.isCommand
    && !tail.isError
    && !tail.isNotificationSummary
  ) {
    return tailIndex;
  }
  if (!tail.isCommand) return -1;

  for (let i = tailIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user') break;
    if (!message.isCommand && !message.isError && !message.isNotificationSummary) return i;
  }
  return -1;
}

/**
 * done 可能晚于 post-turn compact；summary 是透明检查点，compact command/error
 * 不是回复本体。找到真正应承载 duration/usage 的最后一条普通 assistant。
 */
export function findResponseMetadataTargetIndex(messages: MessageTargetLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user') {
      if (message.isSummary) continue;
      break;
    }
    if (!message.isCommand && !message.isError && !message.isNotificationSummary) return i;
  }
  return -1;
}
