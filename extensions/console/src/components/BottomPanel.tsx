/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ToolInvocation } from '@irises/extension-sdk';
import type { ApprovalChoice, ConfirmChoice, PendingConfirm, ThinkingEffortLevel } from '../app-types';
import { ApprovalBar } from './ApprovalBar';
import { ConfirmBar } from './ConfirmBar';
import { HintBar } from './HintBar';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import { ThinkingIndicator } from './ThinkingIndicator';
import { C } from '../theme';

interface BottomPanelProps {
  hasMessages: boolean;
  pendingConfirm: PendingConfirm | null;
  confirmChoice: ConfirmChoice;
  pendingApprovals: ToolInvocation[];
  approvalChoice: ApprovalChoice;
  isGenerating: boolean;
  queueSize: number;
  onSubmit: (text: string) => void;
  onPrioritySubmit: (text: string) => void;
  agentName?: string;
  modeName?: string;
  modelName: string;
  contextTokens: number;
  contextWindow?: number;
  copyMode: boolean;
  exitConfirmArmed: boolean;
  /** 当前后台运行中的异步子代理数量 */
  backgroundTaskCount?: number;
  /** 当前后台运行中的委派任务数量（delegate_to_agent） */
  delegateTaskCount?: number;
  /** 所有后台任务的累计 token 数 */
  backgroundTaskTokens?: number;
  /** chunk 心跳驱动的 spinner 帧索引 */
  backgroundTaskSpinnerFrame?: number;
  /** 当前思考强度层级 */
  thinkingEffort: ThinkingEffortLevel;
  /** Shift+Left/Right 切换思考强度 */
  onCycleThinkingEffort: (direction: 1 | -1) => void;
  hasTools?: boolean;
}

export function BottomPanel({
  hasMessages,
  pendingConfirm,
  confirmChoice,
  pendingApprovals,
  approvalChoice,
  isGenerating,
  queueSize,
  onSubmit,
  onPrioritySubmit,
  agentName,
  modeName,
  modelName,
  contextTokens,
  contextWindow,
  copyMode,
  exitConfirmArmed,
  backgroundTaskCount,
  delegateTaskCount,
  backgroundTaskTokens,
  backgroundTaskSpinnerFrame,
  thinkingEffort,
  onCycleThinkingEffort,
  hasTools,
}: BottomPanelProps) {
  // 输入框仅在审批/确认对话框期间完全禁用
  const inputDisabled = !!(pendingConfirm || pendingApprovals.length > 0);

  return (
    <box flexDirection="column" flexShrink={0} paddingX={1} paddingBottom={1} paddingTop={hasMessages ? 1 : 0}>
      {pendingConfirm ? (
        <ConfirmBar message={pendingConfirm.message} choice={confirmChoice} />
      ) : pendingApprovals.length > 0 ? (
        <ApprovalBar
          toolName={pendingApprovals[0].toolName}
          choice={approvalChoice}
          remainingCount={pendingApprovals.length}
        />
      ) : (
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={isGenerating ? C.warn : C.border}
          paddingX={1}
          paddingTop={0}
          paddingBottom={0}
        >
          <ThinkingIndicator level={thinkingEffort} showHint={!hasMessages} />
          <InputBar
            disabled={inputDisabled}
            isGenerating={isGenerating}
            queueSize={queueSize}
            onSubmit={onSubmit}
            onPrioritySubmit={onPrioritySubmit}
            onCycleThinkingEffort={onCycleThinkingEffort}
          />
          <StatusBar
            agentName={agentName}
            modeName={modeName}
            modelName={modelName}
            contextTokens={contextTokens}
            contextWindow={contextWindow}
            queueSize={queueSize}
            backgroundTaskCount={backgroundTaskCount}
            delegateTaskCount={delegateTaskCount}
            backgroundTaskTokens={backgroundTaskTokens}
            backgroundTaskSpinnerFrame={backgroundTaskSpinnerFrame}
          />
        </box>
      )}

      <HintBar
        isGenerating={isGenerating}
        queueSize={queueSize}
        copyMode={copyMode}
        exitConfirmArmed={exitConfirmArmed}
        hasTools={hasTools}
      />
    </box>
  );
}
