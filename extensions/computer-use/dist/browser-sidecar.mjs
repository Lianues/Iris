import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/browser-sidecar.ts
import * as readline from "readline";
var PLAYWRIGHT_KEY_MAP = {
  backspace: "Backspace",
  tab: "Tab",
  return: "Enter",
  enter: "Enter",
  shift: "Shift",
  control: "ControlOrMeta",
  alt: "Alt",
  escape: "Escape",
  space: "Space",
  pageup: "PageUp",
  pagedown: "PageDown",
  end: "End",
  home: "Home",
  left: "ArrowLeft",
  up: "ArrowUp",
  right: "ArrowRight",
  down: "ArrowDown",
  insert: "Insert",
  delete: "Delete",
  semicolon: ";",
  equals: "=",
  multiply: "Multiply",
  add: "Add",
  subtract: "Subtract",
  decimal: "Decimal",
  divide: "Divide",
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",
  command: "Meta"
};
var browser = null;
var context = null;
var page = null;
var screenSize = [1440, 900];
var highlightMouse = false;
function log(msg) {
  process.stderr.write(`[ComputerUse:sidecar] ${msg}
`);
}
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + `
`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function captureState() {
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  await sleep(500);
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  return { screenshot: buffer.toString("base64"), url: page.url() };
}
async function navigateTo(url) {
  let normalized = url;
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  await page.goto(normalized, { timeout: 30000, waitUntil: "domcontentloaded" });
}
async function doKeyCombination(keys) {
  if (keys.length === 0)
    return;
  const mapped = keys.map((k) => PLAYWRIGHT_KEY_MAP[k.toLowerCase()] ?? k);
  for (const key of mapped.slice(0, -1)) {
    await page.keyboard.down(key);
  }
  await page.keyboard.press(mapped[mapped.length - 1]);
  for (const key of mapped.slice(0, -1).reverse()) {
    await page.keyboard.up(key);
  }
}
async function doHighlightMouse(x, y) {
  if (!highlightMouse)
    return;
  try {
    await page.evaluate(`
      (() => {
        const div = document.createElement('div');
        div.style.pointerEvents = 'none';
        div.style.border = '4px solid red';
        div.style.borderRadius = '50%';
        div.style.width = '20px';
        div.style.height = '20px';
        div.style.position = 'fixed';
        div.style.zIndex = '99999';
        div.style.left = (${x} - 10) + 'px';
        div.style.top = (${y} - 10) + 'px';
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 2000);
      })()
    `);
    await sleep(300);
  } catch {}
}
async function handleRequest(req) {
  try {
    const p = req.params ?? {};
    let result;
    switch (req.method) {
      case "initialize": {
        const cfg = p;
        screenSize = [cfg.screenWidth ?? 1440, cfg.screenHeight ?? 900];
        highlightMouse = cfg.highlightMouse ?? false;
        log("正在加载 Playwright...");
        const { chromium } = await import("playwright");
        log("正在启动 Chromium 浏览器...");
        browser = await chromium.launch({
          headless: cfg.headless ?? false,
          timeout: 30000,
          args: [
            "--disable-extensions",
            "--disable-file-system",
            "--disable-plugins",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--disable-default-apps",
            "--disable-sync"
          ]
        });
        log("Chromium 已启动，正在创建页面...");
        context = await browser.newContext({
          viewport: { width: screenSize[0], height: screenSize[1] }
        });
        page = await context.newPage();
        context.on("page", async (newPage) => {
          try {
            await newPage.waitForLoadState("commit").catch(() => {});
            const newUrl = newPage.url();
            await newPage.close();
            if (newUrl && newUrl !== "about:blank") {
              await page.goto(newUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
            }
          } catch {}
        });
        const initialUrl = cfg.initialUrl ?? "https://www.google.com";
        log(`正在导航到 ${initialUrl} ...`);
        await page.goto(initialUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
        log(`浏览器就绪 (${screenSize[0]}×${screenSize[1]}, ${initialUrl})`);
        result = { ok: true, screenSize };
        break;
      }
      case "dispose": {
        if (context)
          try {
            await context.close();
          } catch {}
        if (browser)
          try {
            await browser.close();
          } catch {}
        browser = null;
        context = null;
        page = null;
        result = { ok: true };
        break;
      }
      case "screenSize": {
        if (page) {
          const vp = page.viewportSize();
          if (vp)
            screenSize = [vp.width, vp.height];
        }
        result = { screenSize };
        break;
      }
      case "currentState":
      case "openWebBrowser": {
        result = await captureState();
        break;
      }
      case "goBack": {
        await page.goBack();
        result = await captureState();
        break;
      }
      case "goForward": {
        await page.goForward();
        result = await captureState();
        break;
      }
      case "search": {
        await navigateTo(p.searchEngineUrl || "https://www.google.com");
        result = await captureState();
        break;
      }
      case "navigate": {
        await navigateTo(p.url);
        result = await captureState();
        break;
      }
      case "clickAt": {
        await doHighlightMouse(p.x, p.y);
        await page.mouse.click(p.x, p.y);
        result = await captureState();
        break;
      }
      case "hoverAt": {
        await doHighlightMouse(p.x, p.y);
        await page.mouse.move(p.x, p.y);
        result = await captureState();
        break;
      }
      case "dragAndDrop": {
        await doHighlightMouse(p.x, p.y);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await doHighlightMouse(p.destX, p.destY);
        await page.mouse.move(p.destX, p.destY);
        await page.mouse.up();
        result = await captureState();
        break;
      }
      case "typeTextAt": {
        await doHighlightMouse(p.x, p.y);
        await page.mouse.click(p.x, p.y);
        await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
        if (p.clearBeforeTyping === true) {
          await doKeyCombination(["Control", "A"]);
          await doKeyCombination(["Delete"]);
        }
        await page.keyboard.type(p.text);
        await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
        if (p.pressEnter === true) {
          await doKeyCombination(["Enter"]);
        }
        result = await captureState();
        break;
      }
      case "keyCombination": {
        await doKeyCombination(p.keys);
        result = await captureState();
        break;
      }
      case "scrollDocument": {
        const dir = p.direction;
        if (dir === "down") {
          await doKeyCombination(["PageDown"]);
        } else if (dir === "up") {
          await doKeyCombination(["PageUp"]);
        } else {
          const amount = Math.round(screenSize[0] / 2);
          const sign = dir === "left" ? "-" : "";
          await page.evaluate(`window.scrollBy(${sign}${amount}, 0)`);
        }
        result = await captureState();
        break;
      }
      case "scrollAt": {
        await doHighlightMouse(p.x, p.y);
        await page.mouse.move(p.x, p.y);
        const pxPerNotch = 100;
        let dx = 0, dy = 0;
        switch (p.direction) {
          case "up":
            dy = -p.magnitude * pxPerNotch;
            break;
          case "down":
            dy = p.magnitude * pxPerNotch;
            break;
          case "left":
            dx = -p.magnitude * pxPerNotch;
            break;
          case "right":
            dx = p.magnitude * pxPerNotch;
            break;
        }
        await page.mouse.wheel(dx, dy);
        result = await captureState();
        break;
      }
      case "wait5Seconds": {
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
var rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  handleRequest(req).catch((err) => {
    send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  });
});
process.stdin.on("end", async () => {
  const forceExitTimer = setTimeout(() => process.exit(1), 3000);
  if (browser) {
    try {
      await browser.close();
    } catch {}
  }
  clearTimeout(forceExitTimer);
  process.exit(0);
});
log("sidecar 进程已启动，等待指令...");
