/** @jsxImportSource @opentui/react */

import React from 'react';
import type { ConfirmChoice } from '../app-types';
import { C } from '../theme';

interface ConfirmBarProps {
  message: string;
  choice: ConfirmChoice;
}

export function ConfirmBar({ message, choice }: ConfirmBarProps) {
  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={choice === 'confirm' ? C.warn : C.dim}
      paddingLeft={1}
      paddingRight={1}
      paddingY={0}
    >
      <text>
        <span fg={C.error}><strong>⚠ </strong></span>
        <span fg={C.text}>{message}</span>
      </text>
      <text>
        <span fg={C.dim}>  </span>
        <span fg={choice === 'confirm' ? C.warn : C.textSec}>
          {choice === 'confirm' ? '[(Y)确认]' : ' (Y)确认 '}
        </span>
        <span fg={C.dim}> </span>
        <span fg={choice === 'cancel' ? C.accent : C.textSec}>
          {choice === 'cancel' ? '[(N)取消]' : ' (N)取消 '}
        </span>
      </text>
    </box>
  );
}
