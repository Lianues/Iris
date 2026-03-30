/**
 * 后端核心服务
 *
 * 封装全部业务逻辑，通过公共方法和事件与平台层交互。
 *
 *平台层调用 Backend 的方法（chat / clearSession / listSessionMetas 等），
 * Backend 通过事件（response / stream:start / stream:chunk / stream:end / tool:update）
 * 将结果推送给平台层。
 *
 * Backend 不知道任何平台的存在。
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { loadSkillsFromFilesystem } from '../../config/skill-loader';
import type { LLMConfig, ToolsConfig, ToolPolicyConfig, SkillDefinition } from '../../config/types';
import type { SummaryConfig } from '../../config/types';
import { updatePlatformLastModel } from '../../config/platform';
import { LLMRouter } from '../../llm/router';
import { isDocumentMimeType } from '../../llm/vision';
import type { PluginHook } from '../../extension';
import { StorageProvider, SessionMeta } from '../../storage/base';
import { ToolRegistry } from '../../tools/registry';
import { ToolStateManager } from '../../tools/state';
import { PromptAssembler } from '../../prompt/assembler';
import { MemoryProvider } from '../../memory/base';
import { ModeRegistry, ModeDefinition, applyToolFilter } from '../../modes';
import type { OCRProvider } from '../../ocr';
import { isOCRTextPart } from '../../ocr';
import { ToolLoop, ToolLoopConfig, LLMCaller } from '../tool-loop';
import { createLogger } from '../../logger';
import { sanitizeHistory } from '../history-sanitizer';
import { estimateTokenCount } from 'tokenx';
import { extractText, isTextPart, isInlineDataPart } from '../../types';
import type { Content, Part, UsageMetadata } from '../../types';
import { summarizeHistory } from '../summarizer';
import { resetConfigToDefaults as doResetConfigToDefaults } from '../../config/index';

import type { BackendConfig, ImageInput, DocumentInput, UndoScope, UndoOperationResult, RedoOperationResult } from './types';
import { buildStoredUserParts } from './media';
import { prepareHistoryForLLM, preparePartsForLLM } from './history';
import { callLLMStream } from './stream';
import { UndoRedoManager } from './undo-redo';
import { buildPluginHookConfig } from './plugins';

const logger = createLogger('Backend');

// ============ Backend 类 ============

export class Backend extends EventEmitter {
  private router: LLMRouter;
  private storage: StorageProvider;
  private tools: ToolRegistry;
  private prompt: PromptAssembler;
  private stream: boolean;
  private autoRecall: boolean;
  private subAgentGuidance?: string;
  private memory?: MemoryProvider;
  private modeRegistry?: ModeRegistry;
  private defaultMode?: string;
  private currentLLMConfig?: LLMConfig;
  private ocrService?: OCRProvider;
  private summaryModelName?: string;
  private summaryConfig?: SummaryConfig;

  private configDir?: string;
  private rememberPlatformModel: boolean;
  private toolLoop: ToolLoop;
  private toolLoopConfig: ToolLoopConfig;
  private toolState: ToolStateManager;

  /** 当前正在处理的 sessionId（用于工具事件转发） */
  private activeSessionId?: string;

  /** 每个 sessionId 的 AbortController，用于中止正在进行的 chat */
  private activeAbortControllers = new Map<string, AbortController>();

  /** Undo/Redo 管理器 */
  private undoRedo = new UndoRedoManager();

  /** 每个 session 最近一次 LLM 调用的 totalTokenCount（用于自动总结阈值判断） */
  private lastSessionTokens = new Map<string, number>();

  /** 插件钩子列表 */
  private pluginHooks: PluginHook[] = [];
  /** Skill 定义列表 */
  private skills: SkillDefinition[] = [];
  /**
   * Skill 目录变化时的回调。
   * 由外部（bootstrap）设置，用于在 Skill 热重载后重建 read_skill 工具声明。
   */
  private _onSkillsChanged?: () => void;

  constructor(
    router: LLMRouter,
    storage: StorageProvider,
    tools: ToolRegistry,
    toolState: ToolStateManager,
    prompt: PromptAssembler,
    config?:BackendConfig,
    memory?: MemoryProvider,
    modeRegistry?: ModeRegistry,
  ) {
    super();
    this.router = router;
    this.storage = storage;
    this.tools = tools;
    this.toolState = toolState;
    this.prompt = prompt;
    this.stream = config?.stream ?? false;
    this.autoRecall = config?.autoRecall ?? true;
    this.subAgentGuidance = config?.subAgentGuidance;
    this.memory = memory;
    this.modeRegistry = modeRegistry;
    this.defaultMode = config?.defaultMode;
    this.currentLLMConfig = config?.currentLLMConfig;
    this.ocrService = config?.ocrService;
    this.summaryModelName = config?.summaryModelName;
    this.summaryConfig = config?.summaryConfig;

    this.configDir = config?.configDir;
    this.rememberPlatformModel = config?.rememberPlatformModel ?? true;
    // 初始化 Skill 定义列表。Skill 内容改为通过 read_skill 工具按需读取，不再维护启用状态。
    if (config?.skills) {
      this.skills = config.skills;
    }

    this.toolLoopConfig = {
      maxRounds: config?.maxToolRounds ?? 200,
      toolsConfig: config?.toolsConfig ?? { permissions: {} },
      retryOnError: config?.retryOnError ?? true,
      maxRetries: config?.maxRetries ?? 3,
    };
    this.toolLoop = new ToolLoop(tools, prompt, this.toolLoopConfig, toolState);

    // 转发工具状态事件
    this.setupToolStateForwarding();
  }

  // ============ 公共 API（平台层调用） ============

  /** 设置插件钩子（由 bootstrap 在插件加载后调用） */
  setPluginHooks(hooks: PluginHook[]): void {
    this.pluginHooks = hooks;
    const hookConfig = buildPluginHookConfig(hooks);
    this.toolLoopConfig.beforeToolExec = hookConfig.beforeToolExec;
    this.toolLoopConfig.afterToolExec = hookConfig.afterToolExec;
    this.toolLoopConfig.beforeLLMCall = hookConfig.beforeLLMCall;
    this.toolLoopConfig.afterLLMCall = hookConfig.afterLLMCall;
  }

  /** 发送消息，触发完整的 LLM + 工具循环 */
  async chat(sessionId: string, text: string, images?: ImageInput[], documents?: DocumentInput[], platformName?: string): Promise<void> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);

    try {
      // 插件钩子: onBeforeChat（可修改用户消息文本）
      for (const hook of this.pluginHooks) {
        try {
          const hookResult = await hook.onBeforeChat?.({ sessionId, text });
          if (hookResult) text = hookResult.text;
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onBeforeChat 执行失败:`, err);
        }
      }

      const storedUserParts = await buildStoredUserParts(text, images, documents, {
        currentLLMConfig: this.currentLLMConfig,
        ocrService: this.ocrService,
      });
      const llmUserParts = preparePartsForLLM(storedUserParts, this.currentLLMConfig);
      await this.handleMessage(sessionId, storedUserParts, llmUserParts, abortController.signal, platformName);
    } catch (err) {
      // 区分用户主动 abort 和其他错误
      if (abortController.signal.aborted) {
        logger.info(`chat 已被中止 (session=${sessionId})`);
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`处理消息失败 (session=${sessionId}):`, err);
        this.emit('error', sessionId, errorMsg);
      }
      this.emit('done', sessionId, Date.now() - startTime);
    } finally {
      this.activeAbortControllers.delete(sessionId);
      this.activeSessionId = undefined;
    }
  }

  /**
   * 中止指定会话正在进行的 chat。
   */
  abortChat(sessionId: string): void {
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      logger.info(`abortChat: session=${sessionId}`);
    }
  }

  /** 清空指定会话 */
  async clearSession(sessionId: string): Promise<void> {
    await this.storage.clearHistory(sessionId);
    this.undoRedo.clearRedo(sessionId);
    this.lastSessionTokens.delete(sessionId);

    for (const hook of this.pluginHooks) {
      try {
        await hook.onSessionClear?.({ sessionId });
      } catch (err) {
        logger.warn(`插件钩子 "${hook.name}" onSessionClear 执行失败:`, err);
      }
    }
  }

  /** 获取指定会话的历史消息 */
  async getHistory(sessionId: string): Promise<Content[]> {
    return this.storage.getHistory(sessionId);
  }

  /** 获取指定会话的元数据 */
  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    return this.storage.getMeta(sessionId);
  }

  /** 获取所有会话元数据列表 */
  async listSessionMetas(): Promise<SessionMeta[]> {
    return this.storage.listSessionMetas();
  }

  /** 获取所有会话 ID */
  async listSessions(): Promise<string[]> {
    return this.storage.listSessions();
  }

  /** 截断会话历史 */
  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    await this.storage.truncateHistory(sessionId, keepCount);
  }

  /**
   * 压缩当前会话的上下文。
   */
  async summarize(sessionId: string, signal?: AbortSignal): Promise<string> {
    const history = await this.storage.getHistory(sessionId);
    if (history.length === 0) {
      throw new Error('当前会话没有历史消息');
    }

    let startIndex = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].isSummary) {
        startIndex = i;
        break;
      }
    }

    const toSummarize = history.slice(startIndex);
    if (toSummarize.length < 2) {
      throw new Error('消息过少，无需压缩');
    }

    const summaryText = await summarizeHistory(
      this.router,
      toSummarize,
      this.summaryModelName,
      this.summaryConfig,
      signal,
    );

    const now = Date.now();
    const fullText = `[Context Summary]\n\n${summaryText}`;
    const estimatedTokens = estimateTokenCount(fullText);

    const summaryContent: Content = {
      role: 'user',
      parts: [{ text: fullText }],
      isSummary: true,
      createdAt: now,
      ...(estimatedTokens > 0 ? { usageMetadata: { promptTokenCount: estimatedTokens } } : {}),
    };
    await this.storage.addMessage(sessionId, summaryContent);

    this.undoRedo.clearRedo(sessionId);
    return summaryText;
  }

  /** 清空指定会话的 redo 栈。任何新的写入都应使 redo 失效。 */
  clearRedo(sessionId: string): void {
    this.undoRedo.clearRedo(sessionId);
  }

  /**
   * 统一 undo：由 Backend 决定本次应删除哪一组 Content，
   * 并将其压入 redo 栈。平台层只消费返回结果并处理 UI。
   */
  async undo(sessionId: string, scope: UndoScope = 'last-turn'): Promise<UndoOperationResult | null> {
    const history = await this.storage.getHistory(sessionId);
    const range = this.undoRedo.resolveUndoRange(history, scope);
    if (!range) return null;

    const removed = history.slice(range.removeStart);
    await this.storage.truncateHistory(sessionId, range.removeStart);
    this.undoRedo.pushRedoGroup(sessionId, removed);

    const summary = this.undoRedo.summarizeGroup(removed);
    return {
      scope,
      removed,
      removedCount: removed.length,
      userText: summary.userText,
      assistantText: summary.assistantText,
    };
  }

  /**
   * 统一 redo：恢复最近一次 undo 删除的一组 Content。
   */
  async redo(sessionId: string): Promise<RedoOperationResult | null> {
    const restored = this.undoRedo.popRedoGroup(sessionId);
    if (!restored) return null;

    for (const content of restored) {
      await this.addMessage(sessionId, content, { clearRedo: false });
    }

    const summary = this.undoRedo.summarizeGroup(restored);
    return {
      restored,
      restoredCount: restored.length,
      userText: summary.userText,
      assistantText: summary.assistantText,
    };
  }

  /**
   * 添加消息到会话历史。
   */
  async addMessage(sessionId: string, content: Content, options?: { clearRedo?: boolean }): Promise<void> {
    if (options?.clearRedo !== false) {
      this.undoRedo.clearRedo(sessionId);
    }
    await this.storage.addMessage(sessionId, content);
  }


  /** 切换工作目录 */
  setCwd(dirPath: string): void {
    const resolved = path.resolve(process.cwd(), dirPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`目录不存在: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`不是目录: ${resolved}`);
    }
    process.chdir(resolved);
    logger.info(`工作目录已切换: ${resolved}`);
  }

  /** 获取当前工作目录 */
  getCwd(): string {
    return process.cwd();
  }

  /**
   * 执行命令
   */
  runCommand(cmd: string): { output: string; cwd: string } {
    const trimmed = cmd.trim();

    const cdMatch = trimmed.match(/^cd\s+(.+)$/i);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^["']|["']$/g, '');
      this.setCwd(target);
      return { output: `已切换到: ${process.cwd()}`, cwd:process.cwd() };
    }

    const result = spawnSync(trimmed, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 30000,
      windowsHide: true,
      shell: true,
    });

    const stdout = (result.stdout as string)?.trimEnd() || '';
    const stderr = (result.stderr as string)?.trimEnd() || '';
    const combined = [stdout, stderr].filter(Boolean).join('\n');

    if (result.status !== 0) {
      throw new Error(combined || `命令执行失败 (exit code: ${result.status})`);
    }
    return { output: combined, cwd: process.cwd() };
  }


  /** 获取所有工具名称（含已禁用的，供 Web API 状态展示） */
  getToolNames(): string[] {
    return this.tools.getDeclarations().map(d => d.name);
  }

  /** 获取被禁用的工具名称列表 */
  getDisabledTools(): string[] {
    return this.toolLoopConfig.toolsConfig.disabledTools ?? [];
  }

  /** 获取工具注册表引用 */
  getTools(): ToolRegistry {
    return this.tools;
  }

  /** 获取存储引用 */
  getStorage(): StorageProvider {
    return this.storage;
  }

  /** 获取路由器引用 */
  getRouter(): LLMRouter {
    return this.router;
  }

  /** 获取记忆层引用 */
  getMemory(): MemoryProvider | undefined {
    return this.memory;
  }

  /** 获取提示词组装器引用 */
  getPrompt(): PromptAssembler {
    return this.prompt;
  }

  /** 获取当前活跃的 sessionId（工具执行期间有效） */
  getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  /** 获取模式注册表引用 */
  getModeRegistry(): ModeRegistry | undefined {
    return this.modeRegistry;
  }

  // ============ Skill 管理 ============

  /** 注册 Skill 列表变化回调 */
  setOnSkillsChanged(callback: () => void): void {
    this._onSkillsChanged = callback;
  }

  /** 列出所有已定义的 Skill 摘要 */
  listSkills(): { name: string; path: string; description?: string }[] {
    return this.skills.map(s => ({
      name: s.name,
      path: s.path,
      description: s.description,
    }));
  }

  /** 按 path 标识查找 Skill */
  getSkillByPath(skillPath: string): SkillDefinition | undefined {
    return this.skills.find(s => s.path === skillPath);
  }

  /**
   * 从文件系统重新扫描 Skill 并合并内联定义，更新内存中的 Skill 列表。
   */
  reloadSkillsFromFilesystem(dataDir: string, inlineSkills?: SkillDefinition[]): void {
    const fsSkills: SkillDefinition[] = loadSkillsFromFilesystem(dataDir);

    const merged = new Map<string, SkillDefinition>();
    for (const s of fsSkills) merged.set(s.name, s);
    if (inlineSkills) {
      for (const s of inlineSkills) merged.set(s.name, s);
    }

    const newSkills = Array.from(merged.values());

    const oldPaths = this.skills.map(s => s.path).sort().join('\0');
    const newPaths = newSkills.map(s => s.path).sort().join('\0');
    if (oldPaths === newPaths) {
      this.skills = newSkills;
      return;
    }

    this.skills = newSkills;
    this._onSkillsChanged?.();
  }

  // ============ Mode 管理 ============

  /** 列出所有已注册的 Mode */
  listModes(): { name: string; description?: string; current: boolean }[] {
    if (!this.modeRegistry) return [];
    return this.modeRegistry.getAll().map(m => ({
      name: m.name,
      description: m.description,
      current: m.name === this.defaultMode,
    }));
  }

  /** 切换当前 Mode */
  switchMode(name: string): boolean {
    if (!this.modeRegistry) return false;
    const mode = this.modeRegistry.get(name);
    if (!mode) return false;
    this.defaultMode = name;
    logger.info(`Mode 已切换: ${name}`);
    return true;
  }

  /** 获取当前 Mode 名称 */
  getCurrentMode(): string | undefined {
    return this.defaultMode;
  }

  /** 获取当前活动模型名称 */
  getCurrentModelName(): string {
    return this.router.getCurrentModelName();
  }

  /** 获取当前活动模型信息 */
  getCurrentModelInfo() {
    return this.router.getCurrentModelInfo();
  }

  /** 列出所有可用模型 */
  listModels() {
    return this.router.listModels();
  }

  /** 切换当前活动模型 */
  switchModel(modelName: string, platformName?: string) {
    const info = this.router.setCurrentModel(modelName);
    this.currentLLMConfig = this.router.getCurrentConfig();
    logger.info(`当前模型已切换: ${info.modelName} -> ${info.modelId}`);

    if (platformName && this.rememberPlatformModel && this.configDir) {
      try {
        updatePlatformLastModel(this.configDir, platformName, info.modelName);
      } catch (err) {
        logger.warn(`持久化平台模型失败 (${platformName}):`, err);
      }
    }

    return info;
  }

  /** 获取工具状态管理器 */
  getToolState(): ToolStateManager {
    return this.toolState;
  }

  /** 获取当前工具执行策略 */
  getToolPolicies(): Record<string, ToolPolicyConfig> {
    return this.toolLoopConfig.toolsConfig.permissions;
  }

  /**
   * 批准或拒绝一个处于 awaiting_approval 状态的工具调用。
   */
  approveTool(toolId: string, approved: boolean): void {
    if (approved) {
      this.toolState.transition(toolId, 'executing');
    } else {
      this.toolState.transition(toolId, 'error', { error: '用户已拒绝执行' });
    }
  }

  /**
   * 在 diff 预览中确认或拒绝执行（二类审批）。
   */
  applyTool(toolId: string, applied: boolean): void {
    if (applied) {
      this.toolState.transition(toolId, 'executing');
    } else {
      this.toolState.transition(toolId, 'error', { error: '用户在 diff 预览中拒绝了执行' });
    }
  }

  /** 获取流式设置 */
  isStreamEnabled(): boolean {
    return this.stream;
  }

  // ============ 热重载 ============

  /** 热重载：替换 LLM 路由器 */
  reloadLLM(newRouter: LLMRouter): void {
    this.router = newRouter;
    const modelsDesc = newRouter.listModels()
      .map(model => `${model.current ? '*' : '-'}${model.modelName}=${model.modelId}`)
      .join(' ');
    logger.info(`LLM 已热重载: [${modelsDesc}]`);
  }

  /** 热重载：更新运行时参数 */
  reloadConfig(opts: {
    stream?: boolean;
    maxToolRounds?: number;
    retryOnError?: boolean;
    maxRetries?: number;
    toolsConfig?: ToolsConfig;
    systemPrompt?: string;
    currentLLMConfig?: LLMConfig;
    ocrService?: OCRProvider;
    skills?: SkillDefinition[];
  }): void {
    if (opts.stream !== undefined) this.stream = opts.stream;
    if (opts.maxToolRounds !== undefined) this.toolLoopConfig.maxRounds = opts.maxToolRounds;
    if (opts.toolsConfig !== undefined) this.toolLoopConfig.toolsConfig = opts.toolsConfig;
    if (opts.retryOnError !== undefined) this.toolLoopConfig.retryOnError = opts.retryOnError;
    if (opts.maxRetries !== undefined) this.toolLoopConfig.maxRetries = opts.maxRetries;
    if (opts.systemPrompt !== undefined) this.prompt.setSystemPrompt(opts.systemPrompt);
    if ('currentLLMConfig' in opts) this.currentLLMConfig = opts.currentLLMConfig;
    if ('ocrService' in opts) this.ocrService = opts.ocrService;
    if ('skills' in opts) {
      this.skills = opts.skills ?? [];
      this._onSkillsChanged?.();
    }
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.toolLoopConfig.maxRounds} toolPolicies=${Object.keys(this.toolLoopConfig.toolsConfig.permissions).length}`);
  }

  /** 重置配置文件为默认值 */
  resetConfigToDefaults(): { success: boolean; message: string } {
    return doResetConfigToDefaults();
  }

  // ============ 核心流程 ============

  /**
   * 根据当前模型配置解析自动总结阈值（绝对 token 数）。
   */
  private getAutoSummaryThreshold(): number | undefined {
    const config = this.currentLLMConfig;
    if (!config?.autoSummaryThreshold) return undefined;
    const raw = config.autoSummaryThreshold;
    if (typeof raw === 'number') return raw > 0 ? raw : undefined;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.endsWith('%')) {
        const percent = parseFloat(trimmed);
        if (!isNaN(percent) && percent > 0 && config.contextWindow && config.contextWindow > 0) {
          return Math.floor(config.contextWindow * percent / 100);
        }
      }
      const num = parseFloat(trimmed);
      return !isNaN(num) && num > 0 ? num : undefined;
    }
    return undefined;
  }

  private async handleMessage(sessionId: string, storedUserParts: Part[], llmUserParts: Part[], signal?: AbortSignal, platformName?: string): Promise<void> {
    this.activeSessionId = sessionId;
    const startTime = Date.now();

    // 清除上一轮残留的工具调用记录
    this.toolState.clearAll();

    // 1. 加载历史并追加用户消息
    let storedHistory = await this.storage.getHistory(sessionId);

    // 1.1 兜底清理
    const beforeSanitize = storedHistory.length;
    const sanitizeAppended = sanitizeHistory(storedHistory);
    const keptFromOriginal = storedHistory.length - sanitizeAppended.length;
    if (keptFromOriginal !== beforeSanitize || sanitizeAppended.length > 0) {
      if (keptFromOriginal < beforeSanitize) {
        await this.storage.truncateHistory(sessionId, keptFromOriginal);
      }
      for (const msg of sanitizeAppended) {
        await this.storage.addMessage(sessionId, msg);
      }
      logger.info(`历史兜底清理: session=${sessionId}, ${beforeSanitize} → ${storedHistory.length} 条`);
    }

    // 1.2 自动上下文压缩（pre-message）
    const autoThreshold = this.getAutoSummaryThreshold();
    if (autoThreshold && storedHistory.length > 0) {
      const lastTokens = this.lastSessionTokens.get(sessionId) ?? 0;
      if (lastTokens > 0) {
        const estUser = estimateTokenCount(extractText(storedUserParts) || '');
        if (lastTokens + estUser > autoThreshold) {
          logger.info(`Auto-compact (pre-message): ${lastTokens} + ${estUser} > ${autoThreshold}`);
          try {
            const summaryText = await this.summarize(sessionId, signal);
            this.emit('auto-compact', sessionId, summaryText);
            storedHistory = await this.storage.getHistory(sessionId);
          } catch (err) {
            logger.warn('Auto-compact (pre-message) failed:', err);
          }
        }
      }
    }

    const history = prepareHistoryForLLM(storedHistory, this.currentLLMConfig);
    const isNewSession = storedHistory.length === 0;
    const userText = extractText(llmUserParts);

    history.push({ role: 'user', parts: llmUserParts });

    // 2. 构建 per-request 额外上下文
    let extraParts: Part[] | undefined;

    if (this.memory && this.autoRecall) {
      try {
        const context = await this.memory.buildContext(userText);
        if (context) {
          extraParts = [...(extraParts ?? []), { text: context }];
        }
      } catch (err) {
        logger.warn('查询记忆失败:', err);
      }
    }

    if (this.subAgentGuidance) {
      if (!extraParts) extraParts = [];
      extraParts.push({ text: this.subAgentGuidance });
    }

    const mode = this.resolveMode();
    if (mode?.systemPrompt) {
      if (!extraParts) extraParts = [];
      extraParts.unshift({ text: mode.systemPrompt });
    }

    // 3. 构建 LLM 调用函数
    let lastCallTotalTokens = 0;
    const callLLM: LLMCaller = async (request, modelName, callSignal) => {
      let content: Content;
      if (this.stream) {
        content = await callLLMStream(this.router, this, sessionId, request, modelName, callSignal);
        if (content.usageMetadata?.totalTokenCount) lastCallTotalTokens = content.usageMetadata.totalTokenCount;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      } else {
        const response = await this.router.chat(request, modelName, callSignal);
        content = response.content;
        content.modelName = modelName || this.router.getCurrentModelName();
        content.createdAt = Date.now();
        if (response.usageMetadata) {
          content.usageMetadata = response.usageMetadata;
          this.emit('usage', sessionId, response.usageMetadata);
          if (response.usageMetadata.totalTokenCount) lastCallTotalTokens = response.usageMetadata.totalTokenCount;
        }
      }
      return content;
    };

    // 4. 解析模式工具过滤 + 全局禁用工具
    let requestTools = mode?.tools ? applyToolFilter(mode, this.tools) : this.tools;
    const disabled = this.toolLoopConfig.toolsConfig.disabledTools;
    if (disabled && disabled.length > 0) {
      requestTools = requestTools.createFiltered(disabled);
    }

    let loop = this.toolLoop;
    if (mode?.tools || (disabled && disabled.length > 0)) {
      loop = new ToolLoop(requestTools, this.prompt, this.toolLoopConfig, this.toolState);
    }
    // 5. 新用户消息会让 redo 失效
    this.undoRedo.clearRedo(sessionId);
    const userTextForTokens = extractText(storedUserParts);
    const estimatedUserTokens = userTextForTokens ? estimateTokenCount(userTextForTokens) : 0;
    await this.storage.addMessage(sessionId, {
      role: 'user',
      parts: storedUserParts,
      createdAt: Date.now(),
      ...(estimatedUserTokens > 0 ? { usageMetadata: { promptTokenCount: estimatedUserTokens } } : {}),
    });
    if (isNewSession) {
      await this.updateSessionMeta(sessionId, storedUserParts, true, platformName);
      for (const hook of this.pluginHooks) {
        try {
          await hook.onSessionCreate?.({ sessionId });
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onSessionCreate 执行失败:`, err);
        }
      }
    }
    if (estimatedUserTokens > 0) this.emit('user:token', sessionId, estimatedUserTokens);
    this.lastSessionTokens.set(sessionId, (this.lastSessionTokens.get(sessionId) ?? 0) + estimatedUserTokens);

    // 6. 执行工具循环
    const result = await loop.run(history, callLLM, {
      extraParts,
      onMessageAppend: (content) => this.storage.addMessage(sessionId, content),
      onModelContent: (content) => { this.emit('assistant:content', sessionId, content); },
      onAttachments: (attachments) => {
        logger.info(`[handleMessage] onAttachments 回调触发: sessionId=${sessionId}, count=${attachments.length}, types=${attachments.map(a => `${a.type}(${a.data.length}B)`).join(',')}`);
        this.emit('attachments', sessionId, attachments);
      },
      signal,
      onRetry: (attempt, maxRetries, error) => {
        this.emit('retry', sessionId, attempt, maxRetries, error);
      },
    });

    // 6.1. 如果被 abort，提前退出
    if (result.aborted) {
      await this.storage.truncateHistory(sessionId, result.history.length);
      this.emit('done', sessionId, Date.now() - startTime);
      return;
    }

    // 6.2. 如果工具循环返回了错误
    if (result.error) {
      this.emit('error', sessionId, result.error);
      this.emit('done', sessionId, Date.now() - startTime);
      return;
    }

    // 6.5. 补 fallback model 消息
    const hasFinalModelMessage = result.history[result.history.length - 1]?.role === 'model';
    let appendedFallbackModel = false;
    if (!hasFinalModelMessage && result.text) {
      const fallbackContent: Content = {
        role: 'model',
        parts: [{ text: result.text }],
        modelName: this.router.getCurrentModelName(),
      };
      result.history.push(fallbackContent);
      await this.storage.addMessage(sessionId, fallbackContent);
      this.emit('assistant:content', sessionId, fallbackContent);
      appendedFallbackModel = true;
    }

    // 7. 将耗时写入最后一条 model 消息
    const durationMs = Date.now() - startTime;
    for (let i = result.history.length - 1; i >= 0; i--) {
      if (result.history[i].role === 'model') {
        result.history[i].durationMs = durationMs;
        break;
      }
    }
    await this.storage.updateLastMessage(sessionId, (content) => {
      if (content.role === 'model') {
        content.durationMs = durationMs;
      }
      return content;
    });

    // 8. 管理会话元数据
    await this.updateSessionMeta(sessionId, storedUserParts, false, platformName);

    // 9. 插件钩子: onAfterChat
    let finalText = result.text;
    if (finalText) {
      for (const hook of this.pluginHooks) {
        try {
          const hookResult = await hook.onAfterChat?.({ sessionId, content: finalText });
          if (hookResult) finalText = hookResult.content;
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onAfterChat 执行失败:`, err);
        }
      }
    }

    // 10. 非流式模式：发送最终文本
    if ((!this.stream || appendedFallbackModel) && finalText) {
      this.emit('response', sessionId, finalText);
    }
    this.emit('done', sessionId, durationMs);

    // 11. 更新 session token 追踪
    if (lastCallTotalTokens > 0) {
      this.lastSessionTokens.set(sessionId, lastCallTotalTokens);
    }
    if (autoThreshold && lastCallTotalTokens > autoThreshold) {
      logger.info(`Auto-compact (post-response): ${lastCallTotalTokens} > ${autoThreshold}`);
      try {
        const summaryText = await this.summarize(sessionId);
        this.emit('auto-compact', sessionId, summaryText);
      } catch (err) {
        logger.warn('Auto-compact (post-response) failed:', err);
      }
    }

    this.activeSessionId = undefined;
  }

  // ============ 工具事件转发 ============

  private setupToolStateForwarding(): void {
    const emitToolUpdate = () => {
      if (!this.activeSessionId) return;
      const invocations = this.toolState.getAll();
      this.emit('tool:update', this.activeSessionId, invocations);
    };

    this.toolState.on('created', emitToolUpdate);
    this.toolState.on('stateChange', emitToolUpdate);
  }

  // ============ 模式解析 ============

  private resolveMode(): ModeDefinition | undefined {
    if (!this.defaultMode || !this.modeRegistry) return undefined;
    return this.modeRegistry.get(this.defaultMode);
  }

  // ============ 会话元数据 ============

  private async updateSessionMeta(sessionId: string, userParts: Part[], isNewSession: boolean, platformName?: string): Promise<void> {
    const now = new Date().toISOString();
    const cwd = process.cwd();

    if (isNewSession) {
      const hasDocuments = userParts.some(p =>
        (isTextPart(p) && p.text?.startsWith('[Document: ')) ||
        (isInlineDataPart(p) && isDocumentMimeType(p.inlineData.mimeType))
      );
      const hasImages = userParts.some(p =>
        isInlineDataPart(p) && !isDocumentMimeType(p.inlineData.mimeType)
      );
      const titleText = userParts.reduce((result, part) => {
        if (isOCRTextPart(part)) {
          return result;
        }

        if (isTextPart(part)) {
          const text = part.text ?? '';
          if (text.startsWith('[Image: original ') || text.startsWith('[Document: ')) {
            return result;
          }
          return result + text;
        }

        return result;
      }, '').trim();
      const fallbackTitle = hasImages ? '图片消息' : (hasDocuments ? '文档消息' : '新对话');
      const title = titleText.slice(0, 100) || fallbackTitle;
      await this.storage.saveMeta({
        id: sessionId,
        title,
        cwd,
        createdAt: now,
        updatedAt: now,
        platforms: platformName ? [platformName] : [],
      });
    } else {
      const meta = await this.storage.getMeta(sessionId);
      if (meta) {
        meta.updatedAt = now;
        if (meta.cwd !== cwd) {
          meta.cwd = cwd;
        }
        if (platformName) {
          const platforms = meta.platforms ?? [];
          if (!platforms.includes(platformName)) {
            platforms.push(platformName);
          }
          meta.platforms = platforms;
        }
        await this.storage.saveMeta(meta);
      }
    }
  }
}
