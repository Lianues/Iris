/** @jsxImportSource @opentui/react */

import React from 'react';
import type { IrisModelInfoLike as LLMModelInfo } from 'irises-extension-sdk';
import { useCursorBlink } from '../hooks/use-cursor-blink';
import { InputDisplay } from './InputDisplay';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

// ── 工具函数 ─────────────────────────────────────────────

function formatContextWindow(tokens?: number): string {
  if (tokens == null || tokens <= 0) return '';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(tokens);
}

function formatContextWindowFull(tokens?: number): string {
  if (tokens == null || tokens <= 0) return '未知';
  return tokens.toLocaleString('en-US');
}

function getVisionStatus(supportsVision?: boolean): {
  symbol: string;
  label: string;
  color: string;
} {
  if (supportsVision === true) {
    return { symbol: ICONS.checkmark, label: '支持', color: C.accent };
  }
  if (supportsVision === false) {
    return { symbol: ICONS.crossmark, label: '不支持', color: C.error };
  }
  return { symbol: '?', label: '未知', color: C.dim };
}

// ── 组件 ─────────────────────────────────────────────────

interface ModelListViewProps {
  models: LLMModelInfo[];
  selectedIndex: number;
  /** 配置中的默认模型名称（用于 [默认] 标记） */
  defaultModelName?: string;
  statusMessage?: string | null;
  statusIsError?: boolean;
  editingField?: 'modelName' | 'contextWindow' | null;
  editingValue?: string;
  editingCursor?: number;
}

export function ModelListView({
  models,
  selectedIndex,
  defaultModelName,
  statusMessage,
  statusIsError,
  editingField,
  editingValue = '',
  editingCursor = 0,
}: ModelListViewProps) {
  const selected = models[selectedIndex];
  const count = models.length;
  const visionStatus = selected ? getVisionStatus(selected.supportsVision) : undefined;
  const cursorVisible = useCursorBlink();

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* ── 顶部标题 + 操作提示 ── */}
      <box padding={1} flexDirection="column">
        <text fg={C.primary}>{`切换模型 (${count})`}</text>
        {editingField ? (
          <>
            <text fg={C.dim}>{`Enter 保存  Esc 取消  Ctrl+U 清空`}</text>
            <text fg={C.dim}>{editingField === 'contextWindow' ? '留空可清除上下文窗口配置' : '编辑模型别名（会同步更新 /model 使用名称）'}</text>
          </>
        ) : (
          <>
            <text fg={C.dim}>{`${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 切换  d 设默认  r 刷新`}</text>
            <text fg={C.dim}>{`n 改名  w 改上下文  Esc 返回`}</text>
          </>
        )}
      </box>

      {statusMessage && (
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={statusIsError ? C.error : C.accent}>{statusMessage}</text>
        </box>
      )}

      {editingField && selected && (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={C.warn}>{editingField === 'modelName' ? `编辑模型名：${selected.modelName}` : `编辑上下文窗口：${selected.modelName}`}</text>
          <InputDisplay
            value={editingValue}
            cursor={editingCursor}
            isActive={true}
            cursorVisible={cursorVisible}
            placeholder={editingField === 'modelName' ? '输入新的模型别名' : '输入新的上下文窗口，留空可清除'}
          />
        </box>
      )}

      {/* ── 模型列表 ── */}
      <scrollbox flexGrow={1}>
        {count === 0 && (
          <text fg={C.dim} paddingLeft={2}>暂无可用模型。请在 /settings 中配置。</text>
        )}
        {models.map((info, index) => {
          const isSelected = index === selectedIndex;
          const isCurrent = info.current === true;
          const isDefault = !!(defaultModelName && info.modelName === defaultModelName);

          // 标记文本
          const badges: string[] = [];
          if (isCurrent) badges.push('当前');
          if (isDefault) badges.push('默认');
          const badgeText = badges.length > 0 ? ` [${badges.join('] [')}]` : '';

          // 第二行：provider · modelId · contextWindow · vision
          const details: string[] = [];
          if (info.provider) details.push(info.provider);
          if (info.modelId) details.push(info.modelId);
          const ctxStr = formatContextWindow(info.contextWindow);
          if (ctxStr) details.push(ctxStr);
          const detailLine = details.join(` ${ICONS.separator} `);
          const visionIcon = info.supportsVision ? ' \uD83D\uDC41' : '';

          return (
            <box key={info.modelName} flexDirection="column" paddingLeft={1}>
              {/* 第一行：箭头 + 模型别名 + 标记 */}
              <box>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? `${ICONS.selectorArrow} ` : '  '}</span>
                  <span fg={isCurrent ? C.accent : C.dim}>{isCurrent ? ICONS.bullet : ' '} </span>
                  {isSelected
                    ? <strong><span fg={C.text}>{info.modelName}</span></strong>
                    : <span fg={C.textSec}>{info.modelName}</span>}
                  {isCurrent && <span fg={C.accent}>{' [当前]'}</span>}
                  {isDefault && <span fg={C.primaryLight}>{' [默认]'}</span>}
                </text>
              </box>
              {/* 第二行：provider · modelId · context · vision */}
              <box paddingLeft={4}>
                <text>
             <span fg={C.dim}>{detailLine}{visionIcon}</span>
                </text>
              </box>
            </box>
          );
        })}
      </scrollbox>

      {/* ── 底部详情栏 ── */}
      {selected && (
        <box paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={1}>
          <text>
            <span fg={C.dim}>{'提供商：'}</span>
            <span fg={C.textSec}>{selected.provider ?? '未知'}</span>
            <span fg={C.dim}>{' | 模型：'}</span>
            <span fg={C.textSec}>{selected.modelId}</span>
            <span fg={C.dim}>{' | 上下文：'}</span>
            <span fg={C.textSec}>{formatContextWindowFull(selected.contextWindow)}</span>
            <span fg={C.dim}>{' | 视觉：'}</span>
            <span fg={visionStatus?.color ?? C.dim}>{visionStatus?.symbol ?? '?'}</span>
            <span fg={visionStatus?.color ?? C.dim}>{` ${visionStatus?.label ?? '未知'}`}</span>
          </text>
        </box>
      )}
    </box>
  );
}
