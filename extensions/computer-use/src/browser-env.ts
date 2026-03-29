/**
 * 浏览器执行环境（Sidecar 模式）
 *
 * Playwright 运行在独立的子进程（browser-sidecar.ts）中，
 * 主进程通过 stdin/stdout NDJSON 与其通信。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createPluginLogger } from '@irises/extension-sdk';
import type { Computer, EnvState, BrowserEnvConfig } from './types';

const logger = createPluginLogger('computer-use', 'BrowserEnv');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 扩展根目录（由插件入口设置） */
let _extensionDir: string | undefined;

/** 设置扩展根目录，供 sidecar 路径解析使用 */
export function setExtensionDir(dir: string | undefined): void {
  _extensionDir = dir;
}

export class BrowserEnvironment implements Computer {
  private _config: BrowserEnvConfig;
  private _screenSize: [number, number];
  screenDescription: string;
  private _child: ChildProcess | null = null;
  private _rl: readline.Interface | null = null;
  private _nextId = 1;
  private _pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  constructor(config: BrowserEnvConfig) {
    this._config = config;
    this._screenSize = [config.screenWidth, config.screenHeight];
    this.screenDescription = `浏览器 (${config.screenWidth}×${config.screenHeight})`;
  }

  screenSize(): [number, number] {
    return this._screenSize;
  }

  async initialize(): Promise<void> {
    logger.info('正在启动 browser sidecar 子进程...');

    const { cmd, args } = resolveSidecarCommand('browser', 'browser-sidecar.ts');

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
        reject(new Error(`browser sidecar 进程退出 (code=${code})${stderrBuf ? '\n' + stderrBuf : ''}`));
      }
      this._pending.clear();
    });

    try {
      const result = await this._call('initialize', {
        screenWidth: this._config.screenWidth,
        screenHeight: this._config.screenHeight,
        headless: this._config.headless,
        initialUrl: this._config.initialUrl,
        searchEngineUrl: this._config.searchEngineUrl,
        highlightMouse: this._config.highlightMouse,
      });

      if (result.screenSize) {
        this._screenSize = result.screenSize;
      }
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

  // ============ 内部 IPC ============

  private async _callEnv(method: string, params?: Record<string, unknown>): Promise<EnvState> {
    const result = await this._call(method, params);
    return {
      screenshot: Buffer.from(result.screenshot as string, 'base64'),
      url: result.url as string,
    };
  }

  private _call(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<any> {
    if (!this._child?.stdin) {
      return Promise.reject(new Error('browser sidecar 未启动'));
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`browser sidecar RPC '${method}' 超时 (${timeoutMs}ms)`));
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

/**
 * 根据运行环境确定 sidecar 启动命令。
 *
 * 1. 开发模式（.ts 源文件存在）：bun 或 node --import tsx
 * 2. 已安装模式（dist/.mjs 存在）：node 运行构建产物
 * 3. 兆底：尝试宿主二进制 --sidecar 机制
 */
function resolveSidecarCommand(type: string, sidecarFile: string): { cmd: string; args: string[] } {
  // 1. 开发模式
  const sidecarTs = path.resolve(__dirname, sidecarFile);
  if (fs.existsSync(sidecarTs)) {
    if ((globalThis as any).Bun) {
      return { cmd: 'bun', args: [sidecarTs] };
    }
    return { cmd: 'node', args: ['--import', 'tsx', sidecarTs] };
  }

  // 2. 已安装模式
  if (_extensionDir) {
    const distMjs = path.resolve(_extensionDir, 'dist', sidecarFile.replace('.ts', '.mjs'));
    if (fs.existsSync(distMjs)) {
      return { cmd: 'node', args: [distMjs] };
    }
  }

  // 3. 兆底：宿主二进制
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
