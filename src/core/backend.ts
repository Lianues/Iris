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
import { execSync } from 'child_process';
import type { LLMConfig, ToolsConfig, ToolPolicyConfig } from '../config/types';
import { LLMRouter } from '../llm/router';
import { supportsVision as llmSupportsVision, isDocumentMimeType, supportsNativePDF, supportsNativeOffice } from '../llm/vision';
import { StorageProvider, SessionMeta } from '../storage/base';
import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { PromptAssembler } from '../prompt/assembler';
import { MemoryProvider } from '../memory/base';
import { ModeRegistry, ModeDefinition, applyToolFilter } from '../modes';
import { OCRService, createOCRTextPart, isOCRTextPart, stripOCRTextMarker } from '../ocr';
import { ToolLoop, ToolLoopConfig, LLMCaller } from './tool-loop';
import { createLogger } from '../logger';
import {
  Content, Part, LLMRequest, UsageMetadata, ToolInvocation,
  extractText, isFunctionCallPart, isFunctionResponsePart, isInlineDataPart, isTextPart,
} from '../types';
import { resizeImage, formatDimensionNote } from '../media/image-resize.js';
import { extractDocument, isSupportedDocumentMime } from '../media/document-extract.js';
import { convertToPDF } from '../media/office-to-pdf.js';
import type { DocumentInput } from '../media/document-extract.js';

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

export interface ChatSuggestion {
  label: string;
  text: string;
}

const DEFAULT_CHAT_SUGGESTIONS: ChatSuggestion[] = [
  { label: '继续推进', text: '请基于刚才的内容继续推进，并告诉我下一步最值得做什么。' },
  { label: '梳理关键点', text: '请先帮我梳理当前问题的关键点、风险和建议方案。' },
  { label: '校验结果', text: '请检查当前结论是否有遗漏，并给出我应该优先补充的内容。' },
];

const WORKSPACE_MUTATION_TOOL_NAMES = [
  'write_file',
  'apply_diff',
  'insert_code',
  'delete_code',
  'create_directory',
  'delete_file',
];

const WORKSPACE_MUTATION_INTENT_PATTERNS: RegExp[] = [
  /(保存|写入|落地|导出|输出到|写到).{0,20}(文件|目录|项目|仓库|工程|磁盘|本地|工作区)/i,
  /(创建|新建|生成).{0,12}(文件|目录)/i,
  /(修改|编辑|更新|重构|修复|实现|新增|删除|移除|插入|替换|打补丁|应用补丁).{0,16}(代码|源码|文件|目录|项目|仓库|工程|组件|模块|函数|样式|配置|脚本|bug|问题|功能)/i,
  /\b(write|save|create|edit|modify|update|refactor|fix|implement|insert|delete|remove|patch)\b.{0,24}\b(file|code|project|repo|repository|directory|folder|bug|issue|feature)\b/i,
  /(修改|编辑|更新|重构|修复|新增|删除|替换|写入).{0,24}(?:src|docs|scripts|deploy)\/[\w./-]+/i,
  /(修改|编辑|更新|重构|修复|新增|删除|替换|写入).{0,24}[\w./-]+\.(?:ts|tsx|js|jsx|vue|css|scss|json|ya?ml|md|txt|html|py|java|go|rs|c|cpp)/i,
  /(?:src|docs|scripts|deploy)\/[\w./-]+\s*(?:里|中|内)?\s*(修改|编辑|更新|修复|重构|新增|删除|替换|写入)/i,
  /(?:[\w./-]+\.(?:ts|tsx|js|jsx|vue|css|scss|json|ya?ml|md|txt|html|py|java|go|rs|c|cpp))\s*(修改|编辑|更新|修复|重构|新增|删除|替换|写入)/i,
];

function shouldAllowWorkspaceMutation(userText: string): boolean {
  const normalized = userText.trim();
  if (!normalized) return false;
  return WORKSPACE_MUTATION_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildRequestScopedTools(baseTools: ToolRegistry, allowWorkspaceMutation: boolean): ToolRegistry {
  if (allowWorkspaceMutation) return baseTools;
  return baseTools.createFiltered(WORKSPACE_MUTATION_TOOL_NAMES);
}

function buildWorkspaceMutationGuidance(allowWorkspaceMutation: boolean): string {
  if (allowWorkspaceMutation) return '';
  return '本轮若用户没有明确要求修改、创建、删除或保存工作区文件，请不要调用会落地到本地文件系统的写入型工具。普通问答请直接在对话中给出结果；如果用户需要文件，请提示其通过 GUI 的下载按钮导出。';
}

interface ThoughtTimingState {
  activeStartedAt?: number;
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeSuggestionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function buildSuggestionLabel(text: string): string {
  const normalized = normalizeSuggestionText(text).replace(/[。！？!?；;：:、,，]+$/g, '');
  if (!normalized) return '';

  const labelRules: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(附件|文档|图片|资料|文件)/, label: '分析附件' },
    { pattern: /(继续|推进|下一步|优先)/, label: '继续推进' },
    { pattern: /(梳理|思路|关键点|脉络)/, label: '梳理思路' },
    { pattern: /(定位|排查|报错|异常|bug|问题)/i, label: '定位问题' },
    { pattern: /(遗漏|漏项|缺口)/, label: '检查遗漏' },
    { pattern: /(检查|校验|核对|验证)/, label: '校验结果' },
    { pattern: /(风险|隐患)/, label: '检查风险' },
    { pattern: /(方案|建议|实现|做法)/, label: '给出方案' },
    { pattern: /(总结|结论|提炼|归纳)/, label: '总结结论' },
  ];

  for (const rule of labelRules) {
    if (rule.pattern.test(normalized)) {
      return rule.label;
    }
  }

  const compact = normalized
    .replace(/^(请先|请帮我先|请帮我|请你先|请你|请|先|帮我|麻烦你|麻烦|可以帮我|可以|能否)/, '')
    .replace(/^(基于刚才的内容|基于当前内容|基于上面的内容|围绕当前问题|针对当前问题)/, '')
    .replace(/(并告诉我.*|并给出.*|并说明.*|并列出.*)$/u, '')
    .trim();

  if (!compact) return '';
  return compact.length > 10 ? `${compact.slice(0, 10).trim()}…` : compact;
}

function ensureChatSuggestions(suggestions: ChatSuggestion[]): ChatSuggestion[] {
  const result: ChatSuggestion[] = [];
  const seen = new Set<string>();

  for (const item of [...suggestions, ...DEFAULT_CHAT_SUGGESTIONS]) {
    const text = normalizeSuggestionText(item.text);
    const label = buildSuggestionLabel(item.label || item.text);
    if (!text || !label || seen.has(text)) continue;
    seen.add(text);
    result.push({ label, text });
    if (result.length >= 3) break;
  }

  return result;
}

function parseChatSuggestions(rawText: string): ChatSuggestion[] {
  const normalized = stripMarkdownCodeFence(rawText);
  const arrayBlock = normalized.match(/\[[\s\S]*\]/)?.[0];
  if (!arrayBlock) return [];

  try {
    const parsed = JSON.parse(arrayBlock) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).suggestions)
        ? (parsed as any).suggestions
        : []);

    const suggestions: ChatSuggestion[] = [];
    for (const item of items) {
      const rawTextValue = typeof item === 'string'
        ? item
        : (item && typeof item === 'object' && typeof (item as any).text === 'string'
          ? (item as any).text
          : (item && typeof item === 'object' && typeof (item as any).label === 'string' ? (item as any).label : ''));
      const rawLabelValue = item && typeof item === 'object' && typeof (item as any).label === 'string'
        ? (item as any).label
        : rawTextValue;
      const text = normalizeSuggestionText(rawTextValue);
      const label = buildSuggestionLabel(rawLabelValue || rawTextValue);
      if (!text || !label) continue;
      suggestions.push({ label, text });
    }

    return ensureChatSuggestions(suggestions);
  } catch {
    return [];
  }
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
  ocrService?: OCRService;
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
  /** 当前用户回合完成（统一耗时来源） */
  'done': (sessionId: string, durationMs: number) => void;
  /** 一轮模型输出完成后的完整内容（结构化） */
  'assistant:content': (sessionId: string, content: Content) => void;
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
  private ocrService?: OCRService;

  private toolLoop: ToolLoop;
  private toolLoopConfig: ToolLoopConfig;
  private toolState: ToolStateManager;

  /** 当前正在处理的 sessionId（用于工具事件转发） */
  private activeSessionId?: string;

  /** 每个 sessionId 的 AbortController，用于中止正在进行的 chat */
  private activeAbortControllers = new Map<string, AbortController>();

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

    this.toolLoopConfig = { maxRounds: config?.maxToolRounds ?? 200, toolPolicies: config?.toolsConfig?.permissions ?? {} };
    this.toolLoop = new ToolLoop(tools, prompt, this.toolLoopConfig, toolState);

    // 转发工具状态事件
    this.setupToolStateForwarding();
  }

  // ============ 公共 API（平台层调用） ============

  /** 发送消息，触发完整的 LLM + 工具循环 */
  async chat(sessionId: string, text: string, images?: ImageInput[], documents?: DocumentInput[]): Promise<void> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);

    try {
      const storedUserParts = await this.buildStoredUserParts(text, images, documents);
      const llmUserParts = this.preparePartsForLLM(storedUserParts);
      await this.handleMessage(sessionId, storedUserParts, llmUserParts, abortController.signal);
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

  /** 生成输入框快捷建议（使用当前活动模型） */
  async generateChatSuggestions(sessionId?: string | null): Promise<ChatSuggestion[]> {
    try {
      const history = sessionId ? await this.storage.getHistory(sessionId) : [];
      const request: LLMRequest = {
        systemInstruction: {
          parts: [{ text: '你是 Iris Web GUI 的快捷建议生成器。请只返回 JSON，不要 Markdown、不要解释、不要代码块。输出一个长度为 3 的数组，每个元素都包含 label 和 text 两个字段。label 用于按钮展示，控制在 4-8 个中文字符，必须写成动作短语，风格类似”继续推进””梳理思路””分析附件””定位问题””校验结果””给出方案”，禁止直接截断 text 或写成完整问句；text 用于点击后直接发送，控制在 12-40 个中文字符。建议必须紧扣上下文、方向不同、可立即执行。' }],
        },
        contents: [{ role: 'user', parts: [{ text: this.buildChatSuggestionPrompt(history) }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 220,
        },
      };

      const response = await this.router.chat(request);
      return ensureChatSuggestions(parseChatSuggestions(extractText(response.content.parts)));
    } catch (err) {
      logger.warn('生成聊天快捷建议失败:', err);
      return ensureChatSuggestions([]);
    }
  }

  /** 截断会话历史 */
  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    await this.storage.truncateHistory(sessionId, keepCount);
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
    try {
      const output = execSync(trimmed, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
      });
      return { output: output.trimEnd(), cwd: process.cwd() };
    } catch (err: any) {
      const stderr = err.stderr?.toString().trimEnd() || '';
      const stdout = err.stdout?.toString().trimEnd() || '';
      const combined = [stdout, stderr].filter(Boolean).join('\n');
      throw new Error(combined || `命令执行失败 (exit code: ${err.status})`);
    }
  }


  /** 获取工具声明列表（供 Web API 等使用） */
  getToolNames(): string[] {
    return this.tools.getDeclarations().map(d => d.name);
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
    return this.toolLoopConfig.toolPolicies;
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
   * 中断当前正在进行的 chat 调用。
   * 会取消底层 HTTP 请求并使工具循环提前退出。
   */
  abortChat(): void {
    this.activeAbortController?.abort();
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
    toolsConfig?: ToolsConfig;
    systemPrompt?: string;
    currentLLMConfig?: LLMConfig;
    ocrService?: OCRService;
  }): void {
    if (opts.stream !== undefined) this.stream = opts.stream;
    if (opts.maxToolRounds !== undefined) this.toolLoopConfig.maxRounds = opts.maxToolRounds;
    if (opts.toolsConfig !== undefined) this.toolLoopConfig.toolPolicies = opts.toolsConfig.permissions;
    if (opts.systemPrompt !== undefined) this.prompt.setSystemPrompt(opts.systemPrompt);
    if ('currentLLMConfig' in opts) this.currentLLMConfig = opts.currentLLMConfig;
    if ('ocrService' in opts) this.ocrService = opts.ocrService;
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.toolLoopConfig.maxRounds} toolPolicies=${Object.keys(this.toolLoopConfig.toolPolicies).length}`);
  }

  // ============ 核心流程 ============

  private async handleMessage(sessionId: string, storedUserParts: Part[], llmUserParts: Part[], signal?: AbortSignal): Promise<void> {
    this.activeSessionId = sessionId;
    const startTime = Date.now();

    // 清除上一轮残留的工具调用记录，防止多轮循环中 tool:update 广播历史 invocations 导致 UI 重复显示
    this.toolState.clearAll();

    // 1. 加载历史并追加用户消息
    const storedHistory = await this.storage.getHistory(sessionId);
    const history = this.prepareHistoryForLLM(storedHistory);
    const isNewSession = storedHistory.length === 0;
    const userText = extractText(llmUserParts);
    const allowWorkspaceMutation = shouldAllowWorkspaceMutation(userText);
    history.push({ role: 'user', parts: llmUserParts });

    // 2. 构建 per-request 额外上下文
    let extraParts: Part[] | undefined;

    const workspaceMutationGuidance = buildWorkspaceMutationGuidance(allowWorkspaceMutation);
    if (workspaceMutationGuidance) {
      extraParts = [{ text: workspaceMutationGuidance }];
    }

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
    const callLLM: LLMCaller = async (request, modelName, callSignal) => {
      let content: Content;
      if (this.stream) {
        content = await this.callLLMStream(sessionId, request, modelName, callSignal);
      } else {
        const response = await this.router.chat(request, modelName, callSignal);
        content = response.content;
        content.modelName = modelName || this.router.getCurrentModelName();
        if (response.usageMetadata) {
          content.usageMetadata = response.usageMetadata;
          this.emit('usage', sessionId, response.usageMetadata);
        }
      }
      this.emit('assistant:content', sessionId, content);
      return content;
    };

    // 4. 解析模式工具过滤
    let requestTools = mode?.tools ? applyToolFilter(mode, this.tools) : this.tools;
    requestTools = buildRequestScopedTools(requestTools, allowWorkspaceMutation);

    let loop = this.toolLoop;
    if (mode?.tools) {
      loop = new ToolLoop(requestTools, this.prompt, this.toolLoopConfig, this.toolState);
    } else if (requestTools !== this.tools) {
      loop = new ToolLoop(requestTools, this.prompt, this.toolLoopConfig, this.toolState);
    }
    // 5. 立即持久化用户消息（不等工具循环结束，防止中途中断丢失）
    await this.storage.addMessage(sessionId, { role: 'user', parts: storedUserParts });
    if (isNewSession) {
      await this.updateSessionMeta(sessionId, storedUserParts, true);
    }

    // 6. 执行工具循环（新增消息通过回调实时持久化）
    const result = await loop.run(history, callLLM, {
      extraParts,
      onMessageAppend: (content) => this.storage.addMessage(sessionId, content),
      signal,
    });

    // 6.1. 如果被 abort，提前退出，不做后续处理
    if (result.aborted) {
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
    await this.updateSessionMeta(sessionId, storedUserParts, false);

    // 9. 非流式模式：发送最终文本
    if ((!this.stream || appendedFallbackModel) && result.text) {
      this.emit('response', sessionId, result.text);
    }
    this.emit('done', sessionId, durationMs);

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
    }

    this.emit('stream:end', sessionId, usageMetadata);
    if (usageMetadata) {
      this.emit('usage', sessionId, usageMetadata);
    }

    if (parts.length === 0) parts.push({ text: '' });

    const content: Content = {
      role: 'model',
      parts,
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
    return history.map((content) => ({
      role: content.role,
      parts: this.preparePartsForLLM(content.parts),
      usageMetadata: content.usageMetadata,
      durationMs: content.durationMs,
      streamOutputDurationMs: content.streamOutputDurationMs,
    }));
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

  private summarizeContentForSuggestion(content: Content): string {
    let text = '';
    let imageCount = 0;
    let documentCount = 0;
    let toolCallCount = 0;
    let toolResponseCount = 0;

    for (const part of content.parts) {
      if (isOCRTextPart(part)) continue;
      if (isTextPart(part)) {
        const value = (part.text ?? '').trim();
        if (!value || value.startsWith('[Image: original ') || value.startsWith('[Document: ')) continue;
        text += (text ? ' ' : '') + value;
        continue;
      }
      if (isInlineDataPart(part)) {
        if (isDocumentMimeType(part.inlineData.mimeType)) documentCount += 1;
        else imageCount += 1;
        continue;
      }
      if (isFunctionCallPart(part)) toolCallCount += 1;
      if (isFunctionResponsePart(part)) toolResponseCount += 1;
    }

    const summaryParts: string[] = [];
    if (text) summaryParts.push(text.replace(/\s+/g, ' ').slice(0, 180));
    if (imageCount > 0) summaryParts.push(`${imageCount}张图片`);
    if (documentCount > 0) summaryParts.push(`${documentCount}个文档`);
    if (toolCallCount > 0) summaryParts.push(`${toolCallCount}次工具调用`);
    if (toolResponseCount > 0) summaryParts.push(`${toolResponseCount}个工具结果`);
    return summaryParts.join('；');
  }

  private buildChatSuggestionPrompt(history: Content[]): string {
    const recentHistory = history.slice(-6)
      .map((content, index) => `${index + 1}. ${content.role === 'user' ? '用户' : 'Iris'}：${this.summarizeContentForSuggestion(content) || '（无可见文本）'}`)
      .join('\n');

    if (!recentHistory) {
      return '当前是一个空白新对话。请生成 3 条适合作为首条消息的中文建议，方向尽量覆盖：继续推进任务、梳理思路、分析资料或附件。';
    }

    return `请基于下面最近对话，生成 3 条用户下一步最适合发送的中文建议。\n最近上下文：\n${recentHistory}`;
  }

  private async updateSessionMeta(sessionId: string, userParts: Part[], isNewSession: boolean): Promise<void> {
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
      });
    } else {
      const meta = await this.storage.getMeta(sessionId);
      if (meta) {
        meta.updatedAt = now;
        if (meta.cwd !== cwd) {
          meta.cwd = cwd;
        }
        await this.storage.saveMeta(meta);
      }
    }
  }
}
