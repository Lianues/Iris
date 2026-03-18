/**
 * Console 平台适配器 (OpenTUI React)
 *
 * 通过 Backend 事件驱动全屏 TUI 界面。
 */

import React from 'react';
import { createCliRenderer, type CliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { PlatformAdapter } from '../base';
import { Backend } from '../../core/backend';
import { SessionMeta } from '../../storage/base';
import { Content, Part, ToolInvocation, ToolStatus, UsageMetadata } from '../../types';
import { setGlobalLogLevel, LogLevel } from '../../logger/index';
import type { MCPManager } from '../../mcp';
import { App, AppHandle, MessageMeta } from './App';
import { MessagePart } from './components/MessageItem';
import { ConsoleSettingsController, ConsoleSettingsSaveResult, ConsoleSettingsSnapshot } from './settings';
import type { LLMModelInfo } from '../../llm/router';

function createToolInvocationFromFunctionCall(part: any, index: number, status: ToolStatus): ToolInvocation {
  return {
    id: `history-tool-${Date.now()}-${index}-${part.functionCall.name}`,
    toolName: part.functionCall.name,
    args: part.functionCall.args ?? {},
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function convertPartsToMessageParts(parts: Part[], toolStatus: ToolStatus = 'success'): MessagePart[] {
  const result: MessagePart[] = [];
  let toolIndex = 0;

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
      const invocation = createToolInvocationFromFunctionCall(part, toolIndex++, toolStatus);
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
  getMCPManager: () => MCPManager | undefined;
  setMCPManager: (manager?: MCPManager) => void;
}

export class ConsolePlatform extends PlatformAdapter {
  private sessionId: string;
  private modeName?: string;
  private modelId: string;
  private modelName: string;
  private contextWindow?: number;
  private backend: Backend;
  private settingsController: ConsoleSettingsController;
  private renderer?: CliRenderer;
  private appHandle?: AppHandle;

  /** 当前响应周期内的工具调用 ID 集合 */
  private currentToolIds = new Set<string>();

  /** 串行化 undo/redo 持久化操作，防止并发写入。 */
  private historyMutationQueue: Promise<unknown> = Promise.resolve();

  constructor(backend: Backend, options: ConsolePlatformOptions) {
    super();
    this.backend = backend;
    this.sessionId = generateSessionId();
    this.modeName = options.modeName;
    this.modelId = options.modelId;
    this.modelName = options.modelName;
    this.contextWindow = options.contextWindow;
    this.settingsController = new ConsoleSettingsController({
      backend,
      configDir: options.configDir,
      getMCPManager: options.getMCPManager,
      setMCPManager: options.setMCPManager,
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


  override async start(): Promise<void> {
    setGlobalLogLevel(LogLevel.SILENT);

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

    this.backend.on('done', (sid: string, durationMs: number) => {
      if (sid === this.sessionId) {
        this.appHandle?.finalizeResponse(durationMs);
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

      const element = React.createElement(App, {
        onReady: (handle: AppHandle) => {
          this.appHandle = handle;
          resolve();
        },
        onSubmit: (text: string) => this.handleInput(text),
        onUndo: async () => {
          try {
            const result = await this.enqueueHistoryMutation(async () => {
              return await this.backend.undo(this.sessionId, 'last-visible-message');
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
              return await this.backend.redo(this.sessionId);
            });
            return Boolean(result);
          } catch (err) {
            console.warn('[ConsolePlatform] onRedo 持久化失败:', err);
            return false;
          }
        },
        onClearRedoStack: () => {
          this.backend.clearRedo(this.sessionId);
        },
        onToolApproval: (toolId: string, approved: boolean) => {
          this.backend.approveTool(toolId, approved);
        },
        onToolApply: (toolId: string, applied: boolean) => {
          this.backend.applyTool(toolId, applied);
        },
        onAbort: () => {
          this.backend.abortChat(this.sessionId);
        },
        onNewSession: () => this.handleNewSession(),
        onLoadSession: (id: string) => this.handleLoadSession(id),
        onListSessions: () => this.handleListSessions(),
        onRunCommand: (cmd: string) => this.handleRunCommand(cmd),
        onListModels: () => this.handleListModels(),
        onSwitchModel: (modelName: string) => this.handleSwitchModel(modelName),
        onLoadSettings: () => this.handleLoadSettings(),
        onSaveSettings: (snapshot: ConsoleSettingsSnapshot) => this.handleSaveSettings(snapshot),
        onExit: () => this.stop(),
        modeName: this.modeName,
        modelId: this.modelId,
        modelName: this.modelName,
        contextWindow: this.contextWindow,
      });

      createRoot(this.renderer).render(element);
    });
  }

  override async stop(): Promise<void> {
    // OpenTUI 的 destroy() 会清理交替屏幕、恢复光标等
    this.renderer?.destroy();
  }

  // ============ 内部逻辑 ============

  private handleNewSession(): void {
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
  }

  private handleRunCommand(cmd: string): { output: string; cwd: string } {
    return this.backend.runCommand(cmd);
  }

  private handleListModels(): LLMModelInfo[] {
    return this.backend.listModels();
  }

  private handleSwitchModel(modelName: string): { ok: boolean; message: string; modelId?: string; modelName?: string; contextWindow?: number } {
    try {
      const info = this.backend.switchModel(modelName);
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

    const history = await this.backend.getHistory(id);
    for (const msg of history) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      const parts = convertPartsToMessageParts(msg.parts);
      const meta = getMessageMeta(msg);
      if (parts.length > 0) {
        this.appHandle?.addStructuredMessage(role as 'user' | 'assistant', parts, meta);
      }

      if (msg.usageMetadata) {
        this.appHandle?.setUsage(msg.usageMetadata);
      }
    }
  }

  private async handleListSessions(): Promise<SessionMeta[]> {
    return this.backend.listSessionMetas();
  }

  private async handleLoadSettings(): Promise<ConsoleSettingsSnapshot> {
    return this.settingsController.loadSnapshot();
  }

  private async handleSaveSettings(snapshot: ConsoleSettingsSnapshot): Promise<ConsoleSettingsSaveResult> {
    return this.settingsController.saveSnapshot(snapshot);
  }

  private async handleInput(text: string): Promise<void> {
    this.appHandle?.addMessage('user', text);
    this.appHandle?.setGenerating(true);
    this.currentToolIds.clear();

    try {
      await this.backend.chat(this.sessionId, text);
    } finally {
      this.appHandle?.commitTools();
      this.appHandle?.setGenerating(false);
    }
  }
}
