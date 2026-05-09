// ../../packages/extension-sdk/src/logger.ts
var _logLevel = 1 /* INFO */;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= 0 /* DEBUG */)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= 1 /* INFO */)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= 2 /* WARN */)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= 3 /* ERROR */)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/src/plugin/context.ts
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/session.ts
import { EventEmitter } from "events";
var TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
function normalizeStatus(value) {
  switch (value) {
    case "in_progress":
    case "completed":
    case "blocked":
    case "cancelled":
    case "pending":
      return value;
    case "todo":
    case "open":
      return "pending";
    case "running":
    case "active":
      return "in_progress";
    case "done":
    case "resolved":
      return "completed";
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}
function asOptionalString(value) {
  if (typeof value !== "string")
    return;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
function asMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  return { ...value };
}
function asTimestamp(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function getInputTitle(input) {
  return asOptionalString(input.title) ?? asOptionalString(input.subject) ?? asOptionalString(input.content);
}
function titleKey(title) {
  return title.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
function sortMilestones(a, b) {
  return a.createdAt - b.createdAt || a.title.localeCompare(b.title);
}
function cloneItem(item) {
  return {
    title: item.title,
    description: item.description,
    activeForm: item.activeForm,
    status: item.status,
    metadata: item.metadata ? { ...item.metadata } : undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}
function normalizeMilestoneItem(value, fallbackNow = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  const record = value;
  const title = asOptionalString(record.title) ?? asOptionalString(record.subject) ?? asOptionalString(record.content);
  if (!title)
    return;
  return {
    title,
    description: asOptionalString(record.description),
    activeForm: asOptionalString(record.activeForm),
    status: normalizeStatus(record.status),
    metadata: asMetadata(record.metadata),
    createdAt: asTimestamp(record.createdAt, fallbackNow),
    updatedAt: asTimestamp(record.updatedAt, fallbackNow)
  };
}
function truncateReason(text, max = 180) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`;
}
function computeMilestoneStats(items) {
  const stats = {
    total: items.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
    open: 0
  };
  for (const item of items) {
    if (item.status === "pending")
      stats.pending++;
    if (item.status === "in_progress")
      stats.inProgress++;
    if (item.status === "completed")
      stats.completed++;
    if (item.status === "blocked")
      stats.blocked++;
    if (item.status === "cancelled")
      stats.cancelled++;
    if (!TERMINAL_STATUSES.has(item.status))
      stats.open++;
  }
  return stats;
}
function normalizeMilestoneSnapshot(value, expectedSessionId) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  const record = value;
  const sessionId = asOptionalString(record.sessionId) ?? expectedSessionId;
  if (!sessionId || expectedSessionId && sessionId !== expectedSessionId)
    return;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems.map((item) => normalizeMilestoneItem(item)).filter((item) => !!item).sort(sortMilestones);
  const maxItemUpdatedAt = items.reduce((max, item) => Math.max(max, item.updatedAt), 0);
  const updatedAt = asTimestamp(record.updatedAt, maxItemUpdatedAt || Date.now());
  return {
    sessionId,
    items,
    stats: computeMilestoneStats(items),
    updatedAt
  };
}

class SessionMilestoneManager extends EventEmitter {
  sessions = new Map;
  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }
  getSnapshot(sessionId) {
    const items = [...this.sessions.get(sessionId) ?? []].map(cloneItem).sort(sortMilestones);
    const updatedAt = items.reduce((max, item) => Math.max(max, item.updatedAt), 0) || Date.now();
    return {
      sessionId,
      items,
      stats: computeMilestoneStats(items),
      updatedAt
    };
  }
  clear(sessionId) {
    this.sessions.delete(sessionId);
    const snapshot = this.getSnapshot(sessionId);
    this.emit("updated", snapshot);
    return snapshot;
  }
  hydrate(snapshot) {
    const normalized = normalizeMilestoneSnapshot(snapshot, snapshot.sessionId);
    this.sessions.set(snapshot.sessionId, normalized?.items.map(cloneItem).sort(sortMilestones) ?? []);
  }
  findActiveMilestoneForToolSync(sessionId, _input) {
    const current = [...this.sessions.get(sessionId) ?? []].sort(sortMilestones);
    const target = current.find((item) => item.status === "in_progress");
    return target ? cloneItem(target) : undefined;
  }
  noteActiveToolFailure(sessionId, input) {
    const target = this.findActiveMilestoneForToolSync(sessionId);
    if (!target)
      return;
    const toolError = {
      toolId: input.toolId,
      toolName: input.toolName,
      error: truncateReason(input.error),
      at: Date.now()
    };
    const previousErrors = Array.isArray(target.metadata?.toolErrors) ? target.metadata.toolErrors.filter((entry) => entry && typeof entry === "object") : [];
    return this.update(sessionId, [{
      title: target.title,
      status: target.status,
      metadata: {
        ...target.metadata ?? {},
        toolSync: { kind: "tool_error_note", ...toolError },
        toolErrors: [...previousErrors, toolError].slice(-5)
      }
    }]);
  }
  markActiveBlockedByToolFailure(sessionId, input) {
    return this.noteActiveToolFailure(sessionId, input);
  }
  update(sessionId, updates, options = {}) {
    const now = Date.now();
    const current = options.replaceAll === true ? [] : [...this.sessions.get(sessionId) ?? []].map(cloneItem);
    const byTitle = new Map(current.map((item) => [titleKey(item.title), item]));
    let activeKeepKey;
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
      const item = {
        title,
        description: asOptionalString(input.description) ?? existing?.description,
        activeForm: asOptionalString(input.activeForm) ?? existing?.activeForm,
        status,
        metadata: asMetadata(input.metadata) ?? existing?.metadata,
        createdAt: existing?.createdAt ?? itemNow,
        updatedAt: itemNow
      };
      byTitle.set(key, item);
      if (item.status === "in_progress")
        activeKeepKey = key;
    });
    if (activeKeepKey) {
      for (const [key, item] of byTitle) {
        if (key === activeKeepKey || item.status !== "in_progress")
          continue;
        byTitle.set(key, {
          ...item,
          status: "pending",
          updatedAt: now
        });
      }
    }
    const next = Array.from(byTitle.values()).sort(sortMilestones);
    this.sessions.set(sessionId, next);
    const snapshot = this.getSnapshot(sessionId);
    this.emit("updated", snapshot);
    return snapshot;
  }
}

// src/index.ts
var logger = createPluginLogger("milestone");
var EXTENSION_STATE_KEY = "milestone";
var MILESTONE_EXTENSION_SERVICE_ID = "milestone:service";
var CONSOLE_PROGRESS_SERVICE_ID = "console:progress";
var manager = new SessionMilestoneManager;
var updateListeners = new Set;
function emitUpdate(sessionId, snapshot) {
  for (const listener of updateListeners)
    listener(sessionId, snapshot);
}
function getExtensionState(meta) {
  const raw = meta?.extensionState?.[EXTENSION_STATE_KEY];
  return raw && typeof raw === "object" ? raw : {};
}
function setExtensionState(meta, state) {
  meta.extensionState = { ...meta.extensionState ?? {}, [EXTENSION_STATE_KEY]: state };
}
function isArchivable(snapshot) {
  return !!snapshot && snapshot.items.length > 0 && snapshot.stats.open === 0;
}
function normalizeArchives(value, sessionId) {
  if (!Array.isArray(value))
    return [];
  const archives = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object")
      continue;
    const record = entry;
    const snapshot = normalizeMilestoneSnapshot(record.snapshot, sessionId);
    if (!snapshot)
      continue;
    const archivedAt = typeof record.archivedAt === "number" ? record.archivedAt : snapshot.updatedAt || Date.now();
    const afterHistoryIndex = typeof record.afterHistoryIndex === "number" && Number.isFinite(record.afterHistoryIndex) ? Math.max(0, Math.floor(record.afterHistoryIndex)) : 0;
    archives.push({
      id: typeof record.id === "string" && record.id ? record.id : `${snapshot.sessionId}:${snapshot.updatedAt}`,
      snapshot,
      archivedAt,
      afterHistoryIndex
    });
  }
  return archives.sort((a, b) => a.afterHistoryIndex - b.afterHistoryIndex || a.archivedAt - b.archivedAt || a.id.localeCompare(b.id));
}
function normalizeUiState(value) {
  if (!value || typeof value !== "object")
    return;
  const record = value;
  if (typeof record.expanded !== "boolean")
    return;
  return {
    expanded: record.expanded,
    updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
    ...typeof record.snapshotUpdatedAt === "number" && Number.isFinite(record.snapshotUpdatedAt) ? { snapshotUpdatedAt: record.snapshotUpdatedAt } : {}
  };
}
function createUiState(expanded, snapshotUpdatedAt) {
  return {
    expanded,
    updatedAt: Date.now(),
    ...typeof snapshotUpdatedAt === "number" && Number.isFinite(snapshotUpdatedAt) ? { snapshotUpdatedAt } : {}
  };
}
async function getHistoryLengthSafe(api, sessionId) {
  try {
    return (await api.storage.getHistory(sessionId)).length;
  } catch {
    return 0;
  }
}
function upsertArchive(state, snapshot, afterHistoryIndex) {
  if (!isArchivable(snapshot))
    return;
  const archives = normalizeArchives(state.archives, snapshot.sessionId);
  const safeIndex = Math.max(0, Math.floor(afterHistoryIndex));
  const archiveId = `${snapshot.sessionId}:${snapshot.updatedAt}`;
  const existingIndex = archives.findIndex((entry) => entry.id === archiveId || entry.snapshot.updatedAt === snapshot.updatedAt);
  if (existingIndex >= 0) {
    const existing = archives[existingIndex];
    archives[existingIndex] = {
      ...existing,
      id: existing.id || archiveId,
      snapshot,
      archivedAt: existing.archivedAt || snapshot.updatedAt || Date.now(),
      afterHistoryIndex: Math.max(existing.afterHistoryIndex ?? 0, safeIndex)
    };
  } else {
    archives.push({ id: archiveId, snapshot, archivedAt: snapshot.updatedAt || Date.now(), afterHistoryIndex: safeIndex });
  }
  state.archives = archives.sort((a, b) => a.afterHistoryIndex - b.afterHistoryIndex || a.archivedAt - b.archivedAt || a.id.localeCompare(b.id));
}
async function persistSnapshot(api, snapshot) {
  const meta = await api.storage.getMeta?.(snapshot.sessionId);
  if (!meta)
    return;
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
var MILESTONE_TOOL_SYNC_IGNORED = new Set([
  "update_milestones",
  "list_milestones",
  "EnterPlanMode",
  "ExitPlanMode",
  "read_plan",
  "write_plan",
  "AskQuestionFirst"
]);
var DEFAULT_PLAN_MAX_ITEMS = 8;
var ACTION_SECTION_RE = /(实施|执行|步骤|任务|里程碑|开发|修改|验证|测试|上线|交付|implementation|steps?|tasks?|milestones?|todo|plan)/i;
var PASSIVE_SECTION_RE = /(背景|上下文|目标|约束|风险|说明|备注|现状|已完成|验收|参考|background|context|goals?|constraints?|risks?|notes?|done|acceptance|reference)/i;
var ACTION_TEXT_RE = /(实现|修改|新增|补充|接入|调整|修复|验证|测试|运行|更新|删除|迁移|重构|检查|确认|implement|modify|add|wire|fix|verify|test|run|update|delete|migrate|refactor|check)/i;
var ITEM_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "面向用户展示的短标题；增量更新时按 title 匹配已有项。建议使用动宾短语。" },
    description: { type: "string", description: "更完整的说明、验收条件或上下文。" },
    activeForm: { type: "string", description: "当前进行中时用于 spinner/状态栏的现在进行时文案，例如「运行测试」。" },
    status: {
      type: "string",
      enum: ["pending", "in_progress", "completed", "blocked", "cancelled"],
      description: "状态：pending 待处理/未开始（尚未执行，或暂时回到等待队列），in_progress 正在做，completed 已完成，blocked 被阻塞，cancelled 已取消。"
    },
    delete: { type: "boolean", description: "设为 true 时删除同 title 的 milestone。" }
  }
};
function getMilestones(api) {
  const service = api.services.get(MILESTONE_EXTENSION_SERVICE_ID);
  if (!service)
    throw new Error("Milestone 服务不可用");
  return service;
}
function createMilestoneServiceForApi(api) {
  const service = {
    update(sessionId, updates, options) {
      const snapshot = manager.update(sessionId, updates, options);
      persistSnapshot(api, snapshot).catch((err) => logger.warn("保存进度状态失败:", err));
      emitUpdate(snapshot.sessionId, snapshot);
      return snapshot;
    },
    getSnapshot(sessionId) {
      return manager.getSnapshot(sessionId);
    },
    clear(sessionId) {
      const snapshot = manager.clear(sessionId);
      persistSnapshot(api, snapshot).catch((err) => logger.warn("清理进度状态失败:", err));
      emitUpdate(snapshot.sessionId, snapshot);
      return snapshot;
    },
    noteActiveToolFailure(sessionId, input) {
      const snapshot = manager.noteActiveToolFailure(sessionId, input);
      if (snapshot) {
        persistSnapshot(api, snapshot).catch((err) => logger.warn("保存工具错误进度状态失败:", err));
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
        const storageUpdatedAt = typeof latest.updatedAt === "number" ? latest.updatedAt : 0;
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
      if (isArchivable(latest) && !archives.some((entry) => entry.snapshot.updatedAt === latest.updatedAt)) {
        upsertArchive(state, latest, await getHistoryLengthSafe(api, sessionId));
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
      if (!meta)
        return;
      const state = getExtensionState(meta);
      state.ui = createUiState(uiState.expanded, uiState.snapshotUpdatedAt);
      setExtensionState(meta, state);
      await api.storage.saveMeta?.(meta);
    },
    onDidUpdate(listener) {
      updateListeners.add(listener);
      return { dispose: () => updateListeners.delete(listener) };
    }
  };
  return service;
}
function getSessionId(api, context) {
  const sessionId = context?.sessionId ?? api.backend.getActiveSessionId?.();
  if (!sessionId)
    throw new Error("milestone 工具只能在会话执行上下文中使用");
  return sessionId;
}
function normalizeToolItems(raw) {
  if (!Array.isArray(raw))
    throw new Error("items 必须是数组");
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`items[${index}] 必须是对象`);
    }
    const record = entry;
    return {
      title: record.title,
      subject: record.subject,
      content: record.content,
      description: record.description,
      activeForm: record.activeForm,
      status: record.status,
      delete: record.delete
    };
  });
}
function stripMetadataForToolResult(snapshot) {
  return {
    ...snapshot,
    items: snapshot.items.map(({ metadata: _metadata, ...item }) => item)
  };
}
function parseCrossAgentTaskId(sessionId) {
  if (!sessionId.startsWith("cross-agent:"))
    return;
  const parts = sessionId.split(":");
  if (parts.length < 3)
    return;
  return parts.slice(2).join(":") || undefined;
}
function resolveExecutionSessionId(api, context) {
  const rawSessionId = getSessionId(api, context);
  const crossAgentTaskId = parseCrossAgentTaskId(rawSessionId);
  if (crossAgentTaskId && api.taskBoard?.get) {
    const task = api.taskBoard.get(crossAgentTaskId);
    if (task?.type === "delegate") {
      return task.sourceSessionId;
    }
  }
  return rawSessionId;
}
function formatSummary(snapshot) {
  const { stats } = snapshot;
  if (stats.total === 0)
    return "当前没有 milestone。";
  const active = snapshot.items.find((item) => item.status === "in_progress");
  return `${stats.completed}/${stats.total} 个 milestone 已完成，${stats.open} 个未完成${active ? `；当前：${active.title}` : ""}`;
}
function stripMarkdown(text) {
  return text.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1").replace(/[*_~`>#]/g, "").replace(/^\s*(?:步骤|阶段|任务|Step|Phase|Task)\s*\d+\s*[:：.)-]?\s*/i, "").replace(/^\s*(?:TODO|待办|实施|执行)\s*[:：-]\s*/i, "").replace(/\s+/g, " ").trim().replace(/[。；;,.，]+$/g, "").trim();
}
function truncateTitle(text, max = 80) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
function isUsefulCandidate(text) {
  const cleaned = stripMarkdown(text);
  if (cleaned.length < 3)
    return false;
  if (/^https?:\/\//i.test(cleaned))
    return false;
  if (/^(yes|no|true|false|null|none)$/i.test(cleaned))
    return false;
  return true;
}
function pushCandidate(candidates, candidate) {
  const cleaned = truncateTitle(stripMarkdown(candidate.text));
  if (!isUsefulCandidate(cleaned))
    return;
  const key = cleaned.toLowerCase();
  if (candidates.some((item) => stripMarkdown(item.text).toLowerCase() === key))
    return;
  candidates.push({ ...candidate, text: cleaned });
}
function extractPlanMilestoneCandidates(plan, maxItems = DEFAULT_PLAN_MAX_ITEMS) {
  const candidates = [];
  const headingFallback = [];
  let inCodeBlock = false;
  let currentSection = "";
  let currentSectionActionable = false;
  let currentSectionPassive = false;
  for (const rawLine of plan.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line)
      continue;
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock)
      continue;
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      currentSection = stripMarkdown(heading[2]);
      currentSectionActionable = ACTION_SECTION_RE.test(currentSection);
      currentSectionPassive = PASSIVE_SECTION_RE.test(currentSection) && !currentSectionActionable;
      if (currentSectionActionable && !currentSectionPassive)
        headingFallback.push({ text: currentSection, source: "heading", section: currentSection });
      continue;
    }
    const taskList = /^[-*+]\s+\[[ xX-]\]\s+(.+)$/.exec(line);
    if (taskList) {
      if (!currentSectionPassive)
        pushCandidate(candidates, { text: taskList[1], source: "task-list", section: currentSection });
      continue;
    }
    const numbered = /^\d+[.)、]\s+(.+)$/.exec(line);
    if (numbered) {
      if (!currentSectionPassive)
        pushCandidate(candidates, { text: numbered[1], source: "numbered-list", section: currentSection });
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      const text = bullet[1];
      if (!currentSectionPassive && (currentSectionActionable || ACTION_TEXT_RE.test(text))) {
        pushCandidate(candidates, { text, source: "bullet-list", section: currentSection });
      }
    }
  }
  if (candidates.length === 0) {
    for (const candidate of headingFallback) {
      pushCandidate(candidates, candidate);
      if (candidates.length >= maxItems)
        break;
    }
  }
  if (candidates.length === 0)
    candidates.push({ text: "按批准计划执行", source: "fallback" });
  return candidates.slice(0, Math.max(1, maxItems));
}
function buildMilestonesFromApprovedPlan(plan, options = {}) {
  const maxItems = options.maxItems ?? DEFAULT_PLAN_MAX_ITEMS;
  return extractPlanMilestoneCandidates(plan, maxItems).map((candidate) => ({
    title: candidate.text,
    status: "pending",
    description: candidate.section && candidate.section !== candidate.text ? `来自计划章节：${candidate.section}` : undefined,
    metadata: {
      origin: "plan_mode",
      source: candidate.source,
      ...options.planFilePath ? { planFilePath: options.planFilePath } : {}
    }
  }));
}
function createUpdateMilestonesTool(api) {
  return {
    approvalMode: "handler",
    parallel: false,
    declaration: {
      name: "update_milestones",
      description: `更新当前会话的结构化 milestone/task 清单，并驱动 Console/Web 中的 Iris 进度面板。

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
        type: "object",
        properties: {
          items: { type: "array", items: ITEM_SCHEMA, description: "要创建、更新或删除的 milestone 项。replaceAll=true 时表示完整清单；否则按 title 增量合并。" },
          replaceAll: { type: "boolean", description: "当 items 是当前任务/计划/阶段应显示的完整清单，或新任务与旧清单明显不同类时设为 true，以替换旧 milestone；仅继续更新同一批工作的一小部分时才省略。" }
        },
        required: ["items"]
      }
    },
    handler: async (args, context) => {
      const service = getMilestones(api);
      const sessionId = resolveExecutionSessionId(api, context);
      const items = normalizeToolItems(args.items);
      const snapshot = service.update(sessionId, items, { replaceAll: args.replaceAll === true });
      const toolSnapshot = stripMetadataForToolResult(snapshot);
      return { ok: true, summary: formatSummary(toolSnapshot), snapshot: toolSnapshot };
    }
  };
}
function createListMilestonesTool(api) {
  return {
    approvalMode: "handler",
    parallel: true,
    declaration: {
      name: "list_milestones",
      description: "读取当前会话的 milestone/task 清单，用于检查整体进度、避免重复创建或确认下一步。",
      parameters: { type: "object", properties: {} }
    },
    handler: async (_args, context) => {
      const service = getMilestones(api);
      const sessionId = resolveExecutionSessionId(api, context);
      const snapshot = service.getSnapshot(sessionId);
      const toolSnapshot = stripMetadataForToolResult(snapshot);
      return { ok: true, summary: formatSummary(toolSnapshot), snapshot: toolSnapshot };
    }
  };
}
function wrapExitPlanMode(api, ctx) {
  const exitPlanTool = ctx.getToolRegistry().get?.("ExitPlanMode");
  if (!exitPlanTool)
    return;
  const original = exitPlanTool.handler;
  const wrapped = async (args, context) => {
    const result = await original(args, context);
    try {
      const record = result && typeof result === "object" ? result : undefined;
      const approvedPlan = typeof record?.approvedPlan === "string" ? record.approvedPlan : undefined;
      const planFilePath = typeof record?.planFilePath === "string" ? record.planFilePath : undefined;
      if (record?.approved === true && approvedPlan) {
        const sessionId = context?.sessionId ?? api.backend.getActiveSessionId?.();
        if (sessionId) {
          const items = buildMilestonesFromApprovedPlan(approvedPlan, { planFilePath });
          getMilestones(api).update(sessionId, items, { replaceAll: true });
        }
      }
    } catch (err) {
      logger.warn("Plan Mode milestone 同步失败:", err);
    }
    return result;
  };
  exitPlanTool.handler = wrapped;
  ctx.trackDisposable({ dispose: () => {
    if (exitPlanTool.handler === wrapped)
      exitPlanTool.handler = original;
  } });
}
function resolveExecutionSessionIdForTool(api, rawSessionId) {
  const crossAgentTaskId = parseCrossAgentTaskId(rawSessionId);
  if (crossAgentTaskId && api.taskBoard?.get) {
    const task = api.taskBoard.get(crossAgentTaskId);
    if (task?.type === "delegate")
      return task.sourceSessionId;
  }
  return rawSessionId;
}
function observeToolFailures(api, ctx) {
  const listener = (_sessionId, handle) => {
    const initial = handle.getSnapshot();
    if (MILESTONE_TOOL_SYNC_IGNORED.has(initial.toolName))
      return;
    if (initial.parentToolId || (initial.depth ?? 0) > 0)
      return;
    const done = (_result, error) => {
      const snapshot = handle.getSnapshot();
      if (snapshot.status !== "error")
        return;
      const service = getMilestones(api);
      if (!service?.noteActiveToolFailure)
        return;
      const sessionId = resolveExecutionSessionIdForTool(api, snapshot.sessionId ?? _sessionId);
      service.noteActiveToolFailure(sessionId, {
        toolId: snapshot.id,
        toolName: snapshot.toolName,
        error: snapshot.error ?? error ?? "未知错误"
      });
    };
    handle.on("done", done);
  };
  api.backend.on("tool:execute", listener);
  ctx.trackDisposable({ dispose: () => api.backend.off("tool:execute", listener) });
}
function createMilestoneToolsForApi(api) {
  return [createUpdateMilestonesTool(api), createListMilestonesTool(api)];
}
var milestonePlugin = definePlugin({
  name: "milestone",
  version: "0.1.0",
  description: "结构化里程碑 / Iris 进度扩展",
  activate(ctx) {
    ctx.onReady((api) => {
      const existing = api.services.get(MILESTONE_EXTENSION_SERVICE_ID);
      const service = existing ?? createMilestoneServiceForApi(api);
      if (!existing) {
        ctx.trackDisposable(api.services.register(MILESTONE_EXTENSION_SERVICE_ID, service, {
          description: "Structured milestone/task progress service",
          version: "1.0.0"
        }));
      }
      api.config.tools ??= {};
      (api.config.tools.permissions ??= {}).update_milestones ??= { autoApprove: true };
      (api.config.tools.permissions ??= {}).list_milestones ??= { autoApprove: true };
      ctx.registerTools(createMilestoneToolsForApi(api));
      wrapExitPlanMode(api, ctx);
      observeToolFailures(api, ctx);
    });
    ctx.onPlatformsReady((_platforms, api) => {
      const service = api.services.get(MILESTONE_EXTENSION_SERVICE_ID);
      const consoleProgress = api.services.get(CONSOLE_PROGRESS_SERVICE_ID);
      if (!service || !consoleProgress)
        return;
      ctx.trackDisposable(consoleProgress.register({
        id: "milestone",
        priority: 100,
        loadLatest: (sessionId) => service.loadLatest(sessionId),
        loadHistory: (sessionId) => service.loadArchives(sessionId),
        loadUiState: (sessionId) => service.loadUiState(sessionId),
        saveUiState: (sessionId, state) => service.setUiState(sessionId, state),
        onDidUpdate: (listener) => service.onDidUpdate(listener)
      }));
    });
  }
});
var src_default = milestonePlugin;
export {
  milestonePlugin,
  extractPlanMilestoneCandidates,
  src_default as default,
  createMilestoneToolsForApi,
  createMilestoneServiceForApi,
  buildMilestonesFromApprovedPlan,
  MILESTONE_EXTENSION_SERVICE_ID
};
