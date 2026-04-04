/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { getTextWidth } from '../text-layout';

interface HintBarProps {
  isGenerating: boolean;
  queueSize?: number;
  copyMode: boolean;
  exitConfirmArmed: boolean;
  /** 是否有工具调用（用于显示 Ctrl+T 提示） */
  hasTools?: boolean;
}

/* ---------- 路径截断工具 ---------- */

/**
 * 将路径截断到指定显示宽度内。
 * 策略：保留首段（盘符 / 根目录）与末尾若干段，中间用 … 替代。
 */
function truncatePath(fullPath: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (getTextWidth(fullPath) <= maxWidth) return fullPath;

  const sep = fullPath.includes('\\') ? '\\' : '/';
  const parts = fullPath.split(sep).filter(Boolean);
  const prefix = /^[\/\\]/.test(fullPath) ? sep : '';

  if (parts.length <= 1) return hardTruncate(fullPath, maxWidth);

  // 尝试保留 first + … + 末尾 N 段（从多到少）
  const head = parts[0];
  for (let n = Math.min(parts.length - 1, 3); n >= 1; n--) {
    const tail = parts.slice(-n).join(sep);
    const truncated = `${prefix}${head}${sep}\u2026${sep}${tail}`;
    if (getTextWidth(truncated) <= maxWidth) return truncated;
  }

  // 仅保留 …/last
  const minimal = `\u2026${sep}${parts[parts.length - 1]}`;
  if (getTextWidth(minimal) <= maxWidth) return minimal;

  return hardTruncate(fullPath, maxWidth);
}

/** 强制截断到指定宽度，末尾加 … */
function hardTruncate(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return '\u2026';
  let result = '';
  let width = 0;
  for (const ch of text) {
    const cw = getTextWidth(ch);
    if (width + cw > maxWidth - 1) break; // 预留 1 列给 …
    result += ch;
    width += cw;
  }
  return result + '\u2026';
}

/* ---------- 组件 ---------- */

export function HintBar({ isGenerating, queueSize, copyMode, exitConfirmArmed, hasTools }: HintBarProps) {
  const cwd = process.cwd();
  const hasQueue = (queueSize ?? 0) > 0;

  // 计算右侧提示文本
  let hintStr: string;
  if (exitConfirmArmed) {
    hintStr = '再次按 ctrl+c 退出';
  } else {
    const parts: string[] = [];
    parts.push(isGenerating ? 'esc 中断生成' : 'ctrl+j 换行');
    if (hasTools) parts.push('ctrl+t 工具详情');
    if (!isGenerating) parts.push('shift+\u2190/\u2192 思考');
    if (isGenerating && hasQueue) {
      parts.push('/queue 管理队列');
    }
    parts.push(isGenerating ? 'ctrl+s 立即发送' : (copyMode ? 'f6 返回滚动模式' : 'f6 复制模式'));
    hintStr = parts.join('  \u00b7  ');
  }
  const hintWidth = getTextWidth(hintStr);

  const termWidth = process.stdout.columns || 80;
  // BottomPanel paddingX=1（左 1 + 右 1）+ HintBar paddingRight=1 → 可用宽度 = termWidth - 3
  const usableWidth = termWidth - 3;
  const gap = 3; // CWD 与提示文本之间的最小间距
  const availableForCwd = usableWidth - hintWidth - gap;

  const displayCwd = truncatePath(cwd, Math.max(availableForCwd, 20));

  return (
    <box flexDirection="row" paddingTop={0} paddingRight={1}>
      <box flexGrow={1}>
        <text fg={C.dim}>{displayCwd}</text>
      </box>
      {exitConfirmArmed ? (
        <text fg={C.warn}>再次按 ctrl+c 退出</text>
      ) : (
        <text fg={C.dim}>
          {isGenerating ? 'esc 中断生成' : 'ctrl+j 换行'}
          {hasTools ? '  \u00b7  ctrl+t 工具详情' : null}
          {isGenerating && hasQueue ? (
            <>
              {'  \u00b7  '}
              <span fg={C.warn}>/queue 管理队列</span>
            </>
          ) : null}
          {'  \u00b7  '}
          {isGenerating ? 'ctrl+s 立即发送' : (copyMode ? 'f6 返回滚动模式' : 'f6 复制模式')}
        </text>
      )}
    </box>
  );
}
