/**
 * Console 平台输入栏指令定义。
 */

export interface Command {
  name: string;
  description: string;
  /** 是否接受空格后的参数；用于补全时保留一个尾随空格 */
  acceptsArgs?: boolean;
  /** 参数候选项（当输入形如 `/cmd <arg>` 时展示） */
  getArgSuggestions?: (input: { arg: string; raw: string }) => CommandArgSuggestion[];
  /** 仅在远程连接时显示 */
  remoteOnly?: boolean;
  /** 仅在宿主支持保留 Core / IPC 的 TUI headless 切换时显示 */
  requiresHeadlessSupport?: boolean;
  /** 自定义颜色（十六进制） */
  color?: string;
}

export interface CommandArgSuggestion {
  value: string;
  description?: string;
  color?: string;
}

/** 内置指令列表 */
export const COMMANDS: Command[] = [
  { name: '/new',      description: '新建对话' },
  { name: '/load',     description: '加载历史对话' },
  { name: '/undo',     description: '撤销最后一条消息' },
  { name: '/redo',     description: '恢复上一次撤销' },
  { name: '/rewind',   description: '选择历史消息并回溯到发送前' },
  { name: '/model',    description: '查看或切换当前模型' },
  { name: '/settings', description: '打开设置中心（LLM / System / Tools / MCP）' },
  { name: '/mcp',      description: '直接打开 MCP 管理区' },
  { name: '/sh',       description: '执行命令（如 cd、dir、git 等）' },
  { name: '/reset-config', description: '重置配置为默认值' },
  { name: '/compact',  description: '压缩上下文（总结历史消息）' },
  { name: '/plan',     description: '进入或查看当前 Agent 会话的 Plan Mode' },
  {
    name: '/commit',
    description: '参考当前 git diff 创建详细提交（可用 cn/en 指定语言）',
    acceptsArgs: true,
    getArgSuggestions: () => [
      { value: 'cn', description: '使用中文 commit message' },
      { value: 'en', description: '使用英文 commit message' },
    ],
  },
  {
    name: '/auto-edit',
    description: '切换当前会话自动编辑（安全编辑自动应用）',
    acceptsArgs: true,
    getArgSuggestions: () => [
      { value: 'on', description: '开启当前会话自动编辑' },
      { value: 'off', description: '关闭当前会话自动编辑' },
      { value: 'status', description: '查看当前状态' },
    ],
  },
  {
    name: '/note',
    description: '编辑当前 Agent 的长期 Note（作为系统提示词注入）',
    acceptsArgs: true,
    getArgSuggestions: () => [
      { value: 'edit', description: '打开编辑器' },
      { value: 'show', description: '查看当前 note' },
      { value: 'clear', description: '清空 note' },
    ],
  },
  { name: '/net',         description: '配置多端互联（Net）' },
  { name: '/remote',      description: '连接远程 Iris 实例' },
  { name: '/disconnect', description: '断开远程连接', remoteOnly: true, color: '#fdcb6e' },
  { name: '/agent',    description: '切换 Agent（多 Agent 模式）' },
  { name: '/memory',   description: '查看长期记忆' },
  { name: '/extension', description: '管理扩展插件（查看/启用/禁用/Git拉取/升级/删除）' },
  { name: '/dream',    description: '整理长期记忆（合并冗余、清理过时）' },
  { name: '/queue',    description: '查看/管理排队消息' },
  { name: '/file',     description: '附加文件（图片/文档/音频/视频）  clear 清空' },
  { name: '/headless', description: '关闭 TUI 并保留 Core / IPC 后台运行', requiresHeadlessSupport: true },
  { name: '/detach',   description: '同 /headless，分离当前 TUI', requiresHeadlessSupport: true },
  {
    name: '/callme',
    description: '切换 Iris git commit 链接署名（默认关闭，可 status）',
    acceptsArgs: true,
    getArgSuggestions: () => [
      { value: 'status', description: '查看当前状态' },
    ],
  },
  { name: '/exit',     description: '退出应用' },
];

export function getCommandInput(cmd: Command): string {
  return cmd.acceptsArgs || cmd.name === '/sh' || cmd.name === '/model' || cmd.name === '/remote' || cmd.name === '/file' || cmd.name === '/plan' || cmd.name === '/note' ? `${cmd.name} ` : cmd.name;
}

export function isExactCommandValue(value: string, cmd: Command): boolean {
  return value === cmd.name || value === getCommandInput(cmd);
}
