/**
 * Console 平台适配器 (Ink 5+ / React 18)
 *
 * 通过现代化的 TUI 渲染终端界面。
 */

import React from 'react';
import { render, Instance } from 'ink';
import { PlatformAdapter } from '../base';
import { ToolStateManager } from '../../tools/state';
import { setGlobalLogLevel, LogLevel } from '../../logger/index';
import { App, AppHandle } from './App';

export class ConsolePlatform extends PlatformAdapter {
  private sessionId: string;
  private inkInstance?: Instance;
  private appHandle?: AppHandle;
  private toolStateManager?: ToolStateManager;

  /** 当前响应周期内的工具调用 ID 集合 */
  private currentToolIds = new Set<string>();

  constructor(sessionId: string = 'console-default') {
    super();
    this.sessionId = sessionId;
  }

  // ============ 平台接口 ============

  /** 接收工具状态管理器，监听事件以同步 UI */
  override setToolStateManager(manager: ToolStateManager): void {
    this.toolStateManager = manager;

    manager.on('created', (invocation) => {
      this.currentToolIds.add(invocation.id);
      this.syncToolDisplay();
    });

    manager.on('stateChange', () => {
      this.syncToolDisplay();
    });
  }

  override async start(): Promise<void> {
    // 屏蔽全局日志输出，避免干扰 TUI 渲染
    setGlobalLogLevel(LogLevel.SILENT);

    // 渲染根组件
    return new Promise<void>((resolve) => {
      const element = React.createElement(App, {
        onReady: (handle: AppHandle) => {
          this.appHandle = handle;
          resolve();
        },
        onSubmit: (text: string) => this.handleInput(text),
        onExit: () => this.stop(),
      });
      // 捕获不可用的 TTY
      try {
        this.inkInstance = render(element);
      } catch (err: unknown) {
        if (err instanceof Error && err.message?.includes('Raw mode is not supported')) {
          console.error('[ConsolePlatform] Fatal: 当前终端不支持 Raw mode。请尝试在原生命令行 (如 CMD, PowerShell, iTerm) 而非内嵌面板中运行。');
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

  /** 非流式发送消息 */
  override async sendMessage(_sessionId: string, text: string): Promise<void> {
    this.appHandle?.addMessage('assistant', text);
  }

  /** 流式发送消息 */
  override async sendMessageStream(_sessionId: string, stream: AsyncIterable<string>): Promise<void> {
    this.appHandle?.startStream();
    for await (const chunk of stream) {
      this.appHandle?.pushStreamChunk(chunk);
    }
    this.appHandle?.endStream();
  }

  // ============ 内部逻辑 ============

  private async handleInput(text: string): Promise<void> {
    if (!this.messageHandler) return;

    // 状态更新：显示用户消息，进入生成状态
    this.appHandle?.addMessage('user', text);
    this.appHandle?.setGenerating(true);

    // 清空上一轮工具 ID（工具已在上轮结束时快照）
    this.currentToolIds.clear();

    try {
      await this.messageHandler({
        sessionId: this.sessionId,
        parts: [{ text }],
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.appHandle?.addMessage('assistant', `!! CRITICAL_ERROR: ${errorMsg}`);
    } finally {
      // 当前轮结束，将工具快照到最后一条 assistant 消息
      this.appHandle?.commitTools();
      this.appHandle?.setGenerating(false);
    }
  }

  private syncToolDisplay(): void {
    if (!this.toolStateManager || !this.appHandle) return;
 const invocations = this.toolStateManager
      .getAll()
      .filter(inv => this.currentToolIds.has(inv.id));
    this.appHandle.setToolInvocations(invocations);
  }
}
