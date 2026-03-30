/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ToolInvocation } from '@irises/extension-sdk';
import type { ApprovalChoice, ConfirmChoice, PendingConfirm } from '../app-types';
import { ApprovalBar } from './ApprovalBar';
import { ConfirmBar } from './ConfirmBar';
import { HintBar } from './HintBar';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
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
          padding={1}
          paddingBottom={0}
        >
          <InputBar
            disabled={inputDisabled}
            isGenerating={isGenerating}
            queueSize={queueSize}
            onSubmit={onSubmit}
            onPrioritySubmit={onPrioritySubmit}
          />
          <StatusBar
            agentName={agentName}
            modeName={modeName}
            modelName={modelName}
            contextTokens={contextTokens}
            contextWindow={contextWindow}
            queueSize={queueSize}
          />
        </box>
      )}

      <HintBar
        isGenerating={isGenerating}
        queueSize={queueSize}
        copyMode={copyMode}
        exitConfirmArmed={exitConfirmArmed}
      />
    </box>
  );
}
