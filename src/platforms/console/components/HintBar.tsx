/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { getTextWidth } from '../text-layout';

interface HintBarProps {
  isGenerating: boolean;
  copyMode: boolean;
  exitConfirmArmed: boolean;
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
  const prefix = /^[/\\]/.test(fullPath) ? sep : '';

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

export function HintBar({ isGenerating, copyMode, exitConfirmArmed }: HintBarProps) {
  const cwd = process.cwd();

  // 计算右侧提示文本的显示宽度
  const hintStr = [
    isGenerating ? 'esc 中断生成' : 'ctrl+j 换行',
    '  \u00b7  ',
    copyMode ? 'f6 返回滚动模式' : 'f6 复制模式',
    '  \u00b7  ',
    exitConfirmArmed ? '再次按 ctrl+c 退出' : 'ctrl+c 连按两次退出',
  ].join('');
  const hintWidth = getTextWidth(hintStr);

  const termWidth = process.stdout.columns || 80;
  // BottomPanel paddingX=1（左 1 + 右 1）+ HintBar paddingRight=1 → 可用宽度 = termWidth - 3
  const usableWidth = termWidth - 3;
  const gap = 3; // CWD 与提示文本之间的最小间距
  const availableForCwd = usableWidth - hintWidth - gap;

  // 空间不足 8 列时不显示 CWD
  const displayCwd = availableForCwd >= 8 ? truncatePath(cwd, availableForCwd) : '';

  return (
    <box flexDirection="row" paddingTop={0} paddingRight={1}>
      {displayCwd ? (
        <box flexGrow={1}>
          <text fg={C.dim}>{displayCwd}</text>
        </box>
      ) : (
        <box flexGrow={1} />
      )}
      <text fg={exitConfirmArmed ? C.warn : C.dim}>
        {isGenerating ? 'esc 中断生成' : 'ctrl+j 换行'}
        {'  \u00b7  '}
        {copyMode ? 'f6 返回滚动模式' : 'f6 复制模式'}
        {'  \u00b7  '}
        {exitConfirmArmed ? '再次按 ctrl+c 退出' : 'ctrl+c 连按两次退出'}
      </text>
    </box>
  );
}
