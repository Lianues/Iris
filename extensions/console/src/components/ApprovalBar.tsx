/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ApprovalChoice } from '../app-types';
import type { ApprovalPage } from '../hooks/use-approval';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

interface ApprovalBarProps {
  toolName: string;
  choice: ApprovalChoice;
  remainingCount: number;
  /** 是否为命令类工具（shell/bash），显示 Tab 切换策略页 */
  isCommandTool?: boolean;
  /** 当前审批页面：basic = Y/N，policy = A/S */
  approvalPage?: ApprovalPage;
}

export function ApprovalBar({ toolName, choice, remainingCount, isCommandTool, approvalPage = 'basic' }: ApprovalBarProps) {
  const showPolicyPage = isCommandTool && approvalPage === 'policy';

  const borderColor = showPolicyPage
    ? C.command
    : choice === 'approve' ? C.accent : C.error;

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingLeft={1}
      paddingRight={1}
      paddingY={0}
    >
      <text>
        <span fg={C.warn}><strong>? </strong></span>
        <span fg={C.text}>{showPolicyPage ? '记住选择 ' : '确认执行 '}</span>
        <span fg={C.warn}><strong>{toolName}</strong></span>
        <span fg={C.dim}>  </span>
        {showPolicyPage ? (
          <>
            <span fg={choice === 'approve' ? C.command : C.textSec}>
              {choice === 'approve' ? '[(A)允许此类命令]' : ' (A)允许此类命令 '}
            </span>
            <span fg={C.dim}> </span>
            <span fg={choice === 'reject' ? '#e17055' : C.textSec}>
              {choice === 'reject' ? '[(S)询问此类命令]' : ' (S)询问此类命令 '}
            </span>
          </>
        ) : (
          <>
            <span fg={choice === 'approve' ? C.accent : C.textSec}>
              {choice === 'approve' ? '[(Y)批准]' : ' (Y)批准 '}
            </span>
            <span fg={C.dim}> </span>
            <span fg={choice === 'reject' ? C.error : C.textSec}>
              {choice === 'reject' ? '[(N)拒绝]' : ' (N)拒绝 '}
            </span>
          </>
        )}
        {remainingCount > 1 ? <span fg={C.dim}>{`  (剩余 ${remainingCount - 1} 个)`}</span> : null}
        {isCommandTool ? (
          <span fg={C.dim}>{showPolicyPage ? `  Tab${ICONS.arrowRight}返回` : `  Tab${ICONS.arrowRight}更多`}</span>
        ) : null}
      </text>
    </box>
  );
}
