/**
 * 飞书消息卡片构建器。
 *
 * ## 技术选型：普通消息卡片 vs CardKit 2.0
 *
 * openclaw-lark 使用 CardKit 2.0 API 实现流式卡片：
 *   1. cardkit.v1.card.create → 创建卡片实体，拿到 card_id
 *   2. im.message.create → 发送卡片引用
 *   3. cardkit.v1.cardElement.content → 按 element_id 流式更新指定元素（有打字机动画）
 *   4. cardkit.v1.card.settings → 关闭 streaming_mode
 *   5. cardkit.v1.card.update → 替换为最终卡片
 * 配套代码量：card/ 目录 10 个文件，StreamingCardController 单文件 817 行，
 * 含显式状态机、FlushController、UnavailableGuard、ImageResolver 等。
 *
 * 我们选择普通 Interactive Message Card + im.message.patch：
 *   1. im.message.create(interactive 卡片 JSON) → 拿到 message_id
 *   2. im.message.patch(message_id, 新卡片 JSON) → 整体替换卡片内容
 *
 * 放弃 CardKit 2.0 的原因：
 *   - @larksuiteoapi/node-sdk 对 cardkit.v1.* 的 TypeScript 类型不完整，
 *     openclaw-lark 大量使用 `as CardKitResponse` / `as any` 做 workaround。
 *   - CardKit 的 5 步流程带来 sequence 管理、元素级更新、流式模式开关、
 *     创建失败降级等边界处理，复杂度远高于 2 步 patch 方案。
 *   - Iris 的流式节流间隔为 1000ms，每秒更新一次。在这个频率下，
 *     CardKit 的打字机动画和 patch 的整体刷新体感差异很小。
 *   - Iris 是多平台框架，飞书是 5 个平台之一。用 10 个文件 + 上千行代码
 *     换一个打字机动画，ROI 不合理。
 *
 * 如果将来需要打字机效果，可参考 openclaw-lark/src/card/ 目录升级为 CardKit 2.0。
 *
 * ## 卡片状态
 *
 * 三态卡片：
 *   - thinking：占位
 *   - streaming：实时更新
 *   - complete：最终展示（含工具、错误、中止）
 */

// ---- 工具状态图标 ----

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
  /** index signature：允许赋值给 Record<string, unknown> */
  [key: string]: unknown;
}

// ---- 构建入口 ----

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

// ---- 私有构建函数 ----

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

  // 至少保证一个元素
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

/** 格式化单个工具状态行 */
export function formatLarkToolLine(entry: { toolName: string; status: string }): string {
  const icon = TOOL_STATUS_ICONS[entry.status] ?? '⏳';
  const label = TOOL_STATUS_LABELS[entry.status] ?? entry.status;
  return `${icon} \`${entry.toolName}\` ${label}`;
}
