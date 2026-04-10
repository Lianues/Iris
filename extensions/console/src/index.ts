/**
 * Console 平台适配器 (OpenTUI React)
 *
 * 通过 Backend 事件驱动全屏 TUI 界面。
 *
 * 支持消息排队发送：AI 生成期间用户可以继续输入并提交消息，
 * 提交的消息会被加入队列，等当前响应完成后自动发送下一条。
 */

declare const process: {
  exit(code?: number): never;
  platform: string;
  stdin: { isTTY?: boolean; setRawMode(mode: boolean): void; pause(): void };
  stdout: { write(data: string): boolean };
  on(event: string, listener: (...args: any[]) => void): void;
};

import React from 'react';
import { createCliRenderer, type CliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import {
  PlatformAdapter,
  type ForegroundPlatform,
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
import { ICONS } from './terminal-compat';
import type { ConsoleConfig } from './console-config';
import { resolveConsoleConfig } from './console-config';

/** 从 shell 命令生成前缀通配模式（如 "npm install express" → "npm install *"） */
function generateCommandPattern(command: string): string {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) return '*';
  if (tokens.length <= 1) return tokens[0] + ' *';
  if (tokens[1].startsWith('-')) return tokens[0] + ' *';
  return tokens[0] + ' ' + tokens[1] + ' *';
}

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
  /** 初始化过程中的警告信息（TUI 启动后展示） */
  initWarnings?: string[];
  extensions?: Pick<BootstrapExtensionRegistryLike, 'llmProviders' | 'ocrProviders'>;
  /** IrisAPI 引用，由宿主注入 */
  api?: IrisAPI;
  /** 是否为编译后的二进制 */
  isCompiledBinary?: boolean;
  /** Console 平台配置 */
  consoleConfig: ConsoleConfig;
}

export class ConsolePlatform extends PlatformAdapter implements ForegroundPlatform {
  private sessionId: string;
  private modeName?: string;
  private modelId: string;
  private modelName: string;
  private contextWindow?: number;
  private backend: IrisBackendLike;
  private agentName?: string;
  private settingsController: ConsoleSettingsController;
  private initWarnings: string[];
  private initWarningsColor?: string;
  private initWarningsIcon?: string;

  /** waitForExit() 的 resolve 函数 */
  private exitResolve?: (action: 'exit' | 'switch-agent') => void;

  private renderer?: CliRenderer;
  private appHandle?: AppHandle;
  private disposeResizeWatcher?: () => void;
  private api?: IrisAPI;
  private _activeHandles: Map<string, any> = new Map();
  private isCompiledBinary: boolean;
  private consoleConfig: ConsoleConfig;

  /** 当前响应周期内的工具调用 ID 集合 */
  private currentToolIds = new Set<string>();

  /** 当前思考强度层级（用于模型切换后重新应用） */
  private currentThinkingEffort: import('./app-types').ThinkingEffortLevel = 'none';

  /** 当前正在查看详情的工具 ID 栈 */
  private _toolDetailStack: string[] = [];

  /** 串行化 undo/redo 持久化操作，防止并发写入。 */
  private historyMutationQueue: Promise<unknown> = Promise.resolve();

  // ── 远程连接状态 ──
  /** 远程连接前保存的原始 backend，断开时恢复 */
  private originalBackend: IrisBackendLike | null = null;
  /** 远程 WS IPC 客户端 */
  private remoteClient: any = null;
  /** 当前是否处于远程连接状态 */
  private _isRemote = false;
  /** 远程连接的主机地址（用于 StatusBar 显示） */
  private _remoteHost = '';
  /** 远程连接前保存的原始 API（断开时恢复） */
  private originalApi: any = null;
  /** 远程连接前保存的原始 settingsController */
  private originalSettingsController: ConsoleSettingsController | null = null;
  /** 远程连接前保存的原始 agentName */
  private originalAgentName?: string;
  /** 当前是否正在生成响应（用于阻止 addErrorMessage 破坏流式占位消息） */
  private _isGenerating = false;

  constructor(backend: IrisBackendLike, options: ConsolePlatformOptions) {
    super();
    this.backend = backend;
    this.sessionId = generateSessionId();
    this.modeName = options.modeName;
    this.modelId = options.modelId;
    this.modelName = options.modelName;
    this.contextWindow = options.contextWindow;
    this.agentName = options.agentName;
    this.initWarnings = options.initWarnings ?? [];
    this.api = options.api;
    this.isCompiledBinary = options.isCompiledBinary ?? false;
    this.consoleConfig = options.consoleConfig;
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
        this.currentToolIds.clear();
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

    this.backend.on('tool:execute' as any, (sid: string, handle: any) => {
      if (sid !== this.sessionId) return;
      this._activeHandles.set(handle.id, handle);
      this.currentToolIds.add(handle.id);
      const refreshUI = () => {
        const invocations = Array.from(this._activeHandles.values())
          .filter((h: any) => this.currentToolIds.has(h.id))
          .map((h: any) => {
            const snapshot = h.getSnapshot();
            if (this.consoleConfig.expandSubAgentTools) {
              const childHandles = h.getChildren?.() ?? [];
              if (childHandles.length > 0) {
                snapshot.children = childHandles.map((ch: any) => ch.getSnapshot());
              }
            }
            return snapshot;
          });
        this.appHandle?.setToolInvocations(invocations);
        this.refreshToolDetailIfNeeded();
      };
      handle.on('state', refreshUI);
      handle.on('output', refreshUI);
      handle.on('child', (childHandle: any) => {
        this._activeHandles.set(childHandle.id, childHandle);
        childHandle.on('state', refreshUI);
        childHandle.on('output', refreshUI);
        refreshUI();
      });
      refreshUI();
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

    // 监听 agent:notification 获取任务描述（在 turn:start 之前触发）。
    // [职责分离] 第 5 个参数 taskType 区分 'sub_agent'、'delegate'、'cron'。
    // 委派任务走单独的计数器（delegateTaskCount）；cron 任务根据 silent 标记决定渲染方式。
    // [cron 重构] 第 6 个参数 silent 标识任务是否为静默模式。
    // backgroundTaskCount / spinner / token 动画混在一起。
    this.backend.on('agent:notification' as any, (sid: string, _taskId: string, status: string, summary: string, taskType?: string, silent?: boolean) => {
      if (sid === this.sessionId) {
        const isDelegate = taskType === 'delegate';
        const isCron = taskType === 'cron';

        if (isCron) {
          // ── 定时任务：仅更新 StatusBar 状态（计数 / spinner / token） ──
          // 结果渲染由独立的 task:result 事件处理（见下方），agent:notification 不负责结果内容。
          if (status === 'registered') {
            this.appHandle?.updateBackgroundTaskCount(1);
          } else if (status === 'completed' || status === 'failed' || status === 'killed') {
            this.appHandle?.updateBackgroundTaskCount(-1);
            this.appHandle?.removeBackgroundTaskTokens(_taskId);
          } else if (status === 'token-update') {
            const tokens = parseInt(summary, 10);
            if (!isNaN(tokens)) {
              this.appHandle?.updateBackgroundTaskTokens(_taskId, tokens);
            }
          } else if (status === 'chunk-heartbeat') {
            this.appHandle?.advanceBackgroundTaskSpinner();
          }
        } else if (isDelegate) {
          // ── 委派任务：只更新独立的委派计数，不影响子代理的 spinner/token ──
          if (status === 'registered') {
            this.appHandle?.updateDelegateTaskCount(1);
          } else if (status === 'completed' || status === 'failed' || status === 'killed') {
            this.appHandle?.updateDelegateTaskCount(-1);
            this.appHandle?.setNotificationContext(summary);
          }
        } else {
          // ── 异步子代理：保持原有逻辑（计数 / spinner / token） ──
          if (status === 'registered') {
            this.appHandle?.updateBackgroundTaskCount(1);
          } else if (status === 'completed' || status === 'failed' || status === 'killed') {
            this.appHandle?.updateBackgroundTaskCount(-1);
            this.appHandle?.removeBackgroundTaskTokens(_taskId);
            this.appHandle?.setNotificationContext(summary);
          } else if (status === 'token-update') {
            const tokens = parseInt(summary, 10);
            if (!isNaN(tokens)) {
              this.appHandle?.updateBackgroundTaskTokens(_taskId, tokens);
            }
          } else if (status === 'chunk-heartbeat') {
            this.appHandle?.advanceBackgroundTaskSpinner();
          }
        }
      }
    });

    // 监听 notification:payloads 获取异步子代理/定时任务通知的结构化内容
    // （在 turn:start 之前触发，供前端渲染折叠通知区块）
    this.backend.on('notification:payloads' as any, (sid: string, payloads: any[]) => {
      if (sid === this.sessionId) {
        this.appHandle?.setNotificationPayloads(payloads);
      }
    });

    // ── 轻量级任务结果广播：通用的 task:result 通道 ──
    // 所有终态任务都会 emit 此事件，不绑定 silent 或任务类型。
    // 平台层自行决定是否消费和如何渲染。
    // 当前策略：silent 任务渲染通知卡片（因为不会有 LLM 回复），非 silent 跳过（避免重复）。
    this.backend.on('task:result' as any, (
      sid: string, _taskId: string, status: string,
      description: string, _taskType?: string, silent?: boolean, result?: string,
    ) => {
      if (sid !== this.sessionId) return;
      // 非 silent 任务的结果由 LLM 通过 stream 事件回复，不需要在此渲染
      if (!silent) return;

      let text: string;
      if (status === 'completed') {
        const preview = (result ?? '').slice(0, 200);
        text = `${ICONS.clock} ${description} 完成：${preview}`;
      } else if (status === 'killed') {
        text = `${ICONS.clock} ${description} 被中止`;
      } else {
        text = `${ICONS.clock} ${description} 失败：${result ?? '未知错误'}`;
      }
      this.appHandle?.addMessage('assistant', text);
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
          (this.backend as any).getToolHandle?.(toolId)?.approve(approved);
        },
        onToolApply: (toolId: string, applied: boolean) => {
          (this.backend as any).getToolHandle?.(toolId)?.apply(applied);
        },
        onAddCommandPattern: (toolName: string, command: string, type: 'allow' | 'deny') => {
          this.addCommandPattern(toolName, command, type);
        },
        onAbort: () => {
          this.backend.abortChat?.(this.sessionId);
        },
        onOpenToolDetail: (toolId: string) => {
          this.openToolDetail(toolId);
        },
        onNavigateToolDetail: (toolId: string) => {
          this.navigateToolDetail(toolId);
        },
        onCloseToolDetail: () => {
          this.closeToolDetail();
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
        onExit: () => {
          void this.stop().then(() => {
            this.exitResolve?.('exit');
          });
        },
        onSummarize: () => this.handleSummarize(),
        onListAgents: () => this.handleListAgents(),
        onSelectAgent: (name: string) => this.handleSelectAgent(name),
        onDream: () => this.handleDream(),
        onListMemories: () => this.handleListMemories(),
        onDeleteMemory: (id: number) => this.handleDeleteMemory(id),
        onListExtensions: () => this.handleListExtensions(),
        onToggleExtension: (name: string) => this.handleToggleExtension(name),
        onRemoteConnect: (name?: string) => this.handleRemoteConnect(name),
        onRemoteDisconnect: () => this.handleRemoteDisconnect(),
        remoteHost: this._remoteHost || undefined,
        onThinkingEffortChange: (level: import('./app-types').ThinkingEffortLevel) => this.applyThinkingEffort(level),
        agentName: this.agentName,
        modeName: this.modeName,
        modelId: this.modelId,
        modelName: this.modelName,
        contextWindow: this.contextWindow,
        initWarnings: this.initWarnings,
        initWarningsColor: this.initWarningsColor,
        initWarningsIcon: this.initWarningsIcon,
        // 插件注册的 Settings Tab：从 IrisAPI 获取所有已注册的 tab 定义
        pluginSettingsTabs: this.api?.getConsoleSettingsTabs?.() ?? [],
      });

      // CliRenderer 在 console/node_modules 与 Iris/node_modules 中的私有字段声明不同，
      // 导致 TS 认为类型不兼容。此处用 as any 绕过该跨 node_modules 的结构性类型差异。
      createRoot(this.renderer as any).render(element);
    });
  }

  async stop(): Promise<void> {
    // 幂等保护：onExit 和 shutdown() 都会调用 stop()，
    // 双重 destroy() 会向已恢复的终端重复写入 ANSI 转义序列导致异常。
    if (!this.renderer) return;
    const r = this.renderer;
    this.renderer = undefined as any;
    this.disposeResizeWatcher?.();

    if (process.platform === 'win32') {
      // Windows workaround: bun 在 destroy() 中写入 \x1b[?1049l（退出交替屏幕）
      // 会导致 cmd.exe / 终端窗口崩溃关闭。
      // 跳过 renderer.destroy()，只手动恢复 raw mode。
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch { /* ignore */ }
      try { process.stdin.pause(); } catch { /* ignore */ }
      // 立即关闭鼠标和 bracketed paste（这些不触发崩溃）
      const { writeSync } = require('fs');
      try {
        writeSync(1,
          '\x1b[?1000l'   // 关闭鼠标
          + '\x1b[?1002l'
          + '\x1b[?1006l'
          + '\x1b[?2004l'  // 关闭 bracketed paste
          + '\x1b[0m'      // 重置颜色
        );
      } catch { /* ignore */ }
      // 退出交替屏幕 + 恢复光标放在 process.on('exit')。
      // bun 直接写 \x1b[?1049l 会导致 cmd.exe 崩溃，
      // 所以用 spawnSync 让子进程（node/powershell）来写，绕过 bun 的 bug。
      // 如果子进程也失败则回退到 \x1b[2J 清屏。
      process.on('exit', () => {
        const { spawnSync } = require('child_process');
        const seq = '\x1b[?1049l\x1b[?25h';
        try {
          // 优先尝试 node（项目环境通常有）
          const r1 = spawnSync('node', ['-e', `process.stdout.write(${JSON.stringify(seq)})`],
            { stdio: 'inherit', timeout: 2000, windowsHide: true });
          if (r1.status === 0) return;
        } catch { /* ignore */ }
        try {
          // 回退到 PowerShell（Windows 10 自带）
          const psCmd = `[Console]::Write([char]27 + '[?1049l' + [char]27 + '[?25h')`;
          const r2 = spawnSync('powershell', ['-NoProfile', '-Command', psCmd],
            { stdio: 'inherit', timeout: 2000, windowsHide: true });
          if (r2.status === 0) return;
        } catch { /* ignore */ }
        // 最终回退：直接清屏（会丢失之前的终端记录，但至少不残留 TUI）
        try { writeSync(1, '\x1b[2J\x1b[H\x1b[?25h'); } catch { /* ignore */ }
      });
    } else {
      r.destroy();
    }

    // 等待终端 I/O flush
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * ForegroundPlatform 接口实现。
   * 返回的 Promise 在用户选择退出或切换 Agent 时 resolve。
   */
  waitForExit(): Promise<'exit' | 'switch-agent'> {
    return new Promise<'exit' | 'switch-agent'>((resolve) => {
      this.exitResolve = resolve;
    });
  }


  /**
   * 获取可用 Agent 列表（/agent 命令触发）。
   *
   * 修改方式：不再直接操作 stdin/stdout 显示 ANSI 选择器，
   * 而是返回 agent 列表交给 React viewMode 渲染，避免 stdin 争夺和日志泄漏。
   */
  private handleListAgents(): import('@irises/extension-sdk').AgentDefinitionLike[] {
    return this.api?.listAgents?.() ?? [];
  }

  /**
   * 用户在 agent-list 视图中选择后，执行实际的 Agent 切换。
   *
   * 修改方式：由 OpenTUI React 键盘事件触发（Enter 键），
   * 不再需要 suspend/destroy renderer 来显示选择器。
   * 选中当前 agent 时直接返回，选中其他 agent 时 stop → 切换 backend → start。
   */
  private async handleSelectAgent(targetName: string): Promise<void> {
    const network = this.api?.agentNetwork;
    if (!network) return;

    // 选中当前 agent 时无需切换
    if (targetName === network.selfName) return;

    // 销毁当前 TUI，准备用新 backend 重建
    await this.stop();

    const targetHandle = network.getPeerBackendHandle?.(targetName);
    if (targetHandle) {
      this.backend = targetHandle;
      this.agentName = targetName;

      const modelInfo = targetHandle.getCurrentModelInfo?.();
      if (modelInfo) {
        this.modelName = modelInfo.modelName;
        this.modelId = modelInfo.modelId;
        this.contextWindow = modelInfo.contextWindow;
      }

      this.sessionId = generateSessionId();
      this.currentToolIds.clear();
      this._activeHandles.clear();

      // 分层配置修复：切换 Agent 后重建 settingsController
      const peerAPI = network.getPeerAPI?.(targetName) as any;
      if (peerAPI) {
        this.api = peerAPI;
        this.settingsController = new ConsoleSettingsController({
          backend: targetHandle,
          configManager: peerAPI.configManager,
          mcpManager: peerAPI.mcpManager,
          extensions: peerAPI.extensions,
        });
      }
    }

    await this.start();
  }

  // ============ 远程连接 ============

  /**
   * 核心远程连接逻辑：WsIPCClient 创建 → 握手 → backend/api swap。
   * 被向导流程和快捷连接共用。调用前 TUI 必须已停止。
   */
  private async doRemoteConnect(url: string, token: string): Promise<void> {
    const { showConnectingStatus, showConnectSuccess, showConnectError } =
      await import('./remote-wizard');

    showConnectingStatus(url);

    try {
      // @ts-expect-error -- 跨 tsconfig 边界的运行时动态导入
      const { WsIPCClient } = await import('../../src/net/client');
      // @ts-expect-error -- 跨 tsconfig 边界的运行时动态导入
      const { RemoteBackendHandle } = await import('../../src/ipc/remote-backend-handle');

      const wsClient = new WsIPCClient();
      const handshake = await wsClient.connect(url, token);

      let remoteBackend: any;
      let remoteApi: any;
      try {
        remoteBackend = new RemoteBackendHandle(wsClient);
        remoteBackend._streamEnabled = handshake.streamEnabled;
        await remoteBackend.initCaches();
        await wsClient.subscribe('*');

        // @ts-expect-error -- 跨 tsconfig 边界的运行时动态导入
        const { createRemoteApiProxy } = await import('../../src/ipc/remote-api-proxy');
        remoteApi = createRemoteApiProxy(wsClient, handshake.agentName);
        if (typeof remoteApi.initCaches === 'function') {
          await remoteApi.initCaches();
        }
      } catch (initErr) {
        wsClient.disconnect();
        throw initErr;
      }

      this.originalBackend = this.backend;
      this.originalApi = this.api;
      this.originalSettingsController = this.settingsController;
      this.originalAgentName = this.agentName;
      this.remoteClient = wsClient;
      this.backend = remoteBackend;
      this.api = remoteApi;
      this.settingsController = new ConsoleSettingsController({
        backend: remoteBackend,
        configManager: remoteApi.configManager,
        mcpManager: undefined,
        extensions: undefined,
      });
      this._isRemote = true;
      this.agentName = handshake.agentName === '__global__' ? undefined : handshake.agentName;
      try { this._remoteHost = new URL(url).host; } catch { this._remoteHost = url; }

      const modelInfo = remoteBackend.getCurrentModelInfo?.();
      if (modelInfo) {
        this.modelName = modelInfo.modelName ?? this.modelName;
        this.modelId = modelInfo.modelId ?? this.modelId;
        this.contextWindow = modelInfo.contextWindow ?? this.contextWindow;
      }

      this.sessionId = generateSessionId();
      this.currentToolIds.clear();
      this._activeHandles.clear();

      showConnectSuccess(handshake.agentName, this.modelName);
      this.initWarnings = [`已连接到远程 Iris — ${this._remoteHost} (agent=${handshake.agentName}, model=${this.modelName})\n输入 /disconnect 断开连接`];
      this.initWarningsColor = '#00cec9';
      this.initWarningsIcon = ICONS.dotFilled;

      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      showConnectError((err as Error).message);
      await new Promise(r => setTimeout(r, 2000));
      throw err;
    }
  }

  /** 读取本地配置中的已保存连接列表 */
  private readSavedRemotes(): Record<string, { url: string; token?: string }> {
    try {
      const config = this.api?.configManager?.readEditableConfig?.() as Record<string, any>;
      const remotes = config?.net?.remotes;
      if (remotes && typeof remotes === 'object') return remotes;
    } catch {}
    return {};
  }

  /** lastRemote → remotes 迁移 */
  private migrateLastRemote(): void {
    try {
      const config = this.api?.configManager?.readEditableConfig?.() as Record<string, any>;
      const lastRemote = config?.net?.lastRemote;
      if (!lastRemote?.url) return;

      const remotes = config?.net?.remotes ?? {};
      // 检查是否已有同 URL 的条目
      const alreadyExists = Object.values(remotes).some(
        (r: any) => r?.url === lastRemote.url,
      );
      if (!alreadyExists) {
        this.api?.configManager?.updateEditableConfig?.({
          net: { remotes: { _last: { url: lastRemote.url, token: lastRemote.token } } },
        });
      }
      // 删除 lastRemote
      this.api?.configManager?.updateEditableConfig?.({
        net: { lastRemote: null },
      });
    } catch {}
  }

  /** 保存连接到 remotes（用 originalApi 写本地配置） */
  private saveRemote(name: string, url: string, token: string): void {
    try {
      const api = this.originalApi ?? this.api;
      api?.configManager?.updateEditableConfig?.({
        net: { remotes: { [name]: { url, token } } },
      });
    } catch {}
  }

  /** 删除已保存的连接 */
  private deleteSavedRemote(name: string): void {
    try {
      this.api?.configManager?.updateEditableConfig?.({
        net: { remotes: { [name]: null } },
      });
    } catch {}
  }

  /**
   * 处理 /remote 命令 — 交互式连接远程 Iris。
   * @param quickName 快捷连接名称（/remote <name>），不传则显示向导。
   */
  private async handleRemoteConnect(quickName?: string): Promise<void> {
    await this.stop();

    // 迁移旧的 lastRemote
    this.migrateLastRemote();

    const remotes = this.readSavedRemotes();

    // 快捷连接：/remote <name>
    if (quickName) {
      const entry = remotes[quickName];
      if (!entry) {
        const { showConnectError } = await import('./remote-wizard');
        showConnectError(`未找到已保存的连接: ${quickName}`);
        await new Promise(r => setTimeout(r, 1500));
        await this.start();
        return;
      }

      if (entry.token) {
        try {
          await this.doRemoteConnect(entry.url, entry.token);
        } catch {}
        await this.start();
        return;
      }

      // 有 URL 但无 token，需要输入（URL 预填且锁定）
      const { showInputPhase } = await import('./remote-wizard');
      const result = await showInputPhase({ prefillUrl: entry.url, urlLocked: true });
      if (!result) {
        await this.start();
        return;
      }
      try {
        await this.doRemoteConnect(entry.url, result.token);
        // 更新保存的 token
        this.saveRemote(quickName, entry.url, result.token);
      } catch {}
      await this.start();
      return;
    }

    // 构建已保存连接列表
    const saved = Object.entries(remotes).map(([name, entry]) => ({
      name,
      url: entry.url,
      hasToken: !!entry.token,
    }));

    // 启动局域网发现
    let discoveryPromise: Promise<import('./remote-wizard').DiscoveredConnection[]> | undefined;
    try {
      // @ts-expect-error -- 跨 tsconfig 边界的运行时动态导入
      const { discoverLanInstances } = await import('../../src/net/discovery');
      discoveryPromise = discoverLanInstances();
    } catch {}

    const { showRemoteConnectWizard, showSavePrompt } = await import('./remote-wizard');

    const result = await showRemoteConnectWizard({
      saved,
      discoveryPromise,
      onDelete: (name) => this.deleteSavedRemote(name),
    });

    if (!result) {
      await this.start();
      return;
    }

    // 已保存 + 有 token → token 为空字符串，需从 config 读取真实 token
    let connectUrl = result.url;
    let connectToken = result.token;
    if (result.source === 'saved' && result.savedName && !connectToken) {
      const entry = remotes[result.savedName];
      if (entry?.token) connectToken = entry.token;
    }

    try {
      await this.doRemoteConnect(connectUrl, connectToken);

      // 连接成功 → 如果不是已保存的连接，提示保存
      if (result.source !== 'saved') {
        const saveName = await showSavePrompt();
        if (saveName) {
          this.saveRemote(saveName, connectUrl, connectToken);
        }
      }
    } catch {}

    await this.start();
  }

  /**
   * 处理 /remote disconnect — 断开远程连接，恢复本地 backend。
   * 与 handleSwitchAgent 相同模式：stop → swap → start，无返回值。
   */
  private async handleRemoteDisconnect(): Promise<void> {
    if (!this._isRemote || !this.originalBackend) return;

    // 停止 TUI
    await this.stop();

    // 断开远程连接
    if (this.remoteClient) {
      this.remoteClient.disconnect();
      this.remoteClient = null;
    }

    // 恢复本地 backend + API + settingsController
    const disconnectedHost = this._remoteHost;
    this.backend = this.originalBackend;
    this.originalBackend = null;
    if (this.originalApi) {
      this.api = this.originalApi;
      this.originalApi = null;
    }
    if (this.originalSettingsController) {
      this.settingsController = this.originalSettingsController;
      this.originalSettingsController = null;
    }
    this.agentName = this.originalAgentName;
    this.originalAgentName = undefined;
    this._isRemote = false;
    this._remoteHost = '';
    this.initWarnings = [`已断开远程连接 (${disconnectedHost})，已回到本地`];
    this.initWarningsColor = '#74b9ff';
    this.initWarningsIcon = ICONS.dotEmpty;

    // 从本地 backend 恢复模型信息
    const modelInfo = (this.backend as any).getCurrentModelInfo?.();
    if (modelInfo) {
      this.modelName = modelInfo.modelName ?? this.modelName;
      this.modelId = modelInfo.modelId ?? this.modelId;
      this.contextWindow = modelInfo.contextWindow ?? this.contextWindow;
    }

    // 新 session
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
    this._activeHandles.clear();

    // 重启 TUI
    await this.start();
  }

  // ============ 内部逻辑 ============

  /** 从历史 ToolInvocation 创建轻量 Handle 对象（与实时 Handle 接口兼容） */
  private createHistoricalHandle(inv: ToolInvocation): any {
    return {
      id: inv.id,
      toolName: inv.toolName,
      status: inv.status,
      depth: inv.depth ?? 0,
      parentId: inv.parentToolId,
      signal: new AbortController().signal,
      getSnapshot: () => ({ ...inv }),
      getOutputHistory: () => [],
      getChildren: () => [],
      abort: () => {},
      approve: () => {},
      apply: () => {},
      send: () => {},
      on: () => {},
      off: () => {},
      emit: () => false,
    };
  }


  private handleNewSession(): void {
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
    this._activeHandles.clear();
  }

  /** 打开工具详情 */
  private openToolDetail(toolId: string): void {
    if (!toolId) {
      // Ctrl+T 无指定目标：打开工具列表
      const all = Array.from(this._activeHandles.values())
        .filter((h: any) => !h.parentId);
      if (all.length === 0) {
        // 生成响应期间不添加错误消息，避免破坏流式占位消息导致回复内容与错误混合
        if (!this._isGenerating) {
          this.appHandle?.addErrorMessage('当前会话没有工具执行记录。');
        }
        return;
      }
      // 收集所有工具的快照，按创建时间排序
      const tools = all.map((h: any) => h.getSnapshot() as ToolInvocation)
        .sort((a: ToolInvocation, b: ToolInvocation) => a.createdAt - b.createdAt);
      this.appHandle?.openToolList(tools);
      return;
    }
    const handle = this._activeHandles.get(toolId);
    if (!handle) {
      this.appHandle?.addErrorMessage('未找到指定的工具执行记录。');
      return;
    }
    this._toolDetailStack = [handle.id];
    this.pushToolDetailData(handle.id);
  }

  /** 导航到子工具详情 */
  private navigateToolDetail(toolId: string): void {
    const handle = this._activeHandles.get(toolId);
    if (!handle) return;
    this._toolDetailStack.push(toolId);
    this.pushToolDetailData(toolId);
  }

  /** 关闭/返回工具详情 */
  private closeToolDetail(): void {
    if (this._toolDetailStack.length > 1) {
      this._toolDetailStack.pop();
      const parentId = this._toolDetailStack[this._toolDetailStack.length - 1];
      this.pushToolDetailData(parentId);
    } else {
      this._toolDetailStack = [];
      this.appHandle?.closeToolDetail();
    }
  }

  /**
   * 将命令模式添加到 shell/bash 的 allowPatterns 或 denyPatterns。
   * 内存立即生效 + 持久化到 tools.yaml。
   */
  private addCommandPattern(toolName: string, command: string, type: 'allow' | 'deny'): void {
    const pattern = generateCommandPattern(command);
    const key = type === 'allow' ? 'allowPatterns' : 'denyPatterns';

    // 1. 内存生效：直接修改 backend 的 policy 引用
    const policies = this.backend.getToolPolicies?.();
    if (!policies) {
      return;
    }
    let policy = policies[toolName] as Record<string, unknown> | undefined;
    if (!policy) {
      policy = { autoApprove: false };
      policies[toolName] = policy;
    }
    // 添加到目标列表
    const arr = (policy as any)[key] as string[] | undefined;
    if (arr) {
      if (!arr.includes(pattern)) arr.push(pattern);
    } else {
      (policy as any)[key] = [pattern];
    }
    // 从对立列表移除冲突模式（如"始终允许"时清除"始终询问"中的同模式）
    const oppositeKey = type === 'allow' ? 'denyPatterns' : 'allowPatterns';
    const oppositeArr = (policy as any)[oppositeKey] as string[] | undefined;
    if (oppositeArr) {
      const idx = oppositeArr.indexOf(pattern);
      if (idx !== -1) oppositeArr.splice(idx, 1);
    }

    // 2. 持久化到 tools.yaml
    const configManager = this.api?.configManager;
    if (configManager) {
      try {
        const raw = configManager.readEditableConfig() as Record<string, any>;
        const tools = raw.tools ?? {};
        const toolSection = tools[toolName] ?? {};
        const existing: string[] = Array.isArray(toolSection[key]) ? toolSection[key] : [];
        if (!existing.includes(pattern)) {
          existing.push(pattern);
        }
        // 从对立列表移除冲突模式
        const oppositeKey = type === 'allow' ? 'denyPatterns' : 'allowPatterns';
        const opposite: string[] = Array.isArray(toolSection[oppositeKey]) ? toolSection[oppositeKey] : [];
        const oidx = opposite.indexOf(pattern);
        if (oidx !== -1) opposite.splice(oidx, 1);
        const updates: Record<string, any> = { [key]: existing };
        if (oidx !== -1) updates[oppositeKey] = opposite;
        configManager.updateEditableConfig({ tools: { [toolName]: updates } });
      } catch {
        // 持久化失败不阻塞审批
      }
    }
  }

  /** 推送工具详情数据到 UI */
  private pushToolDetailData(toolId: string): void {
    const handle = this._activeHandles.get(toolId);
    if (!handle) return;
    const invocation = handle.getSnapshot();
    const output = handle.getOutputHistory?.() ?? [];
    const childHandles = handle.getChildren?.() ?? [];
    const children = childHandles.map((ch: any) => ch.getSnapshot());
    const breadcrumb = this._toolDetailStack.map((id: string) => {
      const h = this._activeHandles.get(id);
      return { toolId: id, toolName: h?.toolName ?? id };
    });
    // 移除最后一个（当前查看的），只保留上层作为 breadcrumb
    const breadcrumbForView = breadcrumb.slice(0, -1);
    this.appHandle?.openToolDetail(
      { invocation, output, children },
      breadcrumbForView,
    );
  }

  /** 如果详情视图打开，刷新数据 */
  private refreshToolDetailIfNeeded(): void {
    if (this._toolDetailStack.length === 0) return;
    const currentId = this._toolDetailStack[this._toolDetailStack.length - 1];
    if (this._activeHandles.has(currentId)) {
      this.pushToolDetailData(currentId);
    }
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
      // 模型切换后重新应用当前思考强度到新 provider
      if (this.currentThinkingEffort !== 'none') {
        this.applyThinkingEffort(this.currentThinkingEffort);
      }
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

  private applyThinkingEffort(level: import('./app-types').ThinkingEffortLevel): void {
    this.currentThinkingEffort = level;
    const router = this.api?.router as Record<string, any> | undefined;
    if (!router) return;

    if (level === 'none') {
      router.removeCurrentModelRequestBodyKeys?.('thinking', 'output_config');
    } else {
      router.patchCurrentModelRequestBody?.({
        thinking: { type: 'enabled', budget_tokens: 10000 },
        output_config: { effort: level },
      });
    }
  }

  private async handleLoadSession(id: string): Promise<void> {
    this.sessionId = id;
    this.currentToolIds.clear();
    this._activeHandles.clear();

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
      // 收集历史工具调用，包装为 Handle 存入 _activeHandles
      for (const part of parts) {
        if (part.type === 'tool_use') {
          for (const inv of part.tools) {
            this._activeHandles.set(inv.id, this.createHistoricalHandle(inv));
          }
        }
      }
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

  private async handleDream(): Promise<{ ok: boolean; message: string }> {
    const mem = (this.api as any)?.memory;
    if (!mem?.dream) {
      return { ok: false, message: '记忆系统未启用。请先在 /memory 中开启。' };
    }

    try {
      const result = await mem.dream();
      return { ok: result.ok, message: result.message };
    } catch (err) {
      return { ok: false, message: `归纳失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async handleListMemories(): Promise<any[]> {
    const mem = (this.api as any)?.memory;
    if (!mem?.list) return [];
    try {
      return await mem.list(undefined, 500);
    } catch {
      return [];
    }
  }

  private async handleDeleteMemory(id: number): Promise<boolean> {
    const mem = (this.api as any)?.memory;
    if (!mem?.delete) return false;
    try {
      return await mem.delete(id);
    } catch {
      return false;
    }
  }

  private async handleListExtensions(): Promise<any[]> {
    const ext = (this.api as any)?.extensions;
    const configManager = this.api?.configManager;
    if (!ext?.discover || !configManager) return [];

    try {
      // 1. 磁盘发现
      const packages: Array<{ manifest: { name: string; version: string; description?: string; plugin?: any }; source: string }> = ext.discover();
      // 2. plugins.yaml 配置
      const raw = configManager.readEditableConfig() as Record<string, any>;
      const pluginEntries: Array<{ name: string; enabled?: boolean }> = raw?.plugins ?? [];
      const pluginMap = new Map(pluginEntries.map(p => [p.name, p]));
      // 3. 运行时状态
      const active = (this.api as any)?.pluginManager?.listPlugins?.() ?? [];
      const activeNames = new Set(active.map((p: any) => p.name));

      return packages.map(pkg => {
        const name = pkg.manifest.name;
        const hasPlugin = !!pkg.manifest.plugin;
        const inConfig = pluginMap.get(name);
        let status: string;

        if (!hasPlugin) {
          status = 'platform';
        } else if (activeNames.has(name)) {
          status = 'active';
        } else if (inConfig && inConfig.enabled === false) {
          status = 'disabled';
        } else if (inConfig) {
          status = 'disabled'; // 配置中有但未运行
        } else {
          status = 'available';
        }

        return {
          name,
          version: pkg.manifest.version,
          description: pkg.manifest.description || '',
          status,
          hasPlugin,
          source: pkg.source,
        };
      });
    } catch {
      return [];
    }
  }

  private async handleToggleExtension(name: string): Promise<{ ok: boolean; message: string }> {
    const ext = (this.api as any)?.extensions;
    const configManager = this.api?.configManager;
    if (!ext || !configManager) {
      return { ok: false, message: '扩展管理 API 不可用' };
    }

    try {
      // 读取当前 plugins.yaml
      const raw = configManager.readEditableConfig() as Record<string, any>;
      const pluginEntries: Array<{ name: string; enabled?: boolean; [k: string]: any }> = [...(raw?.plugins ?? [])];
      const existing = pluginEntries.find(p => p.name === name);

      // 判断运行时状态
      const active = (this.api as any)?.pluginManager?.listPlugins?.() ?? [];
      const isActive = active.some((p: any) => p.name === name);

      if (isActive) {
        // 禁用：停用插件 + 更新 yaml
        await ext.deactivate(name);
        if (existing) {
          existing.enabled = false;
        } else {
          pluginEntries.push({ name, enabled: false });
        }
        configManager.updateEditableConfig({ plugins: pluginEntries } as any);
        return { ok: true, message: `已禁用 "${name}"` };
      } else {
        // 启用：先激活插件，成功后再更新 yaml（防止 activate 失败导致状态不一致）
        await ext.activate(name);
        if (existing) {
          existing.enabled = true;
        } else {
          pluginEntries.push({ name, enabled: true });
        }
        configManager.updateEditableConfig({ plugins: pluginEntries } as any);
        return { ok: true, message: `已启用 "${name}"` };
      }
    } catch (err) {
      return { ok: false, message: `操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async handleSummarize(): Promise<{ ok: boolean; message: string }> {
    this.appHandle?.setGeneratingLabel('compressing context...');
    this._isGenerating = true;
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
      this._isGenerating = false;
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
    this._isGenerating = true;
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

    this._isGenerating = false;
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
  extensions?: Pick<BootstrapExtensionRegistryLike, 'llmProviders' | 'ocrProviders'>;
  api?: IrisAPI;
  isCompiledBinary?: boolean;
  [key: string]: unknown;
}

export default async function consoleFactory(rawContext: Record<string, unknown>): Promise<ConsolePlatform> {
  const context = rawContext as unknown as ConsoleFactoryContext;

  // 读取 platform.yaml 中的 console: 配置段
  const platformCfg = (context.config?.platform as Record<string, unknown> | undefined)?.console;
  const consoleConfig = resolveConsoleConfig(platformCfg as Record<string, unknown> | undefined);

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
    initWarnings: context.initWarnings,
    extensions: context.extensions,
    api: context.api,
    isCompiledBinary: context.isCompiledBinary ?? false,
    consoleConfig,
  });
}
