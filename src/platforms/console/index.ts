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
import { ToolInvocation, UsageMetadata } from '../../types';
import { setGlobalLogLevel, LogLevel } from '../../logger/index';
import { App, AppHandle } from './App';

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
  private backend: Backend;
  private inkInstance?: Instance;
  private appHandle?: AppHandle;

  /** 当前响应周期内的工具调用 ID 集合 */
  private currentToolIds = new Set<string>();

  constructor(backend: Backend, modeName?: string) {
    super();
    this.backend = backend;
    this.sessionId = generateSessionId();
    this.modeName = modeName;
  }

  override async start(): Promise<void> {
    setGlobalLogLevel(LogLevel.SILENT);

    // 监听 Backend 事件
    this.backend.on('response', (sid: string, text: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.addMessage('assistant', text);
      }
    });

    this.backend.on('stream:start', (sid: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.startStream();
      }
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      if (sid === this.sessionId) {
        this.appHandle?.pushStreamChunk(chunk);
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
      const text = msg.parts
        ?.filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join('') || '';
      if (text) {
        this.appHandle?.addMessage(role as 'user' | 'assistant', text);
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
    const startTime = Date.now();

    try {
      await this.backend.chat(this.sessionId, text);
    } finally {
      this.appHandle?.commitTools();
      this.appHandle?.finalizeResponse(Date.now() - startTime);
      this.appHandle?.setGenerating(false);
    }
  }
}
