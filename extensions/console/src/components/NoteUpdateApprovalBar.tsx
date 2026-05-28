/** @jsxImportSource @opentui/react */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { ToolInvocation } from 'irises-extension-sdk';
import type { ApprovalChoice } from '../app-types';
import { C } from '../theme';

interface NoteUpdateProgress {
  kind?: string;
  currentNote?: string;
  proposedNote?: string;
  reason?: string;
  mode?: string;
  noteFilePath?: string;
}

function linesOf(text: string | undefined, fallback: string): string[] {
  const value = text?.trim();
  return value ? value.split(/\r?\n/) : [fallback];
}

interface NoteUpdateApprovalBarProps {
  invocation: ToolInvocation;
  remainingCount: number;
  choice: ApprovalChoice;
}

export function NoteUpdateApprovalBar({ invocation, remainingCount, choice }: NoteUpdateApprovalBarProps) {
  const { height } = useTerminalDimensions();
  const progress = invocation.progress as NoteUpdateProgress | undefined;
  const borderColor = choice === 'approve' ? C.accent : C.error;
  const currentLines = linesOf(progress?.currentNote, '(当前为空)');
  const proposedLines = linesOf(progress?.proposedNote, progress?.mode === 'clear' ? '(清空)' : '(拟写入为空)');
  const maxSectionHeight = Math.max(2, Math.min(7, Math.floor(height * 0.18)));

  return (
    <box flexDirection="column" borderStyle="single" borderColor={borderColor} paddingX={1} paddingY={0}>
      <text>
        <span fg={C.accent}><strong>? </strong></span>
        <span fg={C.text}>批准更新当前 Agent 的 Note？</span>
        <span fg={C.dim}>  </span>
        <span fg={choice === 'approve' ? C.accent : C.textSec}>{choice === 'approve' ? '[(Y/Enter)批准]' : ' (Y/Enter)批准 '}</span>
        <span fg={C.dim}> </span>
        <span fg={choice === 'reject' ? C.error : C.textSec}>{choice === 'reject' ? '[(N)拒绝]' : ' (N)拒绝 '}</span>
        {remainingCount > 1 ? <span fg={C.dim}>{`  (剩余 ${remainingCount - 1} 个)`}</span> : null}
        <span fg={C.dim}>  ←/→ 选择</span>
      </text>
      {progress?.reason ? <text><span fg={C.dim}>原因：</span><span fg={C.textSec}>{progress.reason}</span></text> : null}
      {progress?.noteFilePath ? <text><span fg={C.dim}>文件：{progress.noteFilePath}</span></text> : null}
      <text fg={C.dim}>当前 Note</text>
      <scrollbox height={Math.min(currentLines.length, maxSectionHeight)} borderStyle="single" borderColor={C.border} verticalScrollbarOptions={{ visible: currentLines.length > maxSectionHeight }} horizontalScrollbarOptions={{ visible: false }}>
        {currentLines.map((line, index) => <text key={index}><span fg={C.textSec}>{line || ' '}</span></text>)}
      </scrollbox>
      <text fg={C.dim}>拟更新为</text>
      <scrollbox height={Math.min(proposedLines.length, maxSectionHeight)} borderStyle="single" borderColor={C.border} verticalScrollbarOptions={{ visible: proposedLines.length > maxSectionHeight }} horizontalScrollbarOptions={{ visible: false }}>
        {proposedLines.map((line, index) => <text key={index}><span fg={C.text}>{line || ' '}</span></text>)}
      </scrollbox>
    </box>
  );
}
