/**
 * Console 平台输入栏指令定义。
 */

export interface Command {
  name: string;
  description: string;
  /** 仅在远程连接时显示 */
  remoteOnly?: boolean;
  /** 自定义颜色（十六进制） */
  color?: string;
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
  { name: '/net',         description: '配置多端互联（Net）' },
  { name: '/remote',      description: '连接远程 Iris 实例' },
  { name: '/disconnect', description: '断开远程连接', remoteOnly: true, color: '#fdcb6e' },
  { name: '/agent',    description: '切换 Agent（多 Agent 模式）' },
  { name: '/memory',   description: '查看长期记忆' },
  { name: '/dream',    description: '整理长期记忆（合并冗余、清理过时）' },
  { name: '/queue',    description: '查看/管理排队消息' },
  { name: '/exit',     description: '退出应用' },
];

export function getCommandInput(cmd: Command): string {
  return cmd.name === '/sh' || cmd.name === '/model' || cmd.name === '/remote' ? `${cmd.name} ` : cmd.name;
}

export function isExactCommandValue(value: string, cmd: Command): boolean {
  return value === cmd.name || value === getCommandInput(cmd);
}
