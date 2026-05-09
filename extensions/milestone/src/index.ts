import {
  createPluginLogger,
  definePlugin,
  type IrisAPI,
  type PluginContext,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutionHandleLike,
} from 'irises-extension-sdk';
import {
  SessionMilestoneManager,
  type MilestoneArchiveEntry,
  type MilestoneSnapshot,
  type MilestoneUpdateInput,
  type MilestoneUiState,
} from './session.js';

const logger = createPluginLogger('milestone');
const EXTENSION_STATE_KEY = 'milestone';
export const MILESTONE_EXTENSION_SERVICE_ID = 'milestone:service';

const manager = new SessionMilestoneManager();
const updateListeners = new Set<(sessionId: string, snapshot: MilestoneSnapshot) => void>();

export interface MilestoneExtensionService {
  update(sessionId: string, updates: MilestoneUpdateInput[], options?: { sourceAgent?: string; routeAgent?: string; replaceAll?: boolean }): MilestoneSnapshot;
  getSnapshot(sessionId: string, sourceAgent?: string): MilestoneSnapshot;
  clear?(sessionId: string, sourceAgent?: string, routeAgent?: string): MilestoneSnapshot;
  noteActiveToolFailure?(sessionId: string, input: { toolId: string; toolName: string; error: string; sourceAgent?: string; routeAgent?: string }): MilestoneSnapshot | undefined;
  loadLatest(sessionId: string): Promise<MilestoneSnapshot | undefined>;
  loadArchives(sessionId: string): Promise<MilestoneArchiveEntry[]>;
  loadUiState(sessionId: string): Promise<MilestoneUiState | undefined>;
  setUiState(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }): Promise<void>;
  onDidUpdate(listener: (sessionId: string, snapshot: MilestoneSnapshot) => void): { dispose(): void };
}

interface PersistedMilestoneState {
  latest?: MilestoneSnapshot;
  archives?: MilestoneArchiveEntry[];
  ui?: MilestoneUiState;
}

function emitUpdate(sessionId: string, snapshot: MilestoneSnapshot): void {
  for (const listener of updateListeners) listener(sessionId, snapshot);
}

function getExtensionState(meta: { extensionState?: Record<string, unknown> } | null | undefined): PersistedMilestoneState {
  const raw = meta?.extensionState?.[EXTENSION_STATE_KEY];
  return raw && typeof raw === 'object' ? raw as PersistedMilestoneState : {};
}

function setExtensionState(meta: { extensionState?: Record<string, unknown> }, state: PersistedMilestoneState): void {
  meta.extensionState = { ...(meta.extensionState ?? {}), [EXTENSION_STATE_KEY]: state };
}

function isArchivable(snapshot: MilestoneSnapshot | undefined): boolean {
  return !!snapshot && snapshot.items.length > 0 && snapshot.stats.open === 0;
}

function normalizeArchives(value: unknown, sessionId?: string): MilestoneArchiveEntry[] {
  if (!Array.isArray(value)) return [];
  const archives: MilestoneArchiveEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Partial<MilestoneArchiveEntry>;
    const snapshot = record.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.items)) continue;
    if (sessionId && snapshot.sessionId !== sessionId) continue;
    const archivedAt = typeof record.archivedAt === 'number' ? record.archivedAt : (snapshot.updatedAt || Date.now());
    const afterHistoryIndex = typeof record.afterHistoryIndex === 'number' && Number.isFinite(record.afterHistoryIndex)
      ? Math.max(0, Math.floor(record.afterHistoryIndex))
      : 0;
    archives.push({
      id: typeof record.id === 'string' && record.id ? record.id : `${snapshot.sessionId}:${snapshot.updatedAt}`,
      snapshot,
      archivedAt,
      afterHistoryIndex,
    });
  }
  return archives.sort((a, b) => a.afterHistoryIndex - b.afterHistoryIndex || a.archivedAt - b.archivedAt || a.id.localeCompare(b.id));
}

function normalizeUiState(value: unknown): MilestoneUiState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<MilestoneUiState>;
  if (typeof record.expanded !== 'boolean') return undefined;
  return {
    expanded: record.expanded,
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
    ...(typeof record.snapshotUpdatedAt === 'number' && Number.isFinite(record.snapshotUpdatedAt) ? { snapshotUpdatedAt: record.snapshotUpdatedAt } : {}),
  };
}

function createUiState(expanded: boolean, snapshotUpdatedAt?: number): MilestoneUiState {
  return {
    expanded,
    updatedAt: Date.now(),
    ...(typeof snapshotUpdatedAt === 'number' && Number.isFinite(snapshotUpdatedAt) ? { snapshotUpdatedAt } : {}),
  };
}

async function getHistoryLengthSafe(api: IrisAPI, sessionId: string): Promise<number> {
  try { return (await api.storage.getHistory(sessionId)).length; }
  catch { return 0; }
}

function upsertArchive(state: PersistedMilestoneState, snapshot: MilestoneSnapshot, afterHistoryIndex: number): void {
  if (!isArchivable(snapshot)) return;
  const archives = normalizeArchives(state.archives, snapshot.sessionId);
  const safeIndex = Math.max(0, Math.floor(afterHistoryIndex));
  const archiveId = `${snapshot.sessionId}:${snapshot.updatedAt}`;
  const existingIndex = archives.findIndex(entry => entry.id === archiveId || entry.snapshot.updatedAt === snapshot.updatedAt);
  if (existingIndex >= 0) {
    const existing = archives[existingIndex];
    archives[existingIndex] = {
      ...existing,
      id: existing.id || archiveId,
      snapshot,
      archivedAt: existing.archivedAt || snapshot.updatedAt || Date.now(),
      afterHistoryIndex: Math.max(existing.afterHistoryIndex ?? 0, safeIndex),
    };
  } else {
    archives.push({ id: archiveId, snapshot, archivedAt: snapshot.updatedAt || Date.now(), afterHistoryIndex: safeIndex });
  }
  state.archives = archives.sort((a, b) => a.afterHistoryIndex - b.afterHistoryIndex || a.archivedAt - b.archivedAt || a.id.localeCompare(b.id));
}

async function persistSnapshot(api: IrisAPI, snapshot: MilestoneSnapshot): Promise<void> {
  const meta = await api.storage.getMeta?.(snapshot.sessionId);
  if (!meta) return;
  const state = getExtensionState(meta);
  state.latest = snapshot.items.length > 0 ? snapshot : undefined;
  const existingUi = normalizeUiState(state.ui);
  if (isArchivable(snapshot)) {
    upsertArchive(state, snapshot, await getHistoryLengthSafe(api, snapshot.sessionId));
    state.ui = createUiState(true, snapshot.updatedAt);
  } else if (snapshot.items.length > 0 && !existingUi) {
    state.ui = createUiState(true, snapshot.updatedAt);
  }
  setExtensionState(meta, state);
  await api.storage.saveMeta?.(meta);
}

const MILESTONE_TOOL_SYNC_IGNORED = new Set([
  'update_milestones', 'list_milestones',
  'EnterPlanMode', 'ExitPlanMode', 'read_plan', 'write_plan',
  'AskQuestionFirst',
]);

const DEFAULT_PLAN_MAX_ITEMS = 8;
const ACTION_SECTION_RE = /(实施|执行|步骤|任务|里程碑|开发|修改|验证|测试|上线|交付|implementation|steps?|tasks?|milestones?|todo|plan)/i;
const PASSIVE_SECTION_RE = /(背景|上下文|目标|约束|风险|说明|备注|现状|已完成|验收|参考|background|context|goals?|constraints?|risks?|notes?|done|acceptance|reference)/i;
const ACTION_TEXT_RE = /(实现|修改|新增|补充|接入|调整|修复|验证|测试|运行|更新|删除|迁移|重构|检查|确认|implement|modify|add|wire|fix|verify|test|run|update|delete|migrate|refactor|check)/i;

export interface PlanMilestoneCandidate {
  text: string;
  source: 'task-list' | 'numbered-list' | 'bullet-list' | 'heading' | 'fallback';
  section?: string;
}

const ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '会话内稳定 ID，例如 m1、tests、phase-2。省略时 Iris 会根据标题生成。' },
    title: { type: 'string', description: '面向用户展示的短标题，建议使用动宾短语。' },
    description: { type: 'string', description: '更完整的说明、验收条件或上下文。' },
    activeForm: { type: 'string', description: '当前进行中时用于 spinner/状态栏的现在进行时文案，例如「运行测试」。' },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'],
      description: '状态：pending 待处理/未开始（尚未执行，或暂时回到等待队列），in_progress 正在做，completed 已完成，blocked 被阻塞，cancelled 已取消。',
    },
    owner: { type: 'string', description: '负责该项的 Agent 名称。未填时默认为当前 Agent。' },
    blockedBy: { type: 'array', items: { type: 'string' }, description: '该项依赖的 milestone ID 列表。' },
    blocks: { type: 'array', items: { type: 'string' }, description: '该项完成后会解除阻塞的 milestone ID 列表。' },
    metadata: { type: 'object', description: '可选结构化扩展字段。' },
    delete: { type: 'boolean', description: '设为 true 时删除该 ID 对应的 milestone。' },
    expectedVersion: { type: 'number', description: '可选乐观并发版本号。若提供，必须与当前 milestone.version 一致，否则更新会被拒绝。' },
    force: { type: 'boolean', description: '是否强制接管/覆盖 owner 保护。仅当前台 Agent 或无 routeAgent 的当前执行方可使用。' },
  },
};

function getMilestones(api: IrisAPI): MilestoneExtensionService {
  const service = api.services.get<MilestoneExtensionService>(MILESTONE_EXTENSION_SERVICE_ID);
  if (!service) throw new Error('Milestone 服务不可用');
  return service;
}

export function createMilestoneServiceForApi(api: IrisAPI): MilestoneExtensionService {
  const service: MilestoneExtensionService = {
    update(sessionId, updates, options) {
      const snapshot = manager.update(sessionId, updates as any, options as any);
      void persistSnapshot(api, snapshot).catch((err) => logger.warn('保存进度状态失败:', err));
      emitUpdate(snapshot.sessionId, snapshot);
      return snapshot;
    },
    getSnapshot(sessionId, sourceAgent) {
      return manager.getSnapshot(sessionId, sourceAgent);
    },
    clear(sessionId, sourceAgent, routeAgent) {
      const snapshot = manager.clear(sessionId, sourceAgent, routeAgent);
      void persistSnapshot(api, snapshot).catch((err) => logger.warn('清理进度状态失败:', err));
      emitUpdate(snapshot.sessionId, snapshot);
      return snapshot;
    },
    noteActiveToolFailure(sessionId, input) {
      const snapshot = manager.noteActiveToolFailure(sessionId, input as any);
      if (snapshot) {
        void persistSnapshot(api, snapshot).catch((err) => logger.warn('保存工具错误进度状态失败:', err));
        emitUpdate(snapshot.sessionId, snapshot);
      }
      return snapshot;
    },
    async loadLatest(sessionId) {
      const meta = await api.storage.getMeta?.(sessionId);
      const state = getExtensionState(meta);
      if (state.latest && state.latest.sessionId === sessionId) {
        const current = manager.getSnapshot(sessionId);
        const storageUpdatedAt = typeof state.latest.updatedAt === 'number' ? state.latest.updatedAt : 0;
        if (manager.hasSession(sessionId) && current.items.length > 0 && current.updatedAt >= storageUpdatedAt) {
          return current;
        }
        manager.hydrate(state.latest);
      }
      return manager.getSnapshot(sessionId);
    },
    async loadArchives(sessionId) {
      const meta = await api.storage.getMeta?.(sessionId);
      const state = getExtensionState(meta);
      const archives = normalizeArchives(state.archives, sessionId);
      if (isArchivable(state.latest) && !archives.some(entry => entry.snapshot.updatedAt === state.latest!.updatedAt)) {
        upsertArchive(state, state.latest!, await getHistoryLengthSafe(api, sessionId));
        if (meta) {
          setExtensionState(meta, state);
          await api.storage.saveMeta?.(meta);
        }
        return normalizeArchives(state.archives, sessionId);
      }
      return archives;
    },
    async loadUiState(sessionId) {
      const meta = await api.storage.getMeta?.(sessionId);
      return normalizeUiState(getExtensionState(meta).ui);
    },
    async setUiState(sessionId, uiState) {
      const meta = await api.storage.getMeta?.(sessionId);
      if (!meta) return;
      const state = getExtensionState(meta);
      state.ui = createUiState(uiState.expanded, uiState.snapshotUpdatedAt);
      setExtensionState(meta, state);
      await api.storage.saveMeta?.(meta);
    },
    onDidUpdate(listener) {
      updateListeners.add(listener);
      return { dispose: () => updateListeners.delete(listener) };
    },
  };
  return service;
}

function getSessionId(api: IrisAPI, context?: ToolExecutionContext): string {
  const sessionId = context?.sessionId ?? api.backend.getActiveSessionId?.();
  if (!sessionId) throw new Error('milestone 工具只能在会话执行上下文中使用');
  return sessionId;
}

function normalizeItems(raw: unknown): MilestoneUpdateInput[] {
  if (!Array.isArray(raw)) throw new Error('items 必须是数组');
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`items[${index}] 必须是对象`);
    }
    return entry as MilestoneUpdateInput;
  });
}

function resolveSourceAgentName(api: IrisAPI, context?: ToolExecutionContext): string | undefined {
  const base = api.agentName;
  const current = context?.sourceAgent;
  if (current && current !== 'main') return base ? `${base}:${current}` : current;
  return base;
}

function parseCrossAgentTaskId(sessionId: string): string | undefined {
  if (!sessionId.startsWith('cross-agent:')) return undefined;
  const parts = sessionId.split(':');
  if (parts.length < 3) return undefined;
  return parts.slice(2).join(':') || undefined;
}

function resolveExecutionContext(api: IrisAPI, context?: ToolExecutionContext): { sessionId: string; sourceAgent?: string; routeAgent?: string } {
  const rawSessionId = getSessionId(api, context);
  const baseAgent = api.agentName;
  const sourceAgent = resolveSourceAgentName(api, context);
  const crossAgentTaskId = parseCrossAgentTaskId(rawSessionId);

  if (crossAgentTaskId && api.taskBoard?.get) {
    const task = api.taskBoard.get(crossAgentTaskId);
    if (task?.type === 'delegate') {
      return { sessionId: task.sourceSessionId, sourceAgent, routeAgent: task.sourceAgent };
    }
  }

  return { sessionId: rawSessionId, sourceAgent, routeAgent: baseAgent };
}

function formatSummary(snapshot: MilestoneSnapshot): string {
  const { stats } = snapshot;
  if (stats.total === 0) return '当前没有 milestone。';
  const active = snapshot.items.find((item) => item.status === 'in_progress');
  return `${stats.completed}/${stats.total} 个 milestone 已完成，${stats.open} 个未完成${active ? `；当前：${active.title}` : ''}`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/^\s*(?:步骤|阶段|任务|Step|Phase|Task)\s*\d+\s*[:：.)-]?\s*/i, '')
    .replace(/^\s*(?:TODO|待办|实施|执行)\s*[:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。；;,.，]+$/g, '')
    .trim();
}

function truncateTitle(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function isUsefulCandidate(text: string): boolean {
  const cleaned = stripMarkdown(text);
  if (cleaned.length < 3) return false;
  if (/^https?:\/\//i.test(cleaned)) return false;
  if (/^(yes|no|true|false|null|none)$/i.test(cleaned)) return false;
  return true;
}

function pushCandidate(candidates: PlanMilestoneCandidate[], candidate: PlanMilestoneCandidate): void {
  const cleaned = truncateTitle(stripMarkdown(candidate.text));
  if (!isUsefulCandidate(cleaned)) return;
  const key = cleaned.toLowerCase();
  if (candidates.some((item) => stripMarkdown(item.text).toLowerCase() === key)) return;
  candidates.push({ ...candidate, text: cleaned });
}

export function extractPlanMilestoneCandidates(plan: string, maxItems: number = DEFAULT_PLAN_MAX_ITEMS): PlanMilestoneCandidate[] {
  const candidates: PlanMilestoneCandidate[] = [];
  const headingFallback: PlanMilestoneCandidate[] = [];
  let inCodeBlock = false;
  let currentSection = '';
  let currentSectionActionable = false;
  let currentSectionPassive = false;

  for (const rawLine of plan.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      currentSection = stripMarkdown(heading[2]);
      currentSectionActionable = ACTION_SECTION_RE.test(currentSection);
      currentSectionPassive = PASSIVE_SECTION_RE.test(currentSection) && !currentSectionActionable;
      if (currentSectionActionable && !currentSectionPassive) headingFallback.push({ text: currentSection, source: 'heading', section: currentSection });
      continue;
    }

    const taskList = /^[-*+]\s+\[[ xX-]\]\s+(.+)$/.exec(line);
    if (taskList) {
      if (!currentSectionPassive) pushCandidate(candidates, { text: taskList[1], source: 'task-list', section: currentSection });
      continue;
    }

    const numbered = /^\d+[.)、]\s+(.+)$/.exec(line);
    if (numbered) {
      if (!currentSectionPassive) pushCandidate(candidates, { text: numbered[1], source: 'numbered-list', section: currentSection });
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      const text = bullet[1];
      if (!currentSectionPassive && (currentSectionActionable || ACTION_TEXT_RE.test(text))) {
        pushCandidate(candidates, { text, source: 'bullet-list', section: currentSection });
      }
    }
  }

  if (candidates.length === 0) {
    for (const candidate of headingFallback) {
      pushCandidate(candidates, candidate);
      if (candidates.length >= maxItems) break;
    }
  }
  if (candidates.length === 0) candidates.push({ text: '按批准计划执行', source: 'fallback' });
  return candidates.slice(0, Math.max(1, maxItems));
}

export function buildMilestonesFromApprovedPlan(plan: string, options: { owner?: string; planFilePath?: string; maxItems?: number } = {}): MilestoneUpdateInput[] {
  const maxItems = options.maxItems ?? DEFAULT_PLAN_MAX_ITEMS;
  return extractPlanMilestoneCandidates(plan, maxItems).map((candidate, index) => ({
    id: `m${index + 1}`,
    title: candidate.text,
    status: 'pending',
    owner: options.owner,
    description: candidate.section && candidate.section !== candidate.text ? `来自计划章节：${candidate.section}` : undefined,
    metadata: {
      origin: 'plan_mode',
      source: candidate.source,
      ...(options.planFilePath ? { planFilePath: options.planFilePath } : {}),
    },
  }));
}

function createUpdateMilestonesTool(api: IrisAPI): ToolDefinition {
  return {
    approvalMode: 'handler',
    parallel: false,
    declaration: {
      name: 'update_milestones',
      description: `更新当前会话的结构化 milestone/task 清单，并驱动 Console/Web 中的 Iris 进度面板。

使用规则：
- 复杂、多步骤、跨文件或用户明确要求跟踪进度时，先创建 3-8 个 milestone。
- 开始某项工作前，把该项设为 in_progress；完成后立即设为 completed，不要批量拖到最后。
- 通常同一 Agent 同一时间只应有一个 in_progress；多 Agent 并行时可通过 owner 区分负责人。
- 当前前台 Agent 初次建立完整清单时可使用 replaceAll=true；子代理或委派 Agent 更新时请用增量 items，避免覆盖其他 Agent 的 owner/状态。
- list_milestones 会返回每项 version；并发敏感更新可带 expectedVersion，防止别人刚刚写入的状态被覆盖。
- 这不是最终回复文本；调用后 UI 会自动显示进度清单。`,
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'array', items: ITEM_SCHEMA, description: '要创建、更新或删除的 milestone 项。默认按 id 增量合并。' },
          replaceAll: { type: 'boolean', description: '是否用 items 完整替换当前会话 milestone。仅当前台 Agent 初始化主清单时使用。' },
        },
        required: ['items'],
      },
    },
    handler: async (args, context) => {
      const service = getMilestones(api);
      const ctx = resolveExecutionContext(api, context);
      const items = normalizeItems(args.items);
      const mayReplaceAll = !ctx.routeAgent || !ctx.sourceAgent || ctx.sourceAgent === ctx.routeAgent;
      const replaceAll = args.replaceAll === true && mayReplaceAll;
      const snapshot = service.update(ctx.sessionId, items, { sourceAgent: ctx.sourceAgent, routeAgent: ctx.routeAgent, replaceAll });
      return { ok: true, summary: formatSummary(snapshot), snapshot };
    },
  };
}

function createListMilestonesTool(api: IrisAPI): ToolDefinition {
  return {
    approvalMode: 'handler',
    parallel: true,
    declaration: {
      name: 'list_milestones',
      description: '读取当前会话的 milestone/task 清单，用于检查整体进度、避免重复创建或确认下一步。',
      parameters: { type: 'object', properties: {} },
    },
    handler: async (_args, context) => {
      const service = getMilestones(api);
      const ctx = resolveExecutionContext(api, context);
      const snapshot = service.getSnapshot(ctx.sessionId, ctx.sourceAgent);
      return { ok: true, summary: formatSummary(snapshot), snapshot };
    },
  };
}

function wrapExitPlanMode(api: IrisAPI, ctx: PluginContext): void {
  const exitPlanTool = ctx.getToolRegistry().get?.('ExitPlanMode');
  if (!exitPlanTool) return;
  const original = exitPlanTool.handler;
  const wrapped = async (args: Record<string, unknown>, context?: ToolExecutionContext) => {
    const result = await original(args, context);
    try {
      const record = result && typeof result === 'object' ? result as Record<string, unknown> : undefined;
      const approvedPlan = typeof record?.approvedPlan === 'string' ? record.approvedPlan : undefined;
      const planFilePath = typeof record?.planFilePath === 'string' ? record.planFilePath : undefined;
      if (record?.approved === true && approvedPlan) {
        const sessionId = context?.sessionId ?? api.backend.getActiveSessionId?.();
        const agentName = api.agentName ?? 'master';
        if (sessionId) {
          const items = buildMilestonesFromApprovedPlan(approvedPlan, { owner: agentName, planFilePath });
          getMilestones(api).update(sessionId, items, { sourceAgent: agentName, routeAgent: agentName, replaceAll: true });
        }
      }
    } catch (err) {
      logger.warn('Plan Mode milestone 同步失败:', err);
    }
    return result;
  };
  exitPlanTool.handler = wrapped as typeof exitPlanTool.handler;
  ctx.trackDisposable({ dispose: () => { if (exitPlanTool.handler === wrapped) exitPlanTool.handler = original; } });
}

function resolveExecutionContextForTool(api: IrisAPI, rawSessionId: string): { sessionId: string; sourceAgent?: string; routeAgent?: string } {
  const baseAgent = api.agentName;
  const crossAgentTaskId = parseCrossAgentTaskId(rawSessionId);
  if (crossAgentTaskId && api.taskBoard?.get) {
    const task = api.taskBoard.get(crossAgentTaskId);
    if (task?.type === 'delegate') return { sessionId: task.sourceSessionId, sourceAgent: baseAgent, routeAgent: task.sourceAgent };
  }
  return { sessionId: rawSessionId, sourceAgent: baseAgent, routeAgent: baseAgent };
}

function observeToolFailures(api: IrisAPI, ctx: PluginContext): void {
  const listener = (_sessionId: string, handle: ToolExecutionHandleLike) => {
    const initial = handle.getSnapshot();
    if (MILESTONE_TOOL_SYNC_IGNORED.has(initial.toolName)) return;
    if (initial.parentToolId || (initial.depth ?? 0) > 0) return;

    const done = (_result?: unknown, error?: string) => {
      const snapshot = handle.getSnapshot();
      if (snapshot.status !== 'error') return;
      const service = getMilestones(api);
      if (!service?.noteActiveToolFailure) return;
      const ctxInfo = resolveExecutionContextForTool(api, snapshot.sessionId ?? _sessionId);
      service.noteActiveToolFailure(ctxInfo.sessionId, {
        toolId: snapshot.id,
        toolName: snapshot.toolName,
        error: snapshot.error ?? error ?? '未知错误',
        sourceAgent: ctxInfo.sourceAgent,
        routeAgent: ctxInfo.routeAgent,
      });
    };
    handle.on('done', done);
  };
  api.backend.on('tool:execute', listener);
  ctx.trackDisposable({ dispose: () => api.backend.off('tool:execute', listener) });
}

export function createMilestoneToolsForApi(api: IrisAPI): ToolDefinition[] {
  return [createUpdateMilestonesTool(api), createListMilestonesTool(api)];
}

export const milestonePlugin = definePlugin({
  name: 'milestone',
  version: '0.1.0',
  description: '结构化里程碑 / Iris 进度扩展',

  activate(ctx: PluginContext) {
    ctx.onReady((api) => {
      const existing = api.services.get<MilestoneExtensionService>(MILESTONE_EXTENSION_SERVICE_ID);
      const service = existing ?? createMilestoneServiceForApi(api);
      if (!existing) {
        ctx.trackDisposable(api.services.register(MILESTONE_EXTENSION_SERVICE_ID, service, {
          description: 'Structured milestone/task progress service',
          version: '1.0.0',
        }));
      }
      (api.config as any).tools ??= {};
      ((api.config as any).tools.permissions ??= {}).update_milestones ??= { autoApprove: true };
      ((api.config as any).tools.permissions ??= {}).list_milestones ??= { autoApprove: true };
      ctx.registerTools(createMilestoneToolsForApi(api));
      wrapExitPlanMode(api, ctx);
      observeToolFailures(api, ctx);
    });
  },
});

export default milestonePlugin;
