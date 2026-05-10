/** @jsxImportSource @opentui/react */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { IrisSessionMetaLike as SessionMeta } from 'irises-extension-sdk';
import { C } from '../theme';
import { ICONS, BORDER_CHARS } from '../terminal-compat';
import { getTextWidth, splitGraphemes } from '../text-layout';

interface SessionListViewProps {
  sessions: SessionMeta[];
  selectedIndex: number;
  pendingDeleteId?: string | null;
  statusMessage?: string | null;
  statusIsError?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fitLine(text: string, width: number): string {
  const targetWidth = Math.max(1, width);
  let used = 0;
  let out = '';
  for (const grapheme of splitGraphemes(text)) {
    const w = getTextWidth(grapheme);
    if (used + w > targetWidth) break;
    out += grapheme;
    used += w;
  }
  return `${out}${' '.repeat(Math.max(0, targetWidth - used))}`;
}

interface RenderRow {
  key: string;
  text: string;
  color: string;
  bold?: boolean;
}

/** Collapse whitespace / newlines in title for single-line display */
function formatTitle(title: string | undefined): string {
  if (!title || !title.trim()) return '(无标题)';
  return title.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatTime(timestamp: string | number | Date | undefined): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN');
}

/** Build a dim separator string of the given character width */
function buildSeparator(totalWidth: number): string {
  const sepChar = BORDER_CHARS.horizontal;
  const charW = getTextWidth(sepChar);
  const indent = 3;
  const usable = Math.max(1, totalWidth - indent - 3);
  const count = Math.max(1, Math.floor(usable / charW));
  return `${' '.repeat(indent)}${sepChar.repeat(count)}`;
}

/**
 * 每个列表条目占 ROWS_PER_ITEM 行：
 *   行 1: 选中标记 + 标题
 *   行 2: 缩进路径 + 时间
 *   行 3: 分隔线（最末尾条目除外）
 */
const ROWS_PER_ITEM = 3;

export function SessionListView({ sessions, selectedIndex, pendingDeleteId, statusMessage, statusIsError }: SessionListViewProps) {
  const { height: terminalHeight, width: terminalWidth } = useTerminalDimensions();
  const rowWidth = Math.max(20, terminalWidth || 80);
  const safeSelectedIndex = sessions.length > 0
    ? clamp(selectedIndex, 0, sessions.length - 1)
    : 0;

  // ── 行预算 ──────────────────────────────────────────────
  // 标题栏 padding(1) + content(1) + padding(1) = 3 行，再留 1 行安全余量 → 4
  const reservedRows = 4 + (statusMessage ? 1 : 0);
  const bodyRows = Math.max(4, terminalHeight - reservedRows);

  const pendingDeleteExtraRows = pendingDeleteId ? 1 : 0;

  // N 个条目占行数 = 3N − 1（最后一个不带分隔线）
  // 先尝试不带溢出指示器
  let availRows = bodyRows - pendingDeleteExtraRows;
  let maxItems = Math.max(1, Math.floor((availRows + 1) / ROWS_PER_ITEM));

  // 如果放不下全部条目，预留 2 行给 ↑/↓ 溢出指示器
  if (maxItems < sessions.length) {
    availRows -= 2;
    maxItems = Math.max(1, Math.floor((availRows + 1) / ROWS_PER_ITEM));
  }

  const visibleItemCount = Math.min(sessions.length, maxItems);

  // ── 居中滚动 ────────────────────────────────────────────
  // 让选中项尽量处于可视窗口中央，上下移动时视口平滑跟随。
  const startIndex = sessions.length <= visibleItemCount
    ? 0
    : clamp(
        safeSelectedIndex - Math.floor(visibleItemCount / 2),
        0,
        sessions.length - visibleItemCount,
      );
  const endIndex = Math.min(sessions.length, startIndex + visibleItemCount);
  const visibleSessions = sessions.slice(startIndex, endIndex);
  const hasAbove = startIndex > 0;
  const hasBelow = endIndex < sessions.length;

  // ── 构建行 ──────────────────────────────────────────────
  const sepLine = buildSeparator(rowWidth);
  const rows: RenderRow[] = [];

  if (sessions.length === 0) {
    rows.push({ key: 'empty', text: '  暂无历史对话', color: C.dim });
  } else {
    // 上方溢出提示
    if (hasAbove) {
      rows.push({ key: 'above', text: `  ${ICONS.arrowUp} 还有 ${startIndex} 条`, color: C.dim });
    }

    visibleSessions.forEach((meta, localIndex) => {
      const index = startIndex + localIndex;
      const isSelected = index === safeSelectedIndex;
      const title = formatTitle(meta.title);
      const time = formatTime(meta.updatedAt);
      const marker = isSelected ? `${ICONS.selectorArrow} ` : '  ';

      // 第 1 行：标记 + 标题
      rows.push({
        key: `${meta.id}:title`,
        text: `${marker}${title}`,
        color: isSelected ? C.text : C.textSec,
        bold: isSelected,
      });

      // 第 2 行：缩进路径 + 时间
      const infoLine = meta.cwd
        ? `   ${meta.cwd}  ${time}`
        : `   ${time}`;
      rows.push({
        key: `${meta.id}:info`,
        text: infoLine,
        color: C.dim,
      });

      // 删除确认行（占额外 1 行，已在行预算中计入）
      if (meta.id === pendingDeleteId) {
        rows.push({
          key: `${meta.id}:delete`,
          text: '   再次按 D 将删除该历史对话；Esc 或切换选择取消。',
          color: C.error,
        });
      }

      // 条目间分隔线（最后一个可见条目不加）
      if (localIndex < visibleSessions.length - 1) {
        rows.push({
          key: `${meta.id}:sep`,
          text: sepLine,
          color: C.dim,
        });
      }
    });

    // 下方溢出提示
    if (hasBelow) {
      rows.push({ key: 'below', text: `  ${ICONS.arrowDown} 还有 ${sessions.length - endIndex} 条`, color: C.dim });
    }
  }

  // 空白行填充至 bodyRows，防止短列表残留旧内容
  while (rows.length < bodyRows) {
    rows.push({ key: `blank:${rows.length}`, text: '', color: C.dim });
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* 标题栏 */}
      <box padding={1}>
        <text fg={C.primary}>对话</text>
        <text fg={C.dim}>{`  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 加载  D 删除  Esc 返回`}</text>
      </box>
      {/* 状态消息（删除成功/失败等） */}
      {statusMessage && (
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text wrapMode="none" fg={statusIsError ? C.error : C.accent}>{fitLine(statusMessage, rowWidth - 4)}</text>
        </box>
      )}
      {/* 列表主体 */}
      <box flexDirection="column" flexGrow={1} height={bodyRows}>
        {rows.slice(0, bodyRows).map((row) => (
          <text key={row.key} wrapMode="none" fg={row.color}>
            {row.bold ? <strong>{fitLine(row.text, rowWidth)}</strong> : fitLine(row.text, rowWidth)}
          </text>
        ))}
      </box>
    </box>
  );
}
