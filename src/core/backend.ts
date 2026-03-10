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
import { LLMRouter, LLMTier } from '../llm/router';
import { StorageProvider, SessionMeta } from '../storage/base';
import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { PromptAssembler } from '../prompt/assembler';
import { MemoryProvider } from '../memory/base';
import { ModeRegistry, ModeDefinition, applyToolFilter } from '../modes';
import { ToolLoop, ToolLoopConfig, LLMCaller } from './tool-loop';
import { createLogger } from '../logger';
import {
  Content, Part, LLMRequest, UsageMetadata, ToolInvocation,
  isFunctionCallPart, isTextPart,
} from '../types';

const logger = createLogger('Backend');

function appendMergedPart(parts: Part[], nextPart: Part): void {
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
  if (lastPart && 'text' in lastPart && 'text' in nextPart) {
    const lastThought = lastPart.thought === true;
    const nextThought = nextPart.thought === true;
    if (lastThought === nextThought) {
      lastPart.text += nextPart.text;
      if (nextPart.thoughtSignature && !lastPart.thoughtSignature) {
        lastPart.thoughtSignature = nextPart.thoughtSignature;
      }
      return;
    }
  }
  parts.push(nextPart);
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

    this.toolLoopConfig = { maxRounds: config?.maxToolRounds ?? 10 };
    this.toolLoop = new ToolLoop(tools, prompt, this.toolLoopConfig, toolState);

    // 转发工具状态事件
    this.setupToolStateForwarding();
  }

  // ============ 公共 API（平台层调用） ============

  /** 发送消息，触发完整的 LLM + 工具循环 */
  async chat(sessionId: string, text: string): Promise<void> {
    try {
      await this.handleMessage(sessionId, [{ text }]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`处理消息失败 (session=${sessionId}):`, err);
      this.emit('error', sessionId, errorMsg);
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
  reloadConfig(opts: { stream?: boolean; maxToolRounds?: number; systemPrompt?: string }): void {
    if (opts.stream !== undefined) this.stream = opts.stream;
    if (opts.maxToolRounds !== undefined) this.toolLoopConfig.maxRounds = opts.maxToolRounds;
    if (opts.systemPrompt !== undefined) this.prompt.setSystemPrompt(opts.systemPrompt);
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.toolLoopConfig.maxRounds}`);
  }

  // ============ 核心流程 ============

  private async handleMessage(sessionId: string, userParts: Part[]): Promise<void> {
    this.activeSessionId = sessionId;
    const startTime = Date.now();

    // 1. 加载历史并追加用户消息
    const history = await this.storage.getHistory(sessionId);
    const isNewSession = history.length === 0;
    const historyLenBefore = history.length;
    history.push({ role: 'user', parts: userParts });

    // 2. 构建 per-request 额外上下文
    let extraParts: Part[] | undefined;

    // 记忆自动召回
    if (this.memory && this.autoRecall) {
      try {
        const userText = userParts.filter(isTextPart).map(p => p.text).join('');
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

    // 5. 执行工具循环
    const result = await loop.run(history, callLLM, { extraParts });

    // 6. 将耗时写入最后一条 model 消息
    const durationMs = Date.now() - startTime;
    for (let i = result.history.length - 1; i >= 0; i--) {
      if (result.history[i].role === 'model') {
        result.history[i].durationMs = durationMs;
        break;
      }
    }

    // 7. 持久化新增消息
    for (let i = historyLenBefore; i < result.history.length; i++) {
      await this.storage.addMessage(sessionId, result.history[i]);
    }

    // 8. 管理会话元数据
    await this.updateSessionMeta(sessionId, userParts, isNewSession);

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
        for (const part of deltaParts) {
          appendMergedPart(parts, part);
        }
        this.emit('stream:parts', sessionId, deltaParts);
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

  private async updateSessionMeta(sessionId: string, userParts: Part[], isNewSession: boolean): Promise<void> {
    const now = new Date().toISOString();
    const cwd = process.cwd();

    if (isNewSession) {
      const title = userParts.filter(isTextPart).map(p => p.text).join('').slice(0, 100) || '新对话';
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
