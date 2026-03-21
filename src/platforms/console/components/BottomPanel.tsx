/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ToolInvocation } from '../../../types';
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
  onSubmit: (text: string) => void;
  agentName?: string;
  modeName?: string;
  modelName: string;
  contextTokens: number;
  contextWindow?: number;
  copyMode: boolean;
  exitConfirmArmed: boolean;
  /** Computer Use 是否启用（用于条件显示 /window 指令） */
  hasComputerUse?: boolean;
}

export function BottomPanel({
  hasMessages,
  pendingConfirm,
  confirmChoice,
  pendingApprovals,
  approvalChoice,
  isGenerating,
  onSubmit,
  agentName,
  modeName,
  modelName,
  contextTokens,
  contextWindow,
  copyMode,
  exitConfirmArmed,
  hasComputerUse,
}: BottomPanelProps) {
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
          borderColor={isGenerating ? C.dim : C.border}
          padding={1}
          paddingBottom={0}
        >
          <InputBar disabled={isGenerating} onSubmit={onSubmit} hasComputerUse={hasComputerUse} />
          <StatusBar
            agentName={agentName}
            modeName={modeName}
            modelName={modelName}
            contextTokens={contextTokens}
            contextWindow={contextWindow}
          />
        </box>
      )}

      <HintBar
        isGenerating={isGenerating}
        copyMode={copyMode}
        exitConfirmArmed={exitConfirmArmed}
      />
    </box>
  );
}
