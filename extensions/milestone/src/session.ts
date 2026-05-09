/**
 * SessionMilestoneManager
 *
 * 会话级「里程碑 / 任务清单」状态管理器。
 *
 * 设计目标：
 * - 以 Iris 的 session 为隔离边界，而不是绑定某一次工具调用；
 * - 用结构化状态驱动 Console/Web UI，避免解析 assistant 文本；
 * - 保持工具输入尽量接近普通文字清单：用 title 匹配任务，不暴露额外协作控制字段。
 */

import { EventEmitter } from 'events';

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

export const MILESTONE_STATUSES: readonly MilestoneStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'cancelled',
] as const;

const TERMINAL_STATUSES = new Set<MilestoneStatus>(['completed', 'cancelled']);

export interface MilestoneItem {
  /** 面向用户展示的短标题；同时作为增量更新时的匹配键。 */
  title: string;
  /** 更完整的说明，供 list 工具返回给 LLM。 */
  description?: string;
  /** 当前进行中时可用于 spinner 的现在进行时文案。 */
  activeForm?: string;
  status: MilestoneStatus;
  /** 内部结构化扩展字段。不会在 update_milestones 的 AI-facing schema 中暴露。 */
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface MilestoneStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
  cancelled: number;
  open: number;
}

export interface MilestoneSnapshot {
  sessionId: string;
  items: MilestoneItem[];
  stats: MilestoneStats;
  updatedAt: number;
}

/**
 * 已完成 milestone 面板的历史归档。
 *
 * afterHistoryIndex 表示「插入在前 N 条持久化 Content 历史之后」。
 * Console/Web 重载对话时可据此把结构化进度快照还原到聊天记录中，
 * 同时该归档不进入 LLM 上下文。
 */
export interface MilestoneArchiveEntry {
  id: string;
  snapshot: MilestoneSnapshot;
  archivedAt: number;
  afterHistoryIndex: number;
}

/** Console/Web 等前端对最新 milestone 面板的展开状态偏好。 */
export interface MilestoneUiState {
  /** true=展开显示完整列表；false=折叠为一行。完成态会被强制视为 true。 */
  expanded: boolean;
  updatedAt: number;
  snapshotUpdatedAt?: number;
}

export interface MilestoneUpdateInput {
  title?: unknown;
  subject?: unknown;
  content?: unknown;
  description?: unknown;
  activeForm?: unknown;
  status?: unknown;
  metadata?: unknown;
  /** 删除同 title 的 milestone。 */
  delete?: unknown;
}

export interface UpdateMilestonesOptions {
  /** true 时用输入列表整体替换当前 session 的 milestone；false 时按 title 增量合并。 */
  replaceAll?: boolean;
}

export interface ToolFailureMilestoneInput {
  toolId: string;
  toolName: string;
  error: string;
}

export interface SessionMilestoneManagerEvents {
  updated: (snapshot: MilestoneSnapshot) => void;
}

function normalizeStatus(value: unknown): MilestoneStatus {
  switch (value) {
    case 'in_progress':
    case 'completed':
    case 'blocked':
    case 'cancelled':
    case 'pending':
      return value;
    // 容错：兼容常见 todo/任务用词。
    case 'todo':
    case 'open':
      return 'pending';
    case 'running':
    case 'active':
      return 'in_progress';
    case 'done':
    case 'resolved':
      return 'completed';
    case 'canceled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return { ...(value as Record<string, unknown>) };
}

function asTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getInputTitle(input: MilestoneUpdateInput): string | undefined {
  return asOptionalString(input.title) ?? asOptionalString(input.subject) ?? asOptionalString(input.content);
}

function titleKey(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function sortMilestones(a: MilestoneItem, b: MilestoneItem): number {
  return a.createdAt - b.createdAt || a.title.localeCompare(b.title);
}

function cloneItem(item: MilestoneItem): MilestoneItem {
  return {
    title: item.title,
    description: item.description,
    activeForm: item.activeForm,
    status: item.status,
    metadata: item.metadata ? { ...item.metadata } : undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeMilestoneItem(value: unknown, fallbackNow = Date.now()): MilestoneItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const title = asOptionalString(record.title) ?? asOptionalString(record.subject) ?? asOptionalString(record.content);
  if (!title) return undefined;
  return {
    title,
    description: asOptionalString(record.description),
    activeForm: asOptionalString(record.activeForm),
    status: normalizeStatus(record.status),
    metadata: asMetadata(record.metadata),
    createdAt: asTimestamp(record.createdAt, fallbackNow),
    updatedAt: asTimestamp(record.updatedAt, fallbackNow),
  };
}

function truncateReason(text: string, max = 180): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`;
}

export function computeMilestoneStats(items: MilestoneItem[]): MilestoneStats {
  const stats: MilestoneStats = {
    total: items.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
    open: 0,
  };
  for (const item of items) {
    if (item.status === 'pending') stats.pending++;
    if (item.status === 'in_progress') stats.inProgress++;
    if (item.status === 'completed') stats.completed++;
    if (item.status === 'blocked') stats.blocked++;
    if (item.status === 'cancelled') stats.cancelled++;
    if (!TERMINAL_STATUSES.has(item.status)) stats.open++;
  }
  return stats;
}

export function normalizeMilestoneSnapshot(value: unknown, expectedSessionId?: string): MilestoneSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const sessionId = asOptionalString(record.sessionId) ?? expectedSessionId;
  if (!sessionId || (expectedSessionId && sessionId !== expectedSessionId)) return undefined;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems
    .map((item) => normalizeMilestoneItem(item))
    .filter((item): item is MilestoneItem => !!item)
    .sort(sortMilestones);
  const maxItemUpdatedAt = items.reduce((max, item) => Math.max(max, item.updatedAt), 0);
  const updatedAt = asTimestamp(record.updatedAt, maxItemUpdatedAt || Date.now());
  return {
    sessionId,
    items,
    stats: computeMilestoneStats(items),
    updatedAt,
  };
}

export class SessionMilestoneManager extends EventEmitter {
  private sessions = new Map<string, MilestoneItem[]>();

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSnapshot(sessionId: string): MilestoneSnapshot {
    const items = [...(this.sessions.get(sessionId) ?? [])].map(cloneItem).sort(sortMilestones);
    const updatedAt = items.reduce((max, item) => Math.max(max, item.updatedAt), 0) || Date.now();
    return {
      sessionId,
      items,
      stats: computeMilestoneStats(items),
      updatedAt,
    };
  }

  clear(sessionId: string): MilestoneSnapshot {
    this.sessions.delete(sessionId);
    const snapshot = this.getSnapshot(sessionId);
    this.emit('updated', snapshot);
    return snapshot;
  }

  /** 从持久化快照恢复某个 session 的 milestone 状态，不触发事件。 */
  hydrate(snapshot: MilestoneSnapshot): void {
    const normalized = normalizeMilestoneSnapshot(snapshot, snapshot.sessionId);
    this.sessions.set(snapshot.sessionId, normalized?.items.map(cloneItem).sort(sortMilestones) ?? []);
  }

  /** 查找当前 in_progress milestone，供内部工具联动使用。 */
  findActiveMilestoneForToolSync(sessionId: string, _input?: unknown): MilestoneItem | undefined {
    const current = [...(this.sessions.get(sessionId) ?? [])].sort(sortMilestones);
    const target = current.find((item) => item.status === 'in_progress');
    return target ? cloneItem(target) : undefined;
  }

  /**
   * 工具失败时的轻量联动：只记录最近一次工具错误，不自动把「进行中」标为 blocked。
   *
   * 临时命令失败、搜索路径输错、一次验证未通过等情况通常仍属于“正在处理”。
   * 自动改成 blocked 会让 Console/Web 进度显示成「受阻」，因此 blocked 只应由 Agent/用户显式设置。
   *
   * 这里写入 metadata 是内部状态/持久化用途，不暴露给 update_milestones 的 AI-facing schema。
   */
  noteActiveToolFailure(sessionId: string, input: ToolFailureMilestoneInput): MilestoneSnapshot | undefined {
    const target = this.findActiveMilestoneForToolSync(sessionId);
    if (!target) return undefined;

    const toolError = {
      toolId: input.toolId,
      toolName: input.toolName,
      error: truncateReason(input.error),
      at: Date.now(),
    };
    const previousErrors = Array.isArray(target.metadata?.toolErrors)
      ? (target.metadata!.toolErrors as unknown[]).filter((entry) => entry && typeof entry === 'object')
      : [];

    return this.update(sessionId, [{
      title: target.title,
      status: target.status,
      metadata: {
        ...(target.metadata ?? {}),
        toolSync: { kind: 'tool_error_note', ...toolError },
        toolErrors: [...previousErrors, toolError].slice(-5),
      },
    }]);
  }

  /** @deprecated 旧版会把工具错误自动标记为 blocked；现在仅记录内部 metadata。 */
  markActiveBlockedByToolFailure(sessionId: string, input: ToolFailureMilestoneInput): MilestoneSnapshot | undefined {
    return this.noteActiveToolFailure(sessionId, input);
  }

  update(
    sessionId: string,
    updates: MilestoneUpdateInput[],
    options: UpdateMilestonesOptions = {},
  ): MilestoneSnapshot {
    const now = Date.now();
    const current = options.replaceAll === true ? [] : [...(this.sessions.get(sessionId) ?? [])].map(cloneItem);
    const byTitle = new Map(current.map((item) => [titleKey(item.title), item]));
    let activeKeepKey: string | undefined;

    updates.forEach((input, index) => {
      const itemNow = now + index;
      const title = getInputTitle(input);
      if (!title) {
        throw new Error(`items[${index}] 缺少 title/subject/content`);
      }
      const key = titleKey(title);

      if (input.delete === true) {
        byTitle.delete(key);
        return;
      }

      const existing = byTitle.get(key);
      const status = input.status === undefined && existing ? existing.status : normalizeStatus(input.status);
      const item: MilestoneItem = {
        title,
        description: asOptionalString(input.description) ?? existing?.description,
        activeForm: asOptionalString(input.activeForm) ?? existing?.activeForm,
        status,
        metadata: asMetadata(input.metadata) ?? existing?.metadata,
        createdAt: existing?.createdAt ?? itemNow,
        updatedAt: itemNow,
      };
      byTitle.set(key, item);
      if (item.status === 'in_progress') activeKeepKey = key;
    });

    // Iris 的自动生命周期约束：同一时间只保留一个进行中项。
    // 当当前更新把某项设为 in_progress 时，自动把旧活跃项退回 pending，
    // 避免模型像普通文本 checklist 一样遗留多个“正在做”。
    if (activeKeepKey) {
      for (const [key, item] of byTitle) {
        if (key === activeKeepKey || item.status !== 'in_progress') continue;
        byTitle.set(key, {
          ...item,
          status: 'pending',
          updatedAt: now,
        });
      }
    }

    const next = Array.from(byTitle.values()).sort(sortMilestones);
    this.sessions.set(sessionId, next);
    const snapshot = this.getSnapshot(sessionId);
    this.emit('updated', snapshot);
    return snapshot;
  }
}

export function formatMilestoneSummary(snapshot: MilestoneSnapshot): string {
  const { stats } = snapshot;
  if (stats.total === 0) return '当前没有 milestone。';
  const inProgress = snapshot.items.find((item) => item.status === 'in_progress');
  const active = inProgress ? `；当前：${inProgress.title}` : '';
  return `${stats.completed}/${stats.total} 个 milestone 已完成，${stats.open} 个未完成${active}`;
}
