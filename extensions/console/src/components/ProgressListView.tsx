/** @jsxImportSource @opentui/react */

import React, { useMemo } from 'react';
import type { ProgressSnapshotLike, ProgressItemLike, ProgressStatusLike } from '../progress-types';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

export const PROGRESS_PANEL_MAX_ITEMS = 8;

interface ProgressListViewProps {
  snapshot?: ProgressSnapshotLike | null;
  /** 当空间有限时最多显示多少条；TUI 面板上限固定为 8 条。 */
  maxItems?: number;
  /** 独立面板模式会显示汇总标题。 */
  standalone?: boolean;
  /** 折叠为单行，仅展示当前进度。 */
  collapsed?: boolean;
  /** 展开模式下的列表滚动偏移。 */
  scrollOffset?: number;
  /** 是否在标题右侧展示快捷键提示。 */
  showControls?: boolean;
}

function compareProgressItems(a: ProgressItemLike, b: ProgressItemLike): number {
  return a.createdAt - b.createdAt || a.title.localeCompare(b.title);
}

function getStatusIcon(status: ProgressStatusLike): { icon: string; color: string } {
  switch (status) {
    case 'completed':
      return { icon: ICONS.checkmark, color: C.accent };
    case 'in_progress':
      return { icon: ICONS.progressInProgress, color: C.accent };
    case 'blocked':
      return { icon: ICONS.progressBlocked, color: C.warn };
    case 'cancelled':
      return { icon: ICONS.cancelled, color: C.dim };
    case 'pending':
    default:
      return { icon: ICONS.progressPending, color: C.dim };
  }
}

function statusLabel(status: ProgressStatusLike): string {
  switch (status) {
    case 'in_progress': return '进行中';
    case 'completed': return '完成';
    case 'blocked': return '受阻';
    case 'cancelled': return '取消';
    default: return '待处理';
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - ICONS.ellipsis.length))}${ICONS.ellipsis}`;
}

function normalizeMaxItems(maxItems: number): number {
  if (!Number.isFinite(maxItems)) return PROGRESS_PANEL_MAX_ITEMS;
  return Math.max(1, Math.min(PROGRESS_PANEL_MAX_ITEMS, Math.floor(maxItems)));
}

function clampScrollOffset(offset: number, total: number, maxItems: number): number {
  const maxOffset = Math.max(0, total - maxItems);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(maxOffset, Math.max(0, Math.floor(offset)));
}

function currentItemForCollapsed(sorted: ProgressItemLike[]): ProgressItemLike | undefined {
  return sorted.find((item) => item.status === 'in_progress')
    ?? sorted.find((item) => item.status === 'blocked')
    ?? sorted.find((item) => item.status === 'pending')
    ?? sorted.find((item) => item.status === 'cancelled')
    ?? sorted[sorted.length - 1];
}

function collapsedPrefix(item?: ProgressItemLike): string {
  if (!item) return '当前';
  switch (item.status) {
    case 'in_progress': return '当前';
    case 'blocked': return '受阻';
    case 'pending': return '下一项';
    case 'completed': return '已完成';
    case 'cancelled': return '已取消';
    default: return '当前';
  }
}

function controlHintText(collapsed: boolean, canScroll: boolean): string {
  const parts = [`alt+m ${collapsed ? '展开' : '折叠'}`];
  if (!collapsed && canScroll) parts.push(`alt+${ICONS.upArrow}/${ICONS.downArrow} 滚动`);
  return parts.join(` ${ICONS.separator} `);
}

export function ProgressListView({
  snapshot,
  maxItems = PROGRESS_PANEL_MAX_ITEMS,
  standalone = false,
  collapsed = false,
  scrollOffset = 0,
  showControls = false,
}: ProgressListViewProps) {
  const items = snapshot?.items ?? [];
  const stats = snapshot?.stats;
  const itemLimit = normalizeMaxItems(maxItems);
  const canCollapse = (stats?.open ?? 0) > 0;
  const effectiveCollapsed = canCollapse && collapsed;

  const { sorted, visibleItems, hiddenBeforeCount, hiddenAfterCount, effectiveScrollOffset, visibleCount } = useMemo(() => {
    const all = [...items].sort(compareProgressItems);
    const effectiveOffset = clampScrollOffset(scrollOffset, all.length, itemLimit);
    const visible = effectiveCollapsed ? [] : all.slice(effectiveOffset, effectiveOffset + itemLimit);
    return {
      sorted: all,
      visibleItems: visible,
      hiddenBeforeCount: effectiveCollapsed ? 0 : effectiveOffset,
      hiddenAfterCount: effectiveCollapsed ? 0 : Math.max(0, all.length - effectiveOffset - visible.length),
      effectiveScrollOffset: effectiveOffset,
      visibleCount: visible.length,
    };
  }, [items, itemLimit, effectiveCollapsed, scrollOffset]);

  if (items.length === 0) return null;

  const canScroll = sorted.length > itemLimit;
  const currentItem = currentItemForCollapsed(sorted);
  const hiddenSummary = !effectiveCollapsed && (hiddenBeforeCount > 0 || hiddenAfterCount > 0)
    ? `显示 ${effectiveScrollOffset + 1}-${effectiveScrollOffset + visibleCount}/${sorted.length}`
      + (hiddenBeforeCount > 0 ? ` ${ICONS.separator} ${ICONS.upArrow} ${hiddenBeforeCount}` : '')
      + (hiddenAfterCount > 0 ? ` ${ICONS.separator} ${ICONS.downArrow} ${hiddenAfterCount}` : '')
    : '';

  const renderHeader = () => {
    if (!standalone || !stats) return null;
    const currentIcon = currentItem ? getStatusIcon(currentItem.status) : undefined;
    const currentText = currentItem
      ? truncate(currentItem.status === 'in_progress' ? (currentItem.activeForm ?? currentItem.title) : currentItem.title, 72)
      : '暂无进度';
    return (
      <text>
        <span fg={C.primaryLight}>Iris 进度</span>
        {showControls && canCollapse ? <span fg={C.dim}> {ICONS.separator} {controlHintText(effectiveCollapsed, canScroll)}</span> : null}
        <span fg={C.dim}> {ICONS.separator} </span>
        <span fg={C.text}><strong>{stats.completed}</strong></span>
        <span fg={C.dim}>/</span>
        <span fg={C.text}><strong>{stats.total}</strong></span>
        <span fg={C.dim}> 已完成</span>
        {stats.inProgress > 0 ? <span fg={C.accent}> {ICONS.separator} {stats.inProgress} 进行中</span> : null}
        {stats.blocked > 0 ? <span fg={C.warn}> {ICONS.separator} {stats.blocked} 受阻</span> : null}
        {effectiveCollapsed ? (
          <>
            <span fg={C.dim}> {ICONS.separator} {collapsedPrefix(currentItem)}：</span>
            {currentIcon ? <span fg={currentIcon.color}>{currentIcon.icon} </span> : null}
            <span fg={currentItem?.status === 'in_progress' ? C.text : C.textSec}>{currentText}</span>
          </>
        ) : null}
      </text>
    );
  };

  if (effectiveCollapsed) {
    return (
      <box flexDirection="column" marginTop={standalone ? 1 : 0} paddingLeft={standalone ? 1 : 0}>
        {renderHeader()}
      </box>
    );
  }

  return (
    <box flexDirection="column" marginTop={standalone ? 1 : 0} paddingLeft={standalone ? 1 : 0}>
      {renderHeader()}

      {visibleItems.map((item, index) => {
        const { icon, color } = getStatusIcon(item.status);
        const isCompleted = item.status === 'completed';
        const isActive = item.status === 'in_progress';
        const isDim = isCompleted || item.status === 'cancelled';
        const title = truncate(item.title, 90);
        return (
          <box key={`${effectiveScrollOffset + index}:${item.createdAt}:${item.title}`} flexDirection="column">
            <text>
              <span fg={C.dim}>  </span>
              <span fg={color}>{icon}</span>
              <span fg={C.dim}> </span>
              <span fg={isDim ? C.dim : isActive ? C.text : C.textSec}>
                {isActive ? <strong>{title}</strong> : title}
              </span>
              {item.status !== 'pending' && item.status !== 'completed' ? <span fg={C.dim}> [{statusLabel(item.status)}]</span> : null}
            </text>
            {isActive && item.activeForm ? (
              <text fg={C.dim}>    {truncate(item.activeForm, 100)}{ICONS.ellipsis}</text>
            ) : null}
          </box>
        );
      })}

      {hiddenSummary ? <text fg={C.dim}>  {hiddenSummary}</text> : null}
    </box>
  );
}
