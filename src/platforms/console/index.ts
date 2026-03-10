/**
 * Console 平台适配器 (Ink 5+ / React 18)
 *
 * 通过 Backend 事件驱动 TUI 界面。
 */

import React from 'react';
import { render, Instance } from 'ink';
import { PlatformAdapter } from '../base';
import { Backend } from '../../core/backend';
import { SessionMeta } from '../../storage/base';
import { Content, Part, ToolInvocation, ToolStatus, UsageMetadata } from '../../types';
import { setGlobalLogLevel, LogLevel } from '../../logger/index';
import { App, AppHandle, MessageMeta } from './App';
import { MessagePart } from './components/MessageItem';

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
        result.push({ type: 'thought', text: part.text });
      } else {
        result.push({ type: 'text', text: part.text });
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

export class ConsolePlatform extends PlatformAdapter {
  private sessionId: string;
  private modeName?: string;
  private contextWindow?: number;
  private backend: Backend;
  private inkInstance?: Instance;
  private appHandle?: AppHandle;

  /** 当前响应周期内的工具调用 ID 集合 */
  private currentToolIds = new Set<string>();

  constructor(backend: Backend, modeName?: string, contextWindow?: number) {
    super();
    this.backend = backend;
    this.sessionId = generateSessionId();
    this.modeName = modeName;
    this.contextWindow = contextWindow;
  }

  override async start(): Promise<void> {
    setGlobalLogLevel(LogLevel.SILENT);

    // 监听 Backend 事件
    this.backend.on('assistant:content', (sid: string, content: Content) => {
      if (sid === this.sessionId) {
        const parts = convertPartsToMessageParts(content.parts, 'queued');
        this.appHandle?.finalizeAssistantParts(parts);
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
        this.appHandle?.addMessage('assistant', `!! CRITICAL_ERROR: ${error}`);
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

    // 渲染 TUI
    return new Promise<void>((resolve) => {
      const element = React.createElement(App, {
        onReady: (handle: AppHandle) => {
          this.appHandle = handle;
          resolve();
        },
        onSubmit: (text: string) => this.handleInput(text),
        onNewSession: () => this.handleNewSession(),
        onLoadSession: (id: string) => this.handleLoadSession(id),
        onListSessions: () => this.handleListSessions(),
        onRunCommand: (cmd: string) => this.handleRunCommand(cmd),
        onExit: () => this.stop(),
        modeName: this.modeName,
        contextWindow: this.contextWindow,
      });
      try {
        this.inkInstance = render(element);
      } catch (err: unknown) {
        if (err instanceof Error && err.message?.includes('Raw mode is not supported')) {
          console.error('[ConsolePlatform] Fatal: 当前终端不支持 Raw mode。');
          process.exit(1);
        } else {
          throw err;
        }
      }
    });
  }

  override async stop(): Promise<void> {
    this.inkInstance?.unmount();
    process.exit(0);
  }

  // ============ 内部逻辑 ============

  private handleNewSession(): void {
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
  }

  private handleRunCommand(cmd: string): { output: string; cwd: string } {
    return this.backend.runCommand(cmd);
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
