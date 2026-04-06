/** @jsxImportSource @opentui/react */

/**
 * Agent 选择列表视图（OpenTUI React 组件）
 *
 * 修改目的：将原来直接操作 process.stdin/stdout 的 ANSI agent-selector
 * 改为 OpenTUI React viewMode 页面，与 session-list、model-list 同级。
 * 这样完全在 TUI 内部切换，不存在 stdin/stdout 争夺和日志泄漏问题。
 */

import React from 'react';
import type { AgentDefinitionLike } from '@irises/extension-sdk';
import { C } from '../theme';

interface AgentListViewProps {
  agents: AgentDefinitionLike[];
  selectedIndex: number;
  /** 当前正在使用的 agent 名称，用于标记 • */
  currentAgentName?: string;
}

export function AgentListView({ agents, selectedIndex, currentAgentName }: AgentListViewProps) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>切换 Agent</text>
        <text fg={C.dim}>  ↑↓ 选择  Enter 切换  Esc 返回</text>
      </box>
      <scrollbox flexGrow={1}>
        {agents.length === 0 && <text fg={C.dim} paddingLeft={2}>暂无可用 Agent</text>}
        {agents.map((agent, index) => {
          const isSelected = index === selectedIndex;
          const isCurrent = agent.name === currentAgentName;
          const currentMarker = isCurrent ? '•' : ' ';
          return (
            <box key={agent.name} paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '❯ ' : '  '}</span>
                <span fg={isCurrent ? C.accent : C.dim}>{currentMarker} </span>
                {isSelected
                  ? <strong><span fg={C.text}>{agent.name}</span></strong>
                  : <span fg={C.textSec}>{agent.name}</span>}
                {agent.description
                  ? <span fg={C.dim}>  {agent.description}</span>
                  : null}
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
