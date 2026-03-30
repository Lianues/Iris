/** @jsxImportSource @opentui/react */

import React from 'react';
import type { IrisSessionMetaLike as SessionMeta } from '@irises/extension-sdk';
import { C } from '../theme';

interface SessionListViewProps {
  sessions: SessionMeta[];
  selectedIndex: number;
}

export function SessionListView({ sessions, selectedIndex }: SessionListViewProps) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>历史对话</text>
        <text fg={C.dim}>  ↑↓ 选择  Enter 加载  Esc 返回</text>
      </box>
      <scrollbox flexGrow={1}>
        {sessions.length === 0 && <text fg={C.dim} paddingLeft={2}>暂无历史对话</text>}
        {sessions.map((meta, index) => {
          const isSelected = index === selectedIndex;
          const time = new Date(meta.updatedAt ?? 0).toLocaleString('zh-CN');
          return (
            <box key={meta.id} paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '❯ ' : '  '}</span>
                {isSelected
                  ? <strong><span fg={C.text}>{meta.title}</span></strong>
                  : <span fg={C.textSec}>{meta.title}</span>}
                <span fg={C.dim}>  {meta.cwd}  {time}</span>
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
