/** @jsxImportSource @opentui/react */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { IrisSessionMetaLike as SessionMeta } from 'irises-extension-sdk';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';
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

function sessionLine(meta: SessionMeta, selected: boolean): string {
  const time = new Date(meta.updatedAt ?? 0).toLocaleString('zh-CN');
  const marker = selected ? `${ICONS.selectorArrow} ` : '  ';
  return `${marker}${meta.title}  ${meta.cwd}  ${time}`;
}

export function SessionListView({ sessions, selectedIndex, pendingDeleteId, statusMessage, statusIsError }: SessionListViewProps) {
  const { height: terminalHeight, width: terminalWidth } = useTerminalDimensions();
  const rowWidth = Math.max(20, terminalWidth || 80);
  const safeSelectedIndex = sessions.length > 0
    ? clamp(selectedIndex, 0, sessions.length - 1)
    : 0;

  // 手动虚拟窗口而不是依赖 ScrollBox 的内部滚动状态：
  // 1. 长按↑/↓ 时选中项始终留在可视区域；
  // 2. D 删除确认会额外插入一行，需要纳入可视行预算；
  // 3. 所有行固定渲染为单行 + 补空白，避免 OpenTUI 对短行残留旧长行尾巴。
  const reservedRows = 4 + (statusMessage ? 1 : 0);
  const bodyRows = Math.max(4, terminalHeight - reservedRows);
  const pendingDeleteExtraRows = pendingDeleteId ? 1 : 0;
  const reserveIndicatorRows = sessions.length > Math.max(1, bodyRows - pendingDeleteExtraRows) ? 2 : 0;
  const visibleItemCount = Math.max(1, bodyRows - pendingDeleteExtraRows - reserveIndicatorRows);
  const startIndex = sessions.length <= visibleItemCount
    ? 0
    : clamp(safeSelectedIndex - visibleItemCount + 1, 0, sessions.length - visibleItemCount);
  const endIndex = Math.min(sessions.length, startIndex + visibleItemCount);
  const visibleSessions = sessions.slice(startIndex, endIndex);
  const hasAbove = startIndex > 0;
  const hasBelow = endIndex < sessions.length;

  const rows: RenderRow[] = [];
  if (sessions.length === 0) {
    rows.push({ key: 'empty', text: '暂无历史对话', color: C.dim });
  } else {
    if (hasAbove) {
      rows.push({ key: 'above', text: `↑ 还有 ${startIndex} 条更早/更近的历史`, color: C.dim });
    }

    visibleSessions.forEach((meta, localIndex) => {
      const index = startIndex + localIndex;
      const isSelected = index === safeSelectedIndex;
      rows.push({
        key: meta.id,
        text: sessionLine(meta, isSelected),
        color: isSelected ? C.text : C.textSec,
        bold: isSelected,
      });
      if (meta.id === pendingDeleteId) {
        rows.push({
          key: `${meta.id}:delete`,
          text: '    再次按 D 将删除该历史对话；Esc 或切换选择取消。',
          color: C.error,
        });
      }
    });

    if (hasBelow) {
      rows.push({ key: 'below', text: `↓ 还有 ${sessions.length - endIndex} 条历史`, color: C.dim });
    }
  }

  while (rows.length < bodyRows) {
    rows.push({ key: `blank:${rows.length}`, text: '', color: C.dim });
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>对话</text>
        <text fg={C.dim}>{`  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 加载  D 删除  Esc 返回`}</text>
      </box>
      {statusMessage && (
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text wrapMode="none" fg={statusIsError ? C.error : C.accent}>{fitLine(statusMessage, rowWidth - 4)}</text>
        </box>
      )}
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
