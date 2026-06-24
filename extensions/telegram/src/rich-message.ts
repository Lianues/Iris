/**
 * Telegram Rich Message 渲染器。
 *
 * 这里是 Telegram 平台展示层的边界：只把“trace + 正文”渲染成
 * Bot API 接受的 InputRichMessage，不改写正文 Markdown，也不提前过滤图片、
 * 表格等 rich media。渲染失败或超限应直接抛错，由投递层统一回落为纯文本。
 */
import type { InputRichMessage } from 'grammy/types';

const TELEGRAM_RICH_MESSAGE_MAX_CHARS = 32768;

/** Telegram 最终消息正文前的可折叠展示区。 */
export interface TelegramTraceSection {
  /** 展示在 <summary> 中的折叠区标题。 */
  title: string;
  /** trace 原文；当前阶段只承载思考文本，后续可扩展工具调用等展示信息。 */
  content: string;
  /** Telegram <details> 是否默认展开。默认折叠，避免 trace 压住正文。 */
  defaultOpen?: boolean;
  /** text 会被包进代码块，markdown 则原样作为 rich markdown 渲染。 */
  format?: 'text' | 'markdown';
}

export interface TelegramRenderableTurn {
  /** Assistant 正文，按 Telegram Rich Markdown 原样交给 Bot API。 */
  answerMarkdown: string;
  /** 位于正文前的附加展示区，不进入 Backend 对话历史。 */
  traceSections?: TelegramTraceSection[];
}

export interface TelegramDraftTurn extends TelegramRenderableTurn {
  thinkingText?: string;
}

/** 渲染 Assistant 最终回复。 */
export function renderTelegramRichTurn(turn: TelegramRenderableTurn): InputRichMessage {
  const markdown = buildTurnMarkdown(turn);
  assertRichMessageWithinLimit(markdown);
  return { markdown };
}

/**
 * 渲染官方 private draft。
 *
 * sendRichMessageDraft 需要可展示内容；当正文和 trace 都为空时，用
 * Telegram draft-only 的 <tg-thinking> 保持客户端侧“正在思考”的体验。
 */
export function renderTelegramDraftTurn(turn: TelegramDraftTurn): InputRichMessage {
  const markdown = buildTurnMarkdown(turn);
  const draftMarkdown = markdown.trim() || `<tg-thinking>${escapeHtml(turn.thinkingText ?? '思考中...')}</tg-thinking>`;
  assertRichMessageWithinLimit(draftMarkdown);
  return { markdown: draftMarkdown };
}

function buildTurnMarkdown(turn: TelegramRenderableTurn): string {
  const sections: string[] = [];
  // 产品契约：trace 折叠区始终在正文前，但只存在于 Telegram 展示层。
  for (const section of turn.traceSections ?? []) {
    const rendered = renderTraceSection(section);
    if (rendered) sections.push(rendered);
  }
  const answer = turn.answerMarkdown.trim();
  if (answer) sections.push(answer);
  return sections.join('\n\n').trim();
}

function renderTraceSection(section: TelegramTraceSection): string {
  const content = section.content.trim();
  if (!content) return '';

  const openAttr = section.defaultOpen ? ' open' : '';
  const title = escapeHtml(section.title);
  const body = section.format === 'markdown'
    ? content
    : wrapTextFence(content);

  // Telegram Rich Markdown 支持 HTML 风格 <details>，可承载折叠 trace。
  return `<details${openAttr}><summary>${title}</summary>\n\n${body}\n\n</details>`;
}

function wrapTextFence(text: string): string {
  // trace 可能包含模型生成的反引号；动态加长 fence，避免提前闭合代码块。
  const longestFence = Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1));
  const fence = '`'.repeat(longestFence);
  return `${fence}text\n${text}\n${fence}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function assertRichMessageWithinLimit(markdown: string): void {
  // Telegram rich_message.markdown 的上限按字符数计算，这里用 code point 近似用户可见字符。
  const length = Array.from(markdown).length;
  if (length > TELEGRAM_RICH_MESSAGE_MAX_CHARS) {
    throw new Error(`Telegram rich message 超过 ${TELEGRAM_RICH_MESSAGE_MAX_CHARS} 字符限制: ${length}`);
  }
}
