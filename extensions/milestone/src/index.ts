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
  normalizeMilestoneSnapshot,
  type MilestoneUpdateInput,
  type MilestoneUiState,
} from './session.js';

const logger = createPluginLogger('milestone');
const EXTENSION_STATE_KEY = 'milestone';
export const MILESTONE_EXTENSION_SERVICE_ID = 'milestone:service';
const CONSOLE_PROGRESS_SERVICE_ID = 'console:progress';

export interface MilestoneExtensionService {
  update(sessionId: string, updates: MilestoneUpdateInput[], options?: { replaceAll?: boolean }): MilestoneSnapshot;
  getSnapshot(sessionId: string): MilestoneSnapshot;
  clear?(sessionId: string): MilestoneSnapshot;
  noteActiveToolFailure?(sessionId: string, input: { toolId: string; toolName: string; error: string }): MilestoneSnapshot | undefined;
  loadLatest(sessionId: string): Promise<MilestoneSnapshot | undefined>;
  loadArchives(sessionId: string): Promise<MilestoneArchiveEntry[]>;
  loadUiState(sessionId: string): Promise<MilestoneUiState | undefined>;
  setUiState(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }): Promise<void>;
  onDidUpdate(listener: (sessionId: string, snapshot: MilestoneSnapshot) => void): { dispose(): void };
}

interface ConsoleProgressServiceLike {
  register(provider: {
    id: string;
    priority?: number;
    loadLatest(sessionId: string): Promise<MilestoneSnapshot | undefined> | MilestoneSnapshot | undefined;
    loadHistory?(sessionId: string): Promise<MilestoneArchiveEntry[]> | MilestoneArchiveEntry[];
    loadUiState?(sessionId: string): Promise<MilestoneUiState | undefined> | MilestoneUiState | undefined;
    saveUiState?(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }): Promise<void> | void;
    onDidUpdate?(listener: (sessionId: string, snapshot: MilestoneSnapshot) => void): { dispose(): void };
  }): { dispose(): void };
}

interface PersistedMilestoneState {
  latest?: MilestoneSnapshot;
  archives?: MilestoneArchiveEntry[];
  ui?: MilestoneUiState;
}

type SessionMetaWithExtensionState = { extensionState?: Record<string, unknown> };
type PersistedMilestoneStateUpdater = (
  state: PersistedMilestoneState,
  meta: SessionMetaWithExtensionState,
) => PersistedMilestoneState | undefined | Promise<PersistedMilestoneState | undefined>;

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
    const snapshot = normalizeMilestoneSnapshot(record.snapshot, sessionId);
    if (!snapshot) continue;
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
  await updatePersistedMilestoneState(api, snapshot.sessionId, async (state) => {
    state.latest = snapshot.items.length > 0 ? snapshot : undefined;
    const existingUi = normalizeUiState(state.ui);
    if (isArchivable(snapshot)) {
      upsertArchive(state, snapshot, await getHistoryLengthSafe(api, snapshot.sessionId));
      state.ui = createUiState(true, snapshot.updatedAt);
    } else if (snapshot.items.length > 0 && !existingUi) {
      state.ui = createUiState(true, snapshot.updatedAt);
    }
    return state;
  });
}

async function updatePersistedMilestoneState(
  api: IrisAPI,
  sessionId: string,
  updater: PersistedMilestoneStateUpdater,
): Promise<PersistedMilestoneState | undefined> {
  let updatedState: PersistedMilestoneState | undefined;

  if (api.storage.updateMeta) {
    await api.storage.updateMeta(sessionId, async (current) => {
      if (!current) return undefined;
      const meta = current as SessionMetaWithExtensionState;
      const state = { ...getExtensionState(meta) };
      const next = await updater(state, meta);
      if (!next) return undefined;
      updatedState = next;
      setExtensionState(meta, next);
      return current;
    });
    return updatedState;
  }

  const meta = await api.storage.getMeta?.(sessionId) as SessionMetaWithExtensionState | null | undefined;
  if (!meta) return undefined;
  const state = { ...getExtensionState(meta) };
  const next = await updater(state, meta);
  if (!next) return undefined;
  updatedState = next;
  setExtensionState(meta, next);
  await api.storage.saveMeta?.(meta as any);
  return updatedState;
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
    title: { type: 'string', description: '面向用户展示的短标题；增量更新时按 title 匹配已有项。建议使用动宾短语。' },
    description: { type: 'string', description: '更完整的说明、验收条件或上下文。' },
    activeForm: { type: 'string', description: '当前进行中时用于 spinner/状态栏的现在进行时文案，例如「运行测试」。' },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'],
      description: '状态：pending 待处理/未开始（尚未执行，或暂时回到等待队列），in_progress 正在做，completed 已完成，blocked 被阻塞，cancelled 已取消。',
    },
    delete: { type: 'boolean', description: '设为 true 时删除同 title 的 milestone。' },
  },
};

function getMilestones(api: IrisAPI): MilestoneExtensionService {
  const service = api.services.get<MilestoneExtensionService>(MILESTONE_EXTENSION_SERVICE_ID);
  if (!service) throw new Error('Milestone 服务不可用');
  return service;
}

function tryGetMilestones(api: IrisAPI | undefined): MilestoneExtensionService | undefined {
  if (!api?.services?.get) return undefined;
  return api.services.get<MilestoneExtensionService>(MILESTONE_EXTENSION_SERVICE_ID);
}

export function createMilestoneServiceForApi(api: IrisAPI): MilestoneExtensionService {
  const manager = new SessionMilestoneManager();
  const updateListeners = new Set<(sessionId: string, snapshot: MilestoneSnapshot) => void>();
  const emitUpdate = (sessionId: string, snapshot: MilestoneSnapshot): void => {
    for (const listener of updateListeners) listener(sessionId, snapshot);
  };

  const service: MilestoneExtensionService = {
    update(sessionId, updates, options) {
      const snapshot = manager.update(sessionId, updates as any, options);
      void persistSnapshot(api, snapshot).catch((err) => logger.warn('保存进度状态失败:', err));
      emitUpdate(snapshot.sessionId, snapshot);
      return snapshot;
    },
    getSnapshot(sessionId) {
      return manager.getSnapshot(sessionId);
    },
    clear(sessionId) {
      const snapshot = manager.clear(sessionId);
      void persistSnapshot(api, snapshot).catch((err) => logger.warn('清理进度状态失败:', err));
      emitUpdate(snapshot.sessionId, snapshot);
      return snapshot;
    },
    noteActiveToolFailure(sessionId, input) {
      const snapshot = manager.noteActiveToolFailure(sessionId, input);
      if (snapshot) {
        void persistSnapshot(api, snapshot).catch((err) => logger.warn('保存工具错误进度状态失败:', err));
        emitUpdate(snapshot.sessionId, snapshot);
      }
      return snapshot;
    },
    async loadLatest(sessionId) {
      const meta = await api.storage.getMeta?.(sessionId);
      const state = getExtensionState(meta);
      const latest = normalizeMilestoneSnapshot(state.latest, sessionId);
      if (latest) {
        const current = manager.getSnapshot(sessionId);
        const storageUpdatedAt = typeof latest.updatedAt === 'number' ? latest.updatedAt : 0;
        if (manager.hasSession(sessionId) && current.items.length > 0 && current.updatedAt >= storageUpdatedAt) {
          return current;
        }
        manager.hydrate(latest);
      }
      return manager.getSnapshot(sessionId);
    },
    async loadArchives(sessionId) {
      const meta = await api.storage.getMeta?.(sessionId);
      const state = getExtensionState(meta);
      const archives = normalizeArchives(state.archives, sessionId);
      const latest = normalizeMilestoneSnapshot(state.latest, sessionId);
      if (isArchivable(latest) && !archives.some(entry => entry.snapshot.updatedAt === latest!.updatedAt)) {
        const updated = await updatePersistedMilestoneState(api, sessionId, async (currentState) => {
          const currentArchives = normalizeArchives(currentState.archives, sessionId);
          const currentLatest = normalizeMilestoneSnapshot(currentState.latest, sessionId);
          if (isArchivable(currentLatest) && !currentArchives.some(entry => entry.snapshot.updatedAt === currentLatest!.updatedAt)) {
            upsertArchive(currentState, currentLatest!, await getHistoryLengthSafe(api, sessionId));
          }
          return currentState;
        });
        return normalizeArchives(updated?.archives, sessionId);
      }
      return archives;
    },
    async loadUiState(sessionId) {
      const meta = await api.storage.getMeta?.(sessionId);
      return normalizeUiState(getExtensionState(meta).ui);
    },
    async setUiState(sessionId, uiState) {
      await updatePersistedMilestoneState(api, sessionId, (state) => {
        state.ui = createUiState(uiState.expanded, uiState.snapshotUpdatedAt);
        return state;
      });
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

function normalizeToolItems(raw: unknown): MilestoneUpdateInput[] {
  if (!Array.isArray(raw)) throw new Error('items 必须是数组');
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`items[${index}] 必须是对象`);
    }
    const record = entry as Record<string, unknown>;
    return {
      title: record.title,
      subject: record.subject,
      content: record.content,
      description: record.description,
      activeForm: record.activeForm,
      status: record.status,
      delete: record.delete,
    };
  });
}

function stripMetadataForToolResult(snapshot: MilestoneSnapshot): MilestoneSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map(({ metadata: _metadata, ...item }) => item),
  };
}

function parseCrossAgentTaskId(sessionId: string): string | undefined {
  if (!sessionId.startsWith('cross-agent:')) return undefined;
  const parts = sessionId.split(':');
  if (parts.length < 3) return undefined;
  return parts.slice(2).join(':') || undefined;
}

interface ResolvedMilestoneTarget {
  api: IrisAPI;
  sessionId: string;
  service: MilestoneExtensionService;
}

function resolveMilestoneTarget(api: IrisAPI, rawSessionId: string): ResolvedMilestoneTarget {
  const crossAgentTaskId = parseCrossAgentTaskId(rawSessionId);
  let targetApi = api;
  let sessionId = rawSessionId;

  if (crossAgentTaskId && api.taskBoard?.get) {
    const task = api.taskBoard.get(crossAgentTaskId);
    if (task?.type === 'delegate') {
      sessionId = task.sourceSessionId;
      if (task.sourceAgent && task.sourceAgent !== api.agentName) {
        const peerApi = api.agentNetwork?.getPeerAPI?.(task.sourceAgent) as IrisAPI | undefined;
        if (tryGetMilestones(peerApi)) {
          targetApi = peerApi!;
        } else {
          logger.warn(`无法将 delegate milestone 路由到 source Agent "${task.sourceAgent}"，回退到当前 Agent`);
        }
      }
    }
  }

  return { api: targetApi, sessionId, service: getMilestones(targetApi) };
}

function resolveMilestoneTargetFromContext(api: IrisAPI, context?: ToolExecutionContext): ResolvedMilestoneTarget {
  return resolveMilestoneTarget(api, getSessionId(api, context));
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

export function buildMilestonesFromApprovedPlan(plan: string, options: { planFilePath?: string; maxItems?: number } = {}): MilestoneUpdateInput[] {
  const maxItems = options.maxItems ?? DEFAULT_PLAN_MAX_ITEMS;
  return extractPlanMilestoneCandidates(plan, maxItems).map((candidate) => ({
    title: candidate.text,
    status: 'pending',
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
      description: `更新当前会话的结构化 milestone/task 清单。

使用规则：
- 复杂、多步骤、跨文件或用户明确要求跟踪进度时，先创建 3-8 个 milestone。
- 开始某项工作前，把该项设为 in_progress；完成后立即设为 completed，不要批量拖到最后。
- 同一时间只保留一个 in_progress；启动新项时旧的进行中项会自动回到 pending。
- replaceAll=true 表示“我现在提交的是当前任务的完整进度清单”，会用 items 替换旧清单。
- 遇到新的、明显不是同一批工作的用户任务/新计划/新阶段时，必须使用 replaceAll=true，避免把旧任务和新任务混在同一个进度面板里。
- 如果本次 items 已经覆盖当前任务应显示的全部 milestone，也应使用 replaceAll=true。
- 只有在继续更新同一批工作时才省略 replaceAll：例如只把某一项改为 in_progress/completed，或给同一清单少量追加/删除项。
- 省略 replaceAll 时按 title 增量合并：title 相同则更新原项，不存在则创建新项；因此不要用它追加无关任务。
- 这不是最终回复文本；调用后 UI 会自动显示进度清单。`,
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'array', items: ITEM_SCHEMA, description: '要创建、更新或删除的 milestone 项。replaceAll=true 时表示完整清单；否则按 title 增量合并。' },
          replaceAll: { type: 'boolean', description: '当 items 是当前任务/计划/阶段应显示的完整清单，或新任务与旧清单明显不同类时设为 true，以替换旧 milestone；仅继续更新同一批工作的一小部分时才省略。' },
        },
        required: ['items'],
      },
    },
    handler: async (args, context) => {
      const { service, sessionId } = resolveMilestoneTargetFromContext(api, context);
      const items = normalizeToolItems(args.items);
      const snapshot = service.update(sessionId, items, { replaceAll: args.replaceAll === true });
      const toolSnapshot = stripMetadataForToolResult(snapshot);
      return { ok: true, summary: formatSummary(toolSnapshot), snapshot: toolSnapshot };
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
      const { service, sessionId } = resolveMilestoneTargetFromContext(api, context);
      const snapshot = service.getSnapshot(sessionId);
      const toolSnapshot = stripMetadataForToolResult(snapshot);
      return { ok: true, summary: formatSummary(toolSnapshot), snapshot: toolSnapshot };
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
        const rawSessionId = context?.sessionId ?? api.backend.getActiveSessionId?.();
        if (rawSessionId) {
          const items = buildMilestonesFromApprovedPlan(approvedPlan, { planFilePath });
          const { service, sessionId } = resolveMilestoneTarget(api, rawSessionId);
          service.update(sessionId, items, { replaceAll: true });
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

function observeToolFailures(api: IrisAPI, ctx: PluginContext): void {
  const listener = (_sessionId: string, handle: ToolExecutionHandleLike) => {
    const initial = handle.getSnapshot();
    if (MILESTONE_TOOL_SYNC_IGNORED.has(initial.toolName)) return;
    if (initial.parentToolId || (initial.depth ?? 0) > 0) return;

    const done = (_result?: unknown, error?: string) => {
      const snapshot = handle.getSnapshot();
      if (snapshot.status !== 'error') return;
      const { service, sessionId } = resolveMilestoneTarget(api, snapshot.sessionId ?? _sessionId);
      if (!service?.noteActiveToolFailure) return;
      service.noteActiveToolFailure(sessionId, {
        toolId: snapshot.id,
        toolName: snapshot.toolName,
        error: snapshot.error ?? error ?? '未知错误',
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

    ctx.onPlatformsReady((_platforms, api) => {
      const service = api.services.get<MilestoneExtensionService>(MILESTONE_EXTENSION_SERVICE_ID);
      const consoleProgress = api.services.get<ConsoleProgressServiceLike>(CONSOLE_PROGRESS_SERVICE_ID);
      if (!service || !consoleProgress) return;
      ctx.trackDisposable(consoleProgress.register({
        id: 'milestone',
        priority: 100,
        loadLatest: (sessionId) => service.loadLatest(sessionId),
        loadHistory: (sessionId) => service.loadArchives(sessionId),
        loadUiState: (sessionId) => service.loadUiState(sessionId),
        saveUiState: (sessionId, state) => service.setUiState(sessionId, state),
        onDidUpdate: (listener) => service.onDidUpdate(listener),
      }));
    });
  },
});

export default milestonePlugin;
