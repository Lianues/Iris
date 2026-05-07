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
import { createCliRenderer, capture as opentuiCapture, type CliRenderer } from '@opentui/core';
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
  type BootstrapExtensionRegistryLike,
  type ConfigManagerLike,
} from 'irises-extension-sdk';
import type { IPCClientLike } from 'irises-extension-sdk/ipc';
import { ensureExtensionRuntimeDependencies, readGitInstallMetadata } from 'irises-extension-sdk/utils';
import { estimateTokenCount } from 'tokenx';
import { App, AppHandle, MessageMeta } from './App';
import { MessagePart } from './components/MessageItem';
import { ConsoleSettingsController, ConsoleSettingsSaveResult, ConsoleSettingsSnapshot } from './settings';
import { configureBundledOpenTuiTreeSitter } from './opentui-runtime';
import { attachCompiledResizeWatcher } from './resize-watcher';
import { ICONS } from './terminal-compat';
import type { ConsoleConfig } from './console-config';
import { resolveConsoleConfig } from './console-config';
import { CONSOLE_TOOL_DISPLAY_SERVICE_ID, consoleToolDisplayService } from './tool-display-service';
import { CONSOLE_SLASH_COMMAND_SERVICE_ID, consoleSlashCommandService } from './slash-command-service';

/** 从 shell 命令生成前缀通配模式（如 "npm install express" → "npm install *"） */
function generateCommandPattern(command: string): string {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) return '*';
  if (tokens.length <= 1) return tokens[0] + ' *';
  if (tokens[1].startsWith('-')) return tokens[0] + ' *';
  return tokens[0] + ' ' + tokens[1] + ' *';
}

type WsIPCClientLike = IPCClientLike & {
  connect(url: string, token: string): Promise<{ agentName: string; streamEnabled: boolean }>;
  subscribe(sessions: string | string[]): Promise<void>;
  disconnect(): void;
};

type WsIPCClientConstructor = new () => WsIPCClientLike;
type DiscoverLanInstancesFn = () => Promise<import('./remote-wizard').DiscoveredConnection[]>;

const REMOTE_CONNECT_WS_CLIENT_SERVICE = 'remote-connect:WsIPCClient';
const REMOTE_CONNECT_DISCOVERY_SERVICE = 'remote-connect:discoverLanInstances';
const PLAN_MODE_SERVICE_ID = 'plan-mode';

interface PlanModeServiceLike {
  enter(sessionId: string): { planFilePath: string; active: boolean };
  leave?(sessionId: string): unknown;
  exit(sessionId: string): unknown;
  isActive(sessionId?: string): boolean;
  getState(sessionId?: string): { planFilePath: string; active: boolean; hasExited?: boolean } | null;
  readPlan(sessionId: string): string | null;
}

interface PlanCommandResult {
  ok: boolean;
  message: string;
  followupPrompt?: string;
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

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if ('text' in part) {
      if (part.thought === true) {
        result.push({ type: 'thought', text: part.text ?? '', durationMs: part.thoughtDurationMs });
      } else {
        result.push({ type: 'text', text: part.text ?? '' });
      }
      continue;
    }

    if ('inlineData' in part) {
      const mime = part.inlineData.mimeType || '';
      const fileType = mime.startsWith('image/') ? 'image'
        : mime.startsWith('audio/') ? 'audio'
        : mime.startsWith('video/') ? 'video'
        : 'document';
      const fileName = (part.inlineData as any).name || mime;
      result.push({ type: 'file', fileType, fileName, mimeType: mime });
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
  /** 是否允许 TUI 内 /headless 切换为宿主 Core-only 模式。 */
  supportsHeadlessTransition?: boolean;
}

type ConsoleExitAction = 'exit' | 'switch-agent' | 'headless';

interface ConsoleStopOptions {
  /** Windows 下从 TUI 切到前台 headless 时，不退出交替屏幕，只清屏显示后台状态，避免触发终端关闭。 */
  headlessTransition?: boolean;
  /** Windows 下是否在进程退出时恢复主屏幕。重建 TUI 的内部 stop 不应注册该 handler。 */
  restoreOnProcessExit?: boolean;
}

function restoreWindowsAlternateScreen(): void {
  const { spawnSync } = require('child_process');
  const { writeSync } = require('fs');
  const seq = '\x1b[?1049l\x1b[?25h';

  try {
    // 优先尝试 node（项目环境通常有）。用子进程写入可绕过 bun 直接写退出交替屏幕时的 Windows 崩溃问题。
    const r1 = spawnSync('node', ['-e', `process.stdout.write(${JSON.stringify(seq)})`],
      { stdio: 'inherit', timeout: 2000, windowsHide: true });
    if (r1.status === 0) return;
  } catch { /* ignore */ }

  try {
    // 回退到 PowerShell（Windows 10 自带）。
    const psCmd = `[Console]::Write([char]27 + '[?1049l' + [char]27 + '[?25h')`;
    const r2 = spawnSync('powershell', ['-NoProfile', '-Command', psCmd],
      { stdio: 'inherit', timeout: 2000, windowsHide: true });
    if (r2.status === 0) return;
  } catch { /* ignore */ }

  // 最终回退：直接清屏（会丢失之前的终端记录，但至少不残留 TUI）。
  try { writeSync(1, '\x1b[2J\x1b[H\x1b[?25h'); } catch { /* ignore */ }
}

function cleanupWindowsRendererWithoutDestroy(renderer: CliRenderer): void {
  const r = renderer as any;

  // Windows 下不能直接调用 renderer.destroy()，但 /headless 后进程会继续运行，
  // 所以仍要尽量停止 render loop 并移除进程级监听器，避免旧 TUI 在后台残留。
  try { r.stop?.(); } catch { /* ignore */ }
  try { r.disableMouse?.(); } catch { /* ignore */ }
  try { r.disableKittyKeyboard?.(); } catch { /* ignore */ }
  try { r.lib?.disableMouse?.(r.rendererPtr); } catch { /* ignore */ }
  try { r.lib?.disableKittyKeyboard?.(r.rendererPtr); } catch { /* ignore */ }
  // OpenTUI 的 native restoreTerminalModes 会恢复一批终端输入模式；不依赖它退出 alternate screen。
  try { r.lib?.restoreTerminalModes?.(r.rendererPtr); } catch { /* ignore */ }
  try {
    r._isRunning = false;
    r.immediateRerenderRequested = false;
    r._controlState = 'explicit_stopped';
  } catch { /* ignore */ }
  try {
    if (r.renderTimeout) {
      r.clock?.clearTimeout?.(r.renderTimeout);
      r.renderTimeout = null;
    }
  } catch { /* ignore */ }
  try {
    if (r.resizeTimeoutId !== null && r.resizeTimeoutId !== undefined) {
      r.clock?.clearTimeout?.(r.resizeTimeoutId);
      r.resizeTimeoutId = null;
    }
  } catch { /* ignore */ }
  try {
    if (r.capabilityTimeoutId !== null && r.capabilityTimeoutId !== undefined) {
      r.clock?.clearTimeout?.(r.capabilityTimeoutId);
      r.capabilityTimeoutId = null;
    }
  } catch { /* ignore */ }
  try {
    if (r.memorySnapshotTimer) {
      r.clock?.clearInterval?.(r.memorySnapshotTimer);
      r.memorySnapshotTimer = null;
    }
  } catch { /* ignore */ }
  // 如果 stop() 发生在一帧渲染中，后续 renderNative 可能把最后一帧 TUI 又刷回来；直接置空避免覆盖清屏。
  try { r.renderNative = () => {}; } catch { /* ignore */ }
  try { r.removeExitListeners?.(); } catch { /* ignore */ }
  try {
    if (r.sigwinchHandler) (process as any).removeListener?.('SIGWINCH', r.sigwinchHandler);
  } catch { /* ignore */ }
  try {
    if (r.handleError) {
      (process as any).removeListener?.('uncaughtException', r.handleError);
      (process as any).removeListener?.('unhandledRejection', r.handleError);
    }
  } catch { /* ignore */ }
  try {
    if (r.warningHandler) (process as any).removeListener?.('warning', r.warningHandler);
  } catch { /* ignore */ }
  try {
    if (r.exitHandler) (process as any).removeListener?.('beforeExit', r.exitHandler);
  } catch { /* ignore */ }
  try {
    if (r.captureCallback) {
      // 用顶层 ESM 导入替代 require('@opentui/core')：
      // Bun 编译时会静态跟随 src/attach.ts 中的 dynamic import 把本文件
      // 打进 iris 主二进制；@opentui/core 含 top-level await，
      // CJS require 同步求值会触发
      // "This require call is not allowed because the transitive dependency
      //  contains a top-level await" 编译错误。
      (opentuiCapture as any)?.removeListener?.('write', r.captureCallback);
    }
  } catch { /* ignore */ }
  try { r.stdin?.removeListener?.('data', r.stdinListener); } catch { /* ignore */ }
  // 不调用 stdinParser.destroy()：OpenTUI 中可能仍有 capability timeout / pending frame 会调用
  // updateStdinParserProtocolContext()；如果 parser 已 destroy 但引用仍在，会抛出
  // "StdinParser has been destroyed" 并导致 bun run dev 退出。
  try { r.updateStdinParserProtocolContext = () => {}; } catch { /* ignore */ }
  try { r.drainStdinParser = () => {}; } catch { /* ignore */ }
  try { r.stdinParser = null; } catch { /* ignore */ }
  try { r.oscSubscribers?.clear?.(); } catch { /* ignore */ }
  try { r.disableStdoutInterception?.(); } catch { /* ignore */ }
}

function windowsInputModeResetSequence(): string {
  return ''
    + '\x1b[?9l'     // X10 mouse tracking off
    + '\x1b[?1000l'  // mouse button tracking off
    + '\x1b[?1001l'  // highlight mouse tracking off
    + '\x1b[?1002l'  // mouse drag tracking off
    + '\x1b[?1003l'  // any-event mouse tracking off
    + '\x1b[?1004l'  // focus event tracking off
    + '\x1b[?1005l'  // UTF-8 mouse mode off
    + '\x1b[?1006l'  // SGR mouse mode off
    + '\x1b[?1007l'  // alternate scroll mode off
    + '\x1b[?1015l'  // urxvt mouse mode off
    + '\x1b[?1016l'  // SGR pixel mouse mode off
    + '\x1b[?2004l'  // bracketed paste off
    + '\x1b[?2026l'  // synchronized output off
    + '\x1b[?2027l'  // unicode width/terminal extension mode off (best effort)
    + '\x1b[?2031l'  // terminal extension mode off (best effort)
    + '\x1b[>4;0m'   // xterm modifyOtherKeys off (OpenTUI enables >4;1m)
    + '\x1b[<u';     // kitty keyboard protocol pop/disable (best effort)
}

function clearWindowsScreenForHeadless(): void {
  const { writeSync } = require('fs');
  try {
    writeSync(1,
      windowsInputModeResetSequence()
      + '\x1b[?25h'   // 恢复光标
      + '\x1b[0m'   // 重置颜色
      + '\x1b[2J\x1b[H' // 清空当前（可能是 alternate）屏幕并回到左上角
    );
  } catch { /* ignore */ }
}

function printHeadlessTransitionMessage(): void {
  const { writeSync } = require('fs');
  try {
    writeSync(1,
      '[Iris] Console TUI 已关闭，正在切换为 Core-only 后台模式...\n'
      + '[Iris] Core / IPC 仍在运行，可通过 iris attach 重新连接。\n'
      + '[Iris] 按 Ctrl+C 可关闭后台 Core。\n'
    );
  } catch { /* ignore */ }
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
  private exitResolve?: (action: ConsoleExitAction) => void;

  private renderer?: CliRenderer;
  private appHandle?: AppHandle;
  private disposeResizeWatcher?: () => void;
  /** SIGCONT 信号处理函数，stop() 时需要清理 */
  private _sigcontHandler?: () => void;
  private api?: IrisAPI;
  private _activeHandles: Map<string, any> = new Map();
  private isCompiledBinary: boolean;
  private consoleConfig: ConsoleConfig;
  private supportsHeadlessTransition: boolean;

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
  /** Backend 事件监听清理函数；start/stop 之间有效，避免切换 Agent 后重复监听 */
  private backendListenerDisposers: Array<() => void> = [];
  /** 当前是否正在生成响应（用于阻止 addErrorMessage 破坏流式占位消息） */
  private _isGenerating = false;

  /** 待发送的文件附件（由 /file 命令添加，handleInput 时消费） */
  private _pendingImages: import('irises-extension-sdk').ImageInput[] = [];
  private _pendingDocuments: import('irises-extension-sdk').DocumentInput[] = [];
  private _pendingAudio: import('irises-extension-sdk').AudioInput[] = [];
  private _pendingVideo: import('irises-extension-sdk').VideoInput[] = [];
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
    this.supportsHeadlessTransition = options.supportsHeadlessTransition === true;
    this.settingsController = new ConsoleSettingsController({
      backend,
      configManager: options.api?.configManager,
      services: options.api?.services,
      extensions: options.extensions,
    });
    const services = options.api?.services;
    if (services && !services.has(CONSOLE_TOOL_DISPLAY_SERVICE_ID)) {
      services.register(CONSOLE_TOOL_DISPLAY_SERVICE_ID, consoleToolDisplayService, {
        description: 'Console TUI 工具显示扩展服务',
        version: '1.0.0',
      });
    }
    if (services && !services.has(CONSOLE_SLASH_COMMAND_SERVICE_ID)) {
      services.register(CONSOLE_SLASH_COMMAND_SERVICE_ID, consoleSlashCommandService, {
        description: 'Console TUI 斜杠指令扩展服务',
        version: '1.0.0',
      });
    }
  }

  private getPlanModeService(): PlanModeServiceLike | undefined {
    return (this.api?.services as any)?.get?.(PLAN_MODE_SERVICE_ID) as PlanModeServiceLike | undefined;
  }

  private syncPlanModeStatus(): void {
    try {
      const active = this.getPlanModeService()?.isActive(this.sessionId) === true;
      this.appHandle?.setPlanModeActive(active);
    } catch {
      this.appHandle?.setPlanModeActive(false);
    }
  }

  private getLocalExtensionService<T>(id: string): T | undefined {
    const api = this.originalApi ?? this.api;
    return (api?.services as any)?.get?.(id) as T | undefined;
  }

  private onBackend(event: string, listener: (...args: any[]) => void): void {
    const backend = this.backend as any;
    backend.on(event, listener);
    this.backendListenerDisposers.push(() => backend.off?.(event, listener)
      ?? backend.removeListener?.(event, listener));
  }

  private disposeBackendListeners(): void {
    for (const dispose of this.backendListenerDisposers.splice(0)) {
      try { dispose(); } catch { /* ignore */ }
    }
  }

  private disposeCurrentRemoteBackend(): void {
    if (!this._isRemote) return;
    try { (this.backend as any).dispose?.(); } catch { /* ignore */ }
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
    this.onBackend('assistant:content', (sid: string, content: Content) => {
      if (sid === this.sessionId) {
        const meta = getMessageMeta(content);
        const parts = convertPartsToMessageParts(content.parts, 'queued');
        this.appHandle?.finalizeAssistantParts(parts, meta);
      }
    });

    this.onBackend('stream:start', (sid: string) => {
      if (sid === this.sessionId) {
        this.currentToolIds.clear();
        this.appHandle?.startStream();
      }
    });

    this.onBackend('stream:parts', (sid: string, parts: Part[]) => {
      if (sid === this.sessionId) {
        this.appHandle?.pushStreamParts(convertPartsToMessageParts(parts, 'streaming'));
      }
    });

    this.onBackend('stream:chunk', (sid: string, _chunk: string) => {
      if (sid === this.sessionId) {
        // console 走 stream:parts，保留 stream:chunk 仅兼容其他平台
      }
    });

    this.onBackend('stream:end', (sid: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.endStream();
      }
    });

    this.onBackend('tool:execute', (sid: string, handle: any) => {
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
        this.syncPlanModeStatus();
      };
      handle.on('state', refreshUI);
      handle.on('progress', refreshUI);
      handle.on('output', refreshUI);
      handle.on('child', (childHandle: any) => {
        this._activeHandles.set(childHandle.id, childHandle);
        childHandle.on('state', refreshUI);
        childHandle.on('output', refreshUI);
        refreshUI();
      });
      refreshUI();
    });

    this.onBackend('error', (sid: string, error: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.addErrorMessage(error);
      }
    });

    this.onBackend('usage', (sid: string, usage: UsageMetadata) => {
      if (sid === this.sessionId) {
        this.appHandle?.setUsage(usage);
      }
    });

    this.onBackend('retry', (sid: string, attempt: number, maxRetries: number, error: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.setRetryInfo({ attempt, maxRetries, error });
      }
    });

    this.onBackend('user:token', (sid: string, tokenCount: number) => {
      if (sid === this.sessionId) {
        this.appHandle?.setUserTokens(tokenCount);
      }
    });


    this.onBackend('done', (sid: string, durationMs: number) => {
      if (sid === this.sessionId) {
        this.appHandle?.finalizeResponse(durationMs);
        this.appHandle?.clearNotificationContext();
        this.syncPlanModeStatus();
      }
    });

    // 监听 turn:start 区分 notification turn 和普通 turn
    this.onBackend('turn:start', (sid: string, _turnId: string, mode: string) => {
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
    this.onBackend('agent:notification', (sid: string, _taskId: string, status: string, summary: string, taskType?: string, silent?: boolean) => {
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
    this.onBackend('notification:payloads', (sid: string, payloads: any[]) => {
      if (sid === this.sessionId) {
        this.appHandle?.setNotificationPayloads(payloads);
      }
    });

    // ── 轻量级任务结果广播：通用的 task:result 通道 ──
    // 所有终态任务都会 emit 此事件，不绑定 silent 或任务类型。
    // 平台层自行决定是否消费和如何渲染。
    // 当前策略：silent 任务渲染通知卡片（因为不会有 LLM 回复），非 silent 跳过（避免重复）。
    this.onBackend('task:result', (
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

    this.onBackend('auto-compact', (sid: string, summaryText: string) => {
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

      // ── 终端焦点恢复：强制全屏重绘 ──────────────────────────
      // 某些终端（macOS Terminal.app、部分 ConPTY 实现）在窗口失焦或
      // 最小化时可能丢弃交替屏幕缓冲区的内容。OpenTUI 的 diff 渲染器
      // 仅发送变化的 cell，不知道屏幕已被清空——清空 currentRenderBuffer
      // 使所有 cell 都被视为"已变化"，下一帧即可完整重绘。
      {
        const r = this.renderer as any;
        r.on('focus', () => {
          r.currentRenderBuffer?.clear();
          r.requestRender();
        });
      }

      // ── 进程挂起恢复（SIGCONT）──────────────────────────────
      // 用户通过 Ctrl+Z 挂起进程后 fg 恢复时，终端会退出 raw mode
      // 并重置交替屏幕。重新启用 raw mode 并强制全屏重绘以恢复 TUI。
      if (process.platform !== 'win32') {
        if (this._sigcontHandler) {
          (process as any).removeListener?.('SIGCONT', this._sigcontHandler);
        }
        this._sigcontHandler = () => {
          if (!this.renderer) return;
          try { if (process.stdin.isTTY) process.stdin.setRawMode(true); } catch { /* ignore */ }
          (this.renderer as any).currentRenderBuffer?.clear();
          (this.renderer as any).requestRender();
        };
        process.on('SIGCONT', this._sigcontHandler);
      }

      const element = React.createElement(App, {
        onReady: (handle: AppHandle) => {
          this.appHandle = handle;
          this.syncPlanModeStatus();
          resolve();
        },
        onSubmit: (text: string) => this.handleInput(text),
        onFileAttach: (filePath: string) => this.handleFileAttach(filePath),
        onRemoveFile: (index: number) => this.handleRemoveFile(index),
        onFileBrowserSelect: (dirPath: string, entry: any, showHidden: boolean) => {
          this.handleFileBrowserSelect(dirPath, entry, showHidden);
        },
        onFileBrowserGoUp: (dirPath: string, showHidden: boolean) => {
          this.handleFileBrowserGoUp(dirPath, showHidden);
        },
        onFileBrowserToggleHidden: (dirPath: string, showHidden: boolean) => {
          this.handleFileBrowserToggleHidden(dirPath, showHidden);
        },
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
        onToolMessage: (toolId: string, type: string, data?: unknown) => {
          (this.backend as any).getToolHandle?.(toolId)?.send(type, data);
        },
        onAddCommandPattern: (toolName: string, command: string, type: 'allow' | 'deny') => {
          this.addCommandPattern(toolName, command, type);
        },
        onAbort: () => {
          this.backend.abortChat?.(this.sessionId);
        },
        onToolAbort: (toolId: string) => {
          (this._activeHandles.get(toolId) ?? (this.backend as any).getToolHandle?.(toolId))?.abort();
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
        onSetDefaultModel: (modelName: string) => this.handleSetDefaultModel(modelName),
        onUpdateModelEntry: (currentModelName: string, updates: { modelName?: string; contextWindow?: number | null }) => this.handleUpdateModelEntry(currentModelName, updates),
        onSwitchModel: (modelName: string) => this.handleSwitchModel(modelName),
        onLoadSettings: () => this.handleLoadSettings(),
        onSaveSettings: (snapshot: ConsoleSettingsSnapshot) => this.handleSaveSettings(snapshot),
        onResetConfig: () => this.handleResetConfig(),
        onExit: () => {
          void this.stop({ restoreOnProcessExit: true }).then(() => {
            this.exitResolve?.('exit');
          });
        },
        onEnterHeadless: this.supportsHeadlessTransition ? () => {
          void this.stop({ headlessTransition: true }).then(() => {
            this.exitResolve?.('headless');
          });
        } : undefined,
        supportsHeadlessTransition: this.supportsHeadlessTransition,
        onSummarize: () => this.handleSummarize(),
        onPlanCommand: (arg: string) => this.handlePlanCommand(arg),
        onListAgents: () => this.handleListAgents(),
        onSelectAgent: (name: string) => this.handleSelectAgent(name),
        onDream: () => this.handleDream(),
        onListMemories: () => this.handleListMemories(),
        onDeleteMemory: (id: number) => this.handleDeleteMemory(id),
        onListExtensions: () => this.handleListExtensions(),
        onToggleExtension: (name: string) => this.handleToggleExtension(name),
        onInstallGitExtension: (target: string, scope?: 'global' | 'agent') => this.handleInstallGitExtension(target, scope),
        onDeleteExtension: (name: string) => this.handleDeleteExtension(name),
        onPreviewUpdateExtension: (name: string) => this.handlePreviewUpdateExtension(name),
        onUpdateExtension: (name: string) => this.handleUpdateExtension(name),
        onListPluginSettingsTabs: () => this.api?.getConsoleSettingsTabs?.() ?? [],
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

  async stop(options: ConsoleStopOptions = {}): Promise<void> {
    this.disposeBackendListeners();

    // 幂等保护：onExit 和 shutdown() 都会调用 stop()，
    // 双重 destroy() 会向已恢复的终端重复写入 ANSI 转义序列导致异常。
    if (!this.renderer) return;
    const r = this.renderer;
    this.renderer = undefined as any;
    this.disposeResizeWatcher?.();

    // 移除 SIGCONT 信号监听（renderer.destroy 不会清理进程级信号监听器）
    if (this._sigcontHandler) {
      (process as any).removeListener?.('SIGCONT', this._sigcontHandler);
      this._sigcontHandler = undefined;
    }

    if (process.platform === 'win32') {
      const shouldClearForHeadless = options.headlessTransition;
      // Windows workaround: bun 在 destroy() 中写入 \x1b[?1049l（退出交替屏幕）
      // 会导致 cmd.exe / 终端窗口崩溃关闭。跳过 renderer.destroy()，但仍清理可安全清理的监听器。
      cleanupWindowsRendererWithoutDestroy(r);
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch { /* ignore */ }
      try { process.stdin.pause(); } catch { /* ignore */ }
      // 立即关闭鼠标和 bracketed paste（这些不触发崩溃）
      const { writeSync } = require('fs');
      try {
        writeSync(1,
          windowsInputModeResetSequence()
          + '\x1b[0m'      // 重置颜色
        );
      } catch { /* ignore */ }
      // 退出交替屏幕 + 恢复光标放在 process.on('exit')。
      // bun 直接写 \x1b[?1049l 会导致 cmd.exe 崩溃，
      // 所以用 spawnSync 让子进程（node/powershell）来写，绕过 bun 的 bug。
      // 如果子进程也失败则回退到 \x1b[2J 清屏。
      // /headless 后进程会继续运行，此时立即写 \x1b[?1049l 在部分 Windows 终端中会直接关闭窗口；
      // 因此只清空当前屏幕并让 index.ts 打印 Core-only 状态，而不切回主屏。
      if (!shouldClearForHeadless && options.restoreOnProcessExit !== false) {
        process.on('exit', restoreWindowsAlternateScreen);
      }
    } else {
      r.destroy();
    }

    // 等待终端 I/O flush
    await new Promise(resolve => setTimeout(resolve, 100));

    if (process.platform === 'win32' && options.headlessTransition) {
      clearWindowsScreenForHeadless();
      printHeadlessTransitionMessage();
    }
  }

  /**
   * ForegroundPlatform 接口实现。
   * 返回的 Promise 在用户选择退出、切换 Agent 或切换 Headless 时 resolve。
   */
  // 返回 Promise<any> 兼容已安装在 extension/node_modules 中的旧版 SDK 类型声明。
  waitForExit(): Promise<any> {
    return new Promise<ConsoleExitAction>((resolve) => {
      this.exitResolve = resolve;
    });
  }


  /**
   * 获取可用 Agent 列表（/agent 命令触发）。
   *
   * 修改方式：不再直接操作 stdin/stdout 显示 ANSI 选择器，
   * 而是返回 agent 列表交给 React viewMode 渲染，避免 stdin 争夺和日志泄漏。
   */
  private handleListAgents(): import('irises-extension-sdk').AgentDefinitionLike[] {
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
    await this.stop({ restoreOnProcessExit: false });

    const targetHandle = network.getPeerBackendHandle?.(targetName);
    if (targetHandle) {
      if (typeof (targetHandle as any).initCaches === 'function') await (targetHandle as any).initCaches();
      this.disposeCurrentRemoteBackend();
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
        if (typeof peerAPI.initCaches === 'function') await peerAPI.initCaches();
        this.api = peerAPI;
        this.settingsController = new ConsoleSettingsController({
          backend: targetHandle,
          configManager: peerAPI.configManager,
          services: peerAPI.services,
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
      const WsIPCClient = this.getLocalExtensionService<WsIPCClientConstructor>(REMOTE_CONNECT_WS_CLIENT_SERVICE);
      if (!WsIPCClient) {
        throw new Error('remote-connect 扩展服务不可用，请确认 remote-connect 扩展已安装并启用');
      }
      const { RemoteBackendHandle, createRemoteApiProxy } = await import('irises-extension-sdk/ipc');

      const wsClient = new WsIPCClient();
      const handshake = await wsClient.connect(url, token);

      let remoteBackend: any;
      let remoteApi: any;
      try {
        remoteBackend = new RemoteBackendHandle(wsClient);
        remoteBackend._streamEnabled = handshake.streamEnabled;
        await remoteBackend.initCaches();
        await wsClient.subscribe('*');

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
        services: undefined,
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
    await this.stop({ restoreOnProcessExit: false });

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
      const discoverLanInstances = this.getLocalExtensionService<DiscoverLanInstancesFn>(REMOTE_CONNECT_DISCOVERY_SERVICE);
      if (discoverLanInstances) discoveryPromise = discoverLanInstances();
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
    await this.stop({ restoreOnProcessExit: false });

    this.disposeCurrentRemoteBackend();

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
    this.appHandle?.setPlanModeActive(false);
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

  private handleListModels(): { models: IrisModelInfoLike[]; defaultModelName: string } {
    const models = this.backend.listModels?.() ?? [];
    let defaultModelName = '';
    try {
      const raw = this.api?.configManager?.readEditableConfig?.() as any;
      if (raw?.llm?.defaultModel && typeof raw.llm.defaultModel === 'string') {
        defaultModelName = raw.llm.defaultModel;
      }
    } catch {
      // 读取失败不阻塞
    }
    return { models: models as IrisModelInfoLike[], defaultModelName };
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
    this.syncPlanModeStatus();

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

  private async handleSetDefaultModel(modelName: string): Promise<{ ok: boolean; message: string }> {
    try {
      const snapshot = await this.settingsController.loadSnapshot();
      const target = snapshot.models.find((model) => model.modelName === modelName || model.originalModelName === modelName);
      if (!target) {
        return { ok: false, message: `未找到模型 "${modelName}"` };
      }
      snapshot.defaultModelName = target.modelName;
      const result = await this.settingsController.saveSnapshot(snapshot);
      return { ok: result.ok, message: result.message };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async handleUpdateModelEntry(
    currentModelName: string,
    updates: { modelName?: string; contextWindow?: number | null },
  ): Promise<{ ok: boolean; message: string; updatedModelName?: string }> {
    try {
      const snapshot = await this.settingsController.loadSnapshot();
      const target = snapshot.models.find((model) => model.modelName === currentModelName || model.originalModelName === currentModelName);
      if (!target) {
        return { ok: false, message: `未找到模型 "${currentModelName}"` };
      }

      const previousName = target.modelName;
      const nextName = typeof updates.modelName === 'string' ? updates.modelName.trim() : previousName;
      if (typeof updates.modelName === 'string') {
        if (!nextName) {
          return { ok: false, message: '模型名不能为空' };
        }
        const duplicate = snapshot.models.some((model) => model !== target && model.modelName.trim() === nextName);
        if (duplicate) {
          return { ok: false, message: `模型名 "${nextName}" 已存在` };
        }
        target.modelName = nextName;
        if (snapshot.defaultModelName === previousName) {
          snapshot.defaultModelName = nextName;
        }
      }

      if ('contextWindow' in updates) {
        target.contextWindow = updates.contextWindow == null ? undefined : updates.contextWindow;
      }

      const wasCurrent = this.backend.getCurrentModelInfo?.()?.modelName === previousName;
      const result = await this.settingsController.saveSnapshot(snapshot);
      if (!result.ok) {
        return { ok: false, message: result.message, updatedModelName: nextName };
      }

      if (wasCurrent) {
        try {
          if (nextName !== previousName) {
            this.backend.switchModel?.(nextName, 'console');
          }

          const currentInfo = this.backend.getCurrentModelInfo?.() as {
            modelName?: string;
            modelId?: string;
            contextWindow?: number;
          } | undefined;
          if (currentInfo?.modelName) this.modelName = currentInfo.modelName;
          if (currentInfo?.modelId) this.modelId = currentInfo.modelId;
          if ('contextWindow' in (currentInfo ?? {})) {
            this.contextWindow = currentInfo?.contextWindow;
          }
        } catch { /* ignore */ }
      }

      return { ok: true, message: result.message, updatedModelName: nextName };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), updatedModelName: updates.modelName };
    }
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
    if (!ext?.discover || !configManager) {
      console.error('[ConsolePlatform] handleListExtensions: ext?.discover =', !!ext?.discover, ', configManager =', !!configManager, ', api keys =', this.api ? Object.keys(this.api as any) : 'no api');
      return [];
    }

    try {
      // 1. 磁盘发现
      const packages: Array<{ manifest: { name: string; version: string; description?: string; entry?: string; plugin?: any; platforms?: any[] }; source: string; rootDir: string }> = ext.discover();
      // 2. plugins.yaml 配置
      const raw = configManager.readEditableConfig() as Record<string, any>;
      const pluginEntries = this.readPluginEntries(raw);
      const pluginMap = new Map(pluginEntries.map(p => [p.name, p]));
      // 3. 运行时状态
      const active = (this.api as any)?.pluginManager?.listPlugins?.() ?? [];
      const activeNames = new Set(active.map((p: any) => p.name));

      const allPackages: Array<{ manifest: { name: string; version: string; description?: string; entry?: string; plugin?: any; platforms?: any[] }; source: string; rootDir: string }> = ext.discoverAll?.() ?? packages;

      return allPackages.map(pkg => {
        const name = pkg.manifest.name;
        const hasPlatforms = Array.isArray(pkg.manifest.platforms) && pkg.manifest.platforms.length > 0;
        const hasPlugin = !!pkg.manifest.plugin || !!pkg.manifest.entry || !hasPlatforms;
        const inConfig = pluginMap.get(name);
        const gitMetadata = readGitInstallMetadata(pkg.rootDir);
        const workspaceEnabled = pkg.source === 'workspace' ? this.isWorkspaceExtensionEnabled(raw, name) : false;
        let status: string;

        if (!hasPlugin && pkg.source !== 'workspace') {
          status = 'platform';
        } else if (!hasPlugin && pkg.source === 'workspace') {
          status = workspaceEnabled ? 'active' : 'available';
        } else if (activeNames.has(name)) {
          status = 'active';
        } else if (pkg.source === 'workspace' && !workspaceEnabled) {
          status = 'available';
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
          originalStatus: status,
          hasPlugin,
          source: pkg.source,
          installSource: gitMetadata?.source,
          gitUrl: gitMetadata?.url,
          gitRef: gitMetadata?.ref,
          gitCommit: gitMetadata?.commit,
          gitSubdir: gitMetadata?.subdir,
        };
      }).sort((a, b) => {
        const groupA = a.hasPlugin ? 0 : 1;
        const groupB = b.hasPlugin ? 0 : 1;
        return groupA === groupB ? a.name.localeCompare(b.name) : groupA - groupB;
      });
    } catch (err) {
      console.error('[ConsolePlatform] handleListExtensions failed:', err);
      return [];
    }
  }

  private isWorkspaceExtensionEnabled(raw: Record<string, any> | undefined, name: string): boolean {
    const extensions = raw?.system?.extensions;
    if (!extensions || typeof extensions !== 'object' || extensions.loadWorkspaceExtensions !== true) return false;
    const allowlist = Array.isArray(extensions.workspaceAllowlist)
      ? extensions.workspaceAllowlist.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    return allowlist.length === 0 || allowlist.includes(name);
  }

  private updateWorkspaceExtensionDiscoveryConfig(
    name: string,
    enabled: boolean,
    packages: Array<{ manifest: { name: string }; source?: string }>,
  ): { workspace: { enabled: boolean; allowlist: string[] }; mergedRaw?: Record<string, unknown> } {
    const configManager = this.api?.configManager;
    if (!configManager) return { workspace: { enabled: false, allowlist: [] } };

    const raw = configManager.readEditableConfig() as Record<string, any>;
    const system = raw.system && typeof raw.system === 'object' ? { ...raw.system } : {};
    const currentExtensions = system.extensions && typeof system.extensions === 'object' ? { ...system.extensions } : {};
    const workspaceNames = packages.filter(pkg => pkg.source === 'workspace').map(pkg => pkg.manifest.name);
    const currentAllowlist = Array.isArray(currentExtensions.workspaceAllowlist)
      ? currentExtensions.workspaceAllowlist.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const currentlyAllWorkspace = currentExtensions.loadWorkspaceExtensions === true && currentAllowlist.length === 0;

    let nextAllowlist: string[];
    let nextEnabled: boolean;
    if (enabled) {
      nextEnabled = true;
      nextAllowlist = currentlyAllWorkspace ? [] : Array.from(new Set([...currentAllowlist, name]));
    } else {
      nextAllowlist = currentlyAllWorkspace
        ? workspaceNames.filter((item: string) => item !== name)
        : currentAllowlist.filter((item: string) => item !== name);
      nextEnabled = nextAllowlist.length > 0;
      if (!nextEnabled) nextAllowlist = [];
    }

    system.extensions = { ...currentExtensions, loadWorkspaceExtensions: nextEnabled, workspaceAllowlist: nextAllowlist };
    const result = configManager.updateEditableConfig({ system } as any);
    return { workspace: { enabled: nextEnabled, allowlist: nextAllowlist }, mergedRaw: result.mergedRaw as Record<string, unknown> };
  }

  private readPluginEntries(raw: Record<string, any> | undefined): Array<{ name: string; enabled?: boolean; [key: string]: any }> {
    const section = raw?.plugins;
    if (Array.isArray(section)) return section.filter((item) => item && typeof item.name === 'string');
    if (section && typeof section === 'object' && Array.isArray(section.plugins)) {
      return section.plugins.filter((item: any) => item && typeof item.name === 'string');
    }
    return [];
  }

  private buildPluginsConfigUpdate(raw: Record<string, any> | undefined, pluginEntries: Array<{ name: string; enabled?: boolean; [key: string]: any }>): Record<string, unknown> {
    const section = raw?.plugins;
    if (Array.isArray(section)) return { plugins: pluginEntries };
    const nextSection = section && typeof section === 'object' ? { ...section } : {};
    nextSection.plugins = pluginEntries;
    return { plugins: nextSection };
  }

  private hasPluginContribution(manifest: { entry?: string; plugin?: any; platforms?: any[] }): boolean {
    const hasPlatforms = Array.isArray(manifest.platforms) && manifest.platforms.length > 0;
    return !!manifest.plugin || !!manifest.entry || !hasPlatforms;
  }

  private setPluginConfigEnabled(name: string, enabled: boolean): void {
    const configManager = this.api?.configManager;
    if (!configManager) return;
    const raw = configManager.readEditableConfig() as Record<string, any>;
    const pluginEntries: Array<{ name: string; enabled?: boolean; [k: string]: any }> = [...this.readPluginEntries(raw)];
    const existing = pluginEntries.find(p => p.name === name);
    if (existing) {
      existing.enabled = enabled;
    } else {
      pluginEntries.push({ name, enabled });
    }
    configManager.updateEditableConfig(this.buildPluginsConfigUpdate(raw, pluginEntries) as any);
  }

  private removePluginConfigEntry(name: string): void {
    const configManager = this.api?.configManager;
    if (!configManager) return;
    const raw = configManager.readEditableConfig() as Record<string, any>;
    const nextEntries = this.readPluginEntries(raw).filter((entry) => entry.name !== name);
    configManager.updateEditableConfig(this.buildPluginsConfigUpdate(raw, nextEntries) as any);
  }

  private async handleToggleExtension(name: string, desiredEnabled?: boolean): Promise<{ ok: boolean; message: string }> {
    const ext = (this.api as any)?.extensions;
    const configManager = this.api?.configManager;
    if (!ext || !configManager) {
      return { ok: false, message: '扩展管理 API 不可用' };
    }

    try {
      // 读取当前 plugins.yaml
      const raw = configManager.readEditableConfig() as Record<string, any>;
      const pluginEntries: Array<{ name: string; enabled?: boolean; [k: string]: any }> = [...this.readPluginEntries(raw)];
      const existing = pluginEntries.find(p => p.name === name);
      const packages: Array<{ manifest: { name: string; entry?: string; plugin?: any; platforms?: any[] }; source?: string; rootDir?: string }> = ext.discoverAll?.() ?? ext.discover?.() ?? [];
      const pkg = packages.find((item) => item.manifest.name === name);
      const hasPlugin = pkg ? this.hasPluginContribution(pkg.manifest) : true;
      const isWorkspace = pkg?.source === 'workspace';

      // 判断运行时状态
      const active = (this.api as any)?.pluginManager?.listPlugins?.() ?? [];
      const isActive = active.some((p: any) => p.name === name);
      const shouldEnable = desiredEnabled ?? !isActive;

      if (!shouldEnable) {
        // 禁用：停用插件 + 更新 yaml
        if (isActive) await ext.deactivate(name);
        if (isWorkspace) {
          const workspaceUpdate = this.updateWorkspaceExtensionDiscoveryConfig(name, false, packages);
          ext.setWorkspaceDiscovery?.(workspaceUpdate.workspace);
        }
        if (existing) {
          existing.enabled = false;
        } else if (hasPlugin) {
          pluginEntries.push({ name, enabled: false });
        }
        configManager.updateEditableConfig(this.buildPluginsConfigUpdate(raw, pluginEntries) as any);
        return { ok: true, message: `已禁用 "${name}"` };
      } else {
        let workspaceUpdate: { workspace: { enabled: boolean; allowlist: string[] }; mergedRaw?: Record<string, unknown> } | undefined;
        if (isWorkspace) {
          workspaceUpdate = this.updateWorkspaceExtensionDiscoveryConfig(name, true, packages);
          ext.setWorkspaceDiscovery?.(workspaceUpdate.workspace);
        }

        // 启用：插件扩展先激活，成功后再更新 yaml（防止 activate 失败导致状态不一致）。
        // 纯平台 workspace 扩展只更新发现配置；配置 platform.yaml / 重启后生效。
        let installedDeps: string[] = [];
        if (hasPlugin) {
          if (pkg?.rootDir) {
            const depsResult = await ensureExtensionRuntimeDependencies(pkg.rootDir);
            if (depsResult.installed) installedDeps = depsResult.missingDependencies;
          }
          await ext.activate(name);
        }
        if (existing) {
          existing.enabled = true;
        } else if (hasPlugin) {
          pluginEntries.push({ name, enabled: true });
        }
        if (hasPlugin) configManager.updateEditableConfig(this.buildPluginsConfigUpdate(raw, pluginEntries) as any);
        if (!hasPlugin) return { ok: true, message: `已启用可选平台扩展 "${name}"；请在 platform.yaml 中选择该平台，必要时重启 Iris。` };
        return { ok: true, message: installedDeps.length > 0 ? `已安装依赖 ${installedDeps.join(', ')} 并启用 "${name}"` : `已启用 "${name}"` };
      }
    } catch (err) {
      return { ok: false, message: `操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }


  /**
   * 安装 Git 扩展。
   *
   * @param target Git URL（含可选 #ref:subdir 片段）
   * @param scope  'global' = 装到 ~/.iris/extensions/；'agent' (默认) = 装到当前 agent
   *               这里只暴露二选一，因为 console TUI 始终在某个 agent 上下文中运行；
   *               跨 agent 的安装请用独立 iris extension 二进制。
   */
  private async handleInstallGitExtension(target: string, scope: 'global' | 'agent' = 'agent'): Promise<{ ok: boolean; message: string }> {
    const ext = (this.api as any)?.extensions;
    if (!ext?.installGit) {
      return { ok: false, message: 'Git 扩展安装 API 不可用' };
    }

    try {
      // scope='global' → 显式传 {kind:'global'}；'agent' → 不传，让 iris-core 用 defaultScope (=当前 agent)
      const installScope = scope === 'global' ? { scope: { kind: 'global' as const } } : undefined;
      const result = await ext.installGit(target, installScope);
      const packages: Array<{ manifest: { name: string; entry?: string; plugin?: any; platforms?: any[] } }> = ext.discover?.() ?? [];
      const pkg = packages.find((item) => item.manifest.name === result.name);
      const hasPlugin = pkg ? this.hasPluginContribution(pkg.manifest) : true;
      const scopeLabel = scope === 'global' ? '全局' : '此 agent';
      if (!hasPlugin) {
        return { ok: true, message: `已拉取安装到${scopeLabel} "${result.name}@${result.version}"。平台扩展通常需要重启或配置 platform.yaml 后生效。` };
      }

      const active = (this.api as any)?.pluginManager?.listPlugins?.() ?? [];
      const alreadyActive = active.some((item: any) => item.name === result.name);
      if (alreadyActive) {
        this.setPluginConfigEnabled(result.name, true);
        return { ok: true, message: `已覆盖安装到${scopeLabel} "${result.name}@${result.version}"。当前运行实例已加载同名插件，重启后使用新代码。` };
      }

      await ext.activate(result.name);
      this.setPluginConfigEnabled(result.name, true);
      return { ok: true, message: `已拉取安装到${scopeLabel}并启用 "${result.name}@${result.version}"` };
    } catch (err) {
      return { ok: false, message: `Git 拉取失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async handleDeleteExtension(name: string): Promise<{ ok: boolean; message: string }> {
    const ext = (this.api as any)?.extensions;
    if (!ext?.remove) {
      return { ok: false, message: '扩展删除 API 不可用' };
    }

    // 识别该扩展的来源（installed/agent-installed/embedded/workspace），
    // 仅前两类可在 TUI 中删除；embedded/workspace 属于发行包/源码仓库，应通过 plugins.yaml 禁用。
    const packages: Array<{ manifest: { name: string }; source?: string }> = ext.discover?.() ?? [];
    const pkg = packages.find((p) => p.manifest.name === name);
    if (!pkg) {
      return { ok: false, message: `未找到扩展 "${name}"` };
    }
    if (pkg.source === 'embedded' || pkg.source === 'workspace') {
      const label = pkg.source === 'embedded' ? '内嵌扩展' : '源码 workspace 扩展';
      return { ok: false, message: `${label}不可删除，请改用 plugins.yaml 设置 enabled: false 来禁用` };
    }

    // installed → scope: global；agent-installed → scope: 当前 agent（=默认 scope）
    const scope = pkg.source === 'installed' ? { kind: 'global' as const } : undefined;

    try {
      await ext.remove(name, scope ? { scope } : undefined);
      this.removePluginConfigEntry(name);
      return { ok: true, message: `已删除 "${name}"` };
    } catch (err) {
      return { ok: false, message: `删除失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async handlePreviewUpdateExtension(name: string): Promise<{ ok: boolean; message: string }> {
    const ext = (this.api as any)?.extensions;
    if (!ext?.previewUpdateGit) {
      return { ok: false, message: 'Git 扩展升级预览 API 不可用' };
    }

    // 升级前先识别该扩展安装位置：installed → 全局；agent-installed → 当前 agent；其它 → 不支持
    const scope = this.resolveScopeForInstalled(name);
    if (!scope) {
      return { ok: false, message: '该扩展不是通过 Git 安装到 installed/agent-installed 目录，无法升级' };
    }

    try {
      const preview = await ext.previewUpdateGit(name, { scope });
      const currentCommit = preview.currentCommit ? String(preview.currentCommit).slice(0, 8) : '未知';
      const nextCommit = preview.nextCommit ? String(preview.nextCommit).slice(0, 8) : '未知';
      const versionPart = preview.currentVersion === preview.nextVersion
        ? `版本 ${preview.currentVersion}`
        : `版本 ${preview.currentVersion} -> ${preview.nextVersion}`;
      const commitPart = preview.sameCommit
        ? `commit ${currentCommit} 未变化`
        : `commit ${currentCommit} -> ${nextCommit}`;
      return {
        ok: true,
        message: `升级预览：${versionPart}，${commitPart}`,
      };
    } catch (err) {
      return { ok: false, message: `检查更新失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }


  private async handleUpdateExtension(name: string): Promise<{ ok: boolean; message: string }> {
    const ext = (this.api as any)?.extensions;
    if (!ext?.updateGit) {
      return { ok: false, message: 'Git 扩展升级 API 不可用' };
    }

    const scope = this.resolveScopeForInstalled(name);
    if (!scope) {
      return { ok: false, message: '该扩展不是通过 Git 安装到 installed/agent-installed 目录，无法升级' };
    }

    try {
      const result = await ext.updateGit(name, { scope });
      return { ok: true, message: `已升级 "${result.name}@${result.version}" 到 ${result.gitCommit ?? '最新 commit'}。当前运行中的插件可能需要重启后完全生效。` };
    } catch (err) {
      return { ok: false, message: `升级失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 根据当前发现的扩展包列表，识别给定 name 的扩展归属于哪个 scope。
   * 仅 installed / agent-installed 可被 update/remove；返回 undefined 表示不可操作。
   */
  private resolveScopeForInstalled(name: string): { kind: 'global' } | { kind: 'agent'; agentName: string } | undefined {
    const ext = (this.api as any)?.extensions;
    const packages: Array<{ manifest: { name: string }; source?: string }> = ext?.discover?.() ?? [];
    const pkg = packages.find((p) => p.manifest.name === name);
    if (!pkg) return undefined;
    if (pkg.source === 'installed') return { kind: 'global' };
    if (pkg.source === 'agent-installed') return ext?.defaultScope ?? undefined;
    return undefined;
  }

  private async handlePlanCommand(arg: string): Promise<PlanCommandResult> {
    const service = (this.api?.services as any)?.get?.(PLAN_MODE_SERVICE_ID) as PlanModeServiceLike | undefined;
    if (!service) {
      return { ok: false, message: 'Plan Mode 服务不可用。' };
    }

    const normalized = arg.trim();
    if (normalized === 'status' || normalized === 'open') {
      const state = service.getState(this.sessionId);
      this.syncPlanModeStatus();
      const plan = service.readPlan(this.sessionId) ?? '';
      const preview = plan.trim()
        ? `\n\n当前计划预览：\n${plan.trim().split(/\r?\n/).slice(0, 20).join('\n')}${plan.trim().split(/\r?\n/).length > 20 ? '\n…' : ''}`
        : '\n\n当前计划为空。';
      return {
        ok: true,
        message: state
          ? `Plan Mode: ${state.active ? 'active' : 'inactive'}\n计划文件：${state.planFilePath}${preview}`
          : '当前会话尚未进入 Plan Mode。输入 /plan 可进入。',
      };
    }

    if (!normalized) {
      const currentState = service.getState(this.sessionId);
      if (currentState?.active) {
        const state = (service.leave?.(this.sessionId) ?? service.exit(this.sessionId)) as any;
        this.syncPlanModeStatus();
        return {
          ok: true,
          message: state
            ? `已退出 Plan Mode。计划文件：${state.planFilePath}`
            : '已退出 Plan Mode。',
        };
      }

      const state = service.enter(this.sessionId);
      this.syncPlanModeStatus();
      const plan = service.readPlan(this.sessionId) ?? '';
      return { ok: true, message: `已进入 Plan Mode（当前 Agent: ${this.agentName ?? 'default'}）。\n计划文件：${state.planFilePath}\n${plan.trim() ? '已有计划文件，模型会在下一轮读取/更新它。' : '计划文件为空，请让模型先探索并使用 write_plan 写入计划。'}` };
    }

    if (normalized === 'exit') {
      const state = (service.leave?.(this.sessionId) ?? service.exit(this.sessionId)) as any;
      this.syncPlanModeStatus();
      return {
        ok: true,
        message: state
          ? `已退出 Plan Mode。计划文件：${state.planFilePath}`
          : '当前会话尚未进入 Plan Mode。',
      };
    }

    const state = service.enter(this.sessionId);
    this.syncPlanModeStatus();
    const plan = service.readPlan(this.sessionId) ?? '';
    const message = [
      `已进入 Plan Mode（当前 Agent: ${this.agentName ?? 'default'}）。`,
      `计划文件：${state.planFilePath}`,
      plan.trim() ? '已有计划文件，模型会在下一轮读取/更新它。' : '计划文件为空，请让模型先探索并使用 write_plan 写入计划。',
      normalized ? `已附带任务描述，接下来将发送给模型：${normalized}` : undefined,
    ].filter(Boolean).join('\n');
    return { ok: true, message, followupPrompt: normalized || undefined };
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
   * 处理 /file 命令：
   * - '__open_browser__' → 打开文件浏览器
   * - 具体路径 → 直接附加文件
   */
  private handleFileAttach(filePath: string): void {
    if (filePath === '__open_browser__') {
      const realProcess = require('process') as typeof import('process');
      this.openFileBrowser(realProcess.cwd());
      return;
    }
    if (filePath === '__clear__') {
      this._pendingImages = [];
      this._pendingDocuments = [];
      this._pendingAudio = [];
      this._pendingVideo = [];
      this.appHandle?.setPendingFiles([]);
      this.appHandle?.addCommandMessage('已清空所有待发送附件');
      return;
    }
    const fs = require('fs');
    const path = require('path');

    // 解析路径（支持相对路径）
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      this.appHandle?.addCommandMessage(`文件不存在: ${resolved}`);
      return;
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      this.appHandle?.addCommandMessage(`不是一个文件: ${resolved}`);
      return;
    }

    // 文件大小限制 (20MB)
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (stat.size > MAX_FILE_SIZE) {
      this.appHandle?.addCommandMessage(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，最大支持 20MB`);
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const mimeType = this.detectMimeType(ext);
    const fileType = this.classifyFileType(mimeType);
    const data = fs.readFileSync(resolved).toString('base64');
    const fileName = path.basename(resolved);

    if (fileType === 'image') {
      this._pendingImages.push({ mimeType, data, fileName });
    } else if (fileType === 'audio') {
      this._pendingAudio.push({ mimeType, data, fileName });
    } else if (fileType === 'video') {
      this._pendingVideo.push({ mimeType, data, fileName });
    } else {
      this._pendingDocuments.push({ fileName, mimeType, data });
    }

    // 更新 UI
    this.appHandle?.setPendingFiles(this.getPendingFilesList());
    this.appHandle?.addCommandMessage(`已附加: ${fileName} (${fileType})`);
  }

  /**
   * 移除指定索引的待发送文件附件。
   * 索引对应 getPendingFilesList() 的顺序：images → documents → audio → video。
   */
  private handleRemoveFile(index: number): void {
    let offset = 0;
    if (index < offset + this._pendingImages.length) {
      this._pendingImages.splice(index - offset, 1);
    } else if (index < (offset += this._pendingImages.length, offset + this._pendingDocuments.length)) {
      this._pendingDocuments.splice(index - offset, 1);
    } else if (index < (offset += this._pendingDocuments.length, offset + this._pendingAudio.length)) {
      this._pendingAudio.splice(index - offset, 1);
    } else {
      offset += this._pendingAudio.length;
      this._pendingVideo.splice(index - offset, 1);
    }
    this.appHandle?.setPendingFiles(this.getPendingFilesList());
  }



  /** 获取当前待发送文件的 UI 展示列表 */
  private getPendingFilesList(): import('./components/InputBar').PendingFile[] {
    const files: import('./components/InputBar').PendingFile[] = [];
    for (const img of this._pendingImages) {
      files.push({ path: img.fileName || '(image)', fileType: 'image', mimeType: img.mimeType });
    }
    for (const doc of this._pendingDocuments) {
      files.push({ path: doc.fileName, fileType: 'document', mimeType: doc.mimeType });
    }
    for (const a of this._pendingAudio) {
      files.push({ path: a.fileName || '(audio)', fileType: 'audio', mimeType: a.mimeType });
    }
    for (const v of this._pendingVideo) {
      files.push({ path: v.fileName || '(video)', fileType: 'video', mimeType: v.mimeType });
    }
    return files;
  }

  /** 根据扩展名检测 MIME 类型 */
  private detectMimeType(ext: string): string {
    const mimeMap: Record<string, string> = {
      // 图片
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.tiff': 'image/tiff', '.tif': 'image/tiff',
      // 音频
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
      '.wma': 'audio/x-ms-wma', '.opus': 'audio/opus', '.webm': 'audio/webm',
      // 视频
      '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv',
      '.m4v': 'video/mp4', '.3gp': 'video/3gpp',
      // 文档
      '.pdf': 'application/pdf',
      '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
      '.json': 'application/json', '.xml': 'application/xml',
      '.html': 'text/html', '.htm': 'text/html',
      '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
      // 脚本/配置
      '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript', '.zsh': 'text/x-shellscript',
      '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript',
      '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain', '.ini': 'text/plain',
      '.cfg': 'text/plain', '.conf': 'text/plain', '.log': 'text/plain',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  /** 根据 MIME 类型分类文件 */
  /** 根据 MIME 类型分类文件 */
  private classifyFileType(mimeType: string): 'image' | 'audio' | 'video' | 'document' | 'other' {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('text/')) return 'document';
    if (mimeType === 'application/pdf' || mimeType === 'application/json' ||
        mimeType === 'application/xml' || mimeType.includes('document') ||
        mimeType.includes('spreadsheet') || mimeType.includes('presentation') ||
        mimeType === 'application/zip' || mimeType === 'application/x-tar' ||
        mimeType === 'application/gzip') return 'document';
    if (mimeType === 'application/octet-stream') return 'other';
    return 'other';
  }

  /**
   * 打开文件浏览器视图，列出指定目录的内容。
   */
  private openFileBrowser(dirPath: string): void {
    const entries = this.listDirectory(dirPath);
    this.appHandle?.openFileBrowser(dirPath, entries);
  }

  /**
   * 列出目录内容，返回排序后的条目列表（目录在前，文件在后）。
   */
  private listDirectory(dirPath: string, showHidden = false): import('./components/FileBrowserView').FileBrowserEntry[] {
    const fs = require('fs');
    const path = require('path');

    try {
      const items = fs.readdirSync(dirPath);
      const entries: import('./components/FileBrowserView').FileBrowserEntry[] = [];

      for (const name of items) {
        // 过滤隐藏文件
        if (!showHidden && name.startsWith('.')) continue;

        try {
          const fullPath = path.join(dirPath, name);
          const stat = fs.statSync(fullPath);
          const isDirectory = stat.isDirectory();

          if (isDirectory) {
            entries.push({ name, isDirectory: true });
          } else {
            const ext = path.extname(name).toLowerCase();
            const mimeType = this.detectMimeType(ext);
            const fileType = this.classifyFileType(mimeType);
            entries.push({ name, isDirectory: false, size: stat.size, fileType });
          }
        } catch {
          // 跳过无权限的文件
        }
      }

      // 排序：目录在前（字母序），文件在后（字母序）
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return entries;
    } catch (err: any) {
      this.appHandle?.addCommandMessage(`无法读取目录: ${err.message}`);
      return [];
    }
  }

  /**
   * 文件浏览器中选择文件时的处理（由键盘事件通过 AppHandle 回调触发）。
   */
  handleFileBrowserSelect(dirPath: string, entry: import('./components/FileBrowserView').FileBrowserEntry, showHidden: boolean): void {
    const path = require('path');

    if (entry.isDirectory) {
      // 进入子目录
      const newPath = path.resolve(dirPath, entry.name);
      const entries = this.listDirectory(newPath, showHidden);
      this.appHandle?.openFileBrowser(newPath, entries);
    } else {
      // 选择文件 → 附加
      const fullPath = path.join(dirPath, entry.name);
      this.handleFileAttach(fullPath);
    }
  }

  /**
   * 文件浏览器中返回上级目录。
   */
  handleFileBrowserGoUp(dirPath: string, showHidden: boolean): void {
    const path = require('path');
    const parentPath = path.dirname(dirPath);
    if (parentPath === dirPath) return; // 已在根目录
    const entries = this.listDirectory(parentPath, showHidden);
    this.appHandle?.openFileBrowser(parentPath, entries);
  }

  /**
   * 文件浏览器中切换隐藏文件显示。
   */
  handleFileBrowserToggleHidden(dirPath: string, showHidden: boolean): void {
    const entries = this.listDirectory(dirPath, !showHidden);
    this.appHandle?.openFileBrowser(dirPath, entries);
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

    // 首次发送时取出并消费待发送的文件附件
    const images = this._pendingImages.length > 0 ? [...this._pendingImages] : undefined;
    const documents = this._pendingDocuments.length > 0 ? [...this._pendingDocuments] : undefined;
    const audio = this._pendingAudio.length > 0 ? [...this._pendingAudio] : undefined;
    const video = this._pendingVideo.length > 0 ? [...this._pendingVideo] : undefined;
    this._pendingImages = [];
    this._pendingDocuments = [];
    this._pendingAudio = [];
    this._pendingVideo = [];
    this.appHandle?.setPendingFiles([]);

    let isFirstMessage = true;
    let currentText: string | undefined = text;
    while (currentText) {
      // 构建用户消息的 MessagePart[]（文本 + 文件附件）
      if (isFirstMessage && (images || documents || audio || video)) {
        const userParts: MessagePart[] = [];
        if (images) {
          for (const img of images) {
            userParts.push({ type: 'file', fileType: 'image', fileName: img.fileName || img.mimeType, mimeType: img.mimeType });
          }
        }
        if (documents) {
          for (const doc of documents) {
            userParts.push({ type: 'file', fileType: 'document', fileName: doc.fileName, mimeType: doc.mimeType });
          }
        }
        if (audio) {
          for (const a of audio) {
            userParts.push({ type: 'file', fileType: 'audio', fileName: a.fileName || a.mimeType, mimeType: a.mimeType });
          }
        }
        if (video) {
          for (const v of video) {
            userParts.push({ type: 'file', fileType: 'video', fileName: v.fileName || v.mimeType, mimeType: v.mimeType });
          }
        }
        if (currentText.trim()) userParts.push({ type: 'text', text: currentText });
        this.appHandle?.addStructuredMessage('user', userParts);
      } else {
        this.appHandle?.addMessage('user', currentText);
      }
      this.currentToolIds.clear();
      try {
        // 只有第一条消息携带文件附件，队列中的后续消息不带
        if (isFirstMessage) {
          await this.backend.chat(this.sessionId, currentText, images, documents, 'console', audio, video);
          isFirstMessage = false;
        } else {
          await this.backend.chat(this.sessionId, currentText, undefined, undefined, 'console');
        }
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
  extensions?: Pick<BootstrapExtensionRegistryLike, 'llmProviders' | 'ocrProviders'>;
  api?: IrisAPI;
  isCompiledBinary?: boolean;
  supportsHeadlessTransition?: boolean;
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
    agentName: context.agentName,
    initWarnings: context.initWarnings,
    extensions: context.extensions,
    api: context.api,
    isCompiledBinary: context.isCompiledBinary ?? false,
    consoleConfig,
    supportsHeadlessTransition: context.supportsHeadlessTransition === true,
  });
}
