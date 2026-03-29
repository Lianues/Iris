/**
 * Screen 执行环境（Sidecar 模式）
 *
 * 系统级截屏和输入模拟运行在独立的子进程（screen-sidecar.ts）中，
 * 主进程通过 stdin/stdout NDJSON 与其通信。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createPluginLogger } from '@irises/extension-sdk';
import type { Computer, EnvState, WindowInfo, ScreenEnvConfig, WindowSelector } from './types';

const logger = createPluginLogger('computer-use', 'ScreenEnv');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 扩展根目录（由插件入口设置） */
let _extensionDir: string | undefined;

/** 设置扩展根目录，供 sidecar 路径解析使用 */
export function setExtensionDir(dir: string | undefined): void {
  _extensionDir = dir;
}

export class ScreenEnvironment implements Computer {
  private _config: ScreenEnvConfig;
  private _screenSize: [number, number] = [1920, 1080];
  screenDescription: string = '桌面全屏';
  readonly initWarnings: string[] = [];
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

    const { cmd, args } = resolveSidecarCommand('screen', 'screen-sidecar.ts');

    this._child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
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

    let stderrBuf = '';
    this._child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    this._child.on('exit', (code) => {
      for (const [, { reject }] of this._pending) {
        reject(new Error(`screen sidecar 进程退出 (code=${code})${stderrBuf ? '\n' + stderrBuf : ''}`));
      }
      this._pending.clear();
    });

    try {
      const result = await this._call('initialize', {
        searchEngineUrl: this._config.searchEngineUrl,
        targetWindow: this._config.targetWindow,
        backgroundMode: this._config.backgroundMode,
      });

      if (result.screenSize) {
        this._screenSize = result.screenSize;
      }
      if (Array.isArray(result.warnings)) {
        this.initWarnings.push(...result.warnings);
      }
      this._updateScreenDescription(result.windowInfo);
    } catch (err) {
      await this.dispose();
      throw err;
    }
  }

  async dispose(): Promise<void> {
    try {
      await this._call('dispose', undefined, 3000);
    } catch { /* 超时或 sidecar 已退出 */ }

    const child = this._child;
    if (!child) return;
    this._child = null;
    this._rl?.close();
    this._rl = null;

    child.stdin?.end();

    if (child.exitCode !== null) return;

    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { forceKillTree(child); resolve(); }, 3000);
      child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  // ============ Computer 接口 ============

  async currentState(): Promise<EnvState> { return this._callEnv('currentState'); }
  async openWebBrowser(): Promise<EnvState> { return this._callEnv('openWebBrowser'); }
  async goBack(): Promise<EnvState> { return this._callEnv('goBack'); }
  async goForward(): Promise<EnvState> { return this._callEnv('goForward'); }
  async search(): Promise<EnvState> { return this._callEnv('search', { searchEngineUrl: this._config.searchEngineUrl }); }
  async navigate(url: string): Promise<EnvState> { return this._callEnv('navigate', { url }); }
  async clickAt(x: number, y: number): Promise<EnvState> { return this._callEnv('clickAt', { x, y }); }
  async hoverAt(x: number, y: number): Promise<EnvState> { return this._callEnv('hoverAt', { x, y }); }
  async dragAndDrop(x: number, y: number, destX: number, destY: number): Promise<EnvState> { return this._callEnv('dragAndDrop', { x, y, destX, destY }); }
  async typeTextAt(x: number, y: number, text: string, pressEnter: boolean, clearBeforeTyping: boolean): Promise<EnvState> { return this._callEnv('typeTextAt', { x, y, text, pressEnter, clearBeforeTyping }); }
  async keyCombination(keys: string[]): Promise<EnvState> { return this._callEnv('keyCombination', { keys }); }
  async scrollDocument(direction: 'up' | 'down' | 'left' | 'right'): Promise<EnvState> { return this._callEnv('scrollDocument', { direction }); }
  async scrollAt(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', magnitude: number): Promise<EnvState> { return this._callEnv('scrollAt', { x, y, direction, magnitude }); }
  async wait5Seconds(): Promise<EnvState> { return this._callEnv('wait5Seconds'); }

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
    this._updateScreenDescription(result.windowInfo);
  }

  private _updateScreenDescription(windowInfo: any): void {
    if (windowInfo && windowInfo.hwnd) {
      const [w, h] = this._screenSize;
      const bg = this._config.backgroundMode ? '后台模式' : '前台模式';
      this.screenDescription = `窗口${bg}: ${windowInfo.title} [HWND=${windowInfo.hwnd}, 类名=${windowInfo.className}] (${w}×${h})`;
    } else {
      const [w, h] = this._screenSize;
      this.screenDescription = `桌面全屏 (${w}×${h})`;
    }
  }

  // ============ 内部 IPC ============

  private async _callEnv(method: string, params?: Record<string, unknown>): Promise<EnvState> {
    const result = await this._call(method, params);
    if (result.screenSize) {
      this._screenSize = result.screenSize;
    }
    return {
      screenshot: Buffer.from(result.screenshot as string, 'base64'),
      url: result.url as string,
    };
  }

  private _call(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<any> {
    if (!this._child?.stdin) {
      return Promise.reject(new Error('screen sidecar 未启动'));
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`screen sidecar RPC '${method}' 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      this._pending.set(id, {
        resolve: (val: any) => { clearTimeout(timer); resolve(val); },
        reject: (err: Error) => { clearTimeout(timer); reject(err); },
      });
      this._child!.stdin!.write(JSON.stringify({ id, method, params: params ?? {} }) + '\n');
    });
  }
}

// ============ Sidecar 启动策略 ============

function resolveSidecarCommand(type: string, sidecarFile: string): { cmd: string; args: string[] } {
  const sidecarTs = path.resolve(__dirname, sidecarFile);
  if (fs.existsSync(sidecarTs)) {
    if ((globalThis as any).Bun) {
      return { cmd: 'bun', args: [sidecarTs] };
    }
    return { cmd: 'node', args: ['--import', 'tsx', sidecarTs] };
  }
  if (_extensionDir) {
    const distMjs = path.resolve(_extensionDir, 'dist', sidecarFile.replace('.ts', '.mjs'));
    if (fs.existsSync(distMjs)) {
      return { cmd: 'node', args: [distMjs] };
    }
  }
  return { cmd: process.execPath, args: ['--sidecar', type] };
}

function forceKillTree(child: ChildProcess): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      const tk = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
      tk.on('error', () => {});
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* 进程可能已退出 */ }
}
