/**
 * Memory 扩展插件入口
 *
 * 实现 IrisPlugin 接口，在 activate 阶段初始化记忆存储并注册工具，
 * 通过钩子实现 autoRecall（自动召回）和 autoExtract（自动提取）机制。
 *
 * 设计要点：
 *   - 钩子和 Settings Tab **始终注册**（即使初始 enabled=false），
 *     确保用户可通过 TUI 或 config reload 在运行时启用/禁用。
 *   - 运行时行为由 currentConfig.enabled 和 activeProvider 是否存在动态控制。
 */

import * as path from 'path';
import { definePlugin, createPluginLogger } from '@irises/extension-sdk';
import type { PluginContext, IrisAPI, Part } from '@irises/extension-sdk';
import { SqliteMemory } from './sqlite/index.js';
import { createMemoryTools, MEMORY_TOOL_NAMES } from './tools.js';
import { DEFAULT_CONFIG_TEMPLATE } from './config-template.js';
import { resolveConfig, type MemoryPluginConfig } from './config.js';
import { buildMemorySystemRules } from './prompts/system-rules.js';
import { findAndFormatRelevantMemories } from './retrieval.js';
import { shouldExtractSessionMemory, extractSessionNotes, updateTokenTracking, clearSessionTracking } from './session-memory.js';

const logger = createPluginLogger('memory');

// ============ 模块级状态 ============

/** 当前活跃的 Provider 实例（直接用 SqliteMemory 类型，以访问 consolidation/session 方法） */
let activeProvider: SqliteMemory | undefined;

/** 缓存的 API 引用 */
let cachedApi: IrisAPI | undefined;

/** 当前配置 */
let currentConfig: MemoryPluginConfig;

/** 是否启用 autoRecall（当存在子代理 recall 类型时禁用，由 recall 子代理接管） */
let autoRecallEnabled = true;

/** 系统提示词 Part 引用（用于移除/更新） */
let systemRulesPart: { text: string } | undefined;

// ---- Per-session 状态（多会话并发安全） ----

interface SessionState {
  lastUserText?: string;
  memoryInjectedThisRound: boolean;
  memoryWrittenThisTurn: boolean;
  turnsSinceLastExtract: number;
  surfacedIds: Set<number>;
  bytesUsed: number;
}

const sessionStates = new Map<string, SessionState>();

function getSessionState(sessionId: string): SessionState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = {
      memoryInjectedThisRound: false,
      memoryWrittenThisTurn: false,
      turnsSinceLastExtract: 0,
      surfacedIds: new Set(),
      bytesUsed: 0,
    };
    sessionStates.set(sessionId, state);
  }
  return state;
}

let _fallbackSessionId: string | undefined;
function getActiveTurnSessionId(): string | undefined {
  return (cachedApi?.backend as any)?.getActiveSessionId?.() ?? _fallbackSessionId;
}

// ============ 辅助：初始化 / 销毁 Provider ============

/** 创建 Provider、注册工具、注入系统提示词 */
async function enableMemorySystem(ctx: PluginContext): Promise<void> {
  if (!cachedApi || activeProvider) return; // 已初始化或 API 未就绪

  const dataPath = currentConfig.dbPath
    ? path.resolve(ctx.getConfigDir(), currentConfig.dbPath)
    : path.join(cachedApi.dataDir ?? ctx.getConfigDir(), 'memory.json');

  activeProvider = new SqliteMemory(dataPath, logger);

  const tools = createMemoryTools(activeProvider);
  cachedApi.tools.registerAll(tools);

  // 挂载 provider + dream 方法到 api.memory，供 console 直接调用
  (cachedApi as any).memory = Object.assign(activeProvider, {
    dream: () => runForcedConsolidation(),
  });

  const hasSubAgents = !!(cachedApi.tools as any)?.get?.('sub_agent');
  autoRecallEnabled = !hasSubAgents;

  const count = await activeProvider.count();
  systemRulesPart = { text: buildMemorySystemRules(count) };
  ctx.addSystemPromptPart(systemRulesPart);

  logger.info(`记忆系统已启用 (${tools.length} 工具, ${count} 条记忆)`);
}

/** 销毁 Provider、注销工具、移除系统提示词 */
function disableMemorySystem(ctx: PluginContext): void {
  if (!cachedApi) return;
  for (const name of MEMORY_TOOL_NAMES) {
    (cachedApi.tools as any).unregister?.(name);
  }
  if (systemRulesPart) {
    ctx.removeSystemPromptPart(systemRulesPart);
    systemRulesPart = undefined;
  }
  activeProvider = undefined;
  (cachedApi as any).memory = undefined;
  logger.info('记忆系统已禁用');
}

// ============ 插件定义 ============

export default definePlugin({
  name: 'memory',
  version: '0.2.0',
  description: '长期记忆系统 — SQLite + FTS5 全文检索 + 自动提取 + 智能检索',

  activate(ctx: PluginContext) {
    // 1. 释放默认配置模板
    ctx.ensureConfigFile('memory.yaml', DEFAULT_CONFIG_TEMPLATE);

    // 2. 读取初始配置
    const rawConfig = ctx.readConfigSection('memory');
    currentConfig = resolveConfig(rawConfig, ctx.getPluginConfig<Partial<MemoryPluginConfig>>());

    // 3. onReady：根据初始配置决定是否启用 + 注册 Settings Tab
    //    注意：即使 enabled=false 也注册 Settings Tab，让用户能通过 TUI 开启。
    ctx.onReady(async (api) => {
      cachedApi = api;
      registerSettingsTab(api, ctx);

      if (currentConfig.enabled) {
        await enableMemorySystem(ctx);
      } else {
        logger.info('记忆系统未启用（可在 /settings → 记忆 中开启）');
      }
    });

    // ---- 以下钩子始终注册，运行时由 activeProvider / currentConfig 门控 ----

    // 4. 钩子：捕获用户输入（per-session）
    ctx.addHook({
      name: 'memory:capture-user-text',
      priority: 200,
      onBeforeChat({ sessionId, text }) {
        if (!activeProvider) return undefined;
        _fallbackSessionId = sessionId;
        const s = getSessionState(sessionId);
        s.lastUserText = text;
        s.memoryInjectedThisRound = false;
        s.memoryWrittenThisTurn = false;
        return undefined;
      },
    });

    // 5. 钩子：autoRecall — 在首次 LLM 调用前注入记忆上下文 + session notes
    ctx.addHook({
      name: 'memory:auto-recall',
      priority: 100,
      async onBeforeLLMCall({ request, round }) {
        if (!activeProvider || !cachedApi) return undefined;
        const sid = getActiveTurnSessionId();
        if (!sid) return undefined;
        const s = getSessionState(sid);
        if (s.memoryInjectedThisRound) return undefined;
        if (round > 0) return undefined;

        s.memoryInjectedThisRound = true;

        const sysInst = request.systemInstruction;
        const injectedParts: string[] = [];

        // Phase 3: 智能检索 — 注入相关记忆
        //   Phase 1: user 类型无条件注入（不受 surfacedIds 限制）
        //   Phase 2: 其余类型走 LLM 选择或小集合直接注入
        if (autoRecallEnabled && currentConfig.autoRecall && s.lastUserText) {
          try {
            const result = await findAndFormatRelevantMemories({
              router: cachedApi.router,
              provider: activeProvider,
              userText: s.lastUserText,
              maxBytes: currentConfig.maxContextBytes,
              surfaced: s.surfacedIds,
              smallSetThreshold: currentConfig.smallSetThreshold,
              logger,
            });

            if (result) {
              if (s.bytesUsed + result.bytes <= currentConfig.sessionBudgetBytes) {
                s.bytesUsed += result.bytes;
                // 非 user 记忆加入 surfacedIds，避免重复注入
                for (const id of result.ids) s.surfacedIds.add(id);
                // user 记忆不加入 surfacedIds — 身份信息每轮都可重新注入
                injectedParts.push(result.text);
              }
            }
          } catch (err) {
            logger.warn('查询记忆失败:', err);
          }
        }

        // Phase 4b: 注入 session notes（供 compact summarizer 保留上下文）
        try {
          const { getSessionNotesForCompact } = await import('./session-memory.js');
          const notes = getSessionNotesForCompact(activeProvider as any, sid);
          if (notes) {
            const notesBytes = new TextEncoder().encode(notes).length;
            if (s.bytesUsed + notesBytes <= currentConfig.sessionBudgetBytes) {
              s.bytesUsed += notesBytes;
              injectedParts.push(notes);
            }
          }
        } catch { /* session notes 不可用时静默跳过 */ }

        if (injectedParts.length === 0) return undefined;

        const existingParts: Part[] = sysInst?.parts ? [...sysInst.parts] : [];
        existingParts.push({ text: injectedParts.join('\n') });

        return {
          request: { ...request, systemInstruction: { parts: existingParts } },
        };
      },
    });

    // 6. 钩子：检测本轮是否有 memory 写入 + 动态刷新系统提示词中的记忆条数
    ctx.addHook({
      name: 'memory:detect-write',
      priority: 100,
      onAfterToolExec({ toolName }) {
        if (!activeProvider) return undefined;
        if (toolName === 'memory_add' || toolName === 'memory_update' || toolName === 'memory_delete') {
          const sid = getActiveTurnSessionId();
          if (sid && (toolName === 'memory_add' || toolName === 'memory_update')) {
            getSessionState(sid).memoryWrittenThisTurn = true;
          }
          // 记忆增删后刷新系统提示词中的条数，避免 LLM 看到过时的 "0 memories"
          if (systemRulesPart) {
            activeProvider.count().then(count => {
              systemRulesPart!.text = buildMemorySystemRules(count);
            });
          }
        }
        return undefined;
      },
    });

    // 7. 钩子：onAfterChat — 触发自动提取（Phase 2）
    ctx.addHook({
      name: 'memory:auto-extract',
      priority: 100,
      async onAfterChat({ sessionId }) {
        if (!activeProvider || !cachedApi || !currentConfig.autoExtract) return undefined;
        const s = getSessionState(sessionId);

        if (s.memoryWrittenThisTurn) return undefined;

        s.turnsSinceLastExtract++;
        if (s.turnsSinceLastExtract < currentConfig.extractInterval) return undefined;

        s.turnsSinceLastExtract = 0;
        void runExtraction(sessionId).catch(err => {
          logger.warn('自动提取失败:', err);
        });

        return undefined;
      },
    });

    // 8. 钩子：onSessionClear
    ctx.addHook({
      name: 'memory:session-clear',
      onSessionClear({ sessionId }) {
        sessionStates.delete(sessionId);
        clearSessionTracking(sessionId);
      },
    });

    // 9. 钩子：onSessionCreate — 触发归纳检查（Phase 4a）
    ctx.addHook({
      name: 'memory:consolidation-check',
      async onSessionCreate() {
        if (!activeProvider || !cachedApi || !currentConfig.consolidation.enabled) return;
        void runConsolidation().catch(err => {
          logger.warn('归纳检查失败:', err);
        });
      },
    });

    // 10. 钩子：onAfterLLMCall — 会话记忆提取（Phase 4b）
    ctx.addHook({
      name: 'memory:session-notes',
      priority: 50,
      async onAfterLLMCall({ content }) {
        if (!activeProvider || !cachedApi) return undefined;
        const sid = getActiveTurnSessionId();
        if (!sid) return undefined;

        const tokens = (content as any).usageMetadata?.totalTokenCount;
        if (!tokens || tokens <= 0) return undefined;

        if (shouldExtractSessionMemory(sid, tokens)) {
          updateTokenTracking(sid, tokens);
          void extractSessionNotes({
            api: cachedApi,
            provider: activeProvider,
            sessionId: sid,
            logger,
          }).catch(err => {
            logger.warn('会话笔记提取失败:', err);
          });
        }

        return undefined;
      },
    });

    // 11. 钩子：配置热重载 — 支持运行时启用/禁用
    ctx.addHook({
      name: 'memory:config-reload',
      async onConfigReload() {
        if (!cachedApi) return;

        const newRaw = ctx.readConfigSection('memory');
        const newConfig = resolveConfig(newRaw, ctx.getPluginConfig<Partial<MemoryPluginConfig>>());
        const wasEnabled = currentConfig.enabled;
        currentConfig = newConfig;

        if (!newConfig.enabled) {
          if (wasEnabled) disableMemorySystem(ctx);
          return;
        }

        // enabled: false → true 或 true → true（配置变更）
        if (wasEnabled) disableMemorySystem(ctx); // 先清理旧的
        await enableMemorySystem(ctx);
      },
    });
  },

  async deactivate() {
    activeProvider = undefined;
    cachedApi = undefined;
    _fallbackSessionId = undefined;
    systemRulesPart = undefined;
    sessionStates.clear();
  },
});

// ============ Phase 2: 自动提取 ============

async function runExtraction(sessionId: string): Promise<void> {
  if (!cachedApi || !activeProvider) return;

  const { runMemoryExtraction } = await import('./extract.js');
  const savedCount = await runMemoryExtraction({
    api: cachedApi,
    provider: activeProvider,
    sessionId,
    logger,
  });

  if (savedCount > 0 && cachedApi.eventBus) {
    (cachedApi.eventBus as any).emit?.('memory:updated', { count: savedCount, sessionId });
  }
}

// ============ Phase 4a: 归纳 ============

async function runConsolidation(): Promise<void> {
  if (!cachedApi || !activeProvider) return;

  const { maybeRunConsolidation } = await import('./consolidation.js');
  await maybeRunConsolidation({
    api: cachedApi,
    provider: activeProvider,
    config: currentConfig,
    logger,
  });
}

/** 手动触发归纳（/dream 命令），跳过时间/会话门控 */
async function runForcedConsolidation(): Promise<{ ok: boolean; message: string; opCount: number }> {
  if (!cachedApi || !activeProvider) {
    return { ok: false, message: '记忆系统未就绪。', opCount: 0 };
  }

  const { forceRunConsolidation } = await import('./consolidation.js');
  return await forceRunConsolidation({
    api: cachedApi,
    provider: activeProvider,
    config: currentConfig,
    logger,
  });
}

// ============ Console Settings Tab ============

function registerSettingsTab(api: IrisAPI, ctx: PluginContext): void {
  const registerTab = (api as any).registerConsoleSettingsTab;
  if (!registerTab) return;

  registerTab({
    id: 'memory',
    label: '记忆',
    fields: [
      { key: 'enabled', label: '启用记忆系统', type: 'toggle', defaultValue: false,
        description: '启用后 LLM 可通过工具读写跨会话长期记忆' },
      { key: 'autoExtract', label: '自动提取', type: 'toggle', defaultValue: true,
        description: '对话结束后自动从对话中提取值得记住的信息', group: '自动提取' },
      { key: 'extractInterval', label: '提取间隔（轮）', type: 'number', defaultValue: 1,
        description: '每 N 轮对话后执行一次自动提取' },
      { key: 'autoRecall', label: '自动召回', type: 'toggle', defaultValue: true,
        description: '每轮对话前自动注入相关记忆到上下文', group: '智能检索' },
      { key: 'maxContextKB', label: '每轮注入上限 (KB)', type: 'number', defaultValue: 20,
        description: '每次对话前最多注入多少 KB 的记忆内容' },
      { key: 'sessionBudgetKB', label: '会话注入上限 (KB)', type: 'number', defaultValue: 60,
        description: '一次会话中累计最多注入多少 KB 的记忆内容' },
      { key: 'consolidation.enabled', label: '跨会话归纳', type: 'toggle', defaultValue: true,
        description: '定期整理合并冗余记忆', group: '归纳整理' },
      { key: 'consolidation.minHours', label: '最小归纳间隔（小时）', type: 'number', defaultValue: 24 },
      { key: 'consolidation.minSessions', label: '最少新会话数', type: 'number', defaultValue: 3 },
    ],
    async onLoad() {
      const raw = ctx.readConfigSection('memory') ?? {};
      const consolidation = (raw.consolidation ?? {}) as Record<string, unknown>;
      return {
        enabled: raw.enabled ?? false,
        autoExtract: raw.autoExtract ?? true,
        extractInterval: raw.extractInterval ?? 1,
        autoRecall: raw.autoRecall ?? true,
        maxContextKB: Math.round(((raw.maxContextBytes as number) ?? 20480) / 1024),
        sessionBudgetKB: Math.round(((raw.sessionBudgetBytes as number) ?? 61440) / 1024),
        'consolidation.enabled': consolidation.enabled ?? true,
        'consolidation.minHours': consolidation.minHours ?? 24,
        'consolidation.minSessions': consolidation.minSessions ?? 3,
      };
    },
    async onSave(values: Record<string, unknown>) {
      try {
        if (!api.configManager) return { success: false, error: 'configManager unavailable' };

        const update: Record<string, unknown> = {
          enabled: values.enabled,
          autoExtract: values.autoExtract,
          extractInterval: values.extractInterval,
          autoRecall: values.autoRecall,
          maxContextBytes: ((values.maxContextKB as number) || 20) * 1024,
          sessionBudgetBytes: ((values.sessionBudgetKB as number) || 60) * 1024,
          consolidation: {
            enabled: values['consolidation.enabled'],
            minHours: values['consolidation.minHours'],
            minSessions: values['consolidation.minSessions'],
          },
        };

        const result = api.configManager.updateEditableConfig({ memory: update } as any);
        await api.configManager.applyRuntimeConfigReload(result.mergedRaw);
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}
