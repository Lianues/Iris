const TOOL_STATUS_ICONS: Record<string, string> = {
  queued: '⏳',
  executing: '🔧',
  success: '✅',
  error: '❌',
  streaming: '📡',
  awaiting_approval: '🔐',
  awaiting_apply: '📋',
  warning: '⚠️',
};

const TOOL_STATUS_LABELS: Record<string, string> = {
  queued: '等待中',
  executing: '执行中',
  success: '成功',
  error: '失败',
  streaming: '输出中',
  awaiting_approval: '等待审批',
  awaiting_apply: '等待应用',
  warning: '警告',
};

export type LarkCardState = 'thinking' | 'streaming' | 'complete';

export interface LarkToolStatusEntry {
  id: string;
  toolName: string;
  status: string;
  createdAt: number;
}

export interface LarkCardElement {
  tag: string;
  [key: string]: unknown;
}

export interface LarkCard {
  config: {
    wide_screen_mode: boolean;
    update_multi?: boolean;
  };
  elements: LarkCardElement[];
  [key: string]: unknown;
}

export function buildLarkCard(
  state: LarkCardState,
  data: {
    text?: string;
    toolEntries?: LarkToolStatusEntry[];
    isError?: boolean;
    isAborted?: boolean;
  } = {},
): LarkCard {
  switch (state) {
    case 'thinking':
      return buildThinkingCard();
    case 'streaming':
      return buildStreamingCard(data.text ?? '', data.toolEntries ?? []);
    case 'complete':
      return buildCompleteCard(data.text ?? '', data.toolEntries ?? [], data.isError, data.isAborted);
  }
}

function buildThinkingCard(): LarkCard {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    elements: [{
      tag: 'markdown',
      content: '💭 思考中...',
    }],
  };
}

function buildStreamingCard(text: string, toolEntries: LarkToolStatusEntry[]): LarkCard {
  const elements: LarkCardElement[] = [];

  if (text) {
    elements.push({ tag: 'markdown', content: text });
  }

  if (toolEntries.length > 0) {
    const toolLines = toolEntries.map((entry) => formatLarkToolLine(entry)).join('\n');
    elements.push({ tag: 'markdown', content: toolLines, text_size: 'notation' });
  }

  if (elements.length === 0) {
    elements.push({ tag: 'markdown', content: '💭 思考中...' });
  }

  return {
    config: { wide_screen_mode: true, update_multi: true },
    elements,
  };
}

function buildCompleteCard(
  text: string,
  toolEntries: LarkToolStatusEntry[],
  isError?: boolean,
  isAborted?: boolean,
): LarkCard {
  const elements: LarkCardElement[] = [];

  elements.push({ tag: 'markdown', content: text || '（无内容）' });

  if (toolEntries.length > 0) {
    const toolLines = toolEntries
      .filter((entry) => entry.status === 'success' || entry.status === 'error')
      .map((entry) => formatLarkToolLine(entry))
      .join('\n');
    if (toolLines) {
      elements.push({ tag: 'markdown', content: toolLines, text_size: 'notation' });
    }
  }

  if (isError) {
    elements.push({ tag: 'markdown', content: "<font color='red'>出错</font>", text_size: 'notation' });
  } else if (isAborted) {
    elements.push({ tag: 'markdown', content: '⏹ 已停止', text_size: 'notation' });
  }

  return {
    config: { wide_screen_mode: true, update_multi: true },
    elements,
  };
}

export function formatLarkToolLine(entry: { toolName: string; status: string }): string {
  const icon = TOOL_STATUS_ICONS[entry.status] ?? '⏳';
  const label = TOOL_STATUS_LABELS[entry.status] ?? entry.status;
  return `${icon} \`${entry.toolName}\` ${label}`;
}
