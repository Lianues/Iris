/** @jsxImportSource @opentui/react */

import React from 'react';
import type { MilestoneSnapshotLike } from 'irises-extension-sdk';
import type { ToolRendererProps } from './default';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

function extractSnapshot(result: unknown): MilestoneSnapshotLike | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const snapshot = (result as Record<string, unknown>).snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const items = (snapshot as Record<string, unknown>).items;
  return Array.isArray(items) ? snapshot as MilestoneSnapshotLike : null;
}

function extractSummary(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const summary = (result as Record<string, unknown>).summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : undefined;
}

/**
 * milestone 工具调用本身保持“折叠”的工具卡片语义：只显示一行摘要。
 * 完整 checklist 由聊天列表底部的常驻 MilestoneListView 展示，避免同一轮里重复展开两份清单。
 */
export function MilestonesRenderer({ result }: ToolRendererProps) {
  const summary = extractSummary(result);
  const snapshot = extractSnapshot(result);
  const fallback = snapshot
    ? `${snapshot.stats.completed}/${snapshot.stats.total} 个 milestone 已完成，${snapshot.stats.open} 个未完成`
    : 'milestone 状态已更新';
  const text = summary ?? fallback;
  const truncated = text.length > 100 ? `${text.slice(0, 99)}${ICONS.ellipsis}` : text;

  return <text fg={C.dim}><em> {ICONS.resultArrow} {truncated}</em></text>;
}
