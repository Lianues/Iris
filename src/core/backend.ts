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
import { loadSkillsFromFilesystem } from '../config/skill-loader';
import type { LLMConfig, ToolsConfig, ToolPolicyConfig, SkillDefinition } from '../config/types';
import { LLMRouter } from '../llm/router';
import { supportsVision as llmSupportsVision, isDocumentMimeType, supportsNativePDF, supportsNativeOffice } from '../llm/vision';
import type { PluginHook } from '../plugins/types';
import { StorageProvider, SessionMeta } from '../storage/base';
import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { PromptAssembler } from '../prompt/assembler';
import { MemoryProvider } from '../memory/base';
import { ModeRegistry, ModeDefinition, applyToolFilter } from '../modes';
import type { OCRProvider } from '../ocr';
import { createOCRTextPart, isOCRTextPart, stripOCRTextMarker } from '../ocr';
import { ToolLoop, ToolLoopConfig, LLMCaller } from './tool-loop';
import { createLogger } from '../logger';
import { COMPUTER_USE_FUNCTION_NAMES } from '../computer-use/tools';
import { sanitizeHistory } from './history-sanitizer';
import { estimateTokenCount } from 'tokenx';
import {
  extractText, isFunctionCallPart, isFunctionResponsePart, isInlineDataPart, isTextPart,
} from '../types';
// 上游 main 新增的 summary 相关导入
import type { SummaryConfig } from '../config/types';
import { summarizeHistory } from './summarizer';
// feat 分支新增的 ToolAttachment 类型（MCP 附件旁路功能需要）
import type { Content, Part, LLMRequest, UsageMetadata, ToolInvocation, ToolAttachment } from '../types';
import { resizeImage, formatDimensionNote } from '../media/image-resize.js';
import { extractDocument, isSupportedDocumentMime } from '../media/document-extract.js';
import { convertToPDF } from '../media/office-to-pdf.js';
import type { DocumentInput } from '../media/document-extract.js';
import { resetConfigToDefaults as doResetConfigToDefaults } from '../config/index';

const logger = createLogger('Backend');
const IMAGE_UNAVAILABLE_NOTICE = (count: number) => (
  count > 1
    ? `[用户发送了 ${count} 张图片，但当前模型无法查看图片内容]`
    : '[用户发送了 1 张图片，但当前模型无法查看图片内容]'
);
const DOCUMENT_UNAVAILABLE_NOTICE = (count: number) => (
  count > 1
    ? `[用户发送了 ${count} 个文档，但当前模型无法查看文档内容]`
    : '[用户发送了 1 个文档，但当前模型无法查看文档内容]'
);

/**
 * undo 的粒度。
 *
 * - last-visible-message：撤销最后一个“可见消息单元”。
 *   - 若历史末尾是 assistant 回复，则会删除整段 assistant 回复（含中间 tool response）。
 *   - 若历史末尾是普通 user 消息，则只删除该 user 消息。
 * - last-turn：撤销最后一轮完整交互。
 *   - 若历史末尾是 assistant 回复，则同时删除其前面的 user 消息。
 *   - 若历史末尾是普通 user 消息，则退化为只删除该 user 消息。
 */
export type UndoScope = 'last-visible-message' | 'last-turn';

export interface UndoOperationResult {
  scope: UndoScope;
  removed: Content[];
  removedCount: number;
  userText: string;
  assistantText: string;
}

export interface RedoOperationResult {
  restored: Content[];
  restoredCount: number;
  userText: string;
  assistantText: string;
}

/** Backend 内部最多保留多少组 redo 历史。与 Console 旧实现保持一致。 */
const MAX_REDO_HISTORY_GROUPS = 200;

interface ThoughtTimingState {
  activeStartedAt?: number;
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export interface ImageInput {
  mimeType: string;
  data: string;
}

export type { DocumentInput } from '../media/document-extract.js';

function appendMergedPart(parts: Part[], nextPart: Part, now: number, thoughtTiming?: ThoughtTimingState): Part {
  let normalizedPart = nextPart;
  if ('text' in nextPart && nextPart.thought === true) {
    if (thoughtTiming && thoughtTiming.activeStartedAt == null) {
      thoughtTiming.activeStartedAt = now;
    }
    normalizedPart = {
      ...nextPart,
      thoughtDurationMs: thoughtTiming?.activeStartedAt != null ? now - thoughtTiming.activeStartedAt : nextPart.thoughtDurationMs,
    };
  } else if (thoughtTiming) {
    thoughtTiming.activeStartedAt = undefined;
  }

  const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
  if (lastPart && 'text' in lastPart && ('text' in normalizedPart || 'thoughtSignatures' in normalizedPart)) {
    const lastThought = lastPart.thought === true;
    const nextThought = normalizedPart.thought === true;
    if (lastThought === nextThought) {
      // 如果新 part 有签名且与上一个不同，则不合并，以保留位置
      const lastSigs = JSON.stringify(lastPart.thoughtSignatures || {});
      const nextSigs = JSON.stringify(normalizedPart.thoughtSignatures || {});
      const isSignatureOnlyPart = !normalizedPart.text && nextSigs !== '{}';

      // 流式结束时如果补来一个“仅签名”块，则回填到上一段同类型文本，避免丢签名或产生空白块
      if (isSignatureOnlyPart && lastSigs === '{}') {
        lastPart.thoughtSignatures = {
          ...(lastPart.thoughtSignatures || {}),
          ...(normalizedPart.thoughtSignatures || {}),
        };
        if (normalizedPart.thoughtDurationMs != null) {
          lastPart.thoughtDurationMs = normalizedPart.thoughtDurationMs;
        }
        return lastPart;
      }

      // 只有在签名一致，或者新块没有签名时才合并
      if (nextSigs === '{}' || lastSigs === nextSigs) {
        if (normalizedPart.text) {
          lastPart.text = (lastPart.text || '') + normalizedPart.text;
        }
        if (normalizedPart.thoughtDurationMs != null) {
          lastPart.thoughtDurationMs = normalizedPart.thoughtDurationMs;
        }
        return lastPart;
      }
    }
  }
  parts.push(normalizedPart);
  return normalizedPart;
}

// ============ 配置与事件类型 ============

export interface BackendConfig {
  /** 工具执行最大轮次 */
  maxToolRounds?: number;
  /** LLM 调用报错时是否自动重试 */
  retryOnError?: boolean;
  /** 自动重试最大次数 */
  maxRetries?: number;
  /** 工具执行策略配置 */
  toolsConfig?: ToolsConfig;
  /** 是否启用流式输出 */
  stream?: boolean;
  /** 是否自动召回记忆 */
  autoRecall?: boolean;
  /** 子代理协调指导文本 */
  subAgentGuidance?: string;
  /** 默认模式名称 */
  defaultMode?: string;
  /** 当前活动模型配置（用于 vision 能力判定） */
  currentLLMConfig?: LLMConfig;
  /** OCR 服务（当主模型不支持 vision 时回退使用） */
  ocrService?: OCRProvider;
  /** Computer Use 截图保留的最近轮次数（默认 3） */
  maxRecentScreenshots?: number;
  /** 用于 /compact 上下文压缩的模型名称（需在 LLMRouter 中已注册） */
  summaryModelName?: string;
  /** 上下文压缩提示词配置 */
  summaryConfig?: SummaryConfig;
  /** Skill 定义列表 */
  skills?: SkillDefinition[];
}

export interface BackendEvents {
  /** 非流式最终回复 */
  'response': (sessionId: string, text: string) => void;
  /** 流式段开始 */
  'stream:start': (sessionId: string) => void;
  /** 流式结构化 part 增量（按顺序） */
  'stream:parts': (sessionId: string, parts: Part[]) => void;
  /** 流式文本块 */
  'stream:chunk': (sessionId: string, chunk: string) => void;
  /** 流式段结束 */
  'stream:end': (sessionId: string, usage?: UsageMetadata) => void;
  /** 工具状态变更 */
  'tool:update': (sessionId: string, invocations: ToolInvocation[]) => void;
  /** 处理出错 */
  'error': (sessionId: string, error: string) => void;
  /** Token 用量（每轮 LLM 调用后发出） */
  'usage': (sessionId: string, usage: UsageMetadata) => void;
  /** LLM 调用重试（attempt 从 1 开始，maxRetries 为允许的最大重试次数） */
  'retry': (sessionId: string, attempt: number, maxRetries: number, error: string) => void;
  /** 当前用户回合完成（统一耗时来源） */
  'done': (sessionId: string, durationMs: number) => void;
  /** 一轮模型输出完成后的完整内容（结构化） */
  'assistant:content': (sessionId: string, content: Content) => void;
  /** 自动上下文压缩完成（阈值触发） */
  'auto-compact': (sessionId: string, summaryText: string) => void;
  /**
   * 工具执行产生的附件（例如 MCP 生图结果）。
   *
   * 这里是平台层的旁路通道：附件不进入 LLM 上下文，
   * 由具体平台自己决定如何发送给用户。
   */
  'attachments': (sessionId: string, attachments: ToolAttachment[]) => void;
}

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
  private maxRecentScreenshots: number;
  private summaryModelName?: string;
  private summaryConfig?: SummaryConfig;

  private toolLoop: ToolLoop;
  private toolLoopConfig: ToolLoopConfig;
  private toolState: ToolStateManager;

  /** 当前正在处理的 sessionId（用于工具事件转发） */
  private activeSessionId?: string;

  /** 每个 sessionId 的 AbortController，用于中止正在进行的 chat */
  private activeAbortControllers = new Map<string, AbortController>();

  /** 每个 session 的 redo 栈。每组元素都是一次 undo 移除的完整 Content 组。 */
  private redoHistory = new Map<string, Content[][]>();

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
    this.maxRecentScreenshots = config?.maxRecentScreenshots ?? 3;
    this.summaryModelName = config?.summaryModelName;
    this.summaryConfig = config?.summaryConfig;

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

    this.toolLoopConfig.beforeToolExec = undefined;
    this.toolLoopConfig.afterToolExec = undefined;
    this.toolLoopConfig.beforeLLMCall = undefined;
    this.toolLoopConfig.afterLLMCall = undefined;

    // 将 onBeforeToolExec 钩子组合为拦截器，注入到工具循环配置
    const beforeToolExecHooks = hooks.filter(h => h.onBeforeToolExec);
    if (beforeToolExecHooks.length > 0) {
      this.toolLoopConfig.beforeToolExec = async (toolName, args) => {
        let currentArgs = args;
        for (const hook of beforeToolExecHooks) {
          try {
            const result = await hook.onBeforeToolExec!({ toolName, args: currentArgs });
            if (result) {
              if (result.blocked) return result;
              if (result.args) currentArgs = result.args;
            }
          } catch (err) {
            logger.warn(`插件钩子 "${hook.name}" onBeforeToolExec 执行失败:`, err);
          }
        }
        if (currentArgs !== args) return { blocked: false as const, args: currentArgs };
        return undefined;
      };
    }

    const afterToolExecHooks = hooks.filter(h => h.onAfterToolExec);
    if (afterToolExecHooks.length > 0) {
      this.toolLoopConfig.afterToolExec = async (toolName, args, result, durationMs) => {
        let currentResult = result;
        let changed = false;
        for (const hook of afterToolExecHooks) {
          try {
            const hookResult = await hook.onAfterToolExec!({ toolName, args, result: currentResult, durationMs });
            if (hookResult) {
              currentResult = hookResult.result;
              changed = true;
            }
          } catch (err) {
            logger.warn(`插件钩子 "${hook.name}" onAfterToolExec 执行失败:`, err);
          }
        }
        return changed ? { result: currentResult } : undefined;
      };
    }

    const beforeLLMCallHooks = hooks.filter(h => h.onBeforeLLMCall);
    if (beforeLLMCallHooks.length > 0) {
      this.toolLoopConfig.beforeLLMCall = async (request, round) => {
        let currentRequest = request;
        let changed = false;
        for (const hook of beforeLLMCallHooks) {
          try {
            const hookResult = await hook.onBeforeLLMCall!({ request: currentRequest, round });
            if (hookResult) {
              currentRequest = hookResult.request;
              changed = true;
            }
          } catch (err) {
            logger.warn(`插件钩子 "${hook.name}" onBeforeLLMCall 执行失败:`, err);
          }
        }
        return changed ? { request: currentRequest } : undefined;
      };
    }

    const afterLLMCallHooks = hooks.filter(h => h.onAfterLLMCall);
    if (afterLLMCallHooks.length > 0) {
      this.toolLoopConfig.afterLLMCall = async (content, round) => {
        let currentContent = content;
        let changed = false;
        for (const hook of afterLLMCallHooks) {
          try {
            const hookResult = await hook.onAfterLLMCall!({ content: currentContent, round });
            if (hookResult) {
              currentContent = hookResult.content;
              changed = true;
            }
          } catch (err) {
            logger.warn(`插件钩子 "${hook.name}" onAfterLLMCall 执行失败:`, err);
          }
        }
        return changed ? { content: currentContent } : undefined;
      };
    }
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

      const storedUserParts = await this.buildStoredUserParts(text, images, documents);
      const llmUserParts = this.preparePartsForLLM(storedUserParts);
      await this.handleMessage(sessionId, storedUserParts, llmUserParts, abortController.signal, platformName);
    } catch (err) {
      // 区分用户主动 abort 和其他错误
      if (abortController.signal.aborted) {
        logger.info(`chat 已被中止 (session=${sessionId})`);
        // abort 不视为错误，不 emit 'error'
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
   *
   * 幂等操作：对不存在或已完成的 sessionId 不报错。
   * 中止后，chat() 内的 LLM 调用和工具执行会尽快退出，
   * ToolLoop 会清理历史中不完整的消息以保证格式合法。
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
    this.clearRedo(sessionId);
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
   *
   * 取最后一条总结消息（若有）之后的所有历史，调用 LLM 生成摘要，
   * 然后将摘要作为 isSummary 标记的 user 消息追加到历史末尾。
   * 后续 LLM 调用在 prepareHistoryForLLM 中会自动从最后一条总结消息开始加载。
   */
  async summarize(sessionId: string, signal?: AbortSignal): Promise<string> {
    const history = await this.storage.getHistory(sessionId);
    if (history.length === 0) {
      throw new Error('当前会话没有历史消息');
    }

    // 定位最后一条总结消息，只总结其后的内容
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

    // 调用 LLM 生成摘要
    const summaryText = await summarizeHistory(
      this.router,
      toSummarize,
      this.summaryModelName,
      this.summaryConfig,
      signal,
    );

    const now = Date.now();
    const fullText = `[Context Summary]\n\n${summaryText}`;

    // 估算 token 数
    const estimatedTokens = estimateTokenCount(fullText);

    // 持久化总结 user 消息
    const summaryContent: Content = {
      role: 'user',
      parts: [{ text: fullText }],
      isSummary: true,
      createdAt: now,
      ...(estimatedTokens > 0 ? { usageMetadata: { promptTokenCount: estimatedTokens } } : {}),
    };
    await this.storage.addMessage(sessionId, summaryContent);

    this.clearRedo(sessionId);
    return summaryText;
  }

  /** 清空指定会话的 redo 栈。任何新的写入都应使 redo 失效。 */
  clearRedo(sessionId: string): void {
    this.redoHistory.delete(sessionId);
  }

  /**
   * 统一 undo：由 Backend 决定本次应删除哪一组 Content，
   * 并将其压入 redo 栈。平台层只消费返回结果并处理 UI。
   */
  async undo(sessionId: string, scope: UndoScope = 'last-turn'): Promise<UndoOperationResult | null> {
    const history = await this.storage.getHistory(sessionId);
    if (history.length === 0) return null;

    const removeStart = this.resolveUndoStartIndex(history, scope);
    if (removeStart < 0 || removeStart >= history.length) return null;

    const removed = history.slice(removeStart);
    if (removed.length === 0) return null;

    await this.storage.truncateHistory(sessionId, removeStart);
    this.pushRedoGroup(sessionId, removed);

    const summary = this.summarizeHistoryGroup(removed);
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
   * 恢复的是原始历史，而不是重新调用 LLM。
   */
  async redo(sessionId: string): Promise<RedoOperationResult | null> {
    const stack = this.redoHistory.get(sessionId);
    if (!stack || stack.length === 0) return null;

    const restored = stack.pop()!;
    for (const content of restored) {
      await this.addMessage(sessionId, content, { clearRedo: false });
    }

    const summary = this.summarizeHistoryGroup(restored);
    return {
      restored,
      restoredCount: restored.length,
      userText: summary.userText,
      assistantText: summary.assistantText,
    };
  }

  /**
   * 添加消息到会话历史。
   * 默认会清空 redo 栈，因为任何新的写入都代表分叉，之前的 redo 应失效。
   * redo 恢复自身会传 clearRedo=false，避免把自己的栈清掉。
   */
  async addMessage(sessionId: string, content: Content, options?: { clearRedo?: boolean }): Promise<void> {
    if (options?.clearRedo !== false) {
      this.clearRedo(sessionId);
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
   *
   * 自动拦截 cd 命令，改为 process.chdir()。
   * 其余命令通过子进程执行，返回输出。
   */
  runCommand(cmd: string): { output: string; cwd: string } {
    const trimmed = cmd.trim();

    // 拦截 cd 命令
    const cdMatch = trimmed.match(/^cd\s+(.+)$/i);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^["']|["']$/g, '');
      this.setCwd(target);
      return { output: `已切换到: ${process.cwd()}`, cwd:process.cwd() };
    }

    // 执行其余命令
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

  /** 注册 Skill 列表变化回调（用于热重载后重建 read_skill 工具声明） */
  setOnSkillsChanged(callback: () => void): void {
    this._onSkillsChanged = callback;
  }

  /** 列出所有已定义的 Skill 摘要。这里只返回最小必要信息，完整内容由 read_skill 工具按 path 读取。 */
  listSkills(): { name: string; path: string; description?: string }[] {
    return this.skills.map(s => ({
      name: s.name,
      path: s.path,
      description: s.description,
    }));
  }

  /** 按 path 标识查找 Skill。供 read_skill 工具按需读取完整 Skill 内容。 */
  getSkillByPath(skillPath: string): SkillDefinition | undefined {
    return this.skills.find(s => s.path === skillPath);
  }

  /**
   * 从文件系统重新扫描 Skill 并合并内联定义，更新内存中的 Skill 列表。
   * 用于文件系统 watcher 检测到 SKILL.md 变化时触发热重载。
   *
   * @param dataDir  数据目录，用于定位全局 skills 目录
   * @param inlineSkills  system.yaml 中的内联 Skill 定义（可选，不传则只更新文件系统 Skill）
   */
  reloadSkillsFromFilesystem(dataDir: string, inlineSkills?: SkillDefinition[]): void {
    const fsSkills: SkillDefinition[] = loadSkillsFromFilesystem(dataDir);

    // 合并：文件系统 Skill 打底，内联定义覆盖同名
    const merged = new Map<string, SkillDefinition>();
    for (const s of fsSkills) merged.set(s.name, s);
    if (inlineSkills) {
      for (const s of inlineSkills) merged.set(s.name, s);
    }

    const newSkills = Array.from(merged.values());

    // 只在列表实际发生变化时才触发回调，避免无意义的工具重建
    const oldPaths = this.skills.map(s => s.path).sort().join('\0');
    const newPaths = newSkills.map(s => s.path).sort().join('\0');
    if (oldPaths === newPaths) {
      // 路径一致但内容可能变化，静默更新内容
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

  /** 切换当前 Mode，返回是否成功（Mode 不存在时返回 false） */
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
  switchModel(modelName: string) {
    const info = this.router.setCurrentModel(modelName);
    this.currentLLMConfig = this.router.getCurrentConfig();
    logger.info(`当前模型已切换: ${info.modelName} -> ${info.modelId}`);
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
   *
   * @param toolId   工具调用实例 ID
   * @param approved true=批准（转为 executing），false=拒绝（转为 error）
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
   *
   * @param toolId  工具调用实例 ID
   * @param applied true=确认执行（转为 executing），false=拒绝（转为 error）
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
    maxRecentScreenshots?: number;
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
    if (opts.maxRecentScreenshots !== undefined) this.maxRecentScreenshots = opts.maxRecentScreenshots;
    // 修复：使用 'in' 操作符判断调用方是否传入了 skills 字段。
    // 原写法 `opts.skills !== undefined` 在新配置无 skill 时（skills: undefined）
    // 不会清空旧列表，导致已删除的 Skill 残留在内存中。
    if ('skills' in opts) {
      this.skills = opts.skills ?? [];
      // Skill 列表变化后，通知外部重建 read_skill 工具声明。
      this._onSkillsChanged?.();
    }
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.toolLoopConfig.maxRounds} toolPolicies=${Object.keys(this.toolLoopConfig.toolsConfig.permissions).length}`);
  }

  /** 重置配置文件为默认值（覆盖 ~/.iris/configs/） */
  resetConfigToDefaults(): { success: boolean; message: string } {
    return doResetConfigToDefaults();
  }

  // ============ 核心流程 ============

  /**
   * 根据当前模型配置解析自动总结阈值（绝对 token 数）。
   * 支持绝对值（number）和 contextWindow 百分比（string "80%"）。
   * 未配置或无法解析时返回 undefined。
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

    // 清除上一轮残留的工具调用记录，防止多轮循环中 tool:update 广播历史 invocations 导致 UI 重复显示
    this.toolState.clearAll();

    // 1. 加载历史并追加用户消息
    // ⚠️ 注意：Backend 不处理连续用户消息的合并。
    //    如果平台层并发调用 chat()，历史中会出现连续两条 role: "user" 的消息。
    //    部分 LLM API（如 Gemini）不允许同角色消息相邻，可能导致请求失败。
    //    平台层应自行实现并发控制或消息缓冲（参考 WXWorkPlatform 的实现）。
    let storedHistory = await this.storage.getHistory(sessionId);

    // 1.1 兜底清理：修复因中断/崩溃导致的不完整历史（dangling functionCall 等）
    const beforeSanitize = storedHistory.length;
    const sanitizeAppended = sanitizeHistory(storedHistory);
    const keptFromOriginal = storedHistory.length - sanitizeAppended.length;
    if (keptFromOriginal !== beforeSanitize || sanitizeAppended.length > 0) {
      // 有消息被删除或追加，同步到磁盘
      if (keptFromOriginal < beforeSanitize) {
        await this.storage.truncateHistory(sessionId, keptFromOriginal);
      }
      for (const msg of sanitizeAppended) {
        await this.storage.addMessage(sessionId, msg);
      }
      logger.info(`历史兜底清理: session=${sessionId}, ${beforeSanitize} → ${storedHistory.length} 条`);
    }

    // 1.2 自动上下文压缩（pre-message）：上一轮 token 总量 + 本轮用户消息估算值 > 阈值 → 先压缩
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

    const history = this.prepareHistoryForLLM(storedHistory);
    const isNewSession = storedHistory.length === 0;
    const userText = extractText(llmUserParts);

    // Skill 已改为通过 read_skill 工具按需读取。
    // 因此这里直接保留用户原始消息，不再把 Skill 内容拼接进当前轮输入。
    history.push({ role: 'user', parts: llmUserParts });

    // 2. 构建 per-request 额外上下文
    let extraParts: Part[] | undefined;

    // 记忆自动召回
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

    // 子代理协调指导
    if (this.subAgentGuidance) {
      if (!extraParts) extraParts = [];
      extraParts.push({ text: this.subAgentGuidance });
    }

    // 模式提示词覆盖
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
        content = await this.callLLMStream(sessionId, request, modelName, callSignal);
        if (content.usageMetadata?.totalTokenCount) lastCallTotalTokens = content.usageMetadata.totalTokenCount;
        // 让 stream:end 的 SSE 数据在 assistant:content 之前到达浏览器，
        // 使客户端有机会在 onStreamEnd 中 flush 流式文本并触发渲染，
        // 再收到 onAssistantContent 设置 receivedFinalAssistantPayload。
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
    // 5. 新用户消息会让 redo 失效：从这里开始就是新的分叉。
    this.clearRedo(sessionId);
    //    立即持久化用户消息（不等工具循环结束，防止中途中断丢失）
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
    // 通知前端用户消息的估算 token 数
    if (estimatedUserTokens > 0) this.emit('user:token', sessionId, estimatedUserTokens);
    // 追踪用户消息 token 到 session 累计值
    this.lastSessionTokens.set(sessionId, (this.lastSessionTokens.get(sessionId) ?? 0) + estimatedUserTokens);

    // 6. 执行工具循环（新增消息通过回调实时持久化；redo 已在步骤 5 清空，无需重复清）
    const result = await loop.run(history, callLLM, {
      extraParts,
      onMessageAppend: (content) => this.storage.addMessage(sessionId, content),
      // 上游 main 新增：模型输出完成后通知平台层
      onModelContent: (content) => { this.emit('assistant:content', sessionId, content); },
      // feat 分支新增：MCP 附件单独旁路给平台层
      // 文本继续走原有 tool loop / history 流程，
      // 图片等二进制内容直接由 Telegram / Discord / Lark 等平台发送，
      // 这样不会把 base64 图片带进历史，也不会撑爆上下文。
      onAttachments: (attachments) => {
        logger.info(`[handleMessage] onAttachments 回调触发: sessionId=${sessionId}, count=${attachments.length}, types=${attachments.map(a => `${a.type}(${a.data.length}B)`).join(',')}`);
        this.emit('attachments', sessionId, attachments);
      },
      signal,
      onRetry: (attempt, maxRetries, error) => {
        this.emit('retry', sessionId, attempt, maxRetries, error);
      },
    });

    // 6.1. 如果被 abort，提前退出，不做后续处理
    if (result.aborted) {
      // buildAbortResult 已清理内存中的 history，但 onMessageAppend 可能已将不完整的消息写入磁盘。
      // 用 truncateHistory 将磁盘回滚到与内存一致的状态，防止下次加载时出现 dangling functionCall。
      await this.storage.truncateHistory(sessionId, result.history.length);
      this.emit('done', sessionId, Date.now() - startTime);
      return;
    }

    // 6.2. 如果工具循环返回了错误（LLM 调用失败、超过最大轮次等），
    // 仅通过事件通知平台层显示，不存入对话历史、不发给 AI。
    if (result.error) {
      this.emit('error', sessionId, result.error);
      this.emit('done', sessionId, Date.now() - startTime);
      return;
    }


    // 6.5. 工具循环若以“文本回退”结束（如 LLM 调用失败 / 超过最大轮次），
    // ToolLoop 不会追加最后一条 model 消息；这里补一条，统一平台事件与持久化行为。
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

    // 7. 将耗时写入最后一条 model 消息（同时更新已持久化的记录）
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

    // 9. 插件钩子: onAfterChat（可修改最终响应文本）
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

    // 11. 更新 session token 追踪；若超阈值则自动压缩（为下一轮准备）
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

  // ============ 流式调用 ============

  private async callLLMStream(
    sessionId: string,
    request: LLMRequest,
    modelName?: string,
    signal?: AbortSignal,
  ): Promise<Content> {
    const parts: Part[] = [];
    let usageMetadata: UsageMetadata | undefined;
    let streamOutputFirstChunkAt: number | undefined;
    let streamOutputLastChunkAt: number | undefined;
    let streamOutputChunkCount = 0;
    const thoughtTiming: ThoughtTimingState = {};

    this.emit('stream:start', sessionId);

    const llmStream = this.router.chatStream(request, modelName, signal);
    for await (const chunk of llmStream) {
      const deltaParts: Part[] = [];

      if (chunk.partsDelta && chunk.partsDelta.length > 0) {
        deltaParts.push(...chunk.partsDelta);
      } else {
        if (chunk.textDelta) {
          deltaParts.push({ text: chunk.textDelta });
        }
        if (chunk.functionCalls) {
          deltaParts.push(...chunk.functionCalls);
        }
      }

      if (deltaParts.length > 0) {
        const emittedParts: Part[] = [];
        const now = Date.now();
        if (streamOutputFirstChunkAt == null) {
          streamOutputFirstChunkAt = now;
        }
        streamOutputLastChunkAt = now;
        streamOutputChunkCount++;
        for (const part of deltaParts) {
          const merged = appendMergedPart(parts, part, now, thoughtTiming);
          // appendMergedPart 返回的是 parts 数组中累积后的对象引用（原地拼接），
          // 不能直接作为增量发送，否则前端会收到全量内容导致重复。
          // 这里用原始的 delta part 浅拷贝作为增量发送。
          const delta: Part = { ...part };
          // 如果是 thought 类型，补上 appendMergedPart 计算出的 timing 信息
          if ('text' in delta && 'text' in merged
            && delta.thought === true && merged.thoughtDurationMs != null) {
            delta.thoughtDurationMs = merged.thoughtDurationMs;
          }
          emittedParts.push(delta);
        }
        this.emit('stream:parts', sessionId, emittedParts);
      }

      if (chunk.textDelta) {
        this.emit('stream:chunk', sessionId, chunk.textDelta);
      }
      if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;

      // 当 LLM 代理将流式响应缓冲后一次性返回时，async generator 的所有 yield
      // 通过微任务链连续恢复，res.write() 调用不会真正 flush 到 TCP socket。
      // 插入宏任务断点让事件循环走过 I/O 阶段，确保每个 chunk 的 SSE 数据
      // 被操作系统发送到客户端，使浏览器端能逐步接收到流式事件。
      if (deltaParts.length > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    // 诊断日志：流式 chunk 到达时间分布
    if (streamOutputChunkCount > 0) {
      const spread = (streamOutputLastChunkAt ?? 0) - (streamOutputFirstChunkAt ?? 0);
      logger.info(`[Stream] ${streamOutputChunkCount} chunks, spread=${spread}ms (first→last)`);
    }

    // 确保最后一个 chunk 的 SSE 数据已刷新到 TCP socket，再发送 stream:end
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.emit('stream:end', sessionId, usageMetadata);
    if (usageMetadata) {
      this.emit('usage', sessionId, usageMetadata);
    }

    if (parts.length === 0) parts.push({ text: '' });

    const content: Content = {
      role: 'model',
      parts,
      createdAt: streamOutputFirstChunkAt ?? Date.now(),
      modelName: modelName || this.router.getCurrentModelName(),
    };
    if (usageMetadata) content.usageMetadata = usageMetadata;
    if (
      streamOutputChunkCount >= 3 &&
      streamOutputFirstChunkAt != null &&
      streamOutputLastChunkAt != null
    ) content.streamOutputDurationMs = streamOutputLastChunkAt - streamOutputFirstChunkAt;

    return content;
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

  private async buildStoredUserParts(text: string, images?: ImageInput[], documents?: DocumentInput[]): Promise<Part[]> {
    const parts: Part[] = [];
    const hasText = text.trim().length > 0;
    const hasImages = Array.isArray(images) && images.length > 0;
    const hasDocuments = Array.isArray(documents) && documents.length > 0;
    const visionEnabled = llmSupportsVision(this.currentLLMConfig);

    // ---- 图片处理（含自动缩放） ----
    if (hasImages) {
      if (visionEnabled || !this.ocrService) {
        for (const image of images!) {
          // 自动缩放
          const resized = await resizeImage(image.mimeType, image.data);
          parts.push({ inlineData: { mimeType: resized.mimeType, data: resized.data } });

          // 仅在 vision 启用时添加坐标映射说明（非 vision 模型会剥离图片，dimension note 无意义）
          if (visionEnabled) {
            const dimNote = formatDimensionNote(resized);
            if (dimNote) {
              parts.push({ text: dimNote });
            }
          }
        }
      } else if (this.ocrService) {
        // OCR 模式：先缩放再 OCR
        const resizedImages = await Promise.all(images!.map(async (image) => {
          return await resizeImage(image.mimeType, image.data);
        }));

        const ocrTexts = await Promise.all(resizedImages.map(async (resized, index) => {
          try {
            return await this.ocrService!.extractText(resized.mimeType, resized.data);
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`OCR 处理第 ${index + 1} 张图片失败: ${detail}`);
          }
        }));

        for (let index = 0; index < resizedImages.length; index++) {
          const resized = resizedImages[index];
          parts.push({ inlineData: { mimeType: resized.mimeType, data: resized.data } });
          parts.push(createOCRTextPart(index + 1, ocrTexts[index]));
        }
      }
    }

    // ---- 文档处理（按端点能力分级） ----
    if (hasDocuments) {
      const nativePdf = supportsNativePDF(this.currentLLMConfig);
      const nativeOffice = supportsNativeOffice(this.currentLLMConfig);

      const EXTENSION_TO_MIME: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
      };

      for (const doc of documents!) {
        // 解析有效 MIME
        let effectiveMime = doc.mimeType;
        const ext = doc.fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
        if (!isDocumentMimeType(effectiveMime) && ext in EXTENSION_TO_MIME) {
          effectiveMime = EXTENSION_TO_MIME[ext];
        }

        const isPdf = effectiveMime === 'application/pdf';
        const isOffice = isDocumentMimeType(effectiveMime) && !isPdf;

        if (isPdf && nativePdf) {
          // ① PDF 直传（Gemini / Claude / OpenAI Responses）
          parts.push({ inlineData: { mimeType: 'application/pdf', data: doc.data } });
          parts.push({ text: `[Document: ${doc.fileName}]` });
        } else if (isOffice && nativePdf) {
          // ② Office 优先转 PDF 直传（Gemini / Claude / OpenAI Responses）
          const pdfBuffer = await convertToPDF(Buffer.from(doc.data, 'base64'), ext);
          if (pdfBuffer) {
            parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } });
            parts.push({ text: `[Document: ${doc.fileName}]` });
          } else if (nativeOffice) {
            // 转换失败，但端点支持 Office 原生直传（OpenAI Responses）
            parts.push({ inlineData: { mimeType: effectiveMime, data: doc.data } });
            parts.push({ text: `[Document: ${doc.fileName}]` });
          } else {
            // 转换失败，回退文本提取
            await this.extractDocumentFallback(doc, parts);
          }
        } else if (isOffice && nativeOffice) {
          // ③ 端点支持 Office 但不支持 PDF（当前无此情况，留作扩展）
          parts.push({ inlineData: { mimeType: effectiveMime, data: doc.data } });
          parts.push({ text: `[Document: ${doc.fileName}]` });
        } else {
          // ④ 文本提取（OpenAI Compatible 或不支持原生的情况）
          await this.extractDocumentFallback(doc, parts);
        }
      }
    }

    if (hasText) {
      parts.push({ text });
    }

    if (parts.length === 0) {
      parts.push({ text: '' });
    }

    return parts;
  }

  /** 文档回退文本提取（复用原有 extractDocument 逻辑） */
  private async extractDocumentFallback(doc: DocumentInput, parts: Part[]): Promise<void> {
    try {
      const result = await extractDocument(doc);
      if (result.success) {
        parts.push({ text: `[Document: ${doc.fileName}]\n${result.text}` });
      } else {
        logger.warn(`文档提取失败 (${doc.fileName}): ${result.error}`);
        parts.push({ text: `[Document: ${doc.fileName}] 提取失败: ${result.error}` });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn(`文档处理异常 (${doc.fileName}): ${detail}`);
      parts.push({ text: `[Document: ${doc.fileName}] 处理异常: ${detail}` });
    }
  }

  private prepareHistoryForLLM(history: Content[]): Content[] {
    // 从最后一条总结消息开始加载上下文，跳过更早的历史
    let startIndex = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].isSummary) {
        startIndex = i;
        break;
      }
    }
    const relevantHistory = startIndex > 0 ? history.slice(startIndex) : history;

    const prepared = relevantHistory.map((content) => ({
      role: content.role,
      parts: this.preparePartsForLLM(content.parts),
      usageMetadata: content.usageMetadata,
      durationMs: content.durationMs,
      streamOutputDurationMs: content.streamOutputDurationMs,
    }));

    // Computer Use 截图清理：只保留最近 N 轮含截图的工具响应，
    // 超出的旧轮次中把 functionResponse.parts（截图）剥离以节省 token。
    // 与 Gemini 官方示例的处理逻辑一致。
    this.stripOldScreenshots(prepared);

    return prepared;
  }

  /**
   * 从历史末尾向前扫描，保留最近 maxRecentScreenshots 轮含 Computer Use 截图
   * 的工具响应，超出部分把 functionResponse.parts 置空。
   * 直接修改传入的数组，不产生新对象。
   */
  private stripOldScreenshots(history: Content[]): void {
    const max = this.maxRecentScreenshots;
    if (max === Infinity) return;  // 全部保留

    let screenshotTurns = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const content = history[i];
      if (content.role !== 'user') continue;

      // 检查此 user 轮是否包含带截图的 Computer Use 工具响应
      const hasCUScreenshot = content.parts.some(
        p => isFunctionResponsePart(p)
          && p.functionResponse.parts?.length
          && COMPUTER_USE_FUNCTION_NAMES.has(p.functionResponse.name),
      );
      if (!hasCUScreenshot) continue;

      screenshotTurns++;
      if (screenshotTurns > max) {
        // 剥离此轮中所有 Computer Use 工具响应的截图
        for (const part of content.parts) {
          if (isFunctionResponsePart(part)
            && part.functionResponse.parts?.length
            && COMPUTER_USE_FUNCTION_NAMES.has(part.functionResponse.name)) {
            part.functionResponse.parts = undefined;
          }
        }
      }
    }
  }

  private preparePartsForLLM(parts: Part[]): Part[] {
    const visionEnabled = llmSupportsVision(this.currentLLMConfig);
    const prepared: Part[] = [];
    let strippedImageCount = 0;
    let strippedDocumentCount = 0;
    let hasOCRContext = false;

    for (const part of parts) {
      if (isOCRTextPart(part)) {
        hasOCRContext = true;
        if (!visionEnabled && part.text) {
          prepared.push({ ...part, text: stripOCRTextMarker(part.text) });
        }
        continue;
      }

      if (isInlineDataPart(part)) {
        const mime = part.inlineData.mimeType;
        if (isDocumentMimeType(mime)) {
          // 文档 InlineDataPart：按端点能力决定保留或剥离
          if (mime === 'application/pdf' && supportsNativePDF(this.currentLLMConfig)) {
            prepared.push({ inlineData: { ...part.inlineData } });
          } else if (mime !== 'application/pdf' && supportsNativeOffice(this.currentLLMConfig)) {
            prepared.push({ inlineData: { ...part.inlineData } });
          } else {
            strippedDocumentCount++;
          }
        } else {
          // 图片 InlineDataPart：现有逻辑
          if (visionEnabled) {
            prepared.push({ inlineData: { ...part.inlineData } });
          } else {
            strippedImageCount++;
          }
        }
        continue;
      }

      if (isFunctionCallPart(part)) {
        prepared.push({
          functionCall: {
            name: part.functionCall.name,
            args: JSON.parse(JSON.stringify(part.functionCall.args ?? {})),
            callId: part.functionCall.callId,
          },
        });
        continue;
      }

      if (isFunctionResponsePart(part)) {
        prepared.push({
          functionResponse: {
            name: part.functionResponse.name,
            response: JSON.parse(JSON.stringify(part.functionResponse.response ?? {})),
            callId: part.functionResponse.callId,
            // 保留工具结果中的多模态内联数据（截图、音频等）
            ...(part.functionResponse.parts
              ? { parts: part.functionResponse.parts.map(p => ({ inlineData: { ...p.inlineData } })) }
              : {}),
          },
        });
        continue;
      }

      if (isTextPart(part)) {
        prepared.push({
          ...part,
          thoughtSignatures: part.thoughtSignatures ? { ...part.thoughtSignatures } : undefined,
        });
        continue;
      }

      const _exhaustive: never = part;
      void _exhaustive;
    }

    if (!visionEnabled && strippedImageCount > 0 && !hasOCRContext) {
      prepared.unshift({ text: IMAGE_UNAVAILABLE_NOTICE(strippedImageCount) });
    }
    if (strippedDocumentCount > 0) {
      prepared.unshift({ text: DOCUMENT_UNAVAILABLE_NOTICE(strippedDocumentCount) });
    }

    if (prepared.length === 0) {
      prepared.push({ text: '' });
    }

    return prepared;
  }

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
          // 跳过图片缩放 dimension note 和文档提取文本（不应出现在 session 标题中）
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
        // 将当前平台追加到列表（去重）
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

  /** 判断一条 user 消息是否纯粹是工具响应。 */
  private isToolResponseContent(content: Content): boolean {
    return content.role === 'user'
      && content.parts.length > 0
      && content.parts.every(part => isFunctionResponsePart(part));
  }

  /** 获取历史末尾 assistant 回复段的起始位置；若末尾不是 assistant 回复则返回 null。 */
  private getAssistantResponseStartIndex(history: Content[]): number | null {
    let startIndex: number | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.role === 'model' || this.isToolResponseContent(entry)) {
        startIndex = i;
        continue;
      }
      break;
    }
    return startIndex;
  }

  /** 解析本次 undo 应该从哪一条消息开始截断。 */
  private resolveUndoStartIndex(history: Content[], scope: UndoScope): number {
    const assistantStart = this.getAssistantResponseStartIndex(history);

    if (scope === 'last-visible-message') {
      // 末尾若是 assistant 回复，则删除整段 assistant 回复；否则删除末尾那条普通消息。
      return assistantStart ?? (history.length - 1);
    }

    // last-turn：如果末尾是 assistant 回复，则连同其前面的 user 消息一起删；
    // 如果末尾本身就是 user 消息，则只删这条 user。
    if (assistantStart != null) {
      const prevIndex = assistantStart - 1;
      if (prevIndex >= 0) {
        const previous = history[prevIndex];
        if (previous.role === 'user' && !this.isToolResponseContent(previous)) {
          return prevIndex;
        }
      }
      return assistantStart;
    }

    return history.length - 1;
  }

  /** 将一组被撤销的历史压入 redo 栈，并限制最大长度。 */
  private pushRedoGroup(sessionId: string, removed: Content[]): void {
    const stack = this.redoHistory.get(sessionId) ?? [];
    stack.push(removed.map(content => JSON.parse(JSON.stringify(content)) as Content));
    if (stack.length > MAX_REDO_HISTORY_GROUPS) {
      stack.splice(0, stack.length - MAX_REDO_HISTORY_GROUPS);
    }
    this.redoHistory.set(sessionId, stack);
  }

  /** 从一组历史中提取用户文本和 assistant 可见文本，供平台层做 UI。 */
  private summarizeHistoryGroup(group: Content[]): { userText: string; assistantText: string } {
    const userText = group
      .find(content => content.role === 'user' && !this.isToolResponseContent(content))
      ? extractText(group.find(content => content.role === 'user' && !this.isToolResponseContent(content))!.parts)
      : '';

    for (let i = group.length - 1; i >= 0; i--) {
      if (group[i].role === 'model') {
        return { userText, assistantText: extractText(group[i].parts) };
      }
    }

    return { userText, assistantText: '' };
  }
}
