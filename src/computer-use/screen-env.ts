/**
 * Screen 执行环境（Sidecar 模式）
 *
 * 系统级截屏和输入模拟运行在独立的 Node.js 子进程（screen-sidecar.ts）中，
 * 主进程通过 stdin/stdout NDJSON 与其通信。
 * 与 browser-env.ts 采用相同的 IPC 模式。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../logger';
import type { Computer, EnvState, WindowInfo } from './types';
import type { WindowSelector } from '../config/types';

const logger = createLogger('ComputerUse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ScreenEnvConfig {
  /** 搜索引擎 URL */
  searchEngineUrl?: string;
  /** 目标窗口选择器（字符串或对象形式），不设置则为全屏模式 */
  targetWindow?: string | WindowSelector;
  /** 是否启用后台操作模式（仅窗口模式下有效），默认 false */
  backgroundMode?: boolean;
}

export class ScreenEnvironment implements Computer {
  private _config: ScreenEnvConfig;
  private _screenSize: [number, number] = [1920, 1080];
  private _child: ChildProcess | null = null;
  private _rl: readline.Interface | null = null;
  private _nextId = 1;
  private _pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  constructor(config: ScreenEnvConfig) {
    this._config = config;
  }

  screenSize(): [number, number] {
    return this._screenSize;
  }

  async initialize(): Promise<void> {
    logger.info('正在启动 screen sidecar 子进程...');

    const sidecarPath = path.resolve(__dirname, 'screen-sidecar.ts');

    this._child = spawn('node', ['--import', 'tsx', sidecarPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    this._rl = readline.createInterface({ input: this._child.stdout! });
    this._rl.on('line', (line) => {
      let msg: any;
      try { msg = JSON.parse(line); } catch { return; }
      const pending = this._pending.get(msg.id);
      if (!pending) return;
      this._pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
    });

    this._child.on('exit', (code) => {
      for (const [, { reject }] of this._pending) {
        reject(new Error(`screen sidecar 进程退出 (code=${code})`));
      }
      this._pending.clear();
    });

    const result = await this._call('initialize', {
      searchEngineUrl: this._config.searchEngineUrl,
      targetWindow: this._config.targetWindow,
      backgroundMode: this._config.backgroundMode,
    });

    if (result.screenSize) {
      this._screenSize = result.screenSize;
    }
  }

  async dispose(): Promise<void> {
    try {
      await this._call('dispose');
    } catch { /* sidecar 可能已退出 */ }
    if (this._child) {
      this._child.stdin?.end();
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this._child?.kill(); resolve(); }, 5000);
        this._child!.on('exit', () => { clearTimeout(timer); resolve(); });
      });
      this._child = null;
    }
  }

  // ============ Computer 接口 ============

  async currentState(): Promise<EnvState> {
    return this._callEnv('currentState');
  }

  async openWebBrowser(): Promise<EnvState> {
    return this._callEnv('openWebBrowser');
  }

  async goBack(): Promise<EnvState> {
    return this._callEnv('goBack');
  }

  async goForward(): Promise<EnvState> {
    return this._callEnv('goForward');
  }

  async search(): Promise<EnvState> {
    return this._callEnv('search', { searchEngineUrl: this._config.searchEngineUrl });
  }

  async navigate(url: string): Promise<EnvState> {
    return this._callEnv('navigate', { url });
  }

  async clickAt(x: number, y: number): Promise<EnvState> {
    return this._callEnv('clickAt', { x, y });
  }

  async hoverAt(x: number, y: number): Promise<EnvState> {
    return this._callEnv('hoverAt', { x, y });
  }

  async dragAndDrop(x: number, y: number, destX: number, destY: number): Promise<EnvState> {
    return this._callEnv('dragAndDrop', { x, y, destX, destY });
  }

  async typeTextAt(x: number, y: number, text: string, pressEnter: boolean, clearBeforeTyping: boolean): Promise<EnvState> {
    return this._callEnv('typeTextAt', { x, y, text, pressEnter, clearBeforeTyping });
  }

  async keyCombination(keys: string[]): Promise<EnvState> {
    return this._callEnv('keyCombination', { keys });
  }

  async scrollDocument(direction: 'up' | 'down' | 'left' | 'right'): Promise<EnvState> {
    return this._callEnv('scrollDocument', { direction });
  }

  async scrollAt(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', magnitude: number): Promise<EnvState> {
    return this._callEnv('scrollAt', { x, y, direction, magnitude });
  }

  async wait5Seconds(): Promise<EnvState> {
    return this._callEnv('wait5Seconds');
  }

  // ============ 窗口管理 ============

  async listWindows(): Promise<WindowInfo[]> {
    const result = await this._call('listWindows');
    return (result.windows as WindowInfo[]) ?? [];
  }

  async switchWindow(hwnd: string): Promise<void> {
    const result = await this._call('switchWindow', { hwnd });
    if (result.screenSize) {
      this._screenSize = result.screenSize;
    }
  }

  // ============ 内部 IPC ============

  private async _callEnv(method: string, params?: Record<string, unknown>): Promise<EnvState> {
    const result = await this._call(method, params);
    // sidecar 每次操作后返回当前屏幕/窗口尺寸，同步更新以适应窗口大小变化
    if (result.screenSize) {
      this._screenSize = result.screenSize;
    }
    return {
      screenshot: Buffer.from(result.screenshot as string, 'base64'),
      url: result.url as string,
    };
  }

  private _call(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this._child?.stdin) {
      return Promise.reject(new Error('screen sidecar 未启动'));
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ id, method, params: params ?? {} }) + '\n';
      this._child!.stdin!.write(msg);
    });
  }
}
