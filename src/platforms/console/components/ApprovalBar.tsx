/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ApprovalChoice } from '../app-types';
import { C } from '../theme';

interface ApprovalBarProps {
  toolName: string;
  choice: ApprovalChoice;
  remainingCount: number;
}

export function ApprovalBar({ toolName, choice, remainingCount }: ApprovalBarProps) {
  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={choice === 'approve' ? C.accent : C.error}
      paddingLeft={1}
      paddingRight={1}
      paddingY={0}
    >
      <text>
        <span fg={C.warn}><strong>? </strong></span>
        <span fg={C.text}>确认执行 </span>
        <span fg={C.warn}><strong>{toolName}</strong></span>
        <span fg={C.dim}>  </span>
        <span fg={choice === 'approve' ? C.accent : C.textSec}>
          {choice === 'approve' ? '[(Y)批准]' : ' (Y)批准 '}
        </span>
        <span fg={C.dim}> </span>
        <span fg={choice === 'reject' ? C.error : C.textSec}>
          {choice === 'reject' ? '[(N)拒绝]' : ' (N)拒绝 '}
        </span>
        {remainingCount > 1 ? <span fg={C.dim}>{`  (剩余 ${remainingCount - 1} 个)`}</span> : null}
      </text>
    </box>
  );
}
