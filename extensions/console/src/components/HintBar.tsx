/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { getTextWidth } from '../text-layout';
import { ICONS } from '../terminal-compat';

interface HintBarProps {
  isGenerating: boolean;
  /** 是否有后台任务仍在运行（异步 sub_agent / delegate） */
  hasRunningBackgroundTasks?: boolean;
  queueSize?: number;
  copyMode: boolean;
  exitConfirmArmed: boolean;
  /** 远程连接的主机地址（非空时替换 cwd 显示远程提示） */
  remoteHost?: string;
  /** 当前会话是否开启自动编辑；开启时高亮 Ctrl+E 提示 */
  autoEditActive?: boolean;
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
    const truncated = `${prefix}${head}${sep}${ICONS.ellipsis}${sep}${tail}`;
    if (getTextWidth(truncated) <= maxWidth) return truncated;
  }

  // 仅保留 …/last
  const minimal = `${ICONS.ellipsis}${sep}${parts[parts.length - 1]}`;
  if (getTextWidth(minimal) <= maxWidth) return minimal;

  return hardTruncate(fullPath, maxWidth);
}

/** 强制截断到指定宽度，末尾加 … */
function hardTruncate(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return ICONS.ellipsis;
  let result = '';
  let width = 0;
  for (const ch of text) {
    const cw = getTextWidth(ch);
    if (width + cw > maxWidth - 1) break; // 预留 1 列给 …
    result += ch;
    width += cw;
  }
  return result + ICONS.ellipsis;
}

/* ---------- 组件 ---------- */

export function HintBar({ isGenerating, hasRunningBackgroundTasks = false, queueSize, copyMode, exitConfirmArmed, remoteHost, autoEditActive }: HintBarProps) {
  const cwd = process.cwd();
  const hasQueue = (queueSize ?? 0) > 0;
  const escAction = isGenerating ? 'esc 中断生成' : hasRunningBackgroundTasks ? 'esc 中断任务' : 'ctrl+j 换行';

  // 计算右侧提示文本（必须与下方渲染 JSX 完全对应，否则布局错位）
  let hintStr: string;
  if (exitConfirmArmed) {
    hintStr = '再次按 ctrl+c 退出';
  } else {
    const parts: string[] = [];
    parts.push('ctrl+e 自动编辑');
    parts.push(escAction);
    parts.push('ctrl+t 工具详情');
    if (isGenerating && hasQueue) {
      parts.push('/queue 管理队列');
    }
    parts.push(isGenerating ? 'ctrl+s 立即发送' : (copyMode ? 'f6 返回滚动模式' : 'f6 复制模式'));
    hintStr = parts.join(`  ${ICONS.separator}  `);
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
      <box flexGrow={1} flexShrink={1}>
        {remoteHost ? (
          <text fg={C.warn}>{ICONS.lightning} 远程模式 {ICONS.emDash} 所有操作和配置均作用于 {remoteHost}</text>
        ) : (
          <text fg={C.dim}>{displayCwd}</text>
        )}
      </box>
      {exitConfirmArmed ? (
        <box flexShrink={0}><text fg={C.warn}>再次按 ctrl+c 退出</text></box>
      ) : (
        <box flexShrink={0}>
          <text fg={C.dim}>
            <span fg={autoEditActive ? C.autoEdit : C.dim}>
              ctrl+e 自动编辑
            </span>
            {`  ${ICONS.separator}  `}
            {escAction}
            {`  ${ICONS.separator}  ctrl+t 工具详情`}
            {isGenerating && hasQueue ? (
              <>
                {`  ${ICONS.separator}  `}
                <span fg={C.warn}>/queue 管理队列</span>
              </>
            ) : null}
            {`  ${ICONS.separator}  `}
            {isGenerating ? 'ctrl+s 立即发送' : (copyMode ? 'f6 返回滚动模式' : 'f6 复制模式')}
          </text>
        </box>
      )}
    </box>
  );
}
