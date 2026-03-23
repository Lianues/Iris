/**
 * Console 平台输入栏指令定义。
 */

export interface Command {
  name: string;
  description: string;
}

/** 内置指令列表 */
export const COMMANDS: Command[] = [
  { name: '/new',      description: '新建对话' },
  { name: '/load',     description: '加载历史对话' },
  { name: '/undo',     description: '撤销最后一条消息' },
  { name: '/redo',     description: '恢复上一次撤销' },
  { name: '/model',    description: '查看或切换当前模型' },
  { name: '/settings', description: '打开设置中心（LLM / System / Tools / MCP）' },
  { name: '/mcp',      description: '直接打开 MCP 管理区' },
  { name: '/sh',       description: '执行命令（如 cd、dir、git 等）' },
  { name: '/reset-config', description: '重置配置为默认值' },
  { name: '/compact',  description: '压缩上下文（总结历史消息）' },
  { name: '/window',   description: '查看或切换绑定窗口（Computer Use）' },
  { name: '/agent',    description: '切换 Agent（多 Agent 模式）' },
  { name: '/exit',     description: '退出应用' },
];

export function getCommandInput(cmd: Command): string {
  return cmd.name === '/sh' || cmd.name === '/model' || cmd.name === '/window' ? `${cmd.name} ` : cmd.name;
}

export function isExactCommandValue(value: string, cmd: Command): boolean {
  return value === cmd.name || value === getCommandInput(cmd);
}
