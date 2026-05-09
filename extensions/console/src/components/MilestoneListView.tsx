/** @jsxImportSource @opentui/react */

import React, { useMemo } from 'react';
import type { MilestoneSnapshotLike, MilestoneItemLike, MilestoneStatusLike } from '../milestone-types';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

export const MILESTONE_PANEL_MAX_ITEMS = 8;

interface MilestoneListViewProps {
  snapshot?: MilestoneSnapshotLike | null;
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

interface OwnerStats {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
}

interface OwnerGroup {
  owner: string;
  items: MilestoneItemLike[];
  stats: OwnerStats;
}

function compareById(a: MilestoneItemLike, b: MilestoneItemLike): number {
  const an = parseInt(a.id.replace(/^m/i, ''), 10);
  const bn = parseInt(b.id.replace(/^m/i, ''), 10);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function getStatusIcon(status: MilestoneStatusLike): { icon: string; color: string } {
  switch (status) {
    case 'completed':
      return { icon: ICONS.checkmark, color: C.accent };
    case 'in_progress':
      return { icon: ICONS.milestoneInProgress, color: C.accent };
    case 'blocked':
      return { icon: ICONS.milestoneBlocked, color: C.warn };
    case 'cancelled':
      return { icon: ICONS.cancelled, color: C.dim };
    case 'pending':
    default:
      return { icon: ICONS.milestonePending, color: C.dim };
  }
}

function statusLabel(status: MilestoneStatusLike): string {
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

function ownerLabel(item: MilestoneItemLike, fallback?: string): string {
  return (item.owner || fallback || '未分配').trim();
}

function displayMilestoneId(id: string): string {
  return id.replace(/^m(?=\d+$)/i, '');
}

function createOwnerStats(): OwnerStats {
  return { total: 0, completed: 0, inProgress: 0, blocked: 0 };
}

function buildOwnerStats(items: MilestoneItemLike[], preferredOwner?: string): Map<string, OwnerStats> {
  const map = new Map<string, OwnerStats>();
  for (const item of items) {
    const owner = ownerLabel(item, preferredOwner);
    let stats = map.get(owner);
    if (!stats) {
      stats = createOwnerStats();
      map.set(owner, stats);
    }
    stats.total++;
    if (item.status === 'completed') stats.completed++;
    if (item.status === 'in_progress') stats.inProgress++;
    if (item.status === 'blocked') stats.blocked++;
  }
  return map;
}

function buildOwnerGroups(items: MilestoneItemLike[], preferredOwner?: string, ownerStats = buildOwnerStats(items, preferredOwner)): OwnerGroup[] {
  const map = new Map<string, OwnerGroup>();
  for (const item of items) {
    const owner = ownerLabel(item, preferredOwner);
    let group = map.get(owner);
    if (!group) {
      group = { owner, items: [], stats: ownerStats.get(owner) ?? createOwnerStats() };
      map.set(owner, group);
    }
    group.items.push(item);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (preferredOwner) {
      if (a.owner === preferredOwner && b.owner !== preferredOwner) return -1;
      if (b.owner === preferredOwner && a.owner !== preferredOwner) return 1;
    }
    const firstA = a.items[0];
    const firstB = b.items[0];
    if (firstA && firstB) return compareById(firstA, firstB);
    return a.owner.localeCompare(b.owner);
  });
}

function normalizeMaxItems(maxItems: number): number {
  if (!Number.isFinite(maxItems)) return MILESTONE_PANEL_MAX_ITEMS;
  return Math.max(1, Math.min(MILESTONE_PANEL_MAX_ITEMS, Math.floor(maxItems)));
}

function clampScrollOffset(offset: number, total: number, maxItems: number): number {
  const maxOffset = Math.max(0, total - maxItems);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(maxOffset, Math.max(0, Math.floor(offset)));
}

function currentItemForCollapsed(sorted: MilestoneItemLike[]): MilestoneItemLike | undefined {
  return sorted.find((item) => item.status === 'in_progress')
    ?? sorted.find((item) => item.status === 'blocked')
    ?? sorted.find((item) => item.status === 'pending')
    ?? sorted.find((item) => item.status === 'cancelled')
    ?? sorted[sorted.length - 1];
}

function collapsedPrefix(item?: MilestoneItemLike): string {
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

export function MilestoneListView({
  snapshot,
  maxItems = MILESTONE_PANEL_MAX_ITEMS,
  standalone = false,
  collapsed = false,
  scrollOffset = 0,
  showControls = false,
}: MilestoneListViewProps) {
  const items = snapshot?.items ?? [];
  const stats = snapshot?.stats;
  const itemLimit = normalizeMaxItems(maxItems);
  const canCollapse = (stats?.open ?? 0) > 0;
  const effectiveCollapsed = canCollapse && collapsed;

  const { sorted, groups, hiddenBeforeCount, hiddenAfterCount, effectiveScrollOffset, visibleCount } = useMemo(() => {
    const all = [...items].sort(compareById);
    const effectiveOffset = clampScrollOffset(scrollOffset, all.length, itemLimit);
    const visibleItems = effectiveCollapsed ? [] : all.slice(effectiveOffset, effectiveOffset + itemLimit);
    const ownerStats = buildOwnerStats(all, snapshot?.routeAgent);
    return {
      sorted: all,
      groups: buildOwnerGroups(visibleItems, snapshot?.routeAgent, ownerStats),
      hiddenBeforeCount: effectiveCollapsed ? 0 : effectiveOffset,
      hiddenAfterCount: effectiveCollapsed ? 0 : Math.max(0, all.length - effectiveOffset - visibleItems.length),
      effectiveScrollOffset: effectiveOffset,
      visibleCount: visibleItems.length,
    };
  }, [items, itemLimit, effectiveCollapsed, scrollOffset, snapshot?.routeAgent]);

  if (items.length === 0) return null;

  const canScroll = sorted.length > itemLimit;
  const currentItem = currentItemForCollapsed(sorted);
  const showOwnerHeadings = groups.length > 1;
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

      {groups.map((group) => (
        <box key={group.owner} flexDirection="column" marginTop={standalone && showOwnerHeadings ? 1 : 0}>
          {showOwnerHeadings ? <text>
            <span fg={C.dim}>{ICONS.triangleRight} </span>
            <span fg={C.primaryLight}><strong>{group.owner}</strong></span>
            <span fg={C.dim}> · {group.stats.completed}/{group.stats.total} 已完成</span>
            {group.stats.inProgress > 0 ? <span fg={C.accent}> · {group.stats.inProgress} 进行中</span> : null}
            {group.stats.blocked > 0 ? <span fg={C.warn}> · {group.stats.blocked} 受阻</span> : null}
          </text> : null}
          {group.items.map((item) => {
            const { icon, color } = getStatusIcon(item.status);
            const isCompleted = item.status === 'completed';
            const isActive = item.status === 'in_progress';
            const isDim = isCompleted || item.status === 'cancelled';
            const blocker = item.blockedBy && item.blockedBy.length > 0
              ? ` ${ICONS.resultArrow} 依赖 ${item.blockedBy.map(id => `#${displayMilestoneId(id)}`).join(', ')}`
              : '';
            const title = truncate(item.title, 90);
            return (
              <box key={`${group.owner}:${item.id}`} flexDirection="column">
                <text>
                  <span fg={C.dim}>  </span>
                  <span fg={color}>{icon}</span>
                  <span fg={C.dim}> {displayMilestoneId(item.id)}. </span>
                  <span fg={isDim ? C.dim : isActive ? C.text : C.textSec}>
                    {isActive ? <strong>{title}</strong> : title}
                  </span>
                  {blocker ? <span fg={C.warn}>{blocker}</span> : null}
                  {item.status !== 'pending' && item.status !== 'completed' ? <span fg={C.dim}> [{statusLabel(item.status)}]</span> : null}
                </text>
                {isActive && item.activeForm ? (
                  <text fg={C.dim}>    {truncate(item.activeForm, 100)}{ICONS.ellipsis}</text>
                ) : null}
              </box>
            );
          })}
        </box>
      ))}

      {hiddenSummary ? <text fg={C.dim}>  {hiddenSummary}</text> : null}
    </box>
  );
}
