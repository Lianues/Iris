/** @jsxImportSource @opentui/react */

import React from 'react';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

export interface MemoryItem {
  id: number;
  name: string;
  description: string;
  type: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const TYPE_LABELS: Record<string, string> = {
  user: 'user',
  feedback: 'feedback',
  project: 'project',
  reference: 'reference',
};

const FILTER_CYCLE = ['all', 'user', 'feedback', 'project', 'reference'] as const;

export type MemoryFilter = (typeof FILTER_CYCLE)[number];

export function nextFilter(current: MemoryFilter): MemoryFilter {
  const idx = FILTER_CYCLE.indexOf(current);
  return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
}

export function filterMemories(items: MemoryItem[], filter: MemoryFilter): MemoryItem[] {
  if (filter === 'all') return items;
  return items.filter(m => m.type === filter);
}

interface MemoryListViewProps {
  memories: MemoryItem[];
  selectedIndex: number;
  expandedId: number | null;
  filter: MemoryFilter;
  pendingDeleteId: number | null;
}

export function MemoryListView({ memories, selectedIndex, expandedId, filter, pendingDeleteId }: MemoryListViewProps) {
  const filtered = filterMemories(memories, filter);
  const total = memories.length;
  const shown = filtered.length;

  const filterLabel = filter === 'all'
    ? `(${total} ${ICONS.separator} Tab ${ICONS.triangleRight})`
    : `[${filter}] (${shown}/${total} ${ICONS.separator} Tab ${ICONS.triangleRight})`;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>{`${ICONS.bullet} `}</text>
        <text fg={C.primary}>{'Memory '}</text>
        <text fg={C.dim}>{filterLabel}</text>
        <text fg={C.dim}>{`  ${ICONS.arrowUp}${ICONS.arrowDown} select  Enter expand  D delete  Esc back`}</text>
      </box>
      <scrollbox flexGrow={1}>
        {filtered.length === 0 && (
          <text fg={C.dim} paddingLeft={2}>
            {filter === 'all' ? 'No memories yet.' : `No ${filter} memories.`}
          </text>
        )}
        {filtered.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isExpanded = item.id === expandedId;
          const isPendingDelete = item.id === pendingDeleteId;
          const typeTag = TYPE_LABELS[item.type] ?? item.type;
          const age = formatAge(item.updatedAt);

          return (
            <box key={item.id} flexDirection="column" paddingLeft={1}>
              <box>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>
                    {isSelected ? `${ICONS.selectorArrow} ` : '  '}
                  </span>
                  <span fg={C.dim}>{`[${typeTag}] `}</span>
                  {isSelected
                    ? <strong><span fg={C.text}>{item.name || `#${item.id}`}</span></strong>
                    : <span fg={C.textSec}>{item.name || `#${item.id}`}</span>}
                  <span fg={C.dim}>{` ${ICONS.emDash} ${item.description || '(no description)'}`}</span>
                  <span fg={C.dim}>{`  ${age}`}</span>
                </text>
              </box>
              {isPendingDelete && (
                <box paddingLeft={4}>
                  <text fg={C.error}>{'Delete this memory? (D) confirm  (Esc) cancel'}</text>
                </box>
              )}
              {isExpanded && !isPendingDelete && (
                <box paddingLeft={4} paddingBottom={1}>
                  <text fg={C.textSec}>{item.content}</text>
                </box>
              )}
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}

function formatAge(unixSec: number): string {
  const now = Date.now() / 1000;
  const diff = now - unixSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString('zh-CN');
}
