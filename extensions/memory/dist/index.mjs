var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/utils/age.ts
function memoryAge(updatedAtSec) {
  const now = Date.now();
  const updatedMs = updatedAtSec * 1000;
  const diffMs = now - updatedMs;
  if (diffMs < 0)
    return "just now";
  const diffDays = Math.floor(diffMs / DAY_MS);
  if (diffDays === 0)
    return "today";
  if (diffDays === 1)
    return "yesterday";
  if (diffDays < 7)
    return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(diffDays / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
function memoryFreshnessText(updatedAtSec) {
  const diffMs = Date.now() - updatedAtSec * 1000;
  const diffDays = Math.floor(diffMs / DAY_MS);
  if (diffDays <= 1)
    return;
  return `This memory is ${memoryAge(updatedAtSec)} old. Claims about code behavior may be outdated.`;
}
function memoryFreshnessNote(updatedAtSec) {
  const text = memoryFreshnessText(updatedAtSec);
  if (!text)
    return;
  return `[Note: ${text}]`;
}
var DAY_MS = 86400000;

// src/types.ts
function parseMemoryType(raw) {
  if (typeof raw !== "string")
    return;
  return MEMORY_TYPES.find((t) => t === raw);
}
var MEMORY_TYPES;
var init_types = __esm(() => {
  MEMORY_TYPES = ["user", "feedback", "project", "reference"];
});

// src/utils/manifest.ts
function formatManifest(entries) {
  if (entries.length === 0)
    return "(no memories stored)";
  const lines = entries.map((m) => {
    const desc = m.description ? ` — ${m.description}` : "";
    return `  #${m.id} [${m.type}] ${m.name}${desc} (${m.age})`;
  });
  return `Memory manifest (${entries.length} entries):
${lines.join(`
`)}`;
}
function formatManifestCompact(entries) {
  if (entries.length === 0)
    return "(no memories)";
  const header = "id | type | name | description | age";
  const rows = entries.map((m) => `${m.id} | ${m.type} | ${m.name} | ${m.description || "-"} | ${m.age}`);
  return [header, ...rows].join(`
`);
}

// src/prompts/session-notes.ts
function buildSessionNotesPrompt(conversationText, existingNotes) {
  const template = SESSION_NOTE_SECTIONS.map((s) => `## ${s}
`).join(`
`);
  return `You are the session memory agent. Extract structured notes from the conversation to preserve context continuity.

${existingNotes ? `## Existing session notes

${existingNotes}

Update these notes with new information from the conversation below.
` : ""}

## Conversation

${conversationText}

## Instructions

Produce session notes following this template. Each section should be concise (max ~200 words). Only include sections that have relevant content — skip empty sections.

${template}

### Section guidelines:
- **Session Title**: One-line description of the overall session goal
- **Current State**: What was accomplished, what's pending, any blockers
- **Task Specification**: The user's original request and key requirements
- **Files and Functions**: Important files/functions referenced or modified
- **Workflow**: Steps taken, approaches tried, decision points
- **Errors and Corrections**: Mistakes made, how they were fixed, things to avoid
- **Codebase Documentation**: Non-obvious patterns or architecture discovered
- **Learnings**: Technical insights or domain knowledge gained
- **Key Results**: Concrete outputs (commits, files created, configs changed)
- **Worklog**: Chronological summary of major actions

Output ONLY the structured notes, no preamble.`;
}
var SESSION_NOTE_SECTIONS;
var init_session_notes = __esm(() => {
  SESSION_NOTE_SECTIONS = [
    "Session Title",
    "Current State",
    "Task Specification",
    "Files and Functions",
    "Workflow",
    "Errors and Corrections",
    "Codebase Documentation",
    "Learnings",
    "Key Results",
    "Worklog"
  ];
});

// src/session-memory.ts
var exports_session_memory = {};
__export(exports_session_memory, {
  updateTokenTracking: () => updateTokenTracking,
  shouldExtractSessionMemory: () => shouldExtractSessionMemory,
  getSessionNotesForCompact: () => getSessionNotesForCompact,
  extractSessionNotes: () => extractSessionNotes,
  clearSessionTracking: () => clearSessionTracking
});
function shouldExtractSessionMemory(sessionId, currentTokens) {
  const lastTokens = lastExtractTokens.get(sessionId) ?? 0;
  if (lastTokens === 0) {
    return currentTokens >= INITIAL_TOKEN_THRESHOLD;
  }
  return currentTokens - lastTokens >= UPDATE_TOKEN_DELTA;
}
async function extractSessionNotes(ctx) {
  const { api, provider, sessionId, logger } = ctx;
  const history = await api.storage.getHistory(sessionId);
  if (!history || history.length < 4)
    return;
  const recentCount = Math.min(history.length, 30);
  const recentMessages = history.slice(-recentCount);
  const conversationText = recentMessages.map((msg) => {
    const role = msg.role === "user" ? "User" : "Assistant";
    const text = msg.parts?.filter((p) => p.text).map((p) => p.text).join(`
`) ?? "";
    if (!text)
      return "";
    const truncated = text.length > 1500 ? text.slice(0, 1500) + "..." : text;
    return `${role}: ${truncated}`;
  }).filter(Boolean).join(`

`);
  if (!conversationText.trim())
    return;
  const existingNotes = provider.getSessionNotes(sessionId) || "";
  const prompt = buildSessionNotesPrompt(conversationText, existingNotes);
  try {
    const response = await api.router.chat({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: "You are a session memory agent. Extract structured notes that capture the essential context of the conversation. Be concise and factual." }]
      },
      generationConfig: {
        maxOutputTokens: 2000
      }
    });
    const content = response.content ?? response;
    const notesText = content.parts?.filter((p) => p.text).map((p) => p.text).join(`
`) ?? "";
    if (notesText.trim()) {
      const truncated = notesText.length > 48000 ? notesText.slice(0, 48000) : notesText;
      provider.saveSessionNotes(sessionId, truncated);
      logger.info(`会话笔记已更新 (session=${sessionId}, ${truncated.length} chars)`);
    }
  } catch (err) {
    logger.warn("会话笔记提取失败:", err);
  }
}
function getSessionNotesForCompact(provider, sessionId) {
  const notes = provider.getSessionNotes(sessionId);
  if (!notes)
    return;
  return `
## Session Context (from previous conversation)

${notes}`;
}
function updateTokenTracking(sessionId, currentTokens) {
  lastExtractTokens.set(sessionId, currentTokens);
}
function clearSessionTracking(sessionId) {
  lastExtractTokens.delete(sessionId);
}
var INITIAL_TOKEN_THRESHOLD = 1e4, UPDATE_TOKEN_DELTA = 5000, lastExtractTokens;
var init_session_memory = __esm(() => {
  init_session_notes();
  lastExtractTokens = new Map;
});

// src/prompts/extract.ts
function buildExtractionPrompt(recentMessages, existingManifest, messageCount) {
  return `You are the memory extraction agent. Analyze the conversation below and extract durable information worth remembering across future conversations.

## Existing memories

${existingManifest || "(no memories yet)"}

Check this list before saving — update an existing memory (via memory_update) rather than creating a duplicate.

## Instructions

1. Analyze the last ~${messageCount} messages for information worth persisting
2. Save memories using the memory_add or memory_update tools
3. Each memory must have: name, description, type, and content
4. Types: user (profile/preferences), feedback (behavioral guidance), project (context/decisions), reference (external pointers)

## What to extract

- User preferences, role, expertise level
- Behavioral guidance ("do this", "don't do that") — including confirmations of successful approaches
- Project decisions, deadlines, constraints with motivation
- External resource pointers (URLs, project trackers, channels)
- For feedback/project types, include **Why:** and **How to apply:** lines in content

## What NOT to extract

- Code patterns, architecture, file paths — derivable from reading code
- Git history, recent changes — use git log
- Debugging solutions — the fix is in the code
- Ephemeral task details, current conversation state
- Information already captured in existing memories (update instead)

## Recent conversation

${recentMessages}

Now extract any durable memories from this conversation. If nothing is worth saving, respond with "No new memories to extract." and do not call any tools.`;
}

// src/extract.ts
var exports_extract = {};
__export(exports_extract, {
  runMemoryExtraction: () => runMemoryExtraction
});
async function runMemoryExtraction(ctx) {
  const { api, provider, sessionId, logger } = ctx;
  const history = await api.storage.getHistory(sessionId);
  if (!history || history.length < 2)
    return 0;
  const recentCount = Math.min(history.length, 20);
  const recentMessages = history.slice(-recentCount);
  const conversationText = recentMessages.map((msg) => {
    const role = msg.role === "user" ? "User" : "Assistant";
    const text = extractTextFromParts(msg.parts);
    if (!text)
      return "";
    const truncated = text.length > 2000 ? text.slice(0, 2000) + "..." : text;
    return `${role}: ${truncated}`;
  }).filter(Boolean).join(`

`);
  if (!conversationText.trim())
    return 0;
  const manifest = await provider.buildManifest();
  const manifestText = formatManifestCompact(manifest);
  const extractionPrompt = buildExtractionPrompt(conversationText, manifestText, recentCount);
  const toolDeclarations = [
    {
      name: "memory_add",
      description: "Save a new memory",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Memory content" },
          name: { type: "string", description: "Short identifier" },
          description: { type: "string", description: "One-line description" },
          type: { type: "string", enum: ["user", "feedback", "project", "reference"] }
        },
        required: ["content", "name", "type"]
      }
    },
    {
      name: "memory_update",
      description: "Update an existing memory",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Memory ID to update" },
          content: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          type: { type: "string", enum: ["user", "feedback", "project", "reference"] }
        },
        required: ["id"]
      }
    }
  ];
  try {
    const response = await api.router.chat({
      contents: [
        { role: "user", parts: [{ text: extractionPrompt }] }
      ],
      tools: [{ functionDeclarations: toolDeclarations }],
      systemInstruction: {
        parts: [{ text: "You are a memory extraction agent. Analyze conversations and extract durable memories using the provided tools. Be selective — only save information that will be useful in future conversations." }]
      }
    });
    const responseContent = response.content ?? response;
    const parts = responseContent.parts ?? [];
    let savedCount = 0;
    for (const part of parts) {
      if (!part.functionCall)
        continue;
      const { name: toolName, args } = part.functionCall;
      if (!args)
        continue;
      try {
        if (toolName === "memory_add") {
          const content = args.content;
          if (typeof content !== "string" || !content.trim())
            continue;
          await provider.add({
            content,
            name: args.name || "",
            description: args.description || "",
            type: parseMemoryType(args.type) ?? "reference"
          });
          savedCount++;
        } else if (toolName === "memory_update") {
          const rawId = args.id;
          const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
          if (!Number.isFinite(id))
            continue;
          const ok = await provider.update({
            id,
            content: args.content,
            name: args.name,
            description: args.description,
            type: parseMemoryType(args.type)
          });
          if (ok)
            savedCount++;
        }
      } catch (err) {
        logger.warn(`提取记忆工具调用失败 (${toolName}):`, err);
      }
    }
    if (savedCount > 0) {
      logger.info(`自动提取完成: ${savedCount} 条记忆已保存/更新 (session=${sessionId})`);
    }
    return savedCount;
  } catch (err) {
    logger.warn("自动提取 LLM 调用失败:", err);
    return 0;
  }
}
function extractTextFromParts(parts) {
  if (!parts)
    return "";
  return parts.filter((p) => p.text).map((p) => p.text).join(`
`);
}
var init_extract = __esm(() => {
  init_types();
});

// src/prompts/consolidation.ts
function buildConsolidationPrompt(manifestText, memoryDetails) {
  return `You are the memory consolidation agent. Your job is to review all existing memories and improve their organization.

## Current memories

${manifestText}

## Full memory contents

${memoryDetails}

## Instructions

Perform the following steps:

### 1. Orient
Review all existing memories. Identify:
- Duplicate or near-duplicate entries
- Outdated entries that are no longer relevant
- Entries that could be merged for clarity
- Entries with missing or poor name/description/type

### 2. Consolidate
For each issue found:
- **Merge duplicates**: Use memory_update on the better entry, memory_delete on the redundant one
- **Update stale info**: Use memory_update to correct or add context
- **Fix metadata**: Use memory_update to improve name/description/type fields
- **Remove obsolete**: Use memory_delete for entries that are clearly outdated

### 3. Prune
- Delete memories about ephemeral tasks that are clearly completed
- Delete memories whose information is now derivable from code (architecture decisions that became established patterns)
- Keep memories about user preferences, behavioral guidance, and active project context

### Rules
- Be conservative: when in doubt, keep the memory
- Prefer updating over deleting
- Preserve the user's voice: don't rewrite feedback memories in your own words
- Maintain backward compatibility: don't change memory types without good reason
- Maximum operations: 20 (to prevent runaway consolidation)

Now analyze and consolidate. If everything looks good and no changes are needed, respond with "No consolidation needed." without calling any tools.`;
}

// src/consolidation.ts
var exports_consolidation = {};
__export(exports_consolidation, {
  maybeRunConsolidation: () => maybeRunConsolidation,
  forceRunConsolidation: () => forceRunConsolidation
});
async function maybeRunConsolidation(ctx) {
  const { provider, config, logger } = ctx;
  if (!config.consolidation.enabled)
    return;
  const meta = provider.getConsolidationMeta();
  const hoursSinceLastRun = (Date.now() / 1000 - meta.lastRun) / 3600;
  if (hoursSinceLastRun < config.consolidation.minHours)
    return;
  try {
    const sessionMetas = await ctx.api.storage.listSessionMetas?.();
    if (sessionMetas && Array.isArray(sessionMetas)) {
      const lastRunMs = meta.lastRun * 1000;
      const newSessionCount = sessionMetas.filter((m) => m.createdAt && new Date(m.createdAt).getTime() > lastRunMs).length;
      if (newSessionCount < config.consolidation.minSessions)
        return;
    }
  } catch {}
  const memoryCount = await provider.count();
  if (memoryCount < 5)
    return;
  const pid = process.pid;
  if (!provider.acquireConsolidationLock(pid)) {
    logger.info("归纳锁被占用，跳过");
    return;
  }
  let success = false;
  try {
    await runConsolidation(ctx);
    success = true;
  } catch (err) {
    logger.warn("归纳执行失败:", err);
  } finally {
    provider.releaseConsolidationLock(success);
  }
}
async function forceRunConsolidation(ctx) {
  const { provider, logger } = ctx;
  const memoryCount = await provider.count();
  if (memoryCount < 2) {
    return { ok: false, message: `记忆条数过少（${memoryCount} 条），无需整理。`, opCount: 0 };
  }
  const pid = process.pid;
  if (!provider.acquireConsolidationLock(pid)) {
    return { ok: false, message: "另一个归纳正在进行，请稍后再试。", opCount: 0 };
  }
  let success = false;
  try {
    const opCount = await runConsolidation(ctx);
    success = true;
    const message = opCount > 0 ? `归纳完成，执行了 ${opCount} 个操作（合并 / 删除 / 更新元数据）。` : "所有记忆状态良好，无需变更。";
    return { ok: true, message, opCount };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn("手动归纳失败:", err);
    return { ok: false, message: `归纳失败: ${errMsg}`, opCount: 0 };
  } finally {
    provider.releaseConsolidationLock(success);
  }
}
async function runConsolidation(ctx) {
  const { api, provider, logger } = ctx;
  const memories = await provider.list(undefined, 500);
  if (memories.length === 0)
    return;
  const manifestEntries = memories.map((m) => ({
    id: m.id,
    name: m.name || `memory_${m.id}`,
    description: m.description || m.content.slice(0, 80),
    type: m.type,
    age: memoryAge(m.updatedAt),
    updatedAt: m.updatedAt
  }));
  const manifestText = formatManifestCompact(manifestEntries);
  const memoryDetails = memories.map((m) => {
    const age = memoryAge(m.updatedAt);
    return `### #${m.id} [${m.type}] ${m.name || "(unnamed)"} (${age})
${m.content}`;
  }).join(`

`);
  const MAX_PROMPT_CHARS = 80000;
  let truncatedDetails = memoryDetails;
  if (manifestText.length + memoryDetails.length > MAX_PROMPT_CHARS) {
    const available = MAX_PROMPT_CHARS - manifestText.length - 2000;
    if (available <= 0) {
      logger.warn(`记忆清单过大 (${manifestText.length} chars)，跳过归纳`);
      return;
    }
    truncatedDetails = memoryDetails.slice(0, available);
    const lastEntry = truncatedDetails.lastIndexOf(`

### `);
    if (lastEntry > 0)
      truncatedDetails = truncatedDetails.slice(0, lastEntry);
    truncatedDetails += `

(... remaining memories truncated due to size limit)`;
    logger.info(`归纳 prompt 已截断: ${memoryDetails.length} → ${truncatedDetails.length} chars`);
  }
  const prompt = buildConsolidationPrompt(manifestText, truncatedDetails);
  const toolDeclarations = [
    {
      name: "memory_update",
      description: "Update an existing memory",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          content: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          type: { type: "string", enum: ["user", "feedback", "project", "reference"] }
        },
        required: ["id"]
      }
    },
    {
      name: "memory_delete",
      description: "Delete a memory",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" }
        },
        required: ["id"]
      }
    }
  ];
  const response = await api.router.chat({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ functionDeclarations: toolDeclarations }],
    systemInstruction: {
      parts: [{ text: "You are a memory consolidation agent. Review and organize memories using the provided tools. Be conservative — prefer updating over deleting." }]
    }
  });
  const content = response.content ?? response;
  const parts = content.parts ?? [];
  let opCount = 0;
  for (const part of parts) {
    if (!part.functionCall || opCount >= 20)
      continue;
    const { name: toolName, args } = part.functionCall;
    if (!args)
      continue;
    const rawId = args.id;
    const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
    if (!Number.isFinite(id))
      continue;
    try {
      if (toolName === "memory_update") {
        const ok = await provider.update({
          id,
          content: args.content,
          name: args.name,
          description: args.description,
          type: parseMemoryType(args.type)
        });
        if (ok)
          opCount++;
      } else if (toolName === "memory_delete") {
        const ok = await provider.delete(id);
        if (ok)
          opCount++;
      }
    } catch (err) {
      logger.warn(`归纳工具调用失败 (${toolName} #${id}):`, err);
    }
  }
  if (opCount > 0) {
    logger.info(`归纳完成: ${opCount} 个操作已执行`);
  } else {
    logger.info("归纳完成: 无需变更");
  }
  return opCount;
}
var init_consolidation = __esm(() => {
  init_types();
});

// src/index.ts
import * as path2 from "path";
// ../../packages/extension-sdk/dist/logger.js
function print(level, scope, args) {
  const consoleMethod = console[level] ?? console.log;
  consoleMethod(`[${scope}]`, ...args);
}
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    info: (...args) => print("log", scope, args),
    warn: (...args) => print("warn", scope, args),
    error: (...args) => print("error", scope, args),
    debug: (...args) => print("debug", scope, args)
  };
}

// ../../packages/extension-sdk/dist/plugin/context.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/sqlite/index.ts
import * as fs from "fs";
import * as path from "path";

// src/base.ts
class MemoryProvider {
  async buildManifest(limit = 200) {
    const entries = await this.list(undefined, limit);
    return entries.map((m) => ({
      id: m.id,
      name: m.name || `memory_${m.id}`,
      description: m.description || m.content.slice(0, 80),
      type: m.type,
      age: memoryAge(m.updatedAt),
      updatedAt: m.updatedAt
    }));
  }
  async buildContext(userText, limit = 5) {
    if (!userText)
      return;
    const memories = await this.search(userText, limit);
    if (memories.length === 0)
      return;
    const lines = memories.map((m) => {
      const header = m.name ? `**${m.name}** [${m.type}]` : `[${m.type}]`;
      const freshness = memoryFreshnessNote(m.updatedAt);
      const freshnessLine = freshness ? `
  ${freshness}` : "";
      return `- ${header}: ${m.content}${freshnessLine}`;
    }).join(`
`);
    return `

## Long-term Memory
The following memories may be relevant to the current conversation:
${lines}`;
  }
}

// src/sqlite/index.ts
init_types();
var CURRENT_VERSION = 2;
function createEmptyStore() {
  return {
    version: CURRENT_VERSION,
    nextId: 1,
    memories: [],
    consolidationMeta: { lastRun: 0, pid: null, lockedAt: null },
    sessionNotes: {}
  };
}

class MemoryStore extends MemoryProvider {
  logger;
  data;
  filePath;
  constructor(filePath, logger) {
    super();
    this.logger = logger;
    const resolved = path.resolve(filePath);
    this.filePath = resolved;
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.data = this.load();
    this.logger?.info(`记忆存储已初始化: ${filePath} (${this.data.memories.length} 条)`);
  }
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        return this.migrate(parsed);
      }
    } catch (err) {
      this.logger?.warn("读取记忆文件失败，将使用空数据:", err);
    }
    return createEmptyStore();
  }
  save() {
    const json = JSON.stringify(this.data, null, 2);
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, json, "utf-8");
    fs.renameSync(tmp, this.filePath);
  }
  migrate(raw) {
    const data = { ...createEmptyStore(), ...raw };
    if (!Array.isArray(data.memories))
      data.memories = [];
    if (!data.consolidationMeta)
      data.consolidationMeta = { lastRun: 0, pid: null, lockedAt: null };
    if (!data.sessionNotes)
      data.sessionNotes = {};
    if (data.memories.length > 0) {
      const maxId = Math.max(...data.memories.map((m) => m.id));
      if (maxId >= data.nextId)
        data.nextId = maxId + 1;
    }
    data.version = CURRENT_VERSION;
    return data;
  }
  async add(input) {
    const now = Math.floor(Date.now() / 1000);
    const type = input.type ?? (input.category ? mapCategoryToType(input.category) : "reference");
    const id = this.data.nextId++;
    this.data.memories.push({
      id,
      content: input.content,
      name: input.name ?? "",
      description: input.description ?? "",
      type,
      category: input.category ?? type,
      createdAt: now,
      updatedAt: now
    });
    this.save();
    this.logger?.info(`添加记忆 #${id} [${type}] ${input.name || "(unnamed)"}`);
    return id;
  }
  async update(input) {
    const idx = this.data.memories.findIndex((m) => m.id === input.id);
    if (idx === -1)
      return false;
    const existing = this.data.memories[idx];
    existing.content = input.content ?? existing.content;
    existing.name = input.name ?? existing.name;
    existing.description = input.description ?? existing.description;
    existing.type = input.type ?? existing.type;
    existing.updatedAt = Math.floor(Date.now() / 1000);
    this.save();
    this.logger?.info(`更新记忆 #${input.id} [${existing.type}] ${existing.name || "(unnamed)"}`);
    return true;
  }
  async search(query, limit = 5) {
    const tokens = query.toLowerCase().split(/[\s,.;:!?，。；：！？\-_/\\|]+/).filter((w) => w.length > 1);
    if (tokens.length === 0)
      return [];
    const scored = [];
    for (const m of this.data.memories) {
      const haystack = `${m.name} ${m.description} ${m.content}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (haystack.includes(t))
          score++;
      }
      if (score > 0)
        scored.push({ entry: m, score });
    }
    scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);
    return scored.slice(0, limit).map((s) => toMemoryEntry(s.entry));
  }
  async getByIds(ids) {
    if (ids.length === 0)
      return [];
    const idSet = new Set(ids);
    return this.data.memories.filter((m) => idSet.has(m.id)).map(toMemoryEntry);
  }
  async list(type, limit = 200) {
    let items = this.data.memories;
    if (type) {
      items = items.filter((m) => m.type === type);
    }
    const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted.slice(0, limit).map(toMemoryEntry);
  }
  async count() {
    return this.data.memories.length;
  }
  async delete(id) {
    const idx = this.data.memories.findIndex((m) => m.id === id);
    if (idx === -1)
      return false;
    this.data.memories.splice(idx, 1);
    this.save();
    this.logger?.info(`删除记忆 #${id}`);
    return true;
  }
  async clear() {
    this.data.memories = [];
    this.save();
    this.logger?.info("已清空所有记忆");
  }
  getConsolidationMeta() {
    return { ...this.data.consolidationMeta };
  }
  acquireConsolidationLock(pid) {
    const now = Math.floor(Date.now() / 1000);
    const LOCK_EXPIRY = 3600;
    const meta = this.data.consolidationMeta;
    if (meta.lockedAt !== null && now - meta.lockedAt < LOCK_EXPIRY) {
      return false;
    }
    meta.pid = pid;
    meta.lockedAt = now;
    this.save();
    return true;
  }
  releaseConsolidationLock(success = true) {
    const meta = this.data.consolidationMeta;
    meta.pid = null;
    meta.lockedAt = null;
    if (success) {
      meta.lastRun = Math.floor(Date.now() / 1000);
    }
    this.save();
  }
  getSessionNotes(sessionId) {
    return this.data.sessionNotes[sessionId]?.notes || undefined;
  }
  saveSessionNotes(sessionId, notes) {
    this.data.sessionNotes[sessionId] = {
      notes,
      updatedAt: Math.floor(Date.now() / 1000)
    };
    this.save();
  }
}
function toMemoryEntry(m) {
  return {
    id: m.id,
    content: m.content,
    name: m.name || "",
    description: m.description || "",
    type: parseMemoryType(m.type) ?? "reference",
    category: m.category || m.type,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt
  };
}
function mapCategoryToType(category) {
  switch (category) {
    case "user":
      return "user";
    case "preference":
      return "feedback";
    case "fact":
      return "project";
    default:
      return "reference";
  }
}

// src/tools.ts
init_types();
var MEMORY_TOOL_NAMES = new Set([
  "memory_search",
  "memory_add",
  "memory_update",
  "memory_delete"
]);
function createMemoryTools(provider) {
  const memorySearch = {
    parallel: true,
    declaration: {
      name: "memory_search",
      description: "Search long-term memory for relevant information. Use when you need to recall user preferences, past decisions, project context, or previously saved knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords or natural language query" },
          type: {
            type: "string",
            description: "Filter by memory type",
            enum: [...MEMORY_TYPES]
          },
          limit: { type: "number", description: "Max results (default 10)" }
        },
        required: ["query"]
      }
    },
    handler: async (args) => {
      const query = args.query;
      const typeFilter = parseMemoryType(args.type);
      const requestLimit = args.limit || 10;
      const fetchLimit = typeFilter ? requestLimit * 3 : requestLimit;
      const results = await provider.search(query, fetchLimit);
      const filtered = typeFilter ? results.filter((m) => m.type === typeFilter).slice(0, requestLimit) : results.slice(0, requestLimit);
      if (filtered.length === 0) {
        return { message: "No relevant memories found.", results: [] };
      }
      return {
        message: `Found ${filtered.length} relevant memories.`,
        results: filtered.map((m) => ({
          id: m.id,
          name: m.name || undefined,
          type: m.type,
          content: m.content,
          age: memoryAge(m.updatedAt)
        }))
      };
    }
  };
  const memoryAdd = {
    declaration: {
      name: "memory_add",
      description: [
        "Save important information to long-term memory for cross-session persistence.",
        "Use for: user preferences/profile (type=user), behavioral guidance (type=feedback),",
        "project context/decisions (type=project), external references (type=reference).",
        "Before adding, search existing memories to avoid duplicates — update instead if a related memory exists."
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Memory content (the actual information to remember)" },
          name: { type: "string", description: 'Short identifier (e.g. "user_role", "feedback_testing"). Used for indexing.' },
          description: { type: "string", description: "One-line description — used for relevance matching in future conversations" },
          type: {
            type: "string",
            description: "Memory type: user (profile/preferences), feedback (behavioral guidance), project (context/decisions), reference (external pointers)",
            enum: [...MEMORY_TYPES]
          }
        },
        required: ["content"]
      }
    },
    handler: async (args) => {
      const content = args.content;
      const name = args.name || "";
      const description = args.description || "";
      const type = parseMemoryType(args.type) ?? "reference";
      const id = await provider.add({ content, name, description, type });
      return { message: "Memory saved.", id, name, type };
    }
  };
  const memoryUpdate = {
    declaration: {
      name: "memory_update",
      description: "Update an existing memory. Use when information has changed or needs correction. Prefer updating over creating duplicates.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Memory ID to update" },
          content: { type: "string", description: "New content (omit to keep current)" },
          name: { type: "string", description: "New name (omit to keep current)" },
          description: { type: "string", description: "New description (omit to keep current)" },
          type: {
            type: "string",
            description: "New type (omit to keep current)",
            enum: [...MEMORY_TYPES]
          }
        },
        required: ["id"]
      }
    },
    handler: async (args) => {
      const id = args.id;
      const input = { id };
      if (args.content !== undefined)
        input.content = args.content;
      if (args.name !== undefined)
        input.name = args.name;
      if (args.description !== undefined)
        input.description = args.description;
      if (args.type !== undefined)
        input.type = parseMemoryType(args.type);
      const success = await provider.update(input);
      return success ? { message: `Memory #${id} updated.` } : { message: `Memory #${id} not found.` };
    }
  };
  const memoryDelete = {
    declaration: {
      name: "memory_delete",
      description: "Delete a memory that is no longer relevant or accurate.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Memory ID to delete" }
        },
        required: ["id"]
      }
    },
    handler: async (args) => {
      const id = args.id;
      const success = await provider.delete(id);
      return success ? { message: `Memory #${id} deleted.` } : { message: `Memory #${id} not found.` };
    }
  };
  return [memorySearch, memoryAdd, memoryUpdate, memoryDelete];
}

// src/config-template.ts
var DEFAULT_CONFIG_TEMPLATE = `# 记忆插件配置
#
# 启用后，LLM 可通过 memory_search / memory_add / memory_update / memory_delete 工具
# 读写长期记忆，实现跨会话的信息持久化。
#
# 存储后端：SQLite + FTS5 全文检索
# 数据库文件默认存放在数据目录下的 memory.db

# 是否启用记忆
enabled: false

# 数据库路径（相对于数据目录，或绝对路径）
# dbPath: ./memory.db

# ── 自动提取（对话结束后自动从对话中提取值得记住的信息）──
autoExtract: true
# 每 N 轮对话后提取一次
extractInterval: 1

# ── 智能检索（每轮对话前自动注入相关记忆到上下文）──
autoRecall: true
# 每轮注入记忆的最大大小（KB）
maxContextBytes: 20480
# 会话级记忆注入总上限（KB）
sessionBudgetBytes: 61440

# ── 跨会话归纳（定期整理合并冗余记忆）──
consolidation:
  enabled: true
  # 两次归纳之间的最小间隔（小时）
  minHours: 24
  # 触发归纳的最少新会话数
  minSessions: 3
`;

// src/config.ts
var DEFAULT_CONFIG = {
  enabled: false,
  autoExtract: true,
  extractInterval: 1,
  autoRecall: true,
  maxContextBytes: 20480,
  sessionBudgetBytes: 61440,
  consolidation: {
    enabled: true,
    minHours: 24,
    minSessions: 3
  }
};
function resolveConfig(rawSection, pluginConfig) {
  const source = rawSection ?? pluginConfig ?? {};
  const consolidationRaw = source.consolidation ?? {};
  return {
    enabled: toBool(source.enabled, DEFAULT_CONFIG.enabled),
    dbPath: source.dbPath,
    autoExtract: toBool(source.autoExtract, DEFAULT_CONFIG.autoExtract),
    extractInterval: toNum(source.extractInterval, DEFAULT_CONFIG.extractInterval),
    autoRecall: toBool(source.autoRecall, DEFAULT_CONFIG.autoRecall),
    maxContextBytes: toNum(source.maxContextBytes, DEFAULT_CONFIG.maxContextBytes),
    sessionBudgetBytes: toNum(source.sessionBudgetBytes, DEFAULT_CONFIG.sessionBudgetBytes),
    consolidation: {
      enabled: toBool(consolidationRaw.enabled, DEFAULT_CONFIG.consolidation.enabled),
      minHours: toNum(consolidationRaw.minHours, DEFAULT_CONFIG.consolidation.minHours),
      minSessions: toNum(consolidationRaw.minSessions, DEFAULT_CONFIG.consolidation.minSessions)
    }
  };
}
function toBool(val, def) {
  if (typeof val === "boolean")
    return val;
  return def;
}
function toNum(val, def) {
  if (typeof val === "number" && !isNaN(val))
    return val;
  return def;
}

// src/prompts/system-rules.ts
function buildMemorySystemRules(memoryCount) {
  return `
# Long-term Memory

You have a persistent memory system that stores information across conversations. There are currently ${memoryCount} memories stored.

## Available tools

- **memory_search**: Search memories by keyword or natural language query
- **memory_add**: Save new information to memory
- **memory_update**: Update an existing memory (prefer this over creating duplicates)
- **memory_delete**: Remove outdated or incorrect memories

## Types of memory

There are four discrete types of memory:

<types>
<type>
    <name>user</name>
    <description>Information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your behavior to the user's preferences. Avoid writing memories that could be viewed as negative judgement.</description>
    <when_to_save>When you learn details about the user's role, preferences, responsibilities, or knowledge</when_to_save>
    <how_to_use>When your work should be informed by the user's profile or perspective.</how_to_use>
    <examples>
    user: I'm a data scientist investigating what logging we have in place
    assistant: [saves user memory: user is a data scientist, currently focused on observability/logging]
    </examples>
</type>
<type>
    <name>feedback</name>
    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing. Record from failure AND success: if you only save corrections, you may grow overly cautious.</description>
    <when_to_save>When the user corrects your approach OR confirms a non-obvious approach worked. Include *why* so you can judge edge cases later.</when_to_save>
    <how_to_use>Let these memories guide your behavior so the user doesn't need to repeat guidance.</how_to_use>
    <body_structure>Lead with the rule, then **Why:** and **How to apply:** lines.</body_structure>
    <examples>
    user: don't mock the database in these tests — we got burned when mocked tests passed but prod migration failed
    assistant: [saves feedback memory: integration tests must hit a real database, not mocks]
    </examples>
</type>
<type>
    <name>project</name>
    <description>Information about ongoing work, goals, bugs, or incidents that is NOT derivable from code or git history. Helps understand broader context and motivation.</description>
    <when_to_save>When you learn who is doing what, why, or by when. Convert relative dates to absolute dates.</when_to_save>
    <how_to_use>Understand the details behind the user's request and make better informed suggestions.</how_to_use>
    <body_structure>Lead with the fact, then **Why:** and **How to apply:** lines.</body_structure>
    <examples>
    user: we're freezing merges after Thursday — mobile team is cutting a release
    assistant: [saves project memory: merge freeze for mobile release cut]
    </examples>
</type>
<type>
    <name>reference</name>
    <description>Pointers to where information can be found in external systems (URLs, project trackers, dashboards, channels).</description>
    <when_to_save>When you learn about resources in external systems and their purpose.</when_to_save>
    <how_to_use>When the user references an external system or needs external information.</how_to_use>
    <examples>
    user: check the Linear project "INGEST" for pipeline bug context
    assistant: [saves reference memory: pipeline bugs tracked in Linear project "INGEST"]
    </examples>
</type>
</types>

## What NOT to save in memory

- Code patterns, conventions, architecture, file paths, or project structure — derivable from current project state
- Git history, recent changes, or who-changed-what — \`git log\` / \`git blame\` are authoritative
- Debugging solutions or fix recipes — the fix is in the code
- Ephemeral task details: in-progress work, temporary state, current conversation context

These exclusions apply even when the user explicitly asks you to save. If they ask you to save a summary, ask what was *surprising* or *non-obvious* — that is the part worth keeping.

## When to access memories

- When memories seem relevant, or the user references prior-conversation work
- You MUST access memory when the user explicitly asks you to check, recall, or remember
- If the user says to *ignore* or *not use* memory: do not apply, cite, or mention memory content
- Memory records can become stale. Before answering based solely on memory, verify it is still correct. If a memory conflicts with current information, trust what you observe now — and update or remove the stale memory

## Before recommending from memory

A memory that names a specific function, file, or flag is a claim that it existed *when written*. It may have been renamed or removed. Before recommending:

- If the memory names a file path: check the file exists
- If the memory names a function or flag: search for it
- If the user is about to act on your recommendation, verify first

"The memory says X exists" is not the same as "X exists now."

## How to save memories

When saving a memory with memory_add, always provide:
- **name**: Short identifier (e.g. "user_role", "feedback_testing_policy")
- **description**: One-line description that helps future relevance matching
- **type**: One of user, feedback, project, reference
- **content**: The actual information. For feedback/project types, include **Why:** and **How to apply:** lines

Before adding, use memory_search to check for existing related memories. Use memory_update to modify existing ones instead of creating duplicates.
`.trim();
}

// src/retrieval.ts
async function findAndFormatRelevantMemories(ctx) {
  const { router, provider, userText, maxBytes, surfaced, logger } = ctx;
  const manifest = await provider.buildManifest();
  if (manifest.length === 0)
    return;
  const unsurfaced = manifest.filter((m) => !surfaced.has(m.id));
  if (unsurfaced.length === 0)
    return;
  let selectedIds;
  try {
    selectedIds = await selectRelevantMemories(router, userText, unsurfaced);
  } catch (err) {
    logger?.warn("LLM 检索失败，降级到 FTS5:", err);
    const ftsResults = await provider.search(userText, 5);
    selectedIds = ftsResults.filter((m) => !surfaced.has(m.id)).map((m) => m.id);
  }
  if (selectedIds.length === 0)
    return;
  const memories = await provider.getByIds(selectedIds);
  if (memories.length === 0)
    return;
  const { text, bytes, usedIds } = formatRelevantMemories(memories, maxBytes);
  if (!text)
    return;
  return { text, bytes, ids: usedIds };
}
async function selectRelevantMemories(router, userText, manifest) {
  const manifestText = formatManifest(manifest);
  const prompt = `Given the user's message below, select the most relevant memories from the manifest. Return ONLY a JSON array of memory IDs (numbers), maximum 5 entries. If no memories are relevant, return an empty array [].

## User message
${userText}

## Available memories
${manifestText}

Respond with ONLY the JSON array, no explanation. Example: [3, 7, 12]`;
  const response = await router.chat({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: {
      parts: [{ text: "You are a memory relevance filter. Output only a JSON array of memory IDs." }]
    },
    generationConfig: {
      maxOutputTokens: 100,
      temperature: 0
    }
  });
  const content = response.content ?? response;
  const responseText = content.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";
  const match = responseText.match(/\[[\d\s,]*\]/);
  if (!match)
    return [];
  try {
    const ids = JSON.parse(match[0]);
    return ids.filter((id) => typeof id === "number").slice(0, 5);
  } catch {
    return [];
  }
}
function formatRelevantMemories(memories, maxBytes) {
  const lines = [];
  const usedIds = [];
  let totalBytes = 0;
  const header = `

## Relevant Memories
`;
  totalBytes += new TextEncoder().encode(header).length;
  for (const m of memories) {
    const age = memoryAge(m.updatedAt);
    const freshness = memoryFreshnessNote(m.updatedAt);
    const title = m.name ? `**${m.name}** [${m.type}]` : `[${m.type}]`;
    const content = m.content.length > 4096 ? m.content.slice(0, 4096) + "..." : m.content;
    let entry = `- ${title} (${age}): ${content}`;
    if (freshness)
      entry += `
  ${freshness}`;
    const entryBytes = new TextEncoder().encode(entry).length;
    if (totalBytes + entryBytes > maxBytes)
      break;
    lines.push(entry);
    usedIds.push(m.id);
    totalBytes += entryBytes;
  }
  if (lines.length === 0)
    return { text: "", bytes: 0, usedIds: [] };
  const text = header + lines.join(`
`);
  return { text, bytes: totalBytes, usedIds };
}

// src/index.ts
init_session_memory();
var logger = createPluginLogger("memory");
var activeProvider;
var cachedApi;
var currentConfig;
var autoRecallEnabled = true;
var systemRulesPart;
var sessionStates = new Map;
function getSessionState(sessionId) {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = {
      memoryInjectedThisRound: false,
      memoryWrittenThisTurn: false,
      turnsSinceLastExtract: 0,
      surfacedIds: new Set,
      bytesUsed: 0
    };
    sessionStates.set(sessionId, state);
  }
  return state;
}
var _fallbackSessionId;
function getActiveTurnSessionId() {
  return cachedApi?.backend?.getActiveSessionId?.() ?? _fallbackSessionId;
}
async function enableMemorySystem(ctx) {
  if (!cachedApi || activeProvider)
    return;
  const dataPath = currentConfig.dbPath ? path2.resolve(ctx.getConfigDir(), currentConfig.dbPath) : path2.join(cachedApi.dataDir ?? ctx.getConfigDir(), "memory.json");
  activeProvider = new MemoryStore(dataPath, logger);
  const tools = createMemoryTools(activeProvider);
  cachedApi.tools.registerAll(tools);
  cachedApi.memory = Object.assign(activeProvider, {
    dream: () => runForcedConsolidation()
  });
  const hasSubAgents = !!cachedApi.tools.get("sub_agent");
  autoRecallEnabled = !hasSubAgents;
  const count = await activeProvider.count();
  systemRulesPart = { text: buildMemorySystemRules(count) };
  ctx.addSystemPromptPart(systemRulesPart);
  logger.info(`记忆系统已启用 (${tools.length} 工具, ${count} 条记忆)`);
}
function disableMemorySystem(ctx) {
  if (!cachedApi)
    return;
  for (const name of MEMORY_TOOL_NAMES) {
    cachedApi.tools.unregister?.(name);
  }
  if (systemRulesPart) {
    ctx.removeSystemPromptPart(systemRulesPart);
    systemRulesPart = undefined;
  }
  activeProvider = undefined;
  cachedApi.memory = undefined;
  logger.info("记忆系统已禁用");
}
var src_default = definePlugin({
  name: "memory",
  version: "0.2.0",
  description: "长期记忆系统 — SQLite + FTS5 全文检索 + 自动提取 + 智能检索",
  activate(ctx) {
    ctx.ensureConfigFile("memory.yaml", DEFAULT_CONFIG_TEMPLATE);
    const rawConfig = ctx.readConfigSection("memory");
    currentConfig = resolveConfig(rawConfig, ctx.getPluginConfig());
    ctx.onReady(async (api) => {
      cachedApi = api;
      registerSettingsTab(api, ctx);
      if (currentConfig.enabled) {
        await enableMemorySystem(ctx);
      } else {
        logger.info("记忆系统未启用（可在 /settings → 记忆 中开启）");
      }
    });
    ctx.addHook({
      name: "memory:capture-user-text",
      priority: 200,
      onBeforeChat({ sessionId, text }) {
        if (!activeProvider)
          return;
        _fallbackSessionId = sessionId;
        const s = getSessionState(sessionId);
        s.lastUserText = text;
        s.memoryInjectedThisRound = false;
        s.memoryWrittenThisTurn = false;
        return;
      }
    });
    ctx.addHook({
      name: "memory:auto-recall",
      priority: 100,
      async onBeforeLLMCall({ request, round }) {
        if (!activeProvider || !cachedApi)
          return;
        const sid = getActiveTurnSessionId();
        if (!sid)
          return;
        const s = getSessionState(sid);
        if (s.memoryInjectedThisRound)
          return;
        if (round > 0)
          return;
        s.memoryInjectedThisRound = true;
        const sysInst = request.systemInstruction;
        const injectedParts = [];
        if (autoRecallEnabled && currentConfig.autoRecall && s.lastUserText) {
          try {
            const result = await findAndFormatRelevantMemories({
              router: cachedApi.router,
              provider: activeProvider,
              userText: s.lastUserText,
              maxBytes: currentConfig.maxContextBytes,
              surfaced: s.surfacedIds,
              logger
            });
            if (result) {
              if (s.bytesUsed + result.bytes <= currentConfig.sessionBudgetBytes) {
                s.bytesUsed += result.bytes;
                for (const id of result.ids)
                  s.surfacedIds.add(id);
                injectedParts.push(result.text);
              }
            }
          } catch (err) {
            logger.warn("查询记忆失败:", err);
          }
        }
        try {
          const { getSessionNotesForCompact: getSessionNotesForCompact2 } = await Promise.resolve().then(() => (init_session_memory(), exports_session_memory));
          const notes = getSessionNotesForCompact2(activeProvider, sid);
          if (notes) {
            const notesBytes = new TextEncoder().encode(notes).length;
            if (s.bytesUsed + notesBytes <= currentConfig.sessionBudgetBytes) {
              s.bytesUsed += notesBytes;
              injectedParts.push(notes);
            }
          }
        } catch {}
        if (injectedParts.length === 0)
          return;
        const existingParts = sysInst?.parts ? [...sysInst.parts] : [];
        existingParts.push({ text: injectedParts.join(`
`) });
        return {
          request: { ...request, systemInstruction: { parts: existingParts } }
        };
      }
    });
    ctx.addHook({
      name: "memory:detect-write",
      priority: 100,
      onAfterToolExec({ toolName }) {
        if (!activeProvider)
          return;
        if (toolName === "memory_add" || toolName === "memory_update") {
          const sid = getActiveTurnSessionId();
          if (sid)
            getSessionState(sid).memoryWrittenThisTurn = true;
        }
        return;
      }
    });
    ctx.addHook({
      name: "memory:auto-extract",
      priority: 100,
      async onAfterChat({ sessionId }) {
        if (!activeProvider || !cachedApi || !currentConfig.autoExtract)
          return;
        const s = getSessionState(sessionId);
        if (s.memoryWrittenThisTurn)
          return;
        s.turnsSinceLastExtract++;
        if (s.turnsSinceLastExtract < currentConfig.extractInterval)
          return;
        s.turnsSinceLastExtract = 0;
        runExtraction(sessionId).catch((err) => {
          logger.warn("自动提取失败:", err);
        });
        return;
      }
    });
    ctx.addHook({
      name: "memory:session-clear",
      onSessionClear({ sessionId }) {
        sessionStates.delete(sessionId);
        clearSessionTracking(sessionId);
      }
    });
    ctx.addHook({
      name: "memory:consolidation-check",
      async onSessionCreate() {
        if (!activeProvider || !cachedApi || !currentConfig.consolidation.enabled)
          return;
        runConsolidation2().catch((err) => {
          logger.warn("归纳检查失败:", err);
        });
      }
    });
    ctx.addHook({
      name: "memory:session-notes",
      priority: 50,
      async onAfterLLMCall({ content }) {
        if (!activeProvider || !cachedApi)
          return;
        const sid = getActiveTurnSessionId();
        if (!sid)
          return;
        const tokens = content.usageMetadata?.totalTokenCount;
        if (!tokens || tokens <= 0)
          return;
        if (shouldExtractSessionMemory(sid, tokens)) {
          updateTokenTracking(sid, tokens);
          extractSessionNotes({
            api: cachedApi,
            provider: activeProvider,
            sessionId: sid,
            logger
          }).catch((err) => {
            logger.warn("会话笔记提取失败:", err);
          });
        }
        return;
      }
    });
    ctx.addHook({
      name: "memory:config-reload",
      async onConfigReload() {
        if (!cachedApi)
          return;
        const newRaw = ctx.readConfigSection("memory");
        const newConfig = resolveConfig(newRaw, ctx.getPluginConfig());
        const wasEnabled = currentConfig.enabled;
        currentConfig = newConfig;
        if (!newConfig.enabled) {
          if (wasEnabled)
            disableMemorySystem(ctx);
          return;
        }
        if (wasEnabled)
          disableMemorySystem(ctx);
        await enableMemorySystem(ctx);
      }
    });
  },
  async deactivate() {
    activeProvider = undefined;
    cachedApi = undefined;
    _fallbackSessionId = undefined;
    systemRulesPart = undefined;
    sessionStates.clear();
  }
});
async function runExtraction(sessionId) {
  if (!cachedApi || !activeProvider)
    return;
  const { runMemoryExtraction: runMemoryExtraction2 } = await Promise.resolve().then(() => (init_extract(), exports_extract));
  const savedCount = await runMemoryExtraction2({
    api: cachedApi,
    provider: activeProvider,
    sessionId,
    logger
  });
  if (savedCount > 0 && cachedApi.eventBus) {
    cachedApi.eventBus.emit?.("memory:updated", { count: savedCount, sessionId });
  }
}
async function runConsolidation2() {
  if (!cachedApi || !activeProvider)
    return;
  const { maybeRunConsolidation: maybeRunConsolidation2 } = await Promise.resolve().then(() => (init_consolidation(), exports_consolidation));
  await maybeRunConsolidation2({
    api: cachedApi,
    provider: activeProvider,
    config: currentConfig,
    logger
  });
}
async function runForcedConsolidation() {
  if (!cachedApi || !activeProvider) {
    return { ok: false, message: "记忆系统未就绪。", opCount: 0 };
  }
  const { forceRunConsolidation: forceRunConsolidation2 } = await Promise.resolve().then(() => (init_consolidation(), exports_consolidation));
  return await forceRunConsolidation2({
    api: cachedApi,
    provider: activeProvider,
    config: currentConfig,
    logger
  });
}
function registerSettingsTab(api, ctx) {
  const registerTab = api.registerConsoleSettingsTab;
  if (!registerTab)
    return;
  registerTab({
    id: "memory",
    label: "记忆",
    fields: [
      {
        key: "enabled",
        label: "启用记忆系统",
        type: "toggle",
        defaultValue: false,
        description: "启用后 LLM 可通过工具读写跨会话长期记忆"
      },
      {
        key: "autoExtract",
        label: "自动提取",
        type: "toggle",
        defaultValue: true,
        description: "对话结束后自动从对话中提取值得记住的信息",
        group: "自动提取"
      },
      {
        key: "extractInterval",
        label: "提取间隔（轮）",
        type: "number",
        defaultValue: 1,
        description: "每 N 轮对话后执行一次自动提取"
      },
      {
        key: "autoRecall",
        label: "自动召回",
        type: "toggle",
        defaultValue: true,
        description: "每轮对话前自动注入相关记忆到上下文",
        group: "智能检索"
      },
      {
        key: "maxContextKB",
        label: "每轮注入上限 (KB)",
        type: "number",
        defaultValue: 20,
        description: "每次对话前最多注入多少 KB 的记忆内容"
      },
      {
        key: "sessionBudgetKB",
        label: "会话注入上限 (KB)",
        type: "number",
        defaultValue: 60,
        description: "一次会话中累计最多注入多少 KB 的记忆内容"
      },
      {
        key: "consolidation.enabled",
        label: "跨会话归纳",
        type: "toggle",
        defaultValue: true,
        description: "定期整理合并冗余记忆",
        group: "归纳整理"
      },
      { key: "consolidation.minHours", label: "最小归纳间隔（小时）", type: "number", defaultValue: 24 },
      { key: "consolidation.minSessions", label: "最少新会话数", type: "number", defaultValue: 3 }
    ],
    async onLoad() {
      const raw = ctx.readConfigSection("memory") ?? {};
      const consolidation = raw.consolidation ?? {};
      return {
        enabled: raw.enabled ?? false,
        autoExtract: raw.autoExtract ?? true,
        extractInterval: raw.extractInterval ?? 1,
        autoRecall: raw.autoRecall ?? true,
        maxContextKB: Math.round((raw.maxContextBytes ?? 20480) / 1024),
        sessionBudgetKB: Math.round((raw.sessionBudgetBytes ?? 61440) / 1024),
        "consolidation.enabled": consolidation.enabled ?? true,
        "consolidation.minHours": consolidation.minHours ?? 24,
        "consolidation.minSessions": consolidation.minSessions ?? 3
      };
    },
    async onSave(values) {
      try {
        if (!api.configManager)
          return { success: false, error: "configManager unavailable" };
        const update = {
          enabled: values.enabled,
          autoExtract: values.autoExtract,
          extractInterval: values.extractInterval,
          autoRecall: values.autoRecall,
          maxContextBytes: (values.maxContextKB || 20) * 1024,
          sessionBudgetBytes: (values.sessionBudgetKB || 60) * 1024,
          consolidation: {
            enabled: values["consolidation.enabled"],
            minHours: values["consolidation.minHours"],
            minSessions: values["consolidation.minSessions"]
          }
        };
        const result = api.configManager.updateEditableConfig({ memory: update });
        await api.configManager.applyRuntimeConfigReload(result.mergedRaw);
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  });
}
export {
  src_default as default
};
