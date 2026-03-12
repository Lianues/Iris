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
import type { LLMConfig } from '../config/types';
import { LLMRouter, LLMTier } from '../llm/router';
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

interface ThoughtTimingState {
  activeStartedAt?: number;
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
  /** 是否启用流式输出 */
  stream?: boolean;
  /** 是否自动召回记忆 */
  autoRecall?: boolean;
  /** Agent 协调指导文本 */
  agentGuidance?: string;
  /** 默认模式名称 */
  defaultMode?: string;
  /** 当前 primary LLM 配置（用于 vision 能力判定） */
  primaryLLMConfig?: LLMConfig;
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
  private agentGuidance?: string;
  private memory?: MemoryProvider;
  private modeRegistry?: ModeRegistry;
  private defaultMode?: string;
  private primaryLLMConfig?: LLMConfig;
  private ocrService?: OCRService;

  private toolLoop: ToolLoop;
  private toolLoopConfig: ToolLoopConfig;
  private toolState: ToolStateManager;

  /** 当前正在处理的 sessionId（用于工具事件转发） */
  private activeSessionId?: string;

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
    this.agentGuidance = config?.agentGuidance;
    this.memory = memory;
    this.modeRegistry = modeRegistry;
    this.defaultMode = config?.defaultMode;
    this.primaryLLMConfig = config?.primaryLLMConfig;
    this.ocrService = config?.ocrService;

    this.toolLoopConfig = { maxRounds: config?.maxToolRounds ?? 200 };
    this.toolLoop = new ToolLoop(tools, prompt, this.toolLoopConfig, toolState);

    // 转发工具状态事件
    this.setupToolStateForwarding();
  }

  // ============ 公共 API（平台层调用） ============

  /** 发送消息，触发完整的 LLM + 工具循环 */
  async chat(sessionId: string, text: string, images?: ImageInput[], documents?: DocumentInput[]): Promise<void> {
    const startTime = Date.now();
    try {
      const storedUserParts = await this.buildStoredUserParts(text, images, documents);
      const llmUserParts = this.preparePartsForLLM(storedUserParts);
      await this.handleMessage(sessionId, storedUserParts, llmUserParts);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`处理消息失败 (session=${sessionId}):`, err);
      this.emit('error', sessionId, errorMsg);
      this.emit('done', sessionId, Date.now() - startTime);
    } finally {
      this.activeSessionId = undefined;
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

  /** 获取工具状态管理器 */
  getToolState(): ToolStateManager {
    return this.toolState;
  }

  /** 获取流式设置 */
  isStreamEnabled(): boolean {
    return this.stream;
  }

  // ============ 热重载 ============

  /** 热重载：替换 LLM 路由器 */
  reloadLLM(newRouter: LLMRouter): void {
    this.router = newRouter;
    const tierInfo = newRouter.getTierInfo();
    const tierDesc = [
      `primary=${tierInfo.primary}`,
      tierInfo.secondary ? `secondary=${tierInfo.secondary}` : null,
      tierInfo.light ? `light=${tierInfo.light}` : null,
    ].filter(Boolean).join(' ');
    logger.info(`LLM 已热重载: [${tierDesc}]`);
  }

  /** 热重载：更新运行时参数 */
  reloadConfig(opts: {
    stream?: boolean;
    maxToolRounds?: number;
    systemPrompt?: string;
    primaryLLMConfig?: LLMConfig;
    ocrService?: OCRService;
  }): void {
    if (opts.stream !== undefined) this.stream = opts.stream;
    if (opts.maxToolRounds !== undefined) this.toolLoopConfig.maxRounds = opts.maxToolRounds;
    if (opts.systemPrompt !== undefined) this.prompt.setSystemPrompt(opts.systemPrompt);
    if ('primaryLLMConfig' in opts) this.primaryLLMConfig = opts.primaryLLMConfig;
    if ('ocrService' in opts) this.ocrService = opts.ocrService;
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.toolLoopConfig.maxRounds}`);
  }

  // ============ 核心流程 ============

  private async handleMessage(sessionId: string, storedUserParts: Part[], llmUserParts: Part[]): Promise<void> {
    this.activeSessionId = sessionId;
    const startTime = Date.now();

    // 清除上一轮残留的工具调用记录，防止多轮循环中 tool:update 广播历史 invocations 导致 UI 重复显示
    this.toolState.clearAll();

    // 1. 加载历史并追加用户消息
    const storedHistory = await this.storage.getHistory(sessionId);
    const history = this.prepareHistoryForLLM(storedHistory);
    const isNewSession = storedHistory.length === 0;
    const historyLenBefore = history.length;
    history.push({ role: 'user', parts: llmUserParts });

    // 2. 构建 per-request 额外上下文
    let extraParts: Part[] | undefined;

    // 记忆自动召回
    if (this.memory && this.autoRecall) {
      try {
        const userText = extractText(llmUserParts);
        const context = await this.memory.buildContext(userText);
        if (context) {
          extraParts = [{ text: context }];
        }
      } catch (err) {
        logger.warn('查询记忆失败:', err);
      }
    }

    // Agent 协调指导
    if (this.agentGuidance) {
      if (!extraParts) extraParts = [];
      extraParts.push({ text: this.agentGuidance });
    }

    // 模式提示词覆盖
    const mode = this.resolveMode();
    if (mode?.systemPrompt) {
      if (!extraParts) extraParts = [];
      extraParts.unshift({ text: mode.systemPrompt });
    }

    // 3. 构建 LLM 调用函数
    const callLLM: LLMCaller = async (request, tier) => {
      let content: Content;
      if (this.stream) {
        content = await this.callLLMStream(sessionId, request, tier);
      } else {
        const response = await this.router.chat(request, tier);
        content = response.content;
        if (response.usageMetadata) {
          content.usageMetadata = response.usageMetadata;
          this.emit('usage', sessionId, response.usageMetadata);
        }
      }
      this.emit('assistant:content', sessionId, content);
      return content;
    };

    // 4. 解析模式工具过滤
    let loop = this.toolLoop;
    if (mode?.tools) {
      const filteredTools = applyToolFilter(mode, this.tools);
      loop = new ToolLoop(filteredTools, this.prompt, this.toolLoopConfig, this.toolState);
    }

    const hasVisionParts = history.some(content => content.parts.some(isInlineDataPart));

    // 5. 执行工具循环
    const result = await loop.run(history, callLLM, {
      extraParts,
      secondaryTier: hasVisionParts ? 'primary' : undefined,
    });

    // 6. 将耗时写入最后一条 model 消息
    const durationMs = Date.now() - startTime;
    for (let i = result.history.length - 1; i >= 0; i--) {
      if (result.history[i].role === 'model') {
        result.history[i].durationMs = durationMs;
        break;
      }
    }

    // 7. 持久化新增消息
    await this.storage.addMessage(sessionId, { role: 'user', parts: storedUserParts });
    for (let i = historyLenBefore + 1; i < result.history.length; i++) {
      await this.storage.addMessage(sessionId, result.history[i]);
    }

    // 8. 管理会话元数据
    await this.updateSessionMeta(sessionId, storedUserParts, isNewSession);

    // 9. 非流式模式：发送最终文本
    if (!this.stream && result.text) {
      this.emit('response', sessionId, result.text);
    }
    this.emit('done', sessionId, durationMs);

    this.activeSessionId = undefined;
  }

  // ============ 流式调用 ============

  private async callLLMStream(
    sessionId: string,
    request: LLMRequest,
    tier: LLMTier = 'primary',
  ): Promise<Content> {
    const parts: Part[] = [];
    let usageMetadata: UsageMetadata | undefined;
    let streamOutputFirstChunkAt: number | undefined;
    let streamOutputLastChunkAt: number | undefined;
    let streamOutputChunkCount = 0;
    const thoughtTiming: ThoughtTimingState = {};

    this.emit('stream:start', sessionId);

    const llmStream = this.router.chatStream(request, tier);
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

    const content: Content = { role: 'model', parts };
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
    const visionEnabled = llmSupportsVision(this.primaryLLMConfig);

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
      const nativePdf = supportsNativePDF(this.primaryLLMConfig);
      const nativeOffice = supportsNativeOffice(this.primaryLLMConfig);

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
    const visionEnabled = llmSupportsVision(this.primaryLLMConfig);
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
          if (mime === 'application/pdf' && supportsNativePDF(this.primaryLLMConfig)) {
            prepared.push({ inlineData: { ...part.inlineData } });
          } else if (mime !== 'application/pdf' && supportsNativeOffice(this.primaryLLMConfig)) {
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
          },
        });
        continue;
      }

      if (isFunctionResponsePart(part)) {
        prepared.push({
          functionResponse: {
            name: part.functionResponse.name,
            response: JSON.parse(JSON.stringify(part.functionResponse.response ?? {})),
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
