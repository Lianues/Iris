/**
 * Console 平台适配器 (OpenTUI React)
 *
 * 通过 Backend 事件驱动全屏 TUI 界面。
 *
 * 支持消息排队发送：AI 生成期间用户可以继续输入并提交消息，
 * 提交的消息会被加入队列，等当前响应完成后自动发送下一条。
 */

import React from 'react';
import { createCliRenderer, type CliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import {
  PlatformAdapter,
  LogLevel,
  type Content,
  type Part,
  type FunctionResponsePart,
  type ToolInvocation,
  type ToolStatus,
  type UsageMetadata,
  type IrisBackendLike,
  type IrisModelInfoLike,
  type IrisSessionMetaLike,
  type IrisAPI,
  type MCPManagerLike,
  type BootstrapExtensionRegistryLike,
  type ConfigManagerLike,
} from '@irises/extension-sdk';
import { estimateTokenCount } from 'tokenx';
import { App, AppHandle, MessageMeta } from './App';
import { MessagePart } from './components/MessageItem';
import { ConsoleSettingsController, ConsoleSettingsSaveResult, ConsoleSettingsSnapshot } from './settings';
import { configureBundledOpenTuiTreeSitter } from './opentui-runtime';
import { attachCompiledResizeWatcher } from './resize-watcher';

function createToolInvocationFromFunctionCall(
  part: any,
  index: number,
  defaultStatus: ToolStatus,
  response?: Record<string, unknown>,
  durationMs?: number,
): ToolInvocation {
  let status = defaultStatus;
  let result: unknown;
  let error: string | undefined;

  if (response != null) {
    if ('error' in response && typeof response.error === 'string') {
      status = 'error';
      error = response.error;
    } else if ('result' in response) {
      result = response.result;
    } else {
      // 富媒体结果或其他格式 — 将整个 response 对象视为 result
      result = response;
    }
  }

  const now = Date.now();
  return {
    id: `history-tool-${Date.now()}-${index}-${part.functionCall.name}`,
    toolName: part.functionCall.name,
    args: part.functionCall.args ?? {},
    status,
    result,
    error,
    createdAt: durationMs != null ? now - durationMs : now,
    updatedAt: now,
  };
}

function convertPartsToMessageParts(
  parts: Part[],
  toolStatus: ToolStatus = 'success',
  responseParts?: FunctionResponsePart[],
): MessagePart[] {
  const result: MessagePart[] = [];
  let toolIndex = 0;

  // 构建 functionResponse 查找表：优先按 callId 匹配，兜底按序号匹配
  const responseByCallId = new Map<string, FunctionResponsePart>();
  const responseByIndex: FunctionResponsePart[] = [];
  if (responseParts) {
    for (const rp of responseParts) {
      if (rp.functionResponse.callId) {
        responseByCallId.set(rp.functionResponse.callId, rp);
      }
      responseByIndex.push(rp);
    }
  }

  for (const part of parts) {
    if ('text' in part) {
      if (part.thought === true) {
        result.push({ type: 'thought', text: part.text ?? '', durationMs: part.thoughtDurationMs });
      } else {
        result.push({ type: 'text', text: part.text ?? '' });
      }
      continue;
    }

    if ('functionCall' in part) {
      // 查找匹配的 functionResponse：优先 callId，兜底按序号
      let matchedResponse: Record<string, unknown> | undefined;
      let matchedDurationMs: number | undefined;
      const callId = (part as any).functionCall.callId;
      if (callId && responseByCallId.has(callId)) {
        const matched = responseByCallId.get(callId)!.functionResponse;
        matchedResponse = matched.response;
        matchedDurationMs = matched.durationMs;
      } else if (toolIndex < responseByIndex.length) {
        const matched = responseByIndex[toolIndex]?.functionResponse;
        matchedResponse = matched?.response;
        matchedDurationMs = matched?.durationMs;
      }

      const invocation = createToolInvocationFromFunctionCall(part, toolIndex++, toolStatus, matchedResponse, matchedDurationMs);
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last && last.type === 'tool_use') {
        last.tools.push(invocation);
      } else {
        result.push({ type: 'tool_use', tools: [invocation] });
      }
    }
  }

  return result;
}

function getMessageMeta(content: Content): MessageMeta | undefined {
  const meta: MessageMeta = {};
  if (content.usageMetadata?.promptTokenCount != null) meta.tokenIn = content.usageMetadata.promptTokenCount;
  if (content.usageMetadata?.candidatesTokenCount != null) meta.tokenOut = content.usageMetadata.candidatesTokenCount;
  if (content.createdAt != null) meta.createdAt = content.createdAt;
  if (content.isSummary) meta.isSummary = true;
  if (content.durationMs != null) meta.durationMs = content.durationMs;
  if (content.streamOutputDurationMs != null) meta.streamOutputDurationMs = content.streamOutputDurationMs;
  if (content.modelName) (meta as any).modelName = content.modelName;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** 生成基于时间戳的会话 ID */
function generateSessionId(): string {
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

export interface ConsolePlatformOptions {
  modeName?: string;
  modelName: string;
  modelId: string;
  contextWindow?: number;
  configDir: string;
  getMCPManager: () => MCPManagerLike | undefined;
  setMCPManager: (manager?: MCPManagerLike) => void;
  /** 当前 Agent 名称（多 Agent 模式下显示在 TUI 中） */
  agentName?: string;
  /** 切换 Agent 回调（多 Agent 模式下由 /agent 指令触发） */
  onSwitchAgent?: () => void;
  /** 初始化过程中的警告信息（TUI 启动后展示） */
  initWarnings?: string[];
  extensions?: Pick<BootstrapExtensionRegistryLike, 'llmProviders' | 'ocrProviders'>;
  /** IrisAPI 引用，由宿主注入 */
  api?: IrisAPI;
  /** 是否为编译后的二进制 */
  isCompiledBinary?: boolean;
}

export class ConsolePlatform extends PlatformAdapter {
  private sessionId: string;
  private modeName?: string;
  private modelId: string;
  private modelName: string;
  private contextWindow?: number;
  private backend: IrisBackendLike;
  private agentName?: string;
  private onSwitchAgent?: () => void;
  private settingsController: ConsoleSettingsController;
  private initWarnings: string[];
  private renderer?: CliRenderer;
  private appHandle?: AppHandle;
  private disposeResizeWatcher?: () => void;
  private api?: IrisAPI;
  private isCompiledBinary: boolean;

  /** 当前响应周期内的工具调用 ID 集合 */
  private currentToolIds = new Set<string>();

  /** 串行化 undo/redo 持久化操作，防止并发写入。 */
  private historyMutationQueue: Promise<unknown> = Promise.resolve();

  constructor(backend: IrisBackendLike, options: ConsolePlatformOptions) {
    super();
    this.backend = backend;
    this.sessionId = generateSessionId();
    this.modeName = options.modeName;
    this.modelId = options.modelId;
    this.modelName = options.modelName;
    this.contextWindow = options.contextWindow;
    this.agentName = options.agentName;
    this.onSwitchAgent = options.onSwitchAgent;
    this.initWarnings = options.initWarnings ?? [];
    this.api = options.api;
    this.isCompiledBinary = options.isCompiledBinary ?? false;
    this.settingsController = new ConsoleSettingsController({
      backend,
      configManager: options.api?.configManager,
      mcpManager: options.getMCPManager(),
      extensions: options.extensions,
    });
  }

  /**
   * 将一个异步操作排入持久化队列，保证串行执行。
   * 前一个操作失败不会阻塞后续操作。
   */
  private enqueueHistoryMutation<T>(task: () => Promise<T>): Promise<T> {
    const next = this.historyMutationQueue.then(task, task);
    this.historyMutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }


  async start(): Promise<void> {
    this.api?.setLogLevel?.(LogLevel.SILENT);

    configureBundledOpenTuiTreeSitter(this.isCompiledBinary);

    // 监听 Backend 事件
    this.backend.on('assistant:content', (sid: string, content: Content) => {
      if (sid === this.sessionId) {
        const meta = getMessageMeta(content);
        const parts = convertPartsToMessageParts(content.parts, 'queued');
        this.appHandle?.finalizeAssistantParts(parts, meta);
      }
    });

    this.backend.on('stream:start', (sid: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.startStream();
      }
    });

    this.backend.on('stream:parts', (sid: string, parts: Part[]) => {
      if (sid === this.sessionId) {
        this.appHandle?.pushStreamParts(convertPartsToMessageParts(parts, 'streaming'));
      }
    });

    this.backend.on('stream:chunk', (sid: string, _chunk: string) => {
      if (sid === this.sessionId) {
        // console 走 stream:parts，保留 stream:chunk 仅兼容其他平台
      }
    });

    this.backend.on('stream:end', (sid: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.endStream();
      }
    });

    this.backend.on('tool:update', (sid: string, invocations: ToolInvocation[]) => {
      if (sid === this.sessionId) {
        this.appHandle?.setToolInvocations(invocations);
      }
    });

    this.backend.on('error', (sid: string, error: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.addErrorMessage(error);
      }
    });

    this.backend.on('usage', (sid: string, usage: UsageMetadata) => {
      if (sid === this.sessionId) {
        this.appHandle?.setUsage(usage);
      }
    });

    this.backend.on('retry', (sid: string, attempt: number, maxRetries: number, error: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.setRetryInfo({ attempt, maxRetries, error });
      }
    });

    this.backend.on('user:token', (sid: string, tokenCount: number) => {
      if (sid === this.sessionId) {
        this.appHandle?.setUserTokens(tokenCount);
      }
    });


    this.backend.on('done', (sid: string, durationMs: number) => {
      if (sid === this.sessionId) {
        this.appHandle?.finalizeResponse(durationMs);
        this.appHandle?.clearNotificationContext();
      }
    });

    // 监听 turn:start 区分 notification turn 和普通 turn
    this.backend.on('turn:start' as any, (sid: string, _turnId: string, mode: string) => {
      if (sid === this.sessionId) {
        if (mode === 'task-notification') {
          this.appHandle?.setNotificationContext();
        } else {
          // 普通 chat turn：清除可能残留的 notification context
          // （例如切换 session 后残留的旧状态）
          this.appHandle?.clearNotificationContext();
        }
      }
    });

    // 监听 agent:notification 获取任务描述（在 turn:start 之前触发）
    this.backend.on('agent:notification' as any, (sid: string, _taskId: string, status: string, summary: string) => {
      if (sid === this.sessionId) {
        // 更新 StatusBar 中的后台任务计数：
        // registered → 新任务启动，计数 +1
        // completed / failed / killed → 任务结束，计数 -1
        // token-update → 实时更新后台任务的 token 消耗
        if (status === 'registered') {
          this.appHandle?.updateBackgroundTaskCount(1);
        } else if (status === 'completed' || status === 'failed' || status === 'killed') {
          this.appHandle?.updateBackgroundTaskCount(-1);
          this.appHandle?.removeBackgroundTaskTokens(_taskId);
          this.appHandle?.setNotificationContext(summary);
        } else if (status === 'token-update') {
          // summary 字段携带 token 数值字符串（由 Backend 转发时填入）
          const tokens = parseInt(summary, 10);
          if (!isNaN(tokens)) {
            this.appHandle?.updateBackgroundTaskTokens(_taskId, tokens);
          }
        } else if (status === 'chunk-heartbeat') {
          // 真实数据流动心跳：推进 spinner 帧
          this.appHandle?.advanceBackgroundTaskSpinner();
        }
      }
    });

    // 监听 notification:payloads 获取异步子代理通知的结构化内容
    // （在 turn:start 之前触发，供前端渲染折叠通知区块）
    this.backend.on('notification:payloads' as any, (sid: string, payloads: any[]) => {
      if (sid === this.sessionId) {
        this.appHandle?.setNotificationPayloads(payloads);
      }
    });

    this.backend.on('auto-compact', (sid: string, summaryText: string) => {
      if (sid === this.sessionId) {
        const fullText = `[Context Summary]\n\n${summaryText}`;
        const tokenCount = estimateTokenCount(fullText);
        this.appHandle?.addSummaryMessage(fullText, tokenCount > 0 ? tokenCount : undefined);
      }
    });

    // 创建 OpenTUI 渲染器（全屏交替缓冲区）
    return new Promise<void>(async (resolve, reject) => {
      try {
        this.renderer = await createCliRenderer({
          exitOnCtrlC: false, // 由应用自行处理 Ctrl+C
          useMouse: true, // 默认开启鼠标，支持滚轮滚动；复制时由应用内复制模式临时关闭
          enableMouseMovement: false,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message?.includes('Raw mode')) {
          console.error('[ConsolePlatform] Fatal: 当前终端不支持 Raw mode。');
          process.exit(1);
        }
        reject(err);
        return;
      }

      this.disposeResizeWatcher = attachCompiledResizeWatcher(this.renderer, this.isCompiledBinary);

      const element = React.createElement(App, {
        onReady: (handle: AppHandle) => {
          this.appHandle = handle;
          resolve();
        },
        onSubmit: (text: string) => this.handleInput(text),
        onUndo: async () => {
          try {
            const result = await this.enqueueHistoryMutation(async () => {
              return await this.backend.undo?.(this.sessionId, 'last-visible-message');
            });
            return Boolean(result);
          } catch (err) {
            console.warn('[ConsolePlatform] onUndo 持久化失败:', err);
            return false;
          }
        },
        onRedo: async () => {
          try {
            const result = await this.enqueueHistoryMutation(async () => {
              return await this.backend.redo?.(this.sessionId);
            });
            return Boolean(result);
          } catch (err) {
            console.warn('[ConsolePlatform] onRedo 持久化失败:', err);
            return false;
          }
        },
        onClearRedoStack: () => {
          this.backend.clearRedo?.(this.sessionId);
        },
        onToolApproval: (toolId: string, approved: boolean) => {
          this.backend.approveTool?.(toolId, approved);
        },
        onToolApply: (toolId: string, applied: boolean) => {
          this.backend.applyTool?.(toolId, applied);
        },
        onAbort: () => {
          this.backend.abortChat?.(this.sessionId);
        },
        onNewSession: () => this.handleNewSession(),
        onLoadSession: (id: string) => this.handleLoadSession(id),
        onListSessions: () => this.handleListSessions(),
        onRunCommand: (cmd: string) => this.handleRunCommand(cmd),
        onListModels: () => this.handleListModels(),
        onSwitchModel: (modelName: string) => this.handleSwitchModel(modelName),
        onLoadSettings: () => this.handleLoadSettings(),
        onSaveSettings: (snapshot: ConsoleSettingsSnapshot) => this.handleSaveSettings(snapshot),
        onResetConfig: () => this.handleResetConfig(),
        onExit: () => this.stop(),
        onSummarize: () => this.handleSummarize(),
        onSwitchAgent: this.onSwitchAgent,
        agentName: this.agentName,
        modeName: this.modeName,
        modelId: this.modelId,
        modelName: this.modelName,
        contextWindow: this.contextWindow,
        initWarnings: this.initWarnings,
      });

      // CliRenderer 在 console/node_modules 与 Iris/node_modules 中的私有字段声明不同，
      // 导致 TS 认为类型不兼容。此处用 as any 绕过该跨 node_modules 的结构性类型差异。
      createRoot(this.renderer as any).render(element);
    });
  }

  async stop(): Promise<void> {
    // OpenTUI 的 destroy() 会清理交替屏幕、恢复光标等
    this.disposeResizeWatcher?.();
    this.renderer?.destroy();
  }

  // ============ 内部逻辑 ============

  private handleNewSession(): void {
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
  }

  private handleRunCommand(cmd: string): { output: string; cwd: string } {
    return (this.backend.runCommand?.(cmd) ?? { output: '', cwd: '' }) as { output: string; cwd: string };
  }

  private handleListModels(): IrisModelInfoLike[] {
    return this.backend.listModels?.() ?? [];
  }

  private handleSwitchModel(modelName: string): { ok: boolean; message: string; modelId?: string; modelName?: string; contextWindow?: number } {
    try {
      const info = this.backend.switchModel?.(modelName, 'console') as { modelName: string; modelId: string; contextWindow?: number } | undefined;
      if (!info) return { ok: false, message: '模型切换功能不可用' };
      this.modelName = info.modelName;
      this.modelId = info.modelId;
      this.contextWindow = info.contextWindow;
      return {
        ok: true,
        message: `当前模型已切换为：${info.modelName}  ${info.modelId}`,
        modelName: info.modelName,
        modelId: info.modelId,
        contextWindow: info.contextWindow,
      };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `切换模型失败：${detail}` };
    }
  }

  private async handleLoadSession(id: string): Promise<void> {
    this.sessionId = id;
    this.currentToolIds.clear();

    const history = await this.backend.getHistory?.(id) ?? [];

    // 预处理：为每条 model 消息收集其对应的 functionResponse 列表
    // 历史结构: [model: functionCall...] → [user: functionResponse...] → [model: ...]
    const responseMap = new Map<number, FunctionResponsePart[]>();
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'model' && msg.parts.some((p: Part) => 'functionCall' in p)) {
        const next = i + 1 < history.length ? history[i + 1] : undefined;
        if (next && next.role === 'user') {
          const responses = next.parts.filter((p: Part): p is FunctionResponsePart => 'functionResponse' in p);
          if (responses.length > 0) responseMap.set(i, responses);
        }
      }
    }

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const role = msg.role === 'user' ? 'user' : 'assistant';
      const parts = convertPartsToMessageParts(msg.parts, 'success', responseMap.get(i));
      const meta = getMessageMeta(msg);
      if (parts.length > 0) {
        this.appHandle?.addStructuredMessage(role as 'user' | 'assistant', parts, meta);
      }

      if (msg.usageMetadata) {
        this.appHandle?.setUsage(msg.usageMetadata);
      }
    }
  }

  private async handleListSessions(): Promise<IrisSessionMetaLike[]> {
    return await this.backend.listSessionMetas?.() ?? [];
  }

  private async handleLoadSettings(): Promise<ConsoleSettingsSnapshot> {
    return this.settingsController.loadSnapshot();
  }

  private async handleSaveSettings(snapshot: ConsoleSettingsSnapshot): Promise<ConsoleSettingsSaveResult> {
    return this.settingsController.saveSnapshot(snapshot);
  }

  private async handleResetConfig(): Promise<{ success: boolean; message: string }> {
    try {
      await this.backend.resetConfigToDefaults?.();
      return { success: true, message: '配置已重置' };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  }

  private async handleSummarize(): Promise<{ ok: boolean; message: string }> {
    this.appHandle?.setGenerating(true);
    try {
      const summaryText = await this.backend.summarize?.(this.sessionId) ?? '';
      const fullText = `[Context Summary]\n\n${summaryText}`;
      const tokenCount = estimateTokenCount(fullText);
      this.appHandle?.addSummaryMessage(fullText, tokenCount > 0 ? tokenCount : undefined);
      return { ok: true, message: 'Context compressed.' };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.appHandle?.addErrorMessage(`Context compression failed: ${detail}`);
      return { ok: false, message: detail };
    } finally {
      this.appHandle?.setGenerating(false);
    }
  }

  /**
   * 处理用户输入：发送消息给 Backend，并在完成后自动排流队列中的下一条消息。
   *
   * 流程：
   * 1. 设置生成状态 → 发送消息 → 等待完成
   * 2. 检查队列：如果有下一条，重复步骤 1（abort 仅中断当前生成，不影响队列排流）
   * 3. 队列排空或被 abort 后，取消生成状态
   */
  private async handleInput(text: string): Promise<void> {
    this.appHandle?.setGenerating(true);

    let currentText: string | undefined = text;
    while (currentText) {
      this.appHandle?.addMessage('user', currentText);
      this.currentToolIds.clear();
      try {
        await this.backend.chat(this.sessionId, currentText, undefined, undefined, 'console');
      } finally {
        this.appHandle?.commitTools();
      }

      // 从队列取下一条消息
      currentText = this.appHandle?.drainQueue();
    }

    this.appHandle?.setGenerating(false);
  }
}


// ── Platform Factory (扩展入口) ──────────────────────────────────

/**
 * 宿主传入的 context 扩展字段（通过 `[key: string]: unknown` 动态访问）。
 * 这些字段由主项目在 PlatformFactoryContext 中提供。
 */
interface ConsoleFactoryContext {
  backend: IrisBackendLike;
  config?: { system?: { defaultMode?: string }; [key: string]: unknown };
  configDir?: string;
  agentName?: string;
  initWarnings?: string[];
  router?: { getCurrentModelInfo?(): { modelName: string; modelId: string; contextWindow?: number; provider?: string } };
  getMCPManager?: () => MCPManagerLike | undefined;
  setMCPManager?: (manager?: MCPManagerLike) => void;
  onSwitchAgent?: () => void;
  extensions?: Pick<BootstrapExtensionRegistryLike, 'llmProviders' | 'ocrProviders'>;
  api?: IrisAPI;
  isCompiledBinary?: boolean;
  [key: string]: unknown;
}

export default async function consoleFactory(rawContext: Record<string, unknown>): Promise<ConsolePlatform> {
  const context = rawContext as unknown as ConsoleFactoryContext;

  if (typeof (globalThis as { Bun?: unknown }).Bun === 'undefined') {
    console.error(
      '[Iris] Console 平台需要 Bun 运行时。\n'
      + '  - 请优先使用: bun run dev\n'
      + '  - 或直接执行: bun src/index.ts\n'
      + '  - 或切换到其他平台（如 web）'
    );
    process.exit(1);
  }

  const currentModel = context.router?.getCurrentModelInfo?.() ?? { modelName: 'default', modelId: '' };

  return new ConsolePlatform(context.backend, {
    modeName: context.config?.system?.defaultMode ?? 'default',
    modelName: currentModel.modelName ?? 'default',
    modelId: currentModel.modelId ?? '',
    contextWindow: currentModel.contextWindow,
    configDir: context.configDir ?? '',
    getMCPManager: context.getMCPManager ?? (() => undefined),
    setMCPManager: context.setMCPManager ?? (() => {}),
    agentName: context.agentName,
    onSwitchAgent: context.onSwitchAgent,
    initWarnings: context.initWarnings,
    extensions: context.extensions,
    api: context.api,
    isCompiledBinary: context.isCompiledBinary ?? false,
  });
}
