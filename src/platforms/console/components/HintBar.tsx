/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';

interface HintBarProps {
  isGenerating: boolean;
  copyMode: boolean;
  exitConfirmArmed: boolean;
}

export function HintBar({ isGenerating, copyMode, exitConfirmArmed }: HintBarProps) {
  return (
    <box flexDirection="row" justifyContent="flex-end" paddingTop={0} paddingRight={1}>
      <text fg={exitConfirmArmed ? C.warn : C.dim}>
        {isGenerating ? 'esc 中断生成' : 'ctrl+j 换行'}
        {'  ·  '}
        {copyMode ? 'f6 返回滚动模式' : 'f6 复制模式'}
        {'  ·  '}
        {exitConfirmArmed ? '再次按 ctrl+c 退出' : 'ctrl+c 连按两次退出'}
      </text>
    </box>
  );
}
