/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';

interface NotePanelProps {
  content: string;
  maxLines?: number;
}

export function NotePanel({ content, maxLines = 4 }: NotePanelProps) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const lines = trimmed.split(/\r?\n/);
  const visible = lines.slice(0, maxLines);
  const truncated = lines.length > visible.length;

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={C.accent}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <text>
        <span fg={C.accent}><strong>✎ Note</strong></span>
        <span fg={C.dim}>  /note edit 编辑 · /note clear 清空</span>
      </text>
      {visible.map((line, index) => (
        <text key={index}><span fg={C.textSec}>{line || ' '}</span></text>
      ))}
      {truncated ? <text fg={C.dim}>…</text> : null}
    </box>
  );
}
