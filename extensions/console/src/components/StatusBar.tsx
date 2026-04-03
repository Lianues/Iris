/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';

// Braille spinner 帧序列：后台任务活跃指示。
// 由真实的 chunk 心跳事件驱动帧递增，只有数据真正在流动时 spinner 才转。
// 数据停止流动（如子代理等待工具执行结果）时 spinner 静止——
// 用户可以由此区分"正在接收数据"和"正在等待"两种状态。
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface StatusBarProps {
  agentName?: string;
  modeName?: string;
  modelName: string;
  contextTokens: number;
  contextWindow?: number;
  queueSize?: number;
  /** 当前后台运行中的异步子代理数量 */
  backgroundTaskCount?: number;
  /** 当前后台运行中的委派任务数量（delegate_to_agent），与子代理分开计数 */
  delegateTaskCount?: number;
  /** 所有后台任务的累计 token 数 */
  backgroundTaskTokens?: number;
  /** chunk 心跳驱动的 spinner 帧索引 */
  backgroundTaskSpinnerFrame?: number;
}

export function StatusBar({ agentName, modeName, modelName, contextTokens, contextWindow, queueSize, backgroundTaskCount, delegateTaskCount, backgroundTaskTokens, backgroundTaskSpinnerFrame }: StatusBarProps) {
  const resolvedModeName = modeName ?? 'normal';
  const modeNameCapitalized = resolvedModeName.charAt(0).toUpperCase() + resolvedModeName.slice(1);
  const contextStr = contextTokens > 0 ? contextTokens.toLocaleString() : '-';
  const contextLimitStr = contextWindow ? `/${contextWindow.toLocaleString()}` : '';
  const contextPercent = contextTokens > 0 && contextWindow
    ? ` (${Math.round(contextTokens / contextWindow * 100)}%)`
    : '';

  const hasBackgroundTasks = (backgroundTaskCount ?? 0) > 0;
  const hasDelegateTasks = (delegateTaskCount ?? 0) > 0;
  const spinner = hasBackgroundTasks
    ? SPINNER_FRAMES[(backgroundTaskSpinnerFrame ?? 0) % SPINNER_FRAMES.length]
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
          {/* 异步子代理后台任务指示：spinner 由 chunk 心跳驱动，数据流动时转，停止时静止 */}
          {hasBackgroundTasks ? (
            <>
              <span fg={C.dim}> · </span>
              <span fg={C.accent}>
                {spinner} {backgroundTaskCount} 个后台任务{backgroundTaskTokens != null && backgroundTaskTokens > 0 ? ` ↑${backgroundTaskTokens.toLocaleString()}tk` : ''}
              </span>
            </>
          ) : null}
          {/* [职责分离] 委派任务独立显示，不带 spinner 和 token（委派不传心跳） */}
          {hasDelegateTasks ? (
            <>
              <span fg={C.dim}> · </span>
              <span fg={C.warn}>
                ⇢ {delegateTaskCount} 个委派任务
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
