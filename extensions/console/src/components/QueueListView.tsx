/** @jsxImportSource @opentui/react */

import React from 'react';
import type { QueuedMessage } from '../hooks/use-message-queue';
import { useCursorBlink } from '../hooks/use-cursor-blink';
import { InputDisplay } from './InputDisplay';
import { C } from '../theme';

interface QueueListViewProps {
  queue: QueuedMessage[];
  selectedIndex: number;
  editingId: string | null;
  editingValue: string;
  editingCursor: number;
}

function formatQueueTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 将多行文本压缩为单行预览，换行用 ↵ 标记，超长截断 */
function truncatePreview(text: string, maxLen: number): string {
  const single = text.replace(/\r\n/g, '\n').replace(/\n/g, ' \u21b5 ').trim();
  if (single.length <= maxLen) return single;
  return single.slice(0, maxLen - 1) + '\u2026';
}

/** 统计字符串中的换行数 */
function countNewlines(text: string): number {
  let count = 0;
  for (const ch of text) if (ch === '\n') count++;
  return count;
}

export function QueueListView({ queue, selectedIndex, editingId, editingValue, editingCursor }: QueueListViewProps) {
  const isEditing = editingId != null;
  const cursorVisible = useCursorBlink();

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1} flexDirection="column">
        <box>
          <text fg={C.primary}>消息队列</text>
          <text fg={C.dim}>{`  (${queue.length} 条待发送)`}</text>
        </box>
        <box paddingTop={0}>
          {isEditing ? (
            <text fg={C.dim}>  Ctrl+J 换行  Enter 确认  Ctrl+U 清空  Esc 取消</text>
          ) : (
            <text fg={C.dim}>  ↑↓ 选择  Ctrl/Shift+↑↓ 移动  e 编辑  d 删除  c 清空队列  Esc 返回</text>
          )}
        </box>
      </box>
      <scrollbox flexGrow={1}>
        {queue.length === 0 && (
          <text fg={C.dim} paddingLeft={2}>队列为空</text>
        )}
        {queue.map((msg, index) => {
          const isSelected = index === selectedIndex;
          const isMsgEditing = msg.id === editingId;
          const time = formatQueueTime(msg.createdAt);

          if (isMsgEditing) {
            // 编辑中的条目：展开显示完整内容，带光标
            const nlCount = countNewlines(editingValue);
            return (
              <box key={msg.id} paddingLeft={1} flexDirection="column">
                <text>
                  <span fg={C.accent}>{'\u276F '}</span>
                  <span fg={C.dim}>{`${index + 1}. `}</span>
                  <span fg={C.warn}>[编辑中]</span>
                  {nlCount > 0 ? <span fg={C.dim}>{` (${nlCount + 1} 行)`}</span> : null}
                  <span fg={C.dim}>{`  ${time}`}</span>
                </text>
                <box paddingLeft={4}>
                  <InputDisplay
                    value={editingValue}
                    cursor={editingCursor}
                    isActive={true}
                    cursorVisible={cursorVisible}
                  />
                </box>
              </box>
            );
          }

          // 非编辑条目：紧凑单行预览
          const preview = truncatePreview(msg.text, 60);
          return (
            <box key={msg.id} paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '\u276F ' : '  '}</span>
                <span fg={C.dim}>{`${index + 1}. `}</span>
                {isSelected ? (
                  <strong><span fg={C.text}>{preview}</span></strong>
                ) : (
                  <span fg={C.textSec}>{preview}</span>
                )}
                <span fg={C.dim}>{`  ${time}`}</span>
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
