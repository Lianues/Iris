/**
 * 飞书 Slash 命令解析与帮助文本。
 *
 * 与 Telegram 的命令集保持一致，方便用户跨平台使用。
 * 飞书没有 @botname 后缀，解析逻辑更简单。
 */

export interface ParsedLarkCommand {
  name: string;
  args: string;
}

export const LARK_COMMANDS = [
  { name: 'new', description: '新建对话（清空上下文）' },
  { name: 'clear', description: '清空当前对话历史' },
  { name: 'model', description: '查看或切换模型' },
  { name: 'session', description: '查看或切换历史会话' },
  { name: 'stop', description: '中止当前 AI 回复' },
  { name: 'flush', description: '立即处理缓冲中的消息' },
  { name: 'undo', description: '撤销上一轮对话' },
  { name: 'redo', description: '恢复撤销的对话' },
  { name: 'help', description: '显示帮助' },
];

export class LarkCommandRouter {
  parse(text: string): ParsedLarkCommand | null {
    const normalized = text.trim();
    if (!normalized.startsWith('/')) return null;

    const [rawName, ...rest] = normalized.split(/\s+/);
    const name = rawName.replace(/^\//, '').trim();
    if (!name) return null;

    return {
      name,
      args: rest.join(' ').trim(),
    };
  }

  buildHelpText(): string {
    const lines = [
      '📋 可用指令',
      '',
      ...LARK_COMMANDS.map((c) => `/${c.name} — ${c.description}`),
    ];
    return lines.join('\n');
  }
}
