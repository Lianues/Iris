/**
 * Telegram 出站消息构建器。
 *
 * ## 设计说明
 *
 * 所有输出均为纯文本（不使用 HTML parse_mode）。
 * 原因：AI 回复内容本身包含 Markdown 语法（���码块、标题等），
 * 如果用 HTML parse_mode，需要对所有 <、>、& 做转义，
 * 而且 Telegram 的 HTML 子集不支持完整 Markdown，
 * 两者混用极易导致格式解析失败。纯文本模式最稳健。
 *
 * ## 关于类 vs 纯函数
 *
 * TelegramMessageBuilder 当前是无状态类，所有方法都是纯函数。
 * 做成类是为了和飞书的 buildLarkCard 保持对称的调用风格，
 * 但实际没有内部状态或配置注入的需要。
 * 如果觉得多余，可以直接改为顶层导出的纯函数。
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

export class TelegramMessageBuilder {
  /** 构建最终回复文本 */
  buildResponseText(text: string): string {
    return text;
  }

  /** 构建错误提示 */
  buildErrorText(error: string): string {
    return `❌ 错误: ${error}`;
  }

  /** 构建「思考中」占位文本 */
  buildThinkingText(): string {
    return '💭 思考中...';
  }

  /** 构建中止提示（附带已有文本） */
  buildAbortedText(buffer: string): string {
    return buffer
      ? `${buffer}\n\n⏹ （已中止）`
      : '⏹ 已中止回复。';
  }

}

/** 格式化单个工具状态行 */
export function formatTelegramToolLine(entry: { toolName: string; status: string }): string {
  const icon = TOOL_STATUS_ICONS[entry.status] ?? '⏳';
  const label = TOOL_STATUS_LABELS[entry.status] ?? entry.status;
  return `${icon} \`${entry.toolName}\` ${label}`;
}
