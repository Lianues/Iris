/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';

interface StatusBarProps {
  agentName?: string;
  modeName?: string;
  modelName: string;
  contextTokens: number;
  contextWindow?: number;
}

export function StatusBar({ agentName, modeName, modelName, contextTokens, contextWindow }: StatusBarProps) {
  const resolvedModeName = modeName ?? 'normal';
  const modeNameCapitalized = resolvedModeName.charAt(0).toUpperCase() + resolvedModeName.slice(1);
  const contextStr = contextTokens > 0 ? contextTokens.toLocaleString() : '-';
  const contextLimitStr = contextWindow ? `/${contextWindow.toLocaleString()}` : '';
  const contextPercent = contextTokens > 0 && contextWindow
    ? ` (${Math.round(contextTokens / contextWindow * 100)}%)`
    : '';

  return (
    <box flexDirection="row" marginTop={1}>
      <box flexGrow={1}>
        <text>
          {agentName ? <span fg={C.accent}><strong>[{agentName}]</strong></span> : null}
          {agentName ? <span fg={C.dim}> · </span> : null}
          <span fg={C.primaryLight}><strong>{modeNameCapitalized}</strong></span>
          <span fg={C.dim}> · </span>
          <span fg={C.textSec}>{modelName}</span>
        </text>
      </box>
      <box>
        <text fg={C.dim}>ctx {contextStr}{contextLimitStr}{contextPercent}</text>
      </box>
    </box>
  );
}
