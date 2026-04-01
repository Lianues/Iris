/** @jsxImportSource @opentui/react */

import React, { useEffect, useState } from 'react';
import { C } from '../theme';

interface StatusBarProps {
  agentName?: string;
  modeName?: string;
  modelName: string;
  contextTokens: number;
  contextWindow?: number;
  queueSize?: number;
  /** 当前后台运行中的异步子代理数量 */
  backgroundTaskCount?: number;
  /** 所有后台任务的累计 token 数 */
  backgroundTaskTokens?: number;
}

// Braille spinner 帧序列：用于后台任务活跃指示。
// 每 120ms 切换一帧，让用户直观感知子代理仍在运行中。
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** 当有后台任务运行时，返回循环的 spinner 字符；否则返回空字符串 */
function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 120);
    return () => clearInterval(timer);
  }, [active]);
  return active ? SPINNER_FRAMES[frame] : '';
}

export function StatusBar({ agentName, modeName, modelName, contextTokens, contextWindow, queueSize, backgroundTaskCount, backgroundTaskTokens }: StatusBarProps) {
  const hasBackgroundTasks = (backgroundTaskCount ?? 0) > 0;
  const spinner = useSpinner(hasBackgroundTasks);
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
          {queueSize != null && queueSize > 0 ? (
            <>
              <span fg={C.dim}> · </span>
              <span fg={C.warn}>{queueSize} 条排队中</span>
            </>
          ) : null}
          {/* 异步子代理后台任务计数：让用户实时知道有多少子代理正在后台运行 */}
          {backgroundTaskCount != null && backgroundTaskCount > 0 ? (
            <>
              <span fg={C.dim}> · </span>
              <span fg={C.accent}>
                {spinner} {backgroundTaskCount} 个后台任务{backgroundTaskTokens != null && backgroundTaskTokens > 0 ? ` ↑${backgroundTaskTokens.toLocaleString()}tk` : ''}
              </span>
            </>
          ) : null}
        </text>
      </box>
      <box>
        <text fg={C.dim}>ctx {contextStr}{contextLimitStr}{contextPercent}</text>
      </box>
    </box>
  );
}
