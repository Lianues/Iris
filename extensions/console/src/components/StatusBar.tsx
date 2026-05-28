/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { SPINNER_FRAMES, ICONS } from '../terminal-compat';
import type { ConsoleStatusSegmentSnapshot } from '../status-segment-service';

interface StatusBarProps {
  agentName?: string;
  modeName?: string;
  modelName: string;
  contextTokens: number;
  contextWindow?: number;
  queueSize?: number;
  /** 当前会话是否处于 Plan Mode */
  planModeActive?: boolean;
  /** 当前 Agent 是否存在 active /note */
  noteActive?: boolean;
  /** 远程连接的主机地址（非空时显示远程标识） */
  remoteHost?: string;
  /** 当前后台运行中的异步子代理数量 */
  backgroundTaskCount?: number;
  /** 当前后台运行中的委派任务数量（delegate_to_agent），与子代理分开计数 */
  delegateTaskCount?: number;
  /** 所有后台任务的累计 token 数 */
  backgroundTaskTokens?: number;
  /** chunk 心跳驱动的 spinner 帧索引 */
  backgroundTaskSpinnerFrame?: number;
  /** 显示在右下角 ctx 右侧的扩展状态片段 */
  statusSegments?: ConsoleStatusSegmentSnapshot[];
}

function statusColor(color: ConsoleStatusSegmentSnapshot['color'] | undefined): string {
  if (color === 'dim') return C.dim;
  if (color === 'accent') return C.accent;
  if (color === 'warn') return C.warn;
  if (color === 'error') return C.error;
  return color ?? C.dim;
}

export function StatusBar({ agentName, modeName, modelName, contextTokens, contextWindow, queueSize, planModeActive, noteActive, remoteHost, backgroundTaskCount, delegateTaskCount, backgroundTaskTokens, backgroundTaskSpinnerFrame, statusSegments }: StatusBarProps) {
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
      <box flexGrow={1} flexShrink={1}>
        <text>
          {remoteHost ? <span fg={C.warn}><strong>[远程: {remoteHost}]</strong></span> : null}
          {remoteHost ? <span fg={C.dim}> {ICONS.separator} </span> : null}
          {agentName ? <span fg={C.accent}><strong>[{agentName}]</strong></span> : null}
          {agentName ? <span fg={C.dim}> {ICONS.separator} </span> : null}
          <span fg={C.primaryLight}><strong>{modeNameCapitalized}</strong></span>
          <span fg={C.dim}> {ICONS.separator} </span>
          <span fg={C.textSec}>{modelName}</span>
          {queueSize != null && queueSize > 0 ? (
            <>
              <span fg={C.dim}> {ICONS.separator} </span>
              <span fg={C.warn}>{queueSize} 条排队中</span>
            </>
          ) : null}
          {/* 异步子代理后台任务指示：spinner 由 chunk 心跳驱动，数据流动时转，停止时静止 */}
          {hasBackgroundTasks ? (
            <>
              <span fg={C.dim}> {ICONS.separator} </span>
              <span fg={C.accent}>
                {spinner} {backgroundTaskCount} 个后台任务{backgroundTaskTokens != null && backgroundTaskTokens > 0 ? ` ${ICONS.upArrow}${backgroundTaskTokens.toLocaleString()}tk` : ''}
              </span>
            </>
          ) : null}
          {/* [职责分离] 委派任务独立显示，不带 spinner 和 token（委派不传心跳） */}
          {hasDelegateTasks ? (
            <>
              <span fg={C.dim}> {ICONS.separator} </span>
              <span fg={C.warn}>
                {ICONS.delegateArrow} {delegateTaskCount} 个委派任务
              </span>
            </>
          ) : null}
        </text>
      </box>
      {planModeActive ? (
        <box flexShrink={0}>
          <text>
            <span fg={C.dim}> {ICONS.separator}  </span>
            <span fg={C.warn}><strong>{ICONS.planMode} Plan Mode</strong></span>
            <span fg={C.dim}>  </span>
          </text>
        </box>
      ) : null}
      {noteActive ? (
        <box flexShrink={0}>
          <text>
            <span fg={C.dim}> {ICONS.separator}  </span>
            <span fg={C.accent}><strong>✎ Note</strong></span>
            <span fg={C.dim}>  </span>
          </text>
        </box>
      ) : null}
      <box flexShrink={0}>
        <text>
          <span fg={C.dim}> ctx {contextStr}{contextLimitStr}{contextPercent}</span>
          {(statusSegments ?? []).map((segment) => (
            <React.Fragment key={segment.id}>
              <span fg={C.dim}> {ICONS.separator} </span>
              <span fg={statusColor(segment.color)}>{segment.text}</span>
            </React.Fragment>
          ))}
        </text>
      </box>
    </box>
  );
}
