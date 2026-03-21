/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';

export function LogoScreen() {
  return (
    <box flexDirection="column" flexGrow={1} padding={1} alignItems="center" justifyContent="center">
      <box flexDirection="column" border={false} padding={2} alignItems="center">
        <text fg={C.primary}>
          <strong>{'▀█▀ █▀█ ▀█▀ █▀▀'}</strong>
        </text>
        <text fg={C.primary}>
          <strong>{' █  █▀▄  █  ▀▀█'}</strong>
        </text>
        <text fg={C.primary}>
          <strong>{'▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀'}</strong>
        </text>
        <text> </text>
        <text fg={C.dim}>模块化 AI 智能代理框架</text>
      </box>
    </box>
  );
}
