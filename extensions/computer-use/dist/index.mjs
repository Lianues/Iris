// ../../packages/extension-sdk/dist/logger.js
function print(level, scope, args) {
  const consoleMethod = console[level] ?? console.log;
  consoleMethod(`[${scope}]`, ...args);
}
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    info: (...args) => print("log", scope, args),
    warn: (...args) => print("warn", scope, args),
    error: (...args) => print("error", scope, args),
    debug: (...args) => print("debug", scope, args)
  };
}

// ../../packages/extension-sdk/dist/plugin.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/config.ts
function parseStringArray(arr) {
  if (!Array.isArray(arr))
    return;
  const result = arr.filter((s) => typeof s === "string");
  return result.length > 0 ? result : undefined;
}
function parseToolPolicy(raw) {
  if (!raw || typeof raw !== "object")
    return;
  const include = parseStringArray(raw.include);
  const exclude = parseStringArray(raw.exclude);
  if (!include && !exclude)
    return;
  return { include, exclude };
}
function parseTargetWindow(raw) {
  if (typeof raw === "string")
    return raw;
  if (raw && typeof raw === "object") {
    const obj = raw;
    const selector = {};
    if (typeof obj.hwnd === "string")
      selector.hwnd = obj.hwnd;
    if (typeof obj.title === "string")
      selector.title = obj.title;
    if (typeof obj.exactTitle === "string")
      selector.exactTitle = obj.exactTitle;
    if (typeof obj.processName === "string")
      selector.processName = obj.processName;
    if (typeof obj.processId === "number")
      selector.processId = obj.processId;
    if (typeof obj.className === "string")
      selector.className = obj.className;
    if (Object.keys(selector).length === 0)
      return;
    return selector;
  }
  return;
}
function parseComputerUseConfig(raw) {
  if (!raw || typeof raw !== "object")
    return;
  if (!raw.enabled)
    return;
  let environmentTools;
  if (raw.environmentTools && typeof raw.environmentTools === "object") {
    const et = raw.environmentTools;
    const browser = parseToolPolicy(et.browser);
    const screen = parseToolPolicy(et.screen);
    const background = parseToolPolicy(et.background);
    if (browser || screen || background) {
      environmentTools = { browser, screen, background };
    }
  }
  return {
    enabled: true,
    environment: raw.environment === "screen" ? "screen" : "browser",
    screenWidth: typeof raw.screenWidth === "number" ? raw.screenWidth : undefined,
    screenHeight: typeof raw.screenHeight === "number" ? raw.screenHeight : undefined,
    postActionDelay: typeof raw.postActionDelay === "number" ? raw.postActionDelay : undefined,
    screenshotFormat: raw.screenshotFormat === "jpeg" ? "jpeg" : undefined,
    screenshotQuality: typeof raw.screenshotQuality === "number" ? raw.screenshotQuality : undefined,
    headless: typeof raw.headless === "boolean" ? raw.headless : undefined,
    initialUrl: typeof raw.initialUrl === "string" ? raw.initialUrl : undefined,
    searchEngineUrl: typeof raw.searchEngineUrl === "string" ? raw.searchEngineUrl : undefined,
    highlightMouse: typeof raw.highlightMouse === "boolean" ? raw.highlightMouse : undefined,
    maxRecentScreenshots: typeof raw.maxRecentScreenshots === "number" ? raw.maxRecentScreenshots : undefined,
    targetWindow: parseTargetWindow(raw.targetWindow),
    backgroundMode: typeof raw.backgroundMode === "boolean" ? raw.backgroundMode : undefined,
    environmentTools
  };
}

// src/config-template.ts
var DEFAULT_CONFIG_TEMPLATE = `# Computer Use 配置
#
# 启用后，LLM 可通过一组预定义工具操控浏览器或桌面。
# 工具包括 get_screenshot、click_at、type_text_at、scroll_document 等，
# 走普通 function calling 路径，任何支持工具调用的模型均可使用。
#
# 依赖：
#   browser 环境需要安装 Playwright
#     npm install playwright
#     laywright install chromium
#   screen 环境无额外依赖（Windows 通过 PowerShell 调用系统 API）

# 是否启用（默认关闭）
enabled: false

# 执行环境
#   browser — Playwright 控制 Chromium 浏览器（操作范围限定在浏览器窗口内）
#   screen  — 系统级截屏 + 输入模拟（默认全屏，可通过 targetWindow 限定到单个窗口）
environment: browser

# ─── 工具策略 ───
#
# 按环境配置要启用或排除的工具。
# 三个环境层级，运行时自动选择匹配的一个：
#   browser     — Playwright 浏览器环境
#   screen      — 桌面全屏 / 窗口前台模式
#   background  — 桌面窗口后台模式（screen + backgroundMode: true）
#
# 每个环境支持两种策略（互斥，include 优先）：
#   include: [工具名]  — 白名单，仅启用列出的工具
#   exclude: [工具名]  — 黑名单，排除列出的工具，其余全部启用
#
# 不配置 environmentTools 时使用内置默认策略：
#   browser:    全部启用
#   screen:     排除 go_back, go_forward, search
#   background: 排除 go_back, go_forward, search, drag_and_drop
#
# 配置后覆盖对应环境的默认策略。未配置的环境仍使用默认值。
#
# 全部 13 个工具：
#   get_screenshot, click_at, hover_at, type_text_at,
#   scroll_document, scroll_at, key_combination, navigate,
#   go_back, go_forward, search, wait_5_seconds, drag_and_drop
#
# ── 示例 ──
#
# environmentTools:
#   # 浏览器环境：排除拖拽
#   browser:
#     exclude:
#       - drag_and_drop
#
#   # 桌面环境：使用内置默认排除策略（不配置即可）
#
#   # 后台模式：白名单，只允许基础操作
#   background:
#     include:
#       - get_screenshot
#       - click_at
#       - type_text_at
#       - scroll_document
#       - key_combination
#       - wait_5_seconds

# ─── browser 环境专用 ───

# 启动时打开的初始页面
# initialUrl: https://www.google.com

# 搜索引擎首页（search 工具导航的目标）
# searchEngineUrl: https://www.google.com

# 浏览器视口尺寸（像素），仅 browser 环境生效
# screen 环境下屏幕/窗口尺寸自动检测，无需手动配置
# Gemini 推荐 1440×900 以获得最佳效果
screenWidth: 1440
screenHeight: 900

# 是否无头模式（不显示浏览器窗口）
# 调试时建议关闭，以便观察操作过程
headless: false

# 是否在操作位置显示红色圆圈标记（调试用）
# highlightMouse: true

# ─── screen 环境专用 ───
#
# 默认为全屏模式（截取整个桌面，操作范围不受限制）。
# 如需限定在某个应用窗口内，设置 targetWindow 即可。
#
# 目标窗口标题（子串匹配）。设置后：
#   - 截屏只截取该窗口区域
#   - 鼠标坐标自动偏移到窗口位置
#   - 操作前自动将窗口置于前台（后台模式除外）
#   - screenSize 返回窗口尺寸（LLM 的坐标归一化基于窗口尺寸）
# 不设置则为全屏模式。
#
# 示例：
#   targetWindow: "记事本"       # 匹配标题包含"记事本"的窗口
#   targetWindow: "Chrome"       # 匹配标题包含 Chrome 的窗口
#   targetWindow: "Visual Studio Code"
# targetWindow:
#
# 注意：全屏模式下 AI 的操作范围不受限制，请谨慎使用。
# 建议将 key_combination 等高风险工具设为 autoApprove: false（在 tools.yaml 中配置）。

# 后台操作模式（仅窗口模式下有效，需先设置 targetWindow）。
# 启用后不需要目标窗口在前台，AI 可以在后台操作窗口。
# 窗口只需处于显示状态（不最小化），可以被其他窗口遮挡。
# 如果窗口被最小化，会自动恢复但不激活（不抢焦点）。
#
# 实现方式：
#   截图 → PrintWindow（请求窗口自绘，支持 GPU 加速窗口）
#   鼠标 → PostMessage(WM_LBUTTONDOWN/UP)
#   键盘 → PostMessage(WM_KEYDOWN/UP) / WM_CHAR
#
# 截图兼容性（PrintWindow）：
#   ✓ 原生 Win32 / WPF / WinForms 应用
#   ✓ GPU 加速窗口（Chrome、Electron、游戏等）— 只要窗口处于显示状态
#
# 操作兼容性（PostMessage）：
#   ✓ 原生 Win32 / WPF / WinForms — 点击、键盘、滚动均正常
#   △ 部分应用可能不响应 PostMessage 的鼠标/键盘消息
#   △ 拖拽操作通过消息模拟，部分应用可能不支持
#
# 默认 false（前台模式）。
# backgroundMode: true

# ─── 截图保留策略 ───
#
# 发送给 LLM 时，只保留最近 N 轮 Computer Use 工具交互中的截图。
# 超出的旧轮次截图会被自动剥离，以节省 token。
# 存储中的完整截图不受影响。
#
# 默认 3，与 Gemini 官方示例一致。
# 设为 0 表示不保留任何截图（仅保留 URL 等文本信息）。
# 不设置或注释掉则使用默认值 3。
maxRecentScreenshots: 3
`;

// src/browser-env.ts
import { spawn } from "child_process";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
var logger = createPluginLogger("computer-use", "BrowserEnv");
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = path.dirname(__filename2);
var _extensionDir;
function setExtensionDir(dir) {
  _extensionDir = dir;
}

class BrowserEnvironment {
  _config;
  _screenSize;
  screenDescription;
  _child = null;
  _rl = null;
  _nextId = 1;
  _pending = new Map;
  constructor(config) {
    this._config = config;
    this._screenSize = [config.screenWidth, config.screenHeight];
    this.screenDescription = `浏览器 (${config.screenWidth}×${config.screenHeight})`;
  }
  screenSize() {
    return this._screenSize;
  }
  async initialize() {
    logger.info("正在启动 browser sidecar 子进程...");
    const { cmd, args } = resolveSidecarCommand("browser", "browser-sidecar.ts");
    this._child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: { ...process.env }
    });
    this._rl = readline.createInterface({ input: this._child.stdout });
    this._rl.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this._pending.get(msg.id);
      if (!pending)
        return;
      this._pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
    });
    let stderrBuf = "";
    this._child.stderr?.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });
    this._child.on("exit", (code) => {
      for (const [, { reject }] of this._pending) {
        reject(new Error(`browser sidecar 进程退出 (code=${code})${stderrBuf ? `
` + stderrBuf : ""}`));
      }
      this._pending.clear();
    });
    try {
      const result = await this._call("initialize", {
        screenWidth: this._config.screenWidth,
        screenHeight: this._config.screenHeight,
        headless: this._config.headless,
        initialUrl: this._config.initialUrl,
        searchEngineUrl: this._config.searchEngineUrl,
        highlightMouse: this._config.highlightMouse
      });
      if (result.screenSize) {
        this._screenSize = result.screenSize;
      }
    } catch (err) {
      await this.dispose();
      throw err;
    }
  }
  async dispose() {
    try {
      await this._call("dispose", undefined, 3000);
    } catch {}
    const child = this._child;
    if (!child)
      return;
    this._child = null;
    this._rl?.close();
    this._rl = null;
    child.stdin?.end();
    if (child.exitCode !== null)
      return;
    await new Promise((resolve2) => {
      const timer = setTimeout(() => {
        forceKillTree(child);
        resolve2();
      }, 3000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve2();
      });
    });
  }
  async currentState() {
    return this._callEnv("currentState");
  }
  async openWebBrowser() {
    return this._callEnv("openWebBrowser");
  }
  async goBack() {
    return this._callEnv("goBack");
  }
  async goForward() {
    return this._callEnv("goForward");
  }
  async search() {
    return this._callEnv("search", { searchEngineUrl: this._config.searchEngineUrl });
  }
  async navigate(url) {
    return this._callEnv("navigate", { url });
  }
  async clickAt(x, y) {
    return this._callEnv("clickAt", { x, y });
  }
  async hoverAt(x, y) {
    return this._callEnv("hoverAt", { x, y });
  }
  async dragAndDrop(x, y, destX, destY) {
    return this._callEnv("dragAndDrop", { x, y, destX, destY });
  }
  async typeTextAt(x, y, text, pressEnter, clearBeforeTyping) {
    return this._callEnv("typeTextAt", { x, y, text, pressEnter, clearBeforeTyping });
  }
  async keyCombination(keys) {
    return this._callEnv("keyCombination", { keys });
  }
  async scrollDocument(direction) {
    return this._callEnv("scrollDocument", { direction });
  }
  async scrollAt(x, y, direction, magnitude) {
    return this._callEnv("scrollAt", { x, y, direction, magnitude });
  }
  async wait5Seconds() {
    return this._callEnv("wait5Seconds");
  }
  async _callEnv(method, params) {
    const result = await this._call(method, params);
    return {
      screenshot: Buffer.from(result.screenshot, "base64"),
      url: result.url
    };
  }
  _call(method, params, timeoutMs = 30000) {
    if (!this._child?.stdin) {
      return Promise.reject(new Error("browser sidecar 未启动"));
    }
    const id = this._nextId++;
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`browser sidecar RPC '${method}' 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      this._pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve2(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      this._child.stdin.write(JSON.stringify({ id, method, params: params ?? {} }) + `
`);
    });
  }
}
function resolveSidecarCommand(type, sidecarFile) {
  const sidecarTs = path.resolve(__dirname2, sidecarFile);
  if (fs.existsSync(sidecarTs)) {
    if (globalThis.Bun) {
      return { cmd: "bun", args: [sidecarTs] };
    }
    return { cmd: "node", args: ["--import", "tsx", sidecarTs] };
  }
  if (_extensionDir) {
    const distMjs = path.resolve(_extensionDir, "dist", sidecarFile.replace(".ts", ".mjs"));
    if (fs.existsSync(distMjs)) {
      return { cmd: "node", args: [distMjs] };
    }
  }
  return { cmd: process.execPath, args: ["--sidecar", type] };
}
function forceKillTree(child) {
  try {
    if (process.platform === "win32" && child.pid) {
      const tk = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
      tk.on("error", () => {});
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

// src/screen-env.ts
import { spawn as spawn2 } from "child_process";
import * as readline2 from "readline";
import * as path2 from "path";
import * as fs2 from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
var logger2 = createPluginLogger("computer-use", "ScreenEnv");
var __filename3 = fileURLToPath2(import.meta.url);
var __dirname3 = path2.dirname(__filename3);
var _extensionDir2;
function setExtensionDir2(dir) {
  _extensionDir2 = dir;
}

class ScreenEnvironment {
  _config;
  _screenSize = [1920, 1080];
  screenDescription = "桌面全屏";
  initWarnings = [];
  _child = null;
  _rl = null;
  _nextId = 1;
  _pending = new Map;
  constructor(config) {
    this._config = config;
  }
  screenSize() {
    return this._screenSize;
  }
  async initialize() {
    logger2.info("正在启动 screen sidecar 子进程...");
    const { cmd, args } = resolveSidecarCommand2("screen", "screen-sidecar.ts");
    this._child = spawn2(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: { ...process.env }
    });
    this._rl = readline2.createInterface({ input: this._child.stdout });
    this._rl.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this._pending.get(msg.id);
      if (!pending)
        return;
      this._pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
    });
    let stderrBuf = "";
    this._child.stderr?.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });
    this._child.on("exit", (code) => {
      for (const [, { reject }] of this._pending) {
        reject(new Error(`screen sidecar 进程退出 (code=${code})${stderrBuf ? `
` + stderrBuf : ""}`));
      }
      this._pending.clear();
    });
    try {
      const result = await this._call("initialize", {
        searchEngineUrl: this._config.searchEngineUrl,
        targetWindow: this._config.targetWindow,
        backgroundMode: this._config.backgroundMode
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
  async dispose() {
    try {
      await this._call("dispose", undefined, 3000);
    } catch {}
    const child = this._child;
    if (!child)
      return;
    this._child = null;
    this._rl?.close();
    this._rl = null;
    child.stdin?.end();
    if (child.exitCode !== null)
      return;
    await new Promise((resolve3) => {
      const timer = setTimeout(() => {
        forceKillTree2(child);
        resolve3();
      }, 3000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve3();
      });
    });
  }
  async currentState() {
    return this._callEnv("currentState");
  }
  async openWebBrowser() {
    return this._callEnv("openWebBrowser");
  }
  async goBack() {
    return this._callEnv("goBack");
  }
  async goForward() {
    return this._callEnv("goForward");
  }
  async search() {
    return this._callEnv("search", { searchEngineUrl: this._config.searchEngineUrl });
  }
  async navigate(url) {
    return this._callEnv("navigate", { url });
  }
  async clickAt(x, y) {
    return this._callEnv("clickAt", { x, y });
  }
  async hoverAt(x, y) {
    return this._callEnv("hoverAt", { x, y });
  }
  async dragAndDrop(x, y, destX, destY) {
    return this._callEnv("dragAndDrop", { x, y, destX, destY });
  }
  async typeTextAt(x, y, text, pressEnter, clearBeforeTyping) {
    return this._callEnv("typeTextAt", { x, y, text, pressEnter, clearBeforeTyping });
  }
  async keyCombination(keys) {
    return this._callEnv("keyCombination", { keys });
  }
  async scrollDocument(direction) {
    return this._callEnv("scrollDocument", { direction });
  }
  async scrollAt(x, y, direction, magnitude) {
    return this._callEnv("scrollAt", { x, y, direction, magnitude });
  }
  async wait5Seconds() {
    return this._callEnv("wait5Seconds");
  }
  async listWindows() {
    const result = await this._call("listWindows");
    return result.windows ?? [];
  }
  async switchWindow(hwnd) {
    const result = await this._call("switchWindow", { hwnd });
    if (result.screenSize) {
      this._screenSize = result.screenSize;
    }
    this._updateScreenDescription(result.windowInfo);
  }
  _updateScreenDescription(windowInfo) {
    if (windowInfo && windowInfo.hwnd) {
      const [w, h] = this._screenSize;
      const bg = this._config.backgroundMode ? "后台模式" : "前台模式";
      this.screenDescription = `窗口${bg}: ${windowInfo.title} [HWND=${windowInfo.hwnd}, 类名=${windowInfo.className}] (${w}×${h})`;
    } else {
      const [w, h] = this._screenSize;
      this.screenDescription = `桌面全屏 (${w}×${h})`;
    }
  }
  async _callEnv(method, params) {
    const result = await this._call(method, params);
    if (result.screenSize) {
      this._screenSize = result.screenSize;
    }
    return {
      screenshot: Buffer.from(result.screenshot, "base64"),
      url: result.url
    };
  }
  _call(method, params, timeoutMs = 30000) {
    if (!this._child?.stdin) {
      return Promise.reject(new Error("screen sidecar 未启动"));
    }
    const id = this._nextId++;
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`screen sidecar RPC '${method}' 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      this._pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve3(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      this._child.stdin.write(JSON.stringify({ id, method, params: params ?? {} }) + `
`);
    });
  }
}
function resolveSidecarCommand2(type, sidecarFile) {
  const sidecarTs = path2.resolve(__dirname3, sidecarFile);
  if (fs2.existsSync(sidecarTs)) {
    if (globalThis.Bun) {
      return { cmd: "bun", args: [sidecarTs] };
    }
    return { cmd: "node", args: ["--import", "tsx", sidecarTs] };
  }
  if (_extensionDir2) {
    const distMjs = path2.resolve(_extensionDir2, "dist", sidecarFile.replace(".ts", ".mjs"));
    if (fs2.existsSync(distMjs)) {
      return { cmd: "node", args: [distMjs] };
    }
  }
  return { cmd: process.execPath, args: ["--sidecar", type] };
}
function forceKillTree2(child) {
  try {
    if (process.platform === "win32" && child.pid) {
      const tk = spawn2("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
      tk.on("error", () => {});
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

// src/coordinator.ts
function denormalizeX(x, screenWidth) {
  return Math.round(x / 1000 * screenWidth);
}
function denormalizeY(y, screenHeight) {
  return Math.round(y / 1000 * screenHeight);
}

// src/tools.ts
function toResult(state) {
  return {
    __response: { url: state.url },
    __parts: [{
      inlineData: {
        mimeType: "image/png",
        data: state.screenshot.toString("base64")
      }
    }]
  };
}
var COMPUTER_USE_FUNCTION_NAMES = new Set([
  "get_screenshot",
  "click_at",
  "hover_at",
  "type_text_at",
  "scroll_document",
  "scroll_at",
  "key_combination",
  "navigate",
  "go_back",
  "go_forward",
  "search",
  "wait_5_seconds",
  "drag_and_drop"
]);
var DEFAULT_ENVIRONMENT_TOOLS = {
  browser: {},
  screen: {
    exclude: ["go_back", "go_forward", "search"]
  },
  background: {
    exclude: ["go_back", "go_forward", "search", "drag_and_drop"]
  }
};
function resolveEnvironmentKey(environment, backgroundMode) {
  if (environment === "screen" && backgroundMode)
    return "background";
  return environment;
}
function applyToolPolicy(tools, policy) {
  if (policy.include) {
    const allowed = new Set(policy.include);
    return tools.filter((t) => allowed.has(t.declaration.name));
  }
  if (policy.exclude) {
    const blocked = new Set(policy.exclude);
    return tools.filter((t) => !blocked.has(t.declaration.name));
  }
  return tools;
}
function createComputerUseTools(computer, envKey, userPolicy) {
  const sz = () => computer.screenSize();
  const all = [
    {
      declaration: (() => {
        const decl = {
          name: "get_screenshot",
          description: ""
        };
        Object.defineProperty(decl, "description", {
          get: () => `获取当前屏幕截图。当前截图目标: ${computer.screenDescription}。用于查看当前屏幕内容、确认操作结果、或在开始操作前了解当前界面状态。`,
          enumerable: true
        });
        return decl;
      })(),
      handler: async () => toResult(await computer.openWebBrowser())
    },
    {
      declaration: {
        name: "go_back",
        description: "后退到上一页。在浏览器中触发后退导航，在桌面环境中发送 Alt+Left。"
      },
      handler: async () => toResult(await computer.goBack())
    },
    {
      declaration: {
        name: "go_forward",
        description: "前进到下一页。在浏览器中触发前进导航，在桌面环境中发送 Alt+Right。"
      },
      handler: async () => toResult(await computer.goForward())
    },
    {
      declaration: {
        name: "search",
        description: "打开搜索引擎首页。在需要从新的搜索开始时使用。"
      },
      handler: async () => toResult(await computer.search())
    },
    {
      declaration: {
        name: "navigate",
        description: "在浏览器中打开指定 URL。桌面环境下会调用系统默认浏览器。",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "目标 URL" }
          },
          required: ["url"]
        }
      },
      handler: async (args) => toResult(await computer.navigate(args.url))
    },
    {
      declaration: {
        name: "wait_5_seconds",
        description: "等待 5 秒。用于等待内容加载、动画播放或界面更新完成。"
      },
      handler: async () => toResult(await computer.wait5Seconds())
    },
    {
      declaration: {
        name: "click_at",
        description: "点击屏幕上的指定位置。x 和 y 为 0-999 的归一化坐标，按比例映射到屏幕实际像素。",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number", description: "X 坐标 (0-999)" },
            y: { type: "number", description: "Y 坐标 (0-999)" }
          },
          required: ["x", "y"]
        }
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.clickAt(denormalizeX(args.x, sw), denormalizeY(args.y, sh)));
      }
    },
    {
      declaration: {
        name: "hover_at",
        description: "将鼠标悬停在指定位置。可用于触发悬停菜单或提示信息。x 和 y 为 0-999 的归一化坐标。",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number", description: "X 坐标 (0-999)" },
            y: { type: "number", description: "Y 坐标 (0-999)" }
          },
          required: ["x", "y"]
        }
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.hoverAt(denormalizeX(args.x, sw), denormalizeY(args.y, sh)));
      }
    },
    {
      declaration: {
        name: "drag_and_drop",
        description: "将元素从起始坐标拖放到目标坐标。所有坐标为 0-999 的归一化值。",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number", description: "起始 X 坐标 (0-999)" },
            y: { type: "number", description: "起始 Y 坐标 (0-999)" },
            destination_x: { type: "number", description: "目标 X 坐标 (0-999)" },
            destination_y: { type: "number", description: "目标 Y 坐标 (0-999)" }
          },
          required: ["x", "y", "destination_x", "destination_y"]
        }
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.dragAndDrop(denormalizeX(args.x, sw), denormalizeY(args.y, sh), denormalizeX(args.destination_x, sw), denormalizeY(args.destination_y, sh)));
      }
    },
    {
      declaration: {
        name: "type_text_at",
        description: [
          "在指定位置输入文本。",
          "点击目标坐标后输入文本。",
          "默认不清空已有内容，不自动按回车。",
          "如需清空输入框再输入，设 clear_before_typing=true（会 Ctrl+A 全选后删除）。",
          "如需输入后按回车，设 press_enter=true。",
          "某些情况下，如需换行而非提交，改用 key_combination 发送 Shift+Enter 等组合键避免提交。",
          "x 和 y 为 0-999 的归一化坐标。"
        ].join(""),
        parameters: {
          type: "object",
          properties: {
            x: { type: "number", description: "X 坐标 (0-999)" },
            y: { type: "number", description: "Y 坐标 (0-999)" },
            text: { type: "string", description: "要输入的文本" },
            press_enter: { type: "boolean", description: "输入后是否按回车，默认 false" },
            clear_before_typing: { type: "boolean", description: "输入前是否 Ctrl+A 全选并删除已有内容，默认 false" }
          },
          required: ["x", "y", "text"]
        }
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.typeTextAt(denormalizeX(args.x, sw), denormalizeY(args.y, sh), args.text, args.press_enter ?? false, args.clear_before_typing ?? false));
      }
    },
    {
      declaration: {
        name: "key_combination",
        description: '按下键盘按键或组合键。例如 "Control+C"、"Enter"、"Alt+Tab"。多个键用 "+" 连接。',
        parameters: {
          type: "object",
          properties: {
            keys: { type: "string", description: '按键描述，如 "Enter"、"Control+C"、"Alt+F4"' }
          },
          required: ["keys"]
        }
      },
      handler: async (args) => {
        const keys = args.keys.split("+").map((k) => k.trim());
        return toResult(await computer.keyCombination(keys));
      }
    },
    {
      declaration: {
        name: "scroll_document",
        description: '滚动当前窗口内容。direction 可选 "up"、"down"、"left"、"right"。',
        parameters: {
          type: "object",
          properties: {
            direction: { type: "string", description: "滚动方向: up / down / left / right" }
          },
          required: ["direction"]
        }
      },
      handler: async (args) => toResult(await computer.scrollDocument(args.direction))
    },
    {
      declaration: {
        name: "scroll_at",
        description: [
          "在指定位置按方向滚动指定幅度。",
          "x、y 为 0-999 的归一化坐标。",
          "amount 为滚动格数（鼠标滚轮格数），默认 3。"
        ].join(""),
        parameters: {
          type: "object",
          properties: {
            x: { type: "number", description: "X 坐标 (0-999)" },
            y: { type: "number", description: "Y 坐标 (0-999)" },
            direction: { type: "string", description: "滚动方向: up / down / left / right" },
            amount: { type: "number", description: "滚动格数（鼠标滚轮格数），默认 3" }
          },
          required: ["x", "y", "direction"]
        }
      },
      handler: async (args) => {
        const direction = args.direction;
        const amount = args.amount ?? 3;
        const [sw, sh] = sz();
        return toResult(await computer.scrollAt(denormalizeX(args.x, sw), denormalizeY(args.y, sh), direction, amount));
      }
    }
  ];
  const policy = userPolicy ?? DEFAULT_ENVIRONMENT_TOOLS[envKey] ?? {};
  return applyToolPolicy(all, policy);
}

// src/index.ts
var logger3 = createPluginLogger("computer-use");
var activeEnv;
var lastConfigSnapshot = "";
var reloading = false;
var pendingReload = null;
var cachedApi;
var src_default = definePlugin({
  name: "computer-use",
  version: "0.1.0",
  description: "Computer Use — 浏览器和桌面自动化",
  activate(ctx) {
    const extDir = ctx.getExtensionRootDir();
    setExtensionDir(extDir);
    setExtensionDir2(extDir);
    const created = ctx.ensureConfigFile("computer_use.yaml", DEFAULT_CONFIG_TEMPLATE);
    if (created) {
      logger3.info("已在配置目录中安装 computer_use.yaml 默认模板");
    }
    ctx.onReady(async (api) => {
      cachedApi = api;
      const pluginConfig = ctx.getPluginConfig();
      const rawConfig = ctx.readConfigSection("computer_use") ?? pluginConfig ?? api.config.computer_use ?? api.config.computerUse;
      const cuConfig = parseComputerUseConfig(rawConfig);
      if (!cuConfig?.enabled) {
        logger3.info("Computer Use 未启用");
        return;
      }
      await initEnvironment(cuConfig, api);
      lastConfigSnapshot = JSON.stringify(rawConfig ?? null);
    });
    ctx.addHook({
      name: "computer-use:config-reload",
      async onConfigReload({ config, rawMergedConfig }) {
        if (!cachedApi)
          return;
        const rawConfig = rawMergedConfig.computer_use;
        await safeReload(rawConfig, cachedApi);
      }
    });
  },
  async deactivate() {
    await destroyEnvironment();
  }
});
async function initEnvironment(cuConfig, api) {
  const env = cuConfig.environment ?? "browser";
  const envKey = resolveEnvironmentKey(env, cuConfig.backgroundMode);
  let cuEnv;
  if (env === "screen") {
    cuEnv = new ScreenEnvironment({
      searchEngineUrl: cuConfig.searchEngineUrl,
      targetWindow: cuConfig.targetWindow,
      backgroundMode: cuConfig.backgroundMode
    });
  } else {
    cuEnv = new BrowserEnvironment({
      screenWidth: cuConfig.screenWidth ?? 1440,
      screenHeight: cuConfig.screenHeight ?? 900,
      headless: cuConfig.headless,
      initialUrl: cuConfig.initialUrl,
      searchEngineUrl: cuConfig.searchEngineUrl,
      highlightMouse: cuConfig.highlightMouse
    });
  }
  try {
    await cuEnv.initialize();
  } catch (err) {
    logger3.error("Computer Use 环境初始化失败:", err);
    return;
  }
  if ("initWarnings" in cuEnv) {
    const warnings = cuEnv.initWarnings;
    for (const w of warnings) {
      logger3.warn(w);
    }
  }
  const userPolicy = cuConfig.environmentTools?.[envKey];
  const tools = createComputerUseTools(cuEnv, envKey, userPolicy);
  api.tools.registerAll(tools);
  activeEnv = cuEnv;
  api.computerEnv = cuEnv;
  logger3.info(`Computer Use 已启用 [环境=${env}, 策略=${envKey}]`);
}
async function destroyEnvironment() {
  if (activeEnv) {
    try {
      await activeEnv.dispose();
    } catch {}
    activeEnv = undefined;
  }
}
async function safeReload(rawConfig, api) {
  if (reloading) {
    pendingReload = { rawConfig, api };
    return;
  }
  reloading = true;
  try {
    await doReload(rawConfig, api);
  } finally {
    reloading = false;
    if (pendingReload) {
      const p = pendingReload;
      pendingReload = null;
      await safeReload(p.rawConfig, p.api);
    }
  }
}
async function doReload(rawConfig, api) {
  const newSnapshot = JSON.stringify(rawConfig ?? null);
  if (newSnapshot === lastConfigSnapshot)
    return;
  lastConfigSnapshot = newSnapshot;
  const toolNames = api.tools;
  if (typeof toolNames.listTools === "function") {
    for (const name of toolNames.listTools()) {
      if (COMPUTER_USE_FUNCTION_NAMES.has(name)) {
        toolNames.unregister(name);
      }
    }
  }
  await destroyEnvironment();
  api.computerEnv = undefined;
  const cuConfig = parseComputerUseConfig(rawConfig);
  if (cuConfig?.enabled) {
    await initEnvironment(cuConfig, api);
  } else {
    logger3.info("Computer Use 已禁用");
  }
}
export {
  src_default as default
};
