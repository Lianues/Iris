/**
 * Telegram Slash 命令解析与帮助文本。
 *
 * Phase 4 升级：
 *   - 解析时自动去除 @botname 后缀（Telegram 群聊中 /cmd@botname 形式）；
 *   - 提供完整的命令列表与帮助文本。
 */

export interface ParsedTelegramCommand {
  name: string;
  args: string;
}

/** 可供 BotFather setMyCommands 注册的命令清单 */
export const TELEGRAM_BOT_COMMANDS = [
  { command: 'new', description: '新建对话（清空上下文）' },
  { command: 'clear', description: '清空当前对话历史' },
  { command: 'model', description: '查看或切换模型' },
  { command: 'session', description: '查看或切换历史会话' },
  { command: 'stop', description: '中止当前 AI 回复' },
  { command: 'flush', description: '立即处理缓冲中的消息' },
  { command: 'undo', description: '撤销上一轮对话' },
  { command: 'redo', description: '恢复撤销的对话' },
  { command: 'help', description: '显示帮助' },
];

export class TelegramCommandRouter {
  /**
   * 解析用户文本为命令结构。
   * 自动去除 @botname 后缀，使群聊和私聊的命令格式统一。
   */
  parse(text: string): ParsedTelegramCommand | null {
    const normalized = text.trim();
    if (!normalized.startsWith('/')) return null;

    const [rawName, ...rest] = normalized.split(/\s+/);
    // 去除 /command@botname 中的 @botname 部分
    const name = rawName.replace(/^\//, '').replace(/@.*$/, '').trim();
    if (!name) return null;

    return {
      name,
      args: rest.join(' ').trim(),
    };
  }

  /** 构建 /help 命令的帮助文本 */
  buildHelpText(): string {
    const lines = [
      '📋 可用指令',
      '',
      ...TELEGRAM_BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
    ];
    return lines.join('\n');
  }
}
