/**
 * Console TUI 色板常量
 *
 * 与 onboard 保持一致的设计语言。
 */

export const C = {
  /** 主色（紫） */
  primary: '#6c5ce7',
  /** 主色浅色 */
  primaryLight: '#a29bfe',
  /** 强调色（绿）— 选中、活动、光标、成功 */
  accent: '#00b894',
  /** 警告色（黄） */
  warn: '#fdcb6e',
  /** 错误色（红） */
  error: '#d63031',
  /** 主文本 */
  text: '#dfe6e9',
  /** 次要文本 */
  textSec: '#b2bec3',
  /** 暗淡文本（提示 / 分隔线 / 禁用） */
  dim: '#636e72',
  /** 光标前景（反色） */
  cursorFg: '#1e1e1e',
  /** 边框默认色 */
  border: '#636e72',
  /** 边框活动色 */
  borderActive: '#00b894',
  /** 边框已填写色 */
  borderFilled: '#6c5ce7',
  /** 标题颜色 */
  heading: {
    1: '#fdcb6e',
    2: '#a29bfe',
    3: '#00b894',
    4: '#dfe6e9',
  } as Record<number, string>,
  /** 用户角色色 */
  roleUser: '#00b894',
  /** 助手角色色 */
  roleAssistant: '#6c5ce7',

  /** 工具执行中背景（冷蓝灰调） */
  toolPendingBg: '#1a2228',
  /** 工具成功背景（微绿调） */
  toolSuccessBg: '#1a2520',
  /** 工具失败背景（微红调） */
  toolErrorBg: '#281a1a',
  /** 工具警告背景（微黄调） */
  toolWarnBg: '#28251a',
  /** 指令面板背景 */
  panelBg: '#1e2228',
  /** 思考区域背景 */
  thinkingBg: '#1a2228',
  /** 命令/Shell 输出色（青） */
  command: '#00cec9',
} as const;
