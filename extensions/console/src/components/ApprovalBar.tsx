/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ApprovalChoice } from '../app-types';
import type { ApprovalPage } from '../hooks/use-approval';
import { C } from '../theme';

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
              {choice === 'approve' ? '[(A)始终允许]' : ' (A)始终允许 '}
            </span>
            <span fg={C.dim}> </span>
            <span fg={choice === 'reject' ? '#e17055' : C.textSec}>
              {choice === 'reject' ? '[(S)始终询问]' : ' (S)始终询问 '}
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
          <span fg={C.dim}>{showPolicyPage ? '  Tab→返回' : '  Tab→更多'}</span>
        ) : null}
      </text>
    </box>
  );
}
