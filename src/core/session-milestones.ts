/**
 * SessionMilestoneManager
 *
 * 会话级「里程碑 / 任务清单」状态管理器。
 *
 * 设计目标：
 * - 以 Iris 的 session 为隔离边界，而不是绑定某一次工具调用；
 * - 支持多 Agent / sub_agent 共同更新同一个 session 的任务进度；
 * - 用结构化状态驱动 Console/Web UI，避免解析 assistant 文本；
 * - 仅做轻量内存态，后续可扩展为持久化到 session metadata 或项目进度文档。
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
  /** 会话内稳定 ID。建议短小，如 m1 / tests / phase-2。 */
  id: string;
  /** 面向用户展示的短标题。 */
  title: string;
  /** 更完整的说明，供 list 工具返回给 LLM。 */
  description?: string;
  /** 当前进行中时可用于 spinner 的现在进行时文案。 */
  activeForm?: string;
  status: MilestoneStatus;
  /** 负责或报告该项的 Agent 名称。默认当前 Agent。 */
  owner?: string;
  /** 该项依赖的其他 milestone id。 */
  blockedBy?: string[];
  /** 该项阻塞的其他 milestone id。 */
  blocks?: string[];
  /** 结构化扩展字段。 */
  metadata?: Record<string, unknown>;
  /** 乐观并发版本号。新建为 1，每次成功更新递增。 */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** 最近一次成功更新该项的 Agent。 */
  updatedBy?: string;
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
  /** 最近一次触发更新的 Agent 名称。 */
  sourceAgent?: string;
  /** 应该向哪个前台 Agent 路由此快照；为空时表示本地/单 Agent 场景。 */
  routeAgent?: string;
}

export interface MilestoneUpdateInput {
  id?: unknown;
  title?: unknown;
  subject?: unknown;
  content?: unknown;
  description?: unknown;
  activeForm?: unknown;
  status?: unknown;
  owner?: unknown;
  blockedBy?: unknown;
  blocks?: unknown;
  metadata?: unknown;
  /** 如果提供，则必须与当前 milestone.version 一致，否则拒绝更新。 */
  expectedVersion?: unknown;
  /** 强制覆盖 owner 保护。只有前台 routeAgent 或无 routeAgent 的当前执行方可使用。 */
  force?: unknown;
  delete?: unknown;
}

export interface UpdateMilestonesOptions {
  /** 当前执行工具的 Agent 名称，用于默认 owner 和事件来源。 */
  sourceAgent?: string;
  /** 负责把此 session 展示给用户的 Agent。跨 Agent 委派时通常是发起方 Agent。 */
  routeAgent?: string;
  /** true 时用输入列表整体替换当前 session 的 milestone；false 时按 id 增量合并。 */
  replaceAll?: boolean;
}

export interface ToolFailureMilestoneInput {
  toolId: string;
  toolName: string;
  error: string;
  sourceAgent?: string;
  routeAgent?: string;
}

export type MilestoneConflictReason = 'version_mismatch' | 'owner_mismatch';

export class MilestoneConflictError extends Error {
  readonly code = 'MILESTONE_CONFLICT';

  constructor(
    readonly milestoneId: string,
    readonly reason: MilestoneConflictReason,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MilestoneConflictError';
  }
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

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry).trim() : ''))
    .filter(Boolean);
  return result.length > 0 ? Array.from(new Set(result)) : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

function asMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return { ...(value as Record<string, unknown>) };
}

function deriveId(input: MilestoneUpdateInput, index: number): string {
  const explicit = asOptionalString(input.id);
  if (explicit) return explicit;
  const title = asOptionalString(input.title) ?? asOptionalString(input.subject) ?? asOptionalString(input.content);
  if (title) {
    const slug = title
      .toLowerCase()
      .replace(/[`~!@#$%^&*()+=[\]{};:'"\\|,.<>/?\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (slug) return slug;
  }
  return `m${index + 1}`;
}

function sortMilestones(a: MilestoneItem, b: MilestoneItem): number {
  const aNum = parseInt(a.id.replace(/^m/i, ''), 10);
  const bNum = parseInt(b.id.replace(/^m/i, ''), 10);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}


function truncateReason(text: string, max = 180): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`;
}

function ownerMatches(item: MilestoneItem, owner?: string): boolean {
  if (!owner) return false;
  return item.owner === owner || item.owner?.startsWith(`${owner}:`) === true;
}

function canForceUpdate(sourceAgent?: string, routeAgent?: string, force?: boolean): boolean {
  if (!force || !sourceAgent) return false;
  return !!routeAgent && sourceAgent === routeAgent;
}

function canOwnerUpdate(item: MilestoneItem, sourceAgent?: string, authoritativeRouteAgent?: string, force?: boolean): boolean {
  return !item.owner || !sourceAgent || ownerMatches(item, sourceAgent) || sourceAgent === authoritativeRouteAgent || canForceUpdate(sourceAgent, authoritativeRouteAgent, force);
}

function ownerKey(item: Pick<MilestoneItem, 'owner'>): string {
  return item.owner ?? '';
}

function computeStats(items: MilestoneItem[]): MilestoneStats {
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

export class SessionMilestoneManager extends EventEmitter {
  private sessions = new Map<string, MilestoneItem[]>();
  private routeAgents = new Map<string, string>();

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSnapshot(sessionId: string, sourceAgent?: string): MilestoneSnapshot {
    const items = [...(this.sessions.get(sessionId) ?? [])].sort(sortMilestones);
    const updatedAt = items.reduce((max, item) => Math.max(max, item.updatedAt), 0) || Date.now();
    const routeAgent = this.routeAgents.get(sessionId);
    return {
      sessionId,
      items,
      stats: computeStats(items),
      updatedAt,
      sourceAgent,
      routeAgent,
    };
  }

  clear(sessionId: string, sourceAgent?: string, routeAgent?: string): MilestoneSnapshot {
    this.sessions.delete(sessionId);
    if (routeAgent) this.routeAgents.set(sessionId, routeAgent);
    const snapshot = this.getSnapshot(sessionId, sourceAgent);
    this.emit('updated', snapshot);
    return snapshot;
  }

  /** 从持久化快照恢复某个 session 的 milestone 状态，不触发事件。 */
  hydrate(snapshot: MilestoneSnapshot): void {
    const items = snapshot.items
      .map((item) => ({
        ...item,
        version: Number.isInteger(item.version) && item.version > 0 ? item.version : 1,
        blockedBy: item.blockedBy ? [...item.blockedBy] : undefined,
        blocks: item.blocks ? [...item.blocks] : undefined,
        metadata: item.metadata ? { ...item.metadata } : undefined,
      }))
      .sort(sortMilestones);
    this.sessions.set(snapshot.sessionId, items);
    if (snapshot.routeAgent) {
      this.routeAgents.set(snapshot.sessionId, snapshot.routeAgent);
    }
  }

  /** 查找与当前执行方最相关的 in_progress milestone，供工具联动/提示使用。 */
  findActiveMilestoneForToolSync(
    sessionId: string,
    input: { sourceAgent?: string; routeAgent?: string },
  ): MilestoneItem | undefined {
    const current = [...(this.sessions.get(sessionId) ?? [])].sort(sortMilestones);
    const sameOwner = current.find((item) => item.status === 'in_progress' && ownerMatches(item, input.sourceAgent));
    const fallback = input.sourceAgent && input.routeAgent && input.sourceAgent === input.routeAgent
      ? current.find((item) => item.status === 'in_progress')
      : undefined;
    const target = sameOwner ?? fallback;
    return target ? { ...target, blockedBy: target.blockedBy ? [...target.blockedBy] : undefined, blocks: target.blocks ? [...target.blocks] : undefined, metadata: target.metadata ? { ...target.metadata } : undefined } : undefined;
  }

  /**
   * 工具失败时的轻量联动：只把当前「正在进行」的相关 milestone 标为 blocked。
   *
   * 多 Agent 策略：优先匹配同 owner 的 in_progress 项；只有当前执行 Agent
   * 就是 routeAgent（前台 Agent）时，才回退到任意 in_progress 项。
   */
  markActiveBlockedByToolFailure(sessionId: string, input: ToolFailureMilestoneInput): MilestoneSnapshot | undefined {
    const target = this.findActiveMilestoneForToolSync(sessionId, input);
    if (!target) return undefined;

    const reason = `工具 ${input.toolName} 执行失败：${truncateReason(input.error)}`;
    const description = target.description?.includes(reason)
      ? target.description
      : [target.description, reason].filter(Boolean).join('\n\n');

    return this.update(sessionId, [{
      id: target.id,
      title: target.title,
      status: 'blocked',
      description,
      metadata: {
        ...(target.metadata ?? {}),
        toolSync: { kind: 'blocked_by_tool_error', toolId: input.toolId, toolName: input.toolName, error: input.error, at: Date.now() },
      },
    }], { sourceAgent: input.sourceAgent, routeAgent: input.routeAgent });
  }

  update(
    sessionId: string,
    updates: MilestoneUpdateInput[],
    options: UpdateMilestonesOptions = {},
  ): MilestoneSnapshot {
    const now = Date.now();
    const sourceAgent = options.sourceAgent;
    const existingRouteAgent = this.routeAgents.get(sessionId);
    const requestedRouteAgent = options.routeAgent;
    // routeAgent 是会话级前台归属，一旦建立后必须以已有记录为权威。
    // 不能信任本次调用传入的 routeAgent 作为权限判断依据，否则非 owner
    // 可通过 sourceAgent === routeAgent 伪造“前台 Agent”身份并覆盖他人条目。
    const routeAgent = existingRouteAgent ?? requestedRouteAgent ?? sourceAgent;
    const isRouteAgent = !sourceAgent || !routeAgent || sourceAgent === routeAgent;
    const existingItems = this.sessions.get(sessionId) ?? [];
    const canEstablishRouteAgent = !existingRouteAgent && (existingItems.length === 0 || !sourceAgent || existingItems.every(item => !item.owner || ownerMatches(item, sourceAgent)));

    const canReplaceAll = options.replaceAll === true && (!sourceAgent || (existingItems.length === 0 && isRouteAgent) || (!!existingRouteAgent && sourceAgent === existingRouteAgent));
    const current = canReplaceAll ? [] : [...existingItems];
    const byId = new Map(current.map((item) => [item.id, item]));

    // 先完整校验，再写入 byId，确保版本冲突/owner 冲突时不会部分提交。
    for (let index = 0; index < updates.length; index++) {
      const input = updates[index];
      const id = deriveId(input, index);
      const existing = byId.get(id);
      const expectedVersion = asOptionalNumber(input.expectedVersion);
      if (!existing && expectedVersion !== undefined) {
        throw new MilestoneConflictError(
          id,
          'version_mismatch',
          `milestone ${id} 不存在，但更新要求基于版本 ${expectedVersion}`,
          { currentVersion: undefined, expectedVersion },
        );
      }
      if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new MilestoneConflictError(
          id,
          'version_mismatch',
          `milestone ${id} 版本冲突：当前版本 ${existing.version}，但更新基于版本 ${expectedVersion}`,
          { currentVersion: existing.version, expectedVersion, currentOwner: existing.owner },
        );
      }
      if (existing && !canOwnerUpdate(existing, sourceAgent, existingRouteAgent, input.force === true)) {
        throw new MilestoneConflictError(
          id,
          'owner_mismatch',
          `milestone ${id} 属于 ${existing.owner ?? '未分配'}，当前执行方 ${sourceAgent ?? '未知'} 无权直接覆盖；请由 owner 更新或由前台 Agent 显式接管`,
          { currentOwner: existing.owner, sourceAgent, routeAgent },
        );
      }
    }

    const activeOwnerKeepIds = new Map<string, string>();
    updates.forEach((input, index) => {
      const id = deriveId(input, index);
      if (input.delete === true) {
        byId.delete(id);
        return;
      }

      const title = asOptionalString(input.title) ?? asOptionalString(input.subject) ?? asOptionalString(input.content);
      const existing = byId.get(id);
      if (!existing && !title) {
        throw new Error(`milestone ${id} 缺少 title/subject/content`);
      }

      const status = input.status === undefined && existing ? existing.status : normalizeStatus(input.status);
      const item: MilestoneItem = {
        id,
        title: title ?? existing!.title,
        description: asOptionalString(input.description) ?? existing?.description,
        activeForm: asOptionalString(input.activeForm) ?? existing?.activeForm,
        status,
        owner: asOptionalString(input.owner) ?? existing?.owner ?? sourceAgent,
        blockedBy: asStringArray(input.blockedBy) ?? existing?.blockedBy,
        blocks: asStringArray(input.blocks) ?? existing?.blocks,
        metadata: asMetadata(input.metadata) ?? existing?.metadata,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        updatedBy: sourceAgent ?? existing?.updatedBy,
      };
      byId.set(id, item);
      if (item.status === 'in_progress') {
        activeOwnerKeepIds.set(ownerKey(item), item.id);
      }
    });

    // Iris 的自动生命周期约束：同一个 owner 同一时间只保留一个进行中项。
    // 多 Agent / sub_agent 并行时 owner 会不同（例如 master:taskId），因此不会互相影响。
    // 当当前更新把某项设为 in_progress 时，自动把同 owner 的旧活跃项退回 pending，
    // 避免模型像普通文本 checklist 一样遗留多个“正在做”。
    for (const [activeOwner, keepId] of activeOwnerKeepIds) {
      for (const [id, item] of byId) {
        if (id === keepId || item.status !== 'in_progress' || ownerKey(item) !== activeOwner) continue;
        byId.set(id, {
          ...item,
          status: 'pending',
          version: item.version + 1,
          updatedAt: now,
          updatedBy: sourceAgent ?? item.updatedBy,
        });
      }
    }

    const next = Array.from(byId.values()).sort(sortMilestones);
    this.sessions.set(sessionId, next);
    if (existingRouteAgent || canEstablishRouteAgent) {
      if (routeAgent) this.routeAgents.set(sessionId, routeAgent);
    }
    const snapshot = this.getSnapshot(sessionId, sourceAgent);
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
