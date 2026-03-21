/**
 * Computer Use Screen Sidecar 进程
 *
 * 在独立 Node.js 进程中运行系统级截屏和输入模拟，
 * 通过 stdin/stdout NDJSON 与主进程通信。
 *
 * 启动方式：node --import tsx src/computer-use/screen-sidecar.ts
 */

import * as readline from 'readline';
import { getScreenAdapter, type ScreenAdapter } from './screen/index';
import type { WindowSelector } from '../config/types';

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
  await sleep(500);  // 等待 UI 更新
  // 窗口模式下每次重新获取尺寸，适应窗口大小变化
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

      // ---- 生命周期 ----

      case 'initialize': {
        log('正在检测平台适配器...');
        adapter = getScreenAdapter() ?? null;
        if (!adapter) {
          throw new Error(`当前操作系统 (${process.platform}) 不支持 screen 环境`);
        }
        log(`使用平台适配器: ${adapter.platform}`);
        await adapter.initialize();

        screenSize = await adapter.getScreenSize();

        // 窗口模式
        const targetWindow = p.targetWindow as string | WindowSelector | undefined;
        if (targetWindow && adapter.bindWindow) {
          // 先设置后台模式，再绑定窗口，这样 bindWindow 不会激活窗口
          const bgMode = p.backgroundMode as boolean | undefined;
          if (bgMode && adapter.setBackgroundMode) {
            adapter.setBackgroundMode(true);
            log('后台操作模式已启用（PostMessage + PrintWindow）');
          }

          const label = typeof targetWindow === 'string' ? targetWindow : JSON.stringify(targetWindow);
          log(`正在绑定目标窗口: ${label} ...`);
          await adapter.bindWindow(targetWindow);
          screenSize = await adapter.getScreenSize();
          log(`窗口模式已启用，窗口尺寸: ${screenSize[0]}×${screenSize[1]}`);
        }
        log(`屏幕尺寸: ${screenSize[0]}×${screenSize[1]}`);

        log('Screen 环境就绪');
        result = { ok: true, screenSize };
        break;
      }

      case 'dispose': {
        adapter = null;
        result = { ok: true };
        break;
      }

      // ---- 窗口管理 ----

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
        log(`已切换到窗口: HWND=${hwnd}，窗口尺寸: ${screenSize[0]}×${screenSize[1]}`);
        result = { ok: true, screenSize };
        break;
      }

      case 'screenSize': {
        if (adapter) screenSize = await adapter.getScreenSize();
        result = { screenSize };
        break;
      }

      // ---- 状态 ----

      case 'currentState':
      case 'openWebBrowser': {
        result = await captureState();
        break;
      }

      // ---- 浏览器导航（screen 模式下通过系统浏览器） ----

      case 'navigate': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.openUrl(p.url as string);
        await sleep(1500);
        result = await captureState();
        break;
      }

      case 'search': {
        if (!adapter) throw new Error('adapter 未初始化');
        const searchUrl = (p.searchEngineUrl as string) || 'https://www.google.com';
        await adapter.openUrl(searchUrl);
        await sleep(1500);
        result = await captureState();
        break;
      }

      case 'goBack': {
        // 系统级: Alt+Left
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

      // ---- 鼠标 ----

      case 'clickAt': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.click(p.x as number, p.y as number);
        result = await captureState();
        break;
      }

      case 'hoverAt': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.moveMouse(p.x as number, p.y as number);
        result = await captureState();
        break;
      }

      case 'dragAndDrop': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.drag(
          p.x as number, p.y as number,
          p.destX as number, p.destY as number,
        );
        result = await captureState();
        break;
      }

      // ---- 键盘 ----

      case 'typeTextAt': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.click(p.x as number, p.y as number);
        await sleep(200);
        if (p.clearBeforeTyping !== false) {
          await adapter.keyCombination(['Control', 'A']);
          await sleep(50);
          await adapter.keyPress('Delete');
          await sleep(50);
        }
        await adapter.typeText(p.text as string);
        await sleep(200);
        if (p.pressEnter !== false) {
          await adapter.keyPress('Enter');
        }
        result = await captureState();
        break;
      }

      case 'keyCombination': {
        if (!adapter) throw new Error('adapter 未初始化');
        await adapter.keyCombination(p.keys as string[]);
        result = await captureState();
        break;
      }

      // ---- 滚动 ----

      case 'scrollDocument': {
        if (!adapter) throw new Error('adapter 未初始化');
        const dir = p.direction as string;
        const amount = Math.round(screenSize[1] / 2);
        switch (dir) {
          case 'up':    await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, 0, -amount); break;
          case 'down':  await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, 0, amount); break;
          case 'left':  await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, -amount, 0); break;
          case 'right': await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, amount, 0); break;
        }
        result = await captureState();
        break;
      }

      case 'scrollAt': {
        if (!adapter) throw new Error('adapter 未初始化');
        let dx = 0, dy = 0;
        const mag = (p.magnitude as number) || 300;
        switch (p.direction as string) {
          case 'up':    dy = -mag; break;
          case 'down':  dy = mag;  break;
          case 'left':  dx = -mag; break;
          case 'right': dx = mag;  break;
        }
        await adapter.scroll(p.x as number, p.y as number, dx, dy);
        result = await captureState();
        break;
      }

      // ---- 等待 ----

      case 'wait5Seconds': {
        await sleep(5000);
        result = await captureState();
        break;
      }

      default: {
        send({ id: req.id, error: `未知方法: ${req.method}` });
        return;
      }
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
