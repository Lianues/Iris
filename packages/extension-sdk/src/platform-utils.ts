/**
 * 平台通用工具函数
 *
 * 提供各平台扩展共用的工具函数，避免跨平台重复实现。
 * 包含：图片 MIME 检测、工具状态格式化、自动工具审批等。
 */

import type { ToolExecutionHandleLike } from './tool.js';

// ── 图片 MIME 检测 ──

/**
 * 根据文件头魔术字节检测图片 MIME 类型。
 * 支持 JPEG、PNG、GIF、WebP、BMP。
 * 无法识别时返回 null。
 */
export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  // WebP (RIFF....WEBP)
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer.length >= 12
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp';
  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'image/bmp';
  return null;
}

// ── 工具状态格式化 ──

/** 工具状态图标映射 */
export const TOOL_STATUS_ICONS: Readonly<Record<string, string>> = {
  queued: '⏳',
  executing: '🔧',
  success: '✅',
  error: '❌',
  streaming: '📡',
  awaiting_approval: '🔐',
  awaiting_apply: '📋',
  warning: '⚠️',
};

/** 工具状态中文标签映射 */
export const TOOL_STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: '等待中',
  executing: '执行中',
  success: '成功',
  error: '失败',
  streaming: '输出中',
  awaiting_approval: '等待审批',
  awaiting_apply: '等待应用',
  warning: '警告',
};

/** 工具调用信息（用于状态格式化） */
export interface ToolInvocationInfo {
  id: string;
  toolName: string;
  status: string;
  args: Record<string, unknown>;
  createdAt: number;
}

/**
 * 格式化单个工具调用的状态行。
 *
 * @param inv 工具调用信息
 * @param options.codeStyle 是否用反引号包裹工具名（适用于支持 Markdown 的平台），默认 false
 * @returns 格式化后的状态行，如 "🔧 read_file 执行中"
 */
export function formatToolStatusLine(
  inv: { toolName: string; status: string },
  options?: { codeStyle?: boolean },
): string {
  const icon = TOOL_STATUS_ICONS[inv.status] || '⏳';
  const label = TOOL_STATUS_LABELS[inv.status] || inv.status;
  const name = options?.codeStyle ? `\`${inv.toolName}\`` : inv.toolName;
  return `${icon} ${name} ${label}`;
}

// ── 自动工具审批 ──

/**
 * 自动批准工具执行。
 *
 * 适用于不支持交互式审批 UI 的平台（如 QQ、微信等）。
 * 在 handle 进入 awaiting_approval 时自动 approve。
 *
 * 例外：当安全引擎标记了 safetyConfirmRequired 时，主动拒绝（approve(false)）。
 * 因为该平台无法提供交互式确认 UI，安全确认门无法履行，必须干净拒绝而非挂起。
 *
 * 用法：backend.on('tool:execute', (sid, handle) => { autoApproveHandle(handle); });
 */
export function autoApproveHandle(handle: ToolExecutionHandleLike): void {
  const handleApproval = () => {
    const snapshot = handle.getSnapshot();
    // 安全引擎要求人工确认时，主动拒绝（平台无交互审批 UI，不能挂起）
    if (snapshot.progress?.safetyConfirmRequired) {
      try { handle.approve(false); } catch { /* 并发状态转换 */ }
      return;
    }
    try { handle.approve(true); } catch { /* 并发状态转换 */ }
  };

  if (handle.status === 'awaiting_approval') {
    handleApproval();
  }
  handle.on('state', (status) => {
    if (status === 'awaiting_approval') {
      handleApproval();
    }
  });
}
