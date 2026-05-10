/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ToolInvocation } from 'irises-extension-sdk';
import type { ApprovalChoice, ConfirmChoice, PendingConfirm, ThinkingEffortLevel } from '../app-types';
import type { ApprovalPage } from '../hooks/use-approval';
import { ApprovalBar } from './ApprovalBar';
import { ConfirmBar } from './ConfirmBar';
import { AskQuestionFirstPanel } from './AskQuestionFirstPanel';
import { PlanApprovalBar } from './PlanApprovalBar';
import { HintBar } from './HintBar';
import { InputBar, type PendingFile } from './InputBar';
import type { Command } from '../input-commands';
import { StatusBar } from './StatusBar';
import { ThinkingIndicator } from './ThinkingIndicator';
import { C } from '../theme';

interface BottomPanelProps {
  hasMessages: boolean;
  pendingConfirm: PendingConfirm | null;
  confirmChoice: ConfirmChoice;
  askQuestionInvocation?: ToolInvocation;
  askQuestionKey?: string;
  pendingApprovals: ToolInvocation[];
  approvalChoice: ApprovalChoice;
  approvalPage?: ApprovalPage;
  isGenerating: boolean;
  queueSize: number;
  onSubmit: (text: string) => void;
  onPrioritySubmit: (text: string) => void;
  onToolMessage?: (toolId: string, type: string, data?: unknown) => void;
  agentName?: string;
  modeName?: string;
  modelName: string;
  contextTokens: number;
  contextWindow?: number;
  copyMode: boolean;
  exitConfirmArmed: boolean;
  /** 当前后台运行中的异步子代理数量 */
  backgroundTaskCount?: number;
  /** 当前会话是否处于 Plan Mode */
  planModeActive?: boolean;
  /** 当前后台运行中的委派任务数量（delegate_to_agent） */
  delegateTaskCount?: number;
  /** 所有后台任务的累计 token 数 */
  backgroundTaskTokens?: number;
  /** chunk 心跳驱動的 spinner 帧索引 */
  backgroundTaskSpinnerFrame?: number;
  /** 远程连接的主机地址 */
  remoteHost?: string;
  /** 当前是否处于远程连接状态 */
  isRemote?: boolean;
  /** 当前思考强度层级 */
  thinkingEffort: ThinkingEffortLevel;
  /** Shift+Left/Right 切换思考强度 */
  onCycleThinkingEffort: (direction: 1 | -1) => void;
  /** 思考强度便捷控制是否启用 */
  thinkingControlEnabled?: boolean;
  /** 当前 provider 的级别列表 */
  providerLevels: ThinkingEffortLevel[];
  /** 待发送的文件附件列表 */
  pendingFiles: PendingFile[];
  /** 移除指定索引的待发送文件 */
  onRemoveFile: (index: number) => void;
  dynamicCommands?: Command[];
  supportsHeadlessTransition?: boolean;
}

export function BottomPanel({
  hasMessages,
  pendingConfirm,
  confirmChoice,
  askQuestionInvocation,
  askQuestionKey,
  pendingApprovals,
  approvalChoice,
  approvalPage,
  isGenerating,
  queueSize,
  onSubmit,
  onPrioritySubmit,
  onToolMessage,
  agentName,
  modeName,
  modelName,
  contextTokens,
  contextWindow,
  copyMode,
  exitConfirmArmed,
  backgroundTaskCount,
  planModeActive,
  delegateTaskCount,
  backgroundTaskTokens,
  backgroundTaskSpinnerFrame,
  thinkingEffort,
  onCycleThinkingEffort,
  thinkingControlEnabled,
  providerLevels,
  remoteHost,
  isRemote,
  pendingFiles,
  onRemoveFile,
  dynamicCommands,
  supportsHeadlessTransition,
}: BottomPanelProps) {
  // 输入框仅在审批/确认对话框期间完全禁用
  const inputDisabled = !!(pendingConfirm || askQuestionInvocation || pendingApprovals.length > 0);

  return (
    <box flexDirection="column" flexShrink={0} paddingX={1} paddingBottom={1} paddingTop={hasMessages ? 1 : 0}>
      {pendingConfirm ? (
        <ConfirmBar message={pendingConfirm.message} choice={confirmChoice} />
      ) : askQuestionInvocation && onToolMessage ? (
        <AskQuestionFirstPanel key={askQuestionKey} invocation={askQuestionInvocation} onToolMessage={onToolMessage} planModeActive={planModeActive} />
      ) : pendingApprovals.length > 0 && pendingApprovals[0].toolName === 'ExitPlanMode' ? (
        <PlanApprovalBar invocation={pendingApprovals[0]} remainingCount={pendingApprovals.length} choice={approvalChoice} />
      ) : pendingApprovals.length > 0 ? (
        <ApprovalBar
          toolName={pendingApprovals[0].toolName}
          choice={approvalChoice}
          remainingCount={pendingApprovals.length}
          isCommandTool={pendingApprovals[0].toolName === 'shell' || pendingApprovals[0].toolName === 'bash'}
          approvalPage={approvalPage}
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
          <ThinkingIndicator level={thinkingEffort} providerLevels={providerLevels} showHint={!hasMessages} isRemote={isRemote} thinkingControlEnabled={thinkingControlEnabled} />
          <InputBar
            disabled={inputDisabled}
            isGenerating={isGenerating}
            queueSize={queueSize}
            onSubmit={onSubmit}
            onPrioritySubmit={onPrioritySubmit}
            onCycleThinkingEffort={onCycleThinkingEffort}
            pendingFiles={pendingFiles}
            onRemoveFile={onRemoveFile}
            isRemote={isRemote}
            dynamicCommands={dynamicCommands}
            supportsHeadlessTransition={supportsHeadlessTransition}
            thinkingControlEnabled={thinkingControlEnabled}
          />
          <StatusBar
            agentName={agentName}
            modeName={modeName}
            modelName={modelName}
            contextTokens={contextTokens}
            contextWindow={contextWindow}
            queueSize={queueSize}
            planModeActive={planModeActive}
            remoteHost={remoteHost}
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
        remoteHost={remoteHost}
      />
    </box>
  );
}
