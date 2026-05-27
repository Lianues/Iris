/** @jsxImportSource @opentui/react */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { RewindCheckpointLike, RewindTargetMode } from '../app-types';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';
import { getTextWidth, splitGraphemes } from '../text-layout';

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

function normalizeSingleLine(text: string): string {
  return (text || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function fitText(text: string, maxWidth: number): string {
  const targetWidth = Math.max(1, maxWidth);
  const normalized = normalizeSingleLine(text);
  if (getTextWidth(normalized) <= targetWidth) return normalized;

  const ellipsis = ICONS.ellipsis;
  const ellipsisWidth = getTextWidth(ellipsis);
  let used = 0;
  let out = '';
  for (const grapheme of splitGraphemes(normalized)) {
    const width = getTextWidth(grapheme);
    if (used + width + ellipsisWidth > targetWidth) break;
    out += grapheme;
    used += width;
  }
  return `${out}${ellipsis}`;
}

const MAX_VISIBLE = 9;

const MODE_LABELS: Record<RewindTargetMode, string> = {
  conversation: '仅对话',
  code: '仅代码',
  both: '对话 + 代码',
};

function formatStats(checkpoint: RewindCheckpointLike): string {
  const stats = checkpoint.codeChangeSummary;
  if (!stats) return '无代码快照';
  const fileCount = stats.filesChanged.length;
  if (fileCount === 0) return '代码无变化';
  return `${fileCount} 个文件 · +${stats.insertions} -${stats.deletions}`;
}

function formatModeOption(mode: RewindTargetMode, selectedMode: RewindTargetMode, canRestoreCode: boolean): string {
  const marker = mode === selectedMode ? `${ICONS.selectorArrow} ` : '  ';
  const unavailable = mode !== 'conversation' && !canRestoreCode ? '(不可用)' : '';
  return `${marker}${MODE_LABELS[mode]}${unavailable}`;
}

function formatModeRow(mode: RewindTargetMode, selectedMode: RewindTargetMode, canRestoreCode: boolean): string {
  return formatModeOption(mode, selectedMode, canRestoreCode);
}

function formatConversationAction(selected: RewindCheckpointLike, selectedMode: RewindTargetMode): string {
  return selectedMode === 'code'
    ? '仅恢复代码文件；对话历史保持不变。'
    : `将移除 ${selected.messageCountAfter} 条历史，并把该用户输入恢复到底部输入框。`;
}

function formatCodeScopeNotice(selected: RewindCheckpointLike, selectedMode: RewindTargetMode): string {
  if (!selected.codeChangeSummary) return '该回溯点没有代码快照；只能恢复对话。';
  if (selected.codeChangeSummary.filesChanged.length === 0) {
    return '当前代码与该快照一致；无需恢复代码。';
  }
  if (selectedMode === 'conversation') return '可切换到仅代码或对话 + 代码，以恢复 Iris 编辑类工具产生的文件变更。';
  return '仅覆盖 Iris 编辑类工具；不覆盖 shell/bash、外部编辑器或手动改动。';
}

function formatBranchNotice(selectedMode: RewindTargetMode): string {
  if (selectedMode === 'code') return '仅代码模式不会修改对话历史，也不会影响 redo 栈。';
  return '这会创建新的对话分支；后续发送新消息后，原来的 redo 将失效。';
}

function getModeColor(mode: RewindTargetMode, selectedMode: RewindTargetMode, canRestoreCode: boolean): string {
  const unavailable = mode !== 'conversation' && !canRestoreCode;
  if (mode === selectedMode) return unavailable ? C.error : C.accent;
  return unavailable ? C.error : C.dim;
}

function CodeStatsSummaryLine({ checkpoint, maxWidth }: { checkpoint: RewindCheckpointLike; maxWidth: number }) {
  const stats = checkpoint.codeChangeSummary;
  if (!checkpoint.canRestoreCode || !stats) {
    return null;
  }

  const fileCount = stats.filesChanged.length;
  if (fileCount === 0) {
    return null;
  }

  const fullText = `代码快照：${fileCount} 个文件 · +${stats.insertions} -${stats.deletions}。`;
  const compact = getTextWidth(fullText) > maxWidth;

  return (
    <box flexDirection="row" border={false}>
      <text fg={C.text}>{compact ? '代码：' : '代码快照：'}</text>
      <text fg={C.accent}>{String(fileCount)}</text>
      <text fg={C.text}>{compact ? '文件 ' : ' 个文件 · '}</text>
      <text fg={C.accent}>{`+${stats.insertions}`}</text>
      <text fg={C.text}> </text>
      <text fg={C.error}>{`-${stats.deletions}`}</text>
      <text fg={C.text}>。</text>
    </box>
  );
}

function shouldShowCodeStatsLine(checkpoint: RewindCheckpointLike, selectedMode: RewindTargetMode): boolean {
  return (selectedMode === 'code' || selectedMode === 'both')
    && checkpoint.canRestoreCode === true
    && (checkpoint.codeChangeSummary?.filesChanged.length ?? 0) > 0;
}

export function RewindSelectorView({
  checkpoints,
  selectedIndex,
  confirmCheckpointId,
  statusMessage,
  statusIsError,
  isRestoring,
  selectedMode = 'conversation',
}: RewindSelectorViewProps) {
  const { width: terminalWidth } = useTerminalDimensions();
  const screenWidth = Math.max(40, terminalWidth || 80);
  const headerWidth = Math.max(20, screenWidth - 4);
  const rowWidth = Math.max(20, screenWidth - 4);
  const confirmWidth = Math.max(20, screenWidth - 8);

  const safeSelectedIndex = checkpoints.length > 0 ? clamp(selectedIndex, 0, checkpoints.length - 1) : 0;
  const startIndex = checkpoints.length <= MAX_VISIBLE
    ? 0
    : clamp(safeSelectedIndex - Math.floor(MAX_VISIBLE / 2), 0, checkpoints.length - MAX_VISIBLE);
  const visible = checkpoints.slice(startIndex, startIndex + MAX_VISIBLE);
  const selected = checkpoints[safeSelectedIndex];
  const isConfirming = !!selected && confirmCheckpointId === selected.id;
  const canRestoreSelectedCode = selected?.canRestoreCode === true;
  const effectiveSelectedMode: RewindTargetMode = canRestoreSelectedCode ? selectedMode : 'conversation';

  const hintText = isRestoring
    ? '正在回溯，请稍候...'
    : isConfirming
      ? canRestoreSelectedCode
        ? '↑/↓ 或 ←/→ 切换恢复模式 · Enter 确认 · Esc 返回列表'
        : '无代码快照，只能仅对话 · Enter 确认 · Esc 返回列表'
      : `${ICONS.arrowUp}${ICONS.arrowDown} 选择 · Enter 继续 · Esc 返回`;

  if (isConfirming && selected) {
    const conversationModeColor = getModeColor('conversation', effectiveSelectedMode, canRestoreSelectedCode);
    const codeModeColor = getModeColor('code', effectiveSelectedMode, canRestoreSelectedCode);
    const bothModeColor = getModeColor('both', effectiveSelectedMode, canRestoreSelectedCode);

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box padding={1} flexDirection="column" flexShrink={0}>
          <text fg={C.primary}>{fitText('Rewind 回溯 · 确认恢复', headerWidth)}</text>
          <text fg={C.dim}>{fitText(hintText, headerWidth)}</text>
          <text fg={C.dim}>{fitText(`回溯点：${selected.preview}`, headerWidth)}</text>
        </box>

        <box padding={1} flexDirection="column" borderStyle="single" borderColor={C.warn} flexShrink={0}>
          <text fg={C.warn}>{fitText('确认恢复到所选回溯点？', confirmWidth)}</text>
          <text fg={C.dim}>{fitText('恢复模式：', confirmWidth)}</text>
          <text fg={conversationModeColor}>
            {fitText(formatModeRow('conversation', effectiveSelectedMode, canRestoreSelectedCode), confirmWidth)}
          </text>
          <text fg={codeModeColor}>
            {fitText(formatModeRow('code', effectiveSelectedMode, canRestoreSelectedCode), confirmWidth)}
          </text>
          <text fg={bothModeColor}>
            {fitText(formatModeRow('both', effectiveSelectedMode, canRestoreSelectedCode), confirmWidth)}
          </text>
        </box>

        <box paddingX={2} paddingTop={1} flexDirection="column" flexShrink={0}>
          <text fg={C.text}>{fitText(formatConversationAction(selected, effectiveSelectedMode), headerWidth)}</text>
          {shouldShowCodeStatsLine(selected, effectiveSelectedMode) ? (
            <CodeStatsSummaryLine checkpoint={selected} maxWidth={headerWidth} />
          ) : null}
          <text fg={C.dim}>{fitText(formatCodeScopeNotice(selected, effectiveSelectedMode), headerWidth)}</text>
          <text fg={C.dim}>{fitText(formatBranchNotice(effectiveSelectedMode), headerWidth)}</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1} flexDirection="column">
        <box>
          <text fg={C.primary}>{fitText(`Rewind 回溯  (${checkpoints.length} 个可回溯点)`, headerWidth)}</text>
        </box>
        <box paddingTop={0}>
          <text fg={C.dim}>{fitText(hintText, headerWidth)}</text>
        </box>
        {statusMessage ? (
          <box paddingTop={0}>
            <text fg={statusIsError ? C.error : C.dim}>{fitText(statusMessage, headerWidth)}</text>
          </box>
        ) : null}
      </box>

      <scrollbox flexGrow={1}>
        {checkpoints.length === 0 ? (
          <text fg={C.dim} paddingLeft={2}>{fitText('暂无可回溯的用户消息。', rowWidth)}</text>
        ) : null}

        {startIndex > 0 ? (
          <text fg={C.dim} paddingLeft={2}>{fitText(`${ICONS.arrowUp} 上方还有 ${startIndex} 条`, rowWidth)}</text>
        ) : null}

        {visible.map((checkpoint, localIndex) => {
          const index = startIndex + localIndex;
          const isSelected = index === safeSelectedIndex;
          const marker = isSelected ? `${ICONS.selectorArrow} ` : '  ';
          const markerWidth = getTextWidth(marker);
          const titleWidth = Math.max(8, rowWidth - markerWidth);
          const time = formatTime(checkpoint.createdAt);
          const suffix = [
            time,
            `对话回溯将移除 ${checkpoint.messageCountAfter} 条`,
            checkpoint.hasAttachments ? '含附件' : undefined,
            formatStats(checkpoint),
          ].filter(Boolean).join(' · ');

          return (
            <box key={checkpoint.id} paddingLeft={1} flexDirection="column">
              <box flexDirection="row" border={false}>
                <text fg={isSelected ? C.accent : C.dim}>{marker}</text>
                <box flexGrow={1} flexShrink={1}>
                  <text fg={isSelected ? C.text : C.textSec}>{fitText(`${index + 1}. ${checkpoint.preview}`, titleWidth)}</text>
                </box>
              </box>
              <text fg={C.dim}>
                {fitText(`     ${suffix}`, rowWidth)}
              </text>
              {isSelected && checkpoint.assistantText ? (
                <text fg={C.dim}>
                  {fitText(`     回复：${checkpoint.assistantText}`, rowWidth)}
                </text>
              ) : null}
            </box>
          );
        })}

        {startIndex + visible.length < checkpoints.length ? (
          <text fg={C.dim} paddingLeft={2}>{fitText(`${ICONS.arrowDown} 下方还有 ${checkpoints.length - startIndex - visible.length} 条`, rowWidth)}</text>
        ) : null}
      </scrollbox>

    </box>
  );
}
