/**
 * 终端 WebSocket 处理器
 *
 * 通过 node-pty 在服务器端创建伪终端，
 * 经 WebSocket 与浏览器端 xterm.js 双向通信。
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { Duplex } from 'stream';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createExtensionLogger } from '@irises/extension-sdk';

const logger = createExtensionLogger('Terminal');

let pty: typeof import('node-pty') | null = null;
try {
  pty = await import('node-pty');
} catch {
  logger.warn('node-pty 不可用，终端功能将被禁用');
}

export interface TerminalSession {
  id: string;
  pty: import('node-pty').IPty;
  ws: WebSocket;
}

export interface TerminalHandler {
  /** 处理 HTTP upgrade 请求 */
  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  /** 关闭所有终端会话 */
  killAll(): void;
  /** 终端功能是否可用 */
  available: boolean;
}

/**
 * 创建终端处理器
 * @param isCompiledBinary 是否编译后的二进制发行版
 * @param projectRoot 项目根目录
 */
export function createTerminalHandler(isCompiledBinary = false, projectRoot = process.cwd()): TerminalHandler {
  const sessions = new Map<string, TerminalSession>();
  const wss = new WebSocketServer({ noServer: true });
  let nextId = 1;

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    if (!pty) {
      ws.close(1011, 'node-pty 不可用');
      return;
    }

    const id = `term-${nextId++}`;

    // 从 URL query 读取客户端终端尺寸
    const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const initialCols = Math.max(1, parseInt(reqUrl.searchParams.get('cols') ?? '', 10) || 120);
    const initialRows = Math.max(1, parseInt(reqUrl.searchParams.get('rows') ?? '', 10) || 30);

    // 确定启动命令
    const tuiEnv = { ...process.env, IRIS_PLATFORM: 'console' } as Record<string, string>;
    let spawnCmd: string;
    let spawnArgs: string[];

    if (isCompiledBinary) {
      spawnCmd = process.execPath;
      spawnArgs = [];
    } else {
      const entryFile = path.join(projectRoot, 'src', 'index.ts');
      // 查找 bun 可执行文件绝对路径
      let bunPath: string | null = null;

      // 1. 检查 PATH（用 where/which 获取绝对路径）
      try {
        const whereCmd = os.platform() === 'win32' ? 'where bun.exe' : 'which bun';
        const resolved = execSync(whereCmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0];
        if (resolved && fs.existsSync(resolved)) {
          bunPath = resolved;
        }
      } catch {}

      // 2. 检查常见安装位置
      if (!bunPath) {
        const candidates = [
          path.join(os.homedir(), '.bun', 'bin', os.platform() === 'win32' ? 'bun.exe' : 'bun'),
        ];
        if (os.platform() === 'win32') {
          if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'bun', 'bun.exe'));
          if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'bun.cmd'));
        }
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            bunPath = c;
            break;
          }
        }
      }

      if (bunPath) {
        logger.info(`Bun 找到: ${bunPath}`);
        spawnCmd = bunPath;
        spawnArgs = ['run', entryFile];
      } else {
        // 没有 bun：在 PTY 内用 PowerShell 官方脚本安装后启动
        logger.info('未检测到 Bun 运行时，将在终端内自动安装后启动 TUI。');
        if (os.platform() === 'win32') {
          const bunTarget = path.join(os.homedir(), '.bun', 'bin', 'bun.exe');
          spawnCmd = 'powershell.exe';
          spawnArgs = ['-NoProfile', '-Command',
            `Write-Host '[Iris] 正在安装 Bun 运行时...'; ` +
            `irm bun.sh/install.ps1 | iex; ` +
            `if(Test-Path '${bunTarget}'){ Write-Host '[Iris] 安装完成，正在启动 TUI...'; & '${bunTarget}' run '${entryFile}' } ` +
            `else { Write-Host '[Iris] Bun 安装失败。请手动安装: https://bun.sh'; Read-Host '按 Enter 关闭' }`,
          ];
        } else {
          spawnCmd = process.env.SHELL || '/bin/bash';
          spawnArgs = ['-c',
            `echo '[Iris] 正在安装 Bun 运行时...' && curl -fsSL https://bun.sh/install | bash && echo '[Iris] 安装完成，正在启动 TUI...' && ~/.bun/bin/bun run "${entryFile}" || echo '[Iris] Bun 安装失败，请手动安装: https://bun.sh'`,
          ];
        }
      }
    }

    let proc: import('node-pty').IPty;
    try {
      proc = pty.spawn(spawnCmd, spawnArgs, {
        name: 'xterm-256color',
        cols: initialCols,
        rows: initialRows,
        cwd: process.cwd(),
        env: tuiEnv,
      });
    } catch (err) {
      logger.error(`PTY 创建失败: ${err}`);
      ws.close(1011, 'PTY 创建失败');
      return;
    }

    const session: TerminalSession = { id, pty: proc, ws };
    sessions.set(id, session);
    logger.info(`终端会话已创建: ${id} (cmd=${spawnCmd}, pid=${proc.pid})`);

    // PTY 输出 → WebSocket
    proc.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    proc.onExit(({ exitCode }) => {
      logger.info(`终端进程退出: ${id} (code=${exitCode})`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\x00${JSON.stringify({ type: 'exit', code: exitCode })}`);
        ws.close(1000, '终端进程已退出');
      }
      sessions.delete(id);
    });

    // WebSocket → PTY
    ws.on('message', (data: Buffer | string) => {
      const msg = typeof data === 'string' ? data : data.toString('utf8');

      if (msg.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
            proc.resize(Math.max(1, parsed.cols), Math.max(1, parsed.rows));
            return;
          }
        } catch {
          // 不是 JSON，作为普通输入
        }
      }

      proc.write(msg);
    });

    ws.on('close', () => {
      logger.info(`WebSocket 关闭，终止终端: ${id}`);
      try {
        proc.kill();
      } catch {
        // 进程可能已退出
      }
      sessions.delete(id);
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket 错误 (${id}): ${err.message}`);
    });
  });

  return {
    available: pty !== null,

    handleUpgrade(req, socket, head) {
      if (!pty) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    },

    killAll() {
      for (const [id, session] of sessions) {
        logger.info(`关闭终端会话: ${id}`);
        try { session.pty.kill(); } catch { /* ignore */ }
        try { session.ws.close(1001, '服务器关闭'); } catch { /* ignore */ }
      }
      sessions.clear();
      wss.close();
    },
  };
}
