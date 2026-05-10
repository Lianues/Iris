/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';
import type { ThinkingEffortLevel } from '../app-types';

const FILLED_CHAR = ICONS.thinkingFilled; // ￭ (Halfwidth) / = (ASCII)
const DIM_CHAR = ICONS.thinkingDim;       // ￮ (Halfwidth) / - (ASCII)

interface ThinkingIndicatorProps {
  level: ThinkingEffortLevel;
  /** 当前 provider 的完整级别列表（第一项始终是 'not-set'） */
  providerLevels: ThinkingEffortLevel[];
  /** 是否显示操作提示（首次进入时显示） */
  showHint?: boolean;
  /** 当前是否处于远程连接状态 */
  isRemote?: boolean;
  /** 思考控制功能是否启用（false 时不渲染） */
  thinkingControlEnabled?: boolean;
}

export function ThinkingIndicator({ level, providerLevels, showHint, isRemote, thinkingControlEnabled }: ThinkingIndicatorProps) {
  // thinkingControl 未设置时视为 true（默认启用）
  if (thinkingControlEnabled === false) return null;

  // 圆点数量 = 活跃级别数（排除 'not-set'）
  const blockCount = Math.max(1, providerLevels.length - 1);
  // 填充数量 = 当前级别在列表中的索引（'not-set' = 0 → 全空）
  const idx = providerLevels.indexOf(level);
  const filled = idx >= 0 ? idx : 0;
  const isNotSet = level === 'not-set';

  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < blockCount; i++) {
    const isFilled = i < filled;
    blocks.push(
      <span key={i} fg={isFilled ? C.accent : C.dim}>
        {isFilled ? FILLED_CHAR : DIM_CHAR}
      </span>,
    );
  }

  return (
    <box flexDirection="row">
      <box flexGrow={1}>
        <text>
          {blocks}
          <span fg={isNotSet ? C.dim : C.accent}> {isNotSet ? 'not set' : level}</span>
        </text>
      </box>
      {isRemote ? (
        <box flexShrink={0}>
          <text fg={C.dim}>输入 /disconnect 断开远程连接</text>
        </box>
      ) : null}
      {showHint ? (
        <box flexShrink={0}>
          <text fg={C.dim}>{`shift+${ICONS.arrowLeft}/${ICONS.arrowRight} 调整思考强度`}</text>
        </box>
      ) : null}
    </box>
  );
}
