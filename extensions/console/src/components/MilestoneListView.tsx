/** @jsxImportSource @opentui/react */

import React, { useMemo } from 'react';
import type { MilestoneSnapshotLike, MilestoneItemLike, MilestoneStatusLike } from 'irises-extension-sdk';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

interface MilestoneListViewProps {
  snapshot?: MilestoneSnapshotLike | null;
  /** 当空间有限时最多显示多少条。 */
  maxItems?: number;
  /** 独立面板模式会显示汇总标题。 */
  standalone?: boolean;
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
    case 'blocked': return '阻塞';
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

export function MilestoneListView({ snapshot, maxItems = 8, standalone = false }: MilestoneListViewProps) {
  const items = snapshot?.items ?? [];
  const stats = snapshot?.stats;

  const { hidden, groups } = useMemo(() => {
    const sorted = [...items].sort(compareById);
    const visibleItems = sorted.slice(0, Math.max(0, maxItems));
    const ownerStats = buildOwnerStats(sorted, snapshot?.routeAgent);
    return {
      hidden: sorted.slice(Math.max(0, maxItems)),
      groups: buildOwnerGroups(visibleItems, snapshot?.routeAgent, ownerStats),
    };
  }, [items, maxItems, snapshot?.routeAgent]);

  if (items.length === 0) return null;

  const hiddenSummary = hidden.length > 0
    ? `另有 ${hidden.length} 项未显示（${hidden.filter(i => i.status === 'pending').length} 待处理，${hidden.filter(i => i.status === 'completed').length} 已完成）`
    : '';
  const showOwnerHeadings = groups.length > 1;

  return (
    <box flexDirection="column" marginTop={standalone ? 1 : 0} paddingLeft={standalone ? 1 : 0}>
      {standalone && stats ? (
        <text>
          <span fg={C.primaryLight}>Iris 进度 </span>
          <span fg={C.text}><strong>{stats.completed}</strong></span>
          <span fg={C.dim}>/</span>
          <span fg={C.text}><strong>{stats.total}</strong></span>
          <span fg={C.dim}> 已完成</span>
          {stats.inProgress > 0 ? <span fg={C.accent}> {ICONS.separator} {stats.inProgress} 进行中</span> : null}
          {stats.blocked > 0 ? <span fg={C.warn}> {ICONS.separator} {stats.blocked} 阻塞</span> : null}
        </text>
      ) : null}

      {groups.map((group) => (
        <box key={group.owner} flexDirection="column" marginTop={standalone && showOwnerHeadings ? 1 : 0}>
          {showOwnerHeadings ? <text>
            <span fg={C.dim}>{ICONS.triangleRight} </span>
            <span fg={C.primaryLight}><strong>{group.owner}</strong></span>
            <span fg={C.dim}> · {group.stats.completed}/{group.stats.total} 已完成</span>
            {group.stats.inProgress > 0 ? <span fg={C.accent}> · {group.stats.inProgress} 进行中</span> : null}
            {group.stats.blocked > 0 ? <span fg={C.warn}> · {group.stats.blocked} 阻塞</span> : null}
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
