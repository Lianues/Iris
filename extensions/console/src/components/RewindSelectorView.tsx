/** @jsxImportSource @opentui/react */

import React from 'react';
import type { RewindCheckpointLike, RewindTargetMode } from '../app-types';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

interface RewindSelectorViewProps {
  checkpoints: RewindCheckpointLike[];
  selectedIndex: number;
  confirmCheckpointId?: string | null;
  statusMessage?: string | null;
  statusIsError?: boolean;
  isRestoring?: boolean;
  selectedMode?: RewindTargetMode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTime(createdAt?: number): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  const now = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hhmm;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${hhmm}`;
}

function truncate(text: string, maxLen: number): string {
  const normalized = (text || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}${ICONS.ellipsis}`;
}

const MAX_VISIBLE = 9;

const MODE_LABELS: Record<RewindTargetMode, string> = {
  conversation: '仅对话',
  code: '仅代码',
  both: '对话 + 代码',
};

function formatStats(checkpoint: RewindCheckpointLike): string {
  const stats = checkpoint.codeChangeSummary;
  if (!checkpoint.canRestoreCode || !stats) return '无代码快照';
  const fileCount = stats.filesChanged.length;
  if (fileCount === 0) return '代码无变化';
  return `${fileCount} 个文件 · +${stats.insertions} -${stats.deletions}`;
}

export function RewindSelectorView({ checkpoints, selectedIndex, confirmCheckpointId, statusMessage, statusIsError, isRestoring, selectedMode = 'conversation' }: RewindSelectorViewProps) {
  const safeSelectedIndex = checkpoints.length > 0 ? clamp(selectedIndex, 0, checkpoints.length - 1) : 0;
  const startIndex = checkpoints.length <= MAX_VISIBLE
    ? 0
    : clamp(safeSelectedIndex - Math.floor(MAX_VISIBLE / 2), 0, checkpoints.length - MAX_VISIBLE);
  const visible = checkpoints.slice(startIndex, startIndex + MAX_VISIBLE);
  const selected = checkpoints[safeSelectedIndex];
  const isConfirming = !!selected && confirmCheckpointId === selected.id;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1} flexDirection="column">
        <box>
          <text fg={C.primary}>Rewind 回溯</text>
          <text fg={C.dim}>{`  (${checkpoints.length} 个可回溯点)`}</text>
        </box>
        <box paddingTop={0}>
          <text fg={C.dim}>
            {isRestoring
              ? '正在回溯，请稍候...'
              : isConfirming
              ? 'Enter 确认回到该消息发送前 · Esc 返回列表'
              : `${ICONS.arrowUp}${ICONS.arrowDown} 选择 · Enter 继续 · Esc 返回`}
          </text>
        </box>
        {statusMessage ? (
          <box paddingTop={0}>
            <text fg={statusIsError ? C.error : C.dim}>{statusMessage}</text>
          </box>
        ) : null}
      </box>

      <scrollbox flexGrow={1}>
        {checkpoints.length === 0 ? (
          <text fg={C.dim} paddingLeft={2}>暂无可回溯的用户消息。</text>
        ) : null}

        {startIndex > 0 ? (
          <text fg={C.dim} paddingLeft={2}>{`${ICONS.arrowUp} 上方还有 ${startIndex} 条`}</text>
        ) : null}

        {visible.map((checkpoint, localIndex) => {
          const index = startIndex + localIndex;
          const isSelected = index === safeSelectedIndex;
          const marker = isSelected ? `${ICONS.selectorArrow} ` : '  ';
          const time = formatTime(checkpoint.createdAt);
          const suffix = [
            time,
            `将移除 ${checkpoint.messageCountAfter} 条`,
            checkpoint.hasAttachments ? '含附件' : undefined,
            formatStats(checkpoint),
          ].filter(Boolean).join(' · ');

          return (
            <box key={checkpoint.id} paddingLeft={1} flexDirection="column">
              <text>
                <span fg={isSelected ? C.accent : C.dim}>{marker}</span>
                <span fg={C.dim}>{`${index + 1}. `}</span>
                {isSelected ? (
                  <strong><span fg={C.text}>{truncate(checkpoint.preview, 96)}</span></strong>
                ) : (
                  <span fg={C.textSec}>{truncate(checkpoint.preview, 96)}</span>
                )}
              </text>
              <text>
                <span fg={C.dim}>{`     ${suffix}`}</span>
              </text>
              {isSelected && checkpoint.assistantText ? (
                <text>
                  <span fg={C.dim}>{`     回复：${truncate(checkpoint.assistantText, 88)}`}</span>
                </text>
              ) : null}
            </box>
          );
        })}

        {startIndex + visible.length < checkpoints.length ? (
          <text fg={C.dim} paddingLeft={2}>{`${ICONS.arrowDown} 下方还有 ${checkpoints.length - startIndex - visible.length} 条`}</text>
        ) : null}
      </scrollbox>

      {isConfirming && selected ? (
        <box padding={1} flexDirection="column" borderStyle="single" borderColor={C.warn}>
          <text fg={C.warn}>确认回溯到发送这条消息之前？</text>
          <text>
            <span fg={C.dim}>恢复模式：</span>
            {(['conversation', 'code', 'both'] as RewindTargetMode[]).map((mode) => (
              <span
                key={mode}
                fg={(mode === 'conversation' || selected.canRestoreCode) ? (mode === selectedMode ? C.accent : C.dim) : C.error}
              >
                {`${mode === selectedMode ? `${ICONS.selectorArrow} ` : '  '}${MODE_LABELS[mode]}${mode !== 'conversation' && !selected.canRestoreCode ? '(不可用)' : ''}  `}
              </span>
            ))}
          </text>
          <text fg={C.dim}>
            {selectedMode === 'code'
              ? '仅恢复代码文件；对话历史保持不变。'
              : `将移除 ${selected.messageCountAfter} 条历史，并把该用户输入恢复到底部输入框。`}
          </text>
          <text fg={C.dim}>{`代码快照：${formatStats(selected)}。仅覆盖 Iris 编辑类工具，不覆盖 shell/bash 或手动改动。`}</text>
          <text fg={C.dim}>这会创建新的对话分支；后续发送新消息后，原来的 redo 将失效。</text>
        </box>
      ) : null}
    </box>
  );
}
