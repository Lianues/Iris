/**
 * Computer Use Screen Sidecar 进程
 *
 * 在独立 Node.js 进程中运行系统级截屏和输入模拟，
 * 通过 stdin/stdout NDJSON 与主进程通信。
 */

import * as readline from 'readline';
import { getScreenAdapter, type ScreenAdapter } from './screen/index';
import type { WindowSelector } from './types';

// ============ 状态 ============

let adapter: ScreenAdapter | null = null;
let screenSize: [number, number] = [1920, 1080];

// ============ 工具函数 ============

function log(msg: string): void {
  process.stderr.write(`[ComputerUse:screen-sidecar] ${msg}\n`);
}

function send(msg: { id: number; result?: unknown; error?: string }): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureState(): Promise<{ screenshot: string; url: string; screenSize: [number, number] }> {
  if (!adapter) throw new Error('adapter 未初始化');
  await sleep(500);
  screenSize = await adapter.getScreenSize();
  const buffer = await adapter.captureScreen();
  return { screenshot: buffer.toString('base64'), url: 'screen://', screenSize };
}

// ============ 请求处理 ============

async function handleRequest(req: { id: number; method: string; params?: Record<string, unknown> }): Promise<void> {
  try {
    const p = req.params ?? {};
    let result: unknown;

    switch (req.method) {

      case 'initialize': {
        log('正在检测平台适配器...');
        const warnings: string[] = [];
        adapter = getScreenAdapter() ?? null;
        if (!adapter) {
          throw new Error(`当前操作系统 (${process.platform}) 不支持 screen 环境`);
        }
        log(`使用平台适配器: ${adapter.platform}`);
        await adapter.initialize();

        screenSize = await adapter.getScreenSize();

        const targetWindow = p.targetWindow as string | WindowSelector | undefined;
        if (targetWindow && adapter.bindWindow) {
          const bgMode = p.backgroundMode as boolean | undefined;
          if (bgMode && adapter.setBackgroundMode) {
            adapter.setBackgroundMode(true);
            log('后台操作模式已启用（PostMessage + PrintWindow）');
          }

          const label = typeof targetWindow === 'string' ? targetWindow : JSON.stringify(targetWindow);
          log(`正在绑定目标窗口: ${label} ...`);
          try {
            await adapter.bindWindow(targetWindow);
            screenSize = await adapter.getScreenSize();
            const wi = adapter.boundWindowInfo;
            log(`窗口模式已启用: ${wi?.title ?? '?'} [${wi?.hwnd}]，尺寸: ${screenSize[0]}×${screenSize[1]}`);
          } catch (e: any) {
            const msg = `窗口绑定失败: ${e?.message ?? e}，已回退到全屏模式。可用 /window 手动绑定。`;
            log(msg);
            warnings.push(msg);
          }
        }
        log(`屏幕尺寸: ${screenSize[0]}×${screenSize[1]}`);
        log('Screen 环境就绪');
        result = { ok: true, screenSize, warnings, windowInfo: adapter.boundWindowInfo ?? null };
        break;
      }

      case 'dispose': { adapter = null; result = { ok: true }; break; }

      case 'listWindows': {
        if (!adapter) throw new Error('adapter 未初始化');
        if (!adapter.listWindows) throw new Error('当前适配器不支持窗口列表');
        const windows = await adapter.listWindows();
        result = { windows };
        break;
      }

      case 'switchWindow': {
        if (!adapter) throw new Error('adapter 未初始化');
        if (!adapter.bindWindowByHwnd) throw new Error('当前适配器不支持按 HWND 绑定');
        const hwnd = p.hwnd as string;
        if (!hwnd) throw new Error('未指定窗口 HWND');
        await adapter.bindWindowByHwnd(hwnd);
        screenSize = await adapter.getScreenSize();
        const wi = adapter.boundWindowInfo;
        log(`已切换到窗口: ${wi?.title ?? '?'} [${hwnd}]，尺寸: ${screenSize[0]}×${screenSize[1]}`);
        result = { ok: true, screenSize, windowInfo: wi ?? null };
        break;
      }

      case 'screenSize': {
        if (adapter) screenSize = await adapter.getScreenSize();
        result = { screenSize };
        break;
      }

      case 'currentState':
      case 'openWebBrowser': { result = await captureState(); break; }

      case 'navigate': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.openUrl(p.url as string);
        await sleep(1500);
        result = await captureState();
        break;
      }

      case 'search': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.openUrl((p.searchEngineUrl as string) || 'https://www.google.com');
        await sleep(1500);
        result = await captureState();
        break;
      }

      case 'goBack': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.keyCombination(['Alt', 'Left']);
        await sleep(500);
        result = await captureState();
        break;
      }

      case 'goForward': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.keyCombination(['Alt', 'Right']);
        await sleep(500);
        result = await captureState();
        break;
      }

      case 'clickAt': { if (!adapter) throw new Error('adapter 未初始化'); await adapter.click(p.x as number, p.y as number); result = await captureState(); break; }
      case 'hoverAt': { if (!adapter) throw new Error('adapter 未初始化'); await adapter.moveMouse(p.x as number, p.y as number); result = await captureState(); break; }
      case 'dragAndDrop': { if (!adapter) throw new Error('adapter 未初始化'); await adapter.drag(p.x as number, p.y as number, p.destX as number, p.destY as number); result = await captureState(); break; }

      case 'typeTextAt': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.click(p.x as number, p.y as number);
        await sleep(200);
        if (p.clearBeforeTyping === true) {
          await adapter.keyCombination(['Control', 'A']);
          await sleep(50);
          await adapter.keyPress('Delete');
          await sleep(50);
        }
        await adapter.typeText(p.text as string);
        await sleep(200);
        if (p.pressEnter === true) {
          await adapter.keyPress('Enter');
        }
        result = await captureState();
        break;
      }

      case 'keyCombination': { if (!adapter) throw new Error('adapter 未初始化'); await adapter.keyCombination(p.keys as string[]); result = await captureState(); break; }

      case 'scrollDocument': {
        if (!adapter) throw new Error('adapter 未初始化');
        const dir = p.direction as string;
        const notches = 5;
        switch (dir) {
          case 'up':    await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, 0, -notches); break;
          case 'down':  await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, 0, notches); break;
          case 'left':  await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, -notches, 0); break;
          case 'right': await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, notches, 0); break;
        }
        result = await captureState();
        break;
      }

      case 'scrollAt': {
        if (!adapter) throw new Error('adapter 未初始化');
        let dx = 0, dy = 0;
        const notches = (p.magnitude as number) || 3;
        switch (p.direction as string) {
          case 'up':    dy = -notches; break;
          case 'down':  dy = notches;  break;
          case 'left':  dx = -notches; break;
          case 'right': dx = notches;  break;
        }
        await adapter.scroll(p.x as number, p.y as number, dx, dy);
        result = await captureState();
        break;
      }

      case 'wait5Seconds': { await sleep(5000); result = await captureState(); break; }

      default: { send({ id: req.id, error: `未知方法: ${req.method}` }); return; }
    }

    send({ id: req.id, result });
  } catch (err) {
    send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
}

// ============ 主循环 ============

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  let req: any;
  try { req = JSON.parse(line); } catch { return; }
  handleRequest(req).catch((err) => {
    send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  });
});

process.stdin.on('end', () => {
  process.exit(0);
});

log('sidecar 进程已启动，等待指令...');
