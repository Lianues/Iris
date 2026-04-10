import { createRequire } from "node:module";
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// extensions/console/src/terminal-compat.ts
function detectTier() {
  if (process.env.WT_SESSION)
    return "full";
  const tp = process.env.TERM_PROGRAM ?? "";
  if (KNOWN_MODERN_TERMS.has(tp))
    return "full";
  if (process.platform === "win32")
    return "basic";
  return "standard";
}
function pick(modern, basic) {
  return terminalTier === "basic" ? basic : modern;
}
var KNOWN_MODERN_TERMS, terminalTier, ICONS, SPINNER_FRAMES;
var init_terminal_compat = __esm(() => {
  KNOWN_MODERN_TERMS = new Set([
    "iTerm.app",
    "Hyper",
    "vscode",
    "WezTerm",
    "Alacritty",
    "kitty",
    "Tabby",
    "warp",
    "ghostty"
  ]);
  terminalTier = detectTier();
  ICONS = {
    thinkingFilled: pick("￭", "="),
    thinkingDim: pick("￮", "-"),
    statusStreaming: pick("\uD83D\uDCE1", "~"),
    statusQueued: pick("⏳", "."),
    statusApproval: pick("\uD83D\uDD10", "?"),
    statusExecuting: pick("\uD83D\uDD27", "*"),
    statusApply: pick("\uD83D\uDCCB", "="),
    statusSuccess: pick("✅", "✓"),
    statusWarning: pick("⚠️", "⚠"),
    statusError: pick("❌", "✗"),
    checkmark: pick("✓", "v"),
    crossmark: pick("✗", "x"),
    cancelled: pick("⊘", "-"),
    warning: pick("⚠", "!"),
    lightning: pick("⚡", "*"),
    clock: pick("⏰", "*"),
    timer: pick("⏱", "*"),
    hourglass: pick("⏳", "."),
    selectorArrow: pick("❯", ">"),
    triangleRight: pick("▸", ">"),
    bullet: pick("•", "*"),
    resultArrow: pick("↳", ">"),
    delegateArrow: pick("⇢", "=>"),
    upArrow: pick("↑", "^"),
    downArrow: pick("↓", "v"),
    arrowLeft: pick("←", "<"),
    arrowRight: pick("→", ">"),
    arrowUp: pick("↑", "^"),
    arrowDown: pick("↓", "v"),
    dotFilled: pick("●", "*"),
    dotEmpty: pick("○", "o"),
    ellipsis: pick("…", ".."),
    emDash: pick("—", "--"),
    separator: pick("·", "-")
  };
  SPINNER_FRAMES = terminalTier === "basic" ? ["|", "/", "-", "\\", "|", "/", "-", "\\", "|", "/"] : ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
});

// extensions/console/src/remote-wizard.ts
var exports_remote_wizard = {};
__export(exports_remote_wizard, {
  showSavePrompt: () => showSavePrompt,
  showRemoteConnectWizard: () => showRemoteConnectWizard,
  showInputPhase: () => showInputPhase,
  showConnectingStatus: () => showConnectingStatus,
  showConnectSuccess: () => showConnectSuccess,
  showConnectError: () => showConnectError
});
function showSelectionPhase(options) {
  return new Promise((resolve3) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode)
      stdin.setRawMode(true);
    stdin.resume();
    let discovered = [];
    let discoveryDone = false;
    let done = false;
    function buildItems() {
      const items2 = [];
      for (const s of options.saved) {
        items2.push({ type: "saved", name: s.name, url: s.url, hasToken: s.hasToken });
      }
      for (const d of discovered) {
        items2.push({ type: "discovered", host: d.host, port: d.port, name: d.name });
      }
      items2.push({ type: "manual" });
      return items2;
    }
    let items = buildItems();
    let cursor = 0;
    if (options.discoveryPromise) {
      options.discoveryPromise.then((results) => {
        if (done)
          return;
        discovered = results;
        discoveryDone = true;
        items = buildItems();
        if (cursor >= items.length)
          cursor = items.length - 1;
        render();
      }).catch(() => {
        if (done)
          return;
        discoveryDone = true;
        render();
      });
    } else {
      discoveryDone = true;
    }
    function render() {
      if (done)
        return;
      const lines = [];
      lines.push("");
      lines.push(`  ${ansi.magenta}${ansi.bold}━━ Iris — 远程连接 ${ansi.reset}`);
      lines.push("");
      if (options.saved.length > 0) {
        lines.push(`  ${ansi.dim}已保存:${ansi.reset}`);
        for (let i = 0;i < options.saved.length; i++) {
          const s = options.saved[i];
          const isCurrent = cursor === i;
          const arrow = isCurrent ? `${ansi.cyan}${ICONS.triangleRight} ` : "  ";
          const nameStr = isCurrent ? `${ansi.cyan}${ansi.bold}${s.name}${ansi.reset}` : s.name;
          const host = s.url.replace(/^wss?:\/\//, "");
          const tokenHint = s.hasToken ? `${ansi.dim} ${ICONS.checkmark}${ansi.reset}` : "";
          lines.push(`  ${arrow}${nameStr}${ansi.reset} ${ansi.dim}(${host})${ansi.reset}${tokenHint}`);
        }
        lines.push("");
      }
      const savedLen = options.saved.length;
      if (!discoveryDone) {
        lines.push(`  ${ansi.dim}局域网: ${ansi.yellow}搜索中...${ansi.reset}`);
        lines.push("");
      } else if (discovered.length > 0) {
        lines.push(`  ${ansi.dim}局域网发现:${ansi.reset}`);
        for (let i = 0;i < discovered.length; i++) {
          const d = discovered[i];
          const idx = savedLen + i;
          const isCurrent = cursor === idx;
          const arrow = isCurrent ? `${ansi.cyan}${ICONS.triangleRight} ` : "  ";
          const nameStr = isCurrent ? `${ansi.cyan}${ansi.bold}${d.name}${ansi.reset}` : d.name;
          const agentHint = d.agent ? ` [${d.agent}]` : "";
          lines.push(`  ${arrow}${nameStr}${ansi.reset} ${ansi.dim}(${d.host}:${d.port}${agentHint})${ansi.reset}`);
        }
        lines.push("");
      } else {
        lines.push(`  ${ansi.dim}局域网: 未发现其他实例${ansi.reset}`);
        lines.push("");
      }
      const manualIdx = items.length - 1;
      const isManualCurrent = cursor === manualIdx;
      const manualStyle = isManualCurrent ? `${ansi.cyan}${ansi.bold}${ICONS.triangleRight} [ 手动输入 ]${ansi.reset}` : `  ${ansi.dim}[ 手动输入 ]${ansi.reset}`;
      lines.push(`  ${manualStyle}`);
      lines.push("");
      const hints = ["↑↓ 选择", "Enter 连接"];
      if (options.saved.length > 0 && cursor < savedLen) {
        hints.push("d 删除");
      }
      hints.push("Esc 取消");
      lines.push(`  ${ansi.dim}${hints.join(`  ${ICONS.separator}  `)}${ansi.reset}`);
      lines.push("");
      stdout.write(ansi.clear + ansi.hideCursor + lines.join(`
`));
    }
    function cleanup() {
      done = true;
      stdin.removeListener("data", onData);
      if (stdin.setRawMode)
        stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }
    function onData(buf) {
      const key = buf.toString("utf-8");
      if (key === "\x1B" || key === "\x03") {
        cleanup();
        resolve3(null);
        return;
      }
      if (key === "\x1B[A") {
        if (cursor > 0)
          cursor--;
        render();
        return;
      }
      if (key === "\x1B[B") {
        if (cursor < items.length - 1)
          cursor++;
        render();
        return;
      }
      if (key === "\t") {
        cursor = (cursor + 1) % items.length;
        render();
        return;
      }
      if (key === "\x1B[Z") {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
        return;
      }
      if (key === "d" || key === "D") {
        const item = items[cursor];
        if (item?.type === "saved" && options.onDelete) {
          try {
            options.onDelete(item.name);
          } catch {}
          options.saved = options.saved.filter((s) => s.name !== item.name);
          items = buildItems();
          if (cursor >= items.length)
            cursor = items.length - 1;
          render();
        }
        return;
      }
      if (key === "\r" || key === `
`) {
        const item = items[cursor];
        if (!item)
          return;
        cleanup();
        if (item.type === "saved") {
          resolve3({ action: "connect-saved", name: item.name, url: item.url, hasToken: item.hasToken });
        } else if (item.type === "discovered") {
          resolve3({ action: "connect-discovered", host: item.host, port: item.port, name: item.name });
        } else {
          resolve3({ action: "manual" });
        }
        return;
      }
    }
    stdin.on("data", onData);
    render();
  });
}
function showInputPhase(opts = {}) {
  return new Promise((resolve3) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let url = opts.prefillUrl || "ws://";
    let token = opts.prefillToken || "";
    let focusedField = opts.urlLocked ? 1 : 0;
    let status = "";
    let statusIsError = false;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode)
      stdin.setRawMode(true);
    stdin.resume();
    function render() {
      const lines = [];
      lines.push("");
      lines.push(`  ${ansi.magenta}${ansi.bold}━━ Iris — 远程连接 ${ansi.reset}`);
      lines.push("");
      if (opts.urlLocked) {
        lines.push(`  ${ansi.dim}地址${ansi.reset}  ${url}`);
      } else {
        const urlLabel = focusedField === 0 ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
        const urlCursor = focusedField === 0 ? `${ansi.cyan}|${ansi.reset}` : "";
        lines.push(`  ${urlLabel}地址${ansi.reset}  ${url}${urlCursor}`);
      }
      lines.push("");
      const tokenLabel = focusedField === 1 ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
      const tokenCursor = focusedField === 1 ? `${ansi.cyan}|${ansi.reset}` : "";
      const maskedToken = "*".repeat(token.length);
      lines.push(`  ${tokenLabel}Token${ansi.reset} ${maskedToken}${tokenCursor}`);
      lines.push("");
      const connectStyle = focusedField === 2 ? `${ansi.green}${ansi.bold}[ 连接 ]${ansi.reset}` : `${ansi.dim}[ 连接 ]${ansi.reset}`;
      lines.push(`  ${connectStyle}`);
      lines.push("");
      if (status) {
        const statusColor = statusIsError ? ansi.red : ansi.green;
        lines.push(`  ${statusColor}${status}${ansi.reset}`);
        lines.push("");
      }
      lines.push(`  ${ansi.dim}Tab 切换字段  Enter 确认  Esc 返回${ansi.reset}`);
      lines.push("");
      stdout.write(ansi.clear + ansi.hideCursor + lines.join(`
`));
    }
    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.setRawMode)
        stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }
    const fieldCount = 3;
    function nextField() {
      if (opts.urlLocked) {
        focusedField = focusedField === 1 ? 2 : 1;
      } else {
        focusedField = (focusedField + 1) % fieldCount;
      }
    }
    function prevField() {
      if (opts.urlLocked) {
        focusedField = focusedField === 1 ? 2 : 1;
      } else {
        focusedField = (focusedField - 1 + fieldCount) % fieldCount;
      }
    }
    function onData(buf) {
      const key = buf.toString("utf-8");
      if (key === "\x1B" || key === "\x03") {
        cleanup();
        resolve3(null);
        return;
      }
      if (key === "\t") {
        nextField();
        render();
        return;
      }
      if (key === "\x1B[Z") {
        prevField();
        render();
        return;
      }
      if (key === "\r" || key === `
`) {
        if (focusedField === 2) {
          if (!url.trim() || url.trim() === "ws://") {
            status = "请输入远程地址";
            statusIsError = true;
            render();
            return;
          }
          if (!token.trim()) {
            status = "请输入 Token";
            statusIsError = true;
            render();
            return;
          }
          cleanup();
          resolve3({ url: url.trim(), token: token.trim() });
          return;
        }
        nextField();
        render();
        return;
      }
      if (key === "" || key === "\b") {
        if (focusedField === 0 && !opts.urlLocked && url.length > 0)
          url = url.slice(0, -1);
        else if (focusedField === 1 && token.length > 0)
          token = token.slice(0, -1);
        status = "";
        render();
        return;
      }
      if (key === "\x1B[A") {
        prevField();
        render();
        return;
      }
      if (key === "\x1B[B") {
        nextField();
        render();
        return;
      }
      if (key.length === 1 && key >= " ") {
        if (focusedField === 0 && !opts.urlLocked)
          url += key;
        else if (focusedField === 1)
          token += key;
        status = "";
        render();
        return;
      }
    }
    stdin.on("data", onData);
    render();
  });
}
function showSavePrompt() {
  return new Promise((resolve3) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let name = "";
    let status = "";
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode)
      stdin.setRawMode(true);
    stdin.resume();
    function render() {
      const lines = [];
      lines.push("");
      lines.push(`  ${ansi.green}${ansi.bold}${ICONS.checkmark} 已连接到远程 Iris${ansi.reset}`);
      lines.push("");
      lines.push(`  ${ansi.dim}保存此连接？输入名称后回车保存，Esc 跳过${ansi.reset}`);
      lines.push("");
      lines.push(`  ${ansi.cyan}${ansi.bold}名称${ansi.reset} ${name}${ansi.cyan}|${ansi.reset}`);
      lines.push("");
      if (status) {
        lines.push(`  ${ansi.red}${status}${ansi.reset}`);
        lines.push("");
      }
      stdout.write(ansi.clear + ansi.hideCursor + lines.join(`
`));
    }
    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.setRawMode)
        stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }
    function onData(buf) {
      const key = buf.toString("utf-8");
      if (key === "\x1B" || key === "\x03") {
        cleanup();
        resolve3(null);
        return;
      }
      if (key === "\r" || key === `
`) {
        const trimmed = name.trim();
        if (!trimmed) {
          status = "请输入连接名称";
          render();
          return;
        }
        if (!/^[\w-]+$/.test(trimmed)) {
          status = "名称只能包含字母、数字、-、_";
          render();
          return;
        }
        cleanup();
        resolve3(trimmed);
        return;
      }
      if (key === "" || key === "\b") {
        if (name.length > 0)
          name = name.slice(0, -1);
        status = "";
        render();
        return;
      }
      if (key.length === 1 && key >= " ") {
        name += key;
        status = "";
        render();
        return;
      }
    }
    stdin.on("data", onData);
    render();
  });
}
async function showRemoteConnectWizard(options) {
  const hasListItems = options.saved.length > 0 || options.discoveryPromise;
  if (!hasListItems) {
    const input2 = await showInputPhase();
    if (!input2)
      return null;
    return { url: input2.url, token: input2.token, source: "manual" };
  }
  const selection = await showSelectionPhase(options);
  if (!selection)
    return null;
  if (selection.action === "connect-saved") {
    if (selection.hasToken) {
      return { url: selection.url, token: "", source: "saved", savedName: selection.name };
    }
    const input2 = await showInputPhase({ prefillUrl: selection.url, urlLocked: true });
    if (!input2)
      return null;
    return { url: input2.url, token: input2.token, source: "saved", savedName: selection.name };
  }
  if (selection.action === "connect-discovered") {
    const url = `ws://${selection.host}:${selection.port}`;
    const input2 = await showInputPhase({ prefillUrl: url, urlLocked: true });
    if (!input2)
      return null;
    return { url: input2.url, token: input2.token, source: "discovered" };
  }
  const input = await showInputPhase();
  if (!input)
    return null;
  return { url: input.url, token: input.token, source: "manual" };
}
function showConnectingStatus(url) {
  process.stdout.write(ansi.clear + `
  ${ansi.cyan}正在连接到 ${url}...${ansi.reset}
`);
}
function showConnectSuccess(agentName, modelName) {
  process.stdout.write(`  ${ansi.green}已连接到远程 Iris (agent=${agentName}, model=${modelName})${ansi.reset}
`);
}
function showConnectError(error) {
  process.stdout.write(`  ${ansi.red}连接失败: ${error}${ansi.reset}
`);
}
var ESC = "\x1B", CSI, ansi;
var init_remote_wizard = __esm(() => {
  init_terminal_compat();
  CSI = `${ESC}[`;
  ansi = {
    clear: `${CSI}2J${CSI}H`,
    hideCursor: `${CSI}?25l`,
    showCursor: `${CSI}?25h`,
    reset: `${CSI}0m`,
    bold: `${CSI}1m`,
    dim: `${CSI}2m`,
    cyan: `${CSI}36m`,
    green: `${CSI}32m`,
    yellow: `${CSI}33m`,
    red: `${CSI}31m`,
    magenta: `${CSI}35m`,
    white: `${CSI}37m`
  };
});

// extensions/console/src/index.ts
import React10 from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

// extensions/console/node_modules/irises-extension-sdk/dist/platform.js
class BackendHandle {
  _backend;
  _listeners = new Map;
  constructor(backend) {
    this._backend = backend;
  }
  swap(newBackend) {
    for (const [event, listeners] of this._listeners) {
      for (const fn of listeners) {
        this._backend.off(event, fn);
      }
    }
    this._backend = newBackend;
    for (const [event, listeners] of this._listeners) {
      for (const fn of listeners) {
        this._backend.on(event, fn);
      }
    }
  }
  on(event, listener) {
    if (!this._listeners.has(event))
      this._listeners.set(event, new Set);
    this._listeners.get(event).add(listener);
    this._backend.on(event, listener);
    return this;
  }
  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
    this._backend.off(event, listener);
    return this;
  }
  once(event, listener) {
    const wrapper = (...args) => {
      this._listeners.get(event)?.delete(wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }
  chat(sessionId, text, images, documents, platform) {
    return this._backend.chat(sessionId, text, images, documents, platform);
  }
  isStreamEnabled() {
    return this._backend.isStreamEnabled();
  }
  clearSession(sessionId) {
    return this._backend.clearSession(sessionId);
  }
  switchModel(modelName, platform) {
    return this._backend.switchModel(modelName, platform);
  }
  listModels() {
    return this._backend.listModels();
  }
  listSessionMetas() {
    return this._backend.listSessionMetas();
  }
  abortChat(sessionId) {
    return this._backend.abortChat(sessionId);
  }
  getToolHandle(toolId) {
    return this._backend.getToolHandle(toolId);
  }
  getToolHandles(sessionId) {
    return this._backend.getToolHandles(sessionId);
  }
  undo(sessionId, scope) {
    return this._backend.undo?.(sessionId, scope) ?? Promise.resolve(null);
  }
  redo(sessionId) {
    return this._backend.redo?.(sessionId) ?? Promise.resolve(null);
  }
  listSkills() {
    return this._backend.listSkills?.() ?? [];
  }
  listModes() {
    return this._backend.listModes?.() ?? [];
  }
  switchMode(modeName) {
    return this._backend.switchMode?.(modeName) ?? false;
  }
  clearRedo(sessionId) {
    return this._backend.clearRedo?.(sessionId);
  }
  getHistory(sessionId) {
    return this._backend.getHistory?.(sessionId) ?? Promise.resolve([]);
  }
  runCommand(cmd) {
    return this._backend.runCommand?.(cmd);
  }
  summarize(sessionId) {
    return this._backend.summarize?.(sessionId) ?? Promise.resolve(undefined);
  }
  resetConfigToDefaults() {
    return this._backend.resetConfigToDefaults?.();
  }
  getToolNames() {
    return this._backend.getToolNames?.() ?? [];
  }
  getAgentTasks(sessionId) {
    return this._backend.getAgentTasks?.(sessionId) ?? [];
  }
  getRunningAgentTasks(sessionId) {
    return this._backend.getRunningAgentTasks?.(sessionId) ?? [];
  }
  getAgentTask(taskId) {
    return this._backend.getAgentTask?.(taskId);
  }
  getToolPolicies() {
    return this._backend.getToolPolicies?.();
  }
  getCurrentModelInfo() {
    return this._backend.getCurrentModelInfo?.();
  }
  getDisabledTools() {
    return this._backend.getDisabledTools?.();
  }
  getActiveSessionId() {
    return this._backend.getActiveSessionId?.();
  }
}
class PlatformAdapter {
  get name() {
    return this.constructor.name;
  }
}
// extensions/console/node_modules/irises-extension-sdk/dist/logger.js
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
var _logLevel = LogLevel.INFO;
// extensions/console/node_modules/tokenx/dist/index.mjs
var PATTERNS = {
  whitespace: /^\s+$/,
  cjk: /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF\u30A0-\u30FF\u2E80-\u2EFF\u31C0-\u31EF\u3200-\u32FF\u3300-\u33FF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/,
  numeric: /^\d+(?:[.,]\d+)*$/,
  punctuation: /[.,!?;(){}[\]<>:/\\|@#$%^&*+=`~_-]/,
  alphanumeric: /^[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]+$/
};
var TOKEN_SPLIT_PATTERN = /* @__PURE__ */ new RegExp(`(\\s+|${PATTERNS.punctuation.source}+)`);
var DEFAULT_CHARS_PER_TOKEN = 6;
var SHORT_TOKEN_THRESHOLD = 3;
var DEFAULT_LANGUAGE_CONFIGS = [
  {
    pattern: /[äöüßẞ]/i,
    averageCharsPerToken: 3
  },
  {
    pattern: /[éèêëàâîïôûùüÿçœæáíóúñ]/i,
    averageCharsPerToken: 3
  },
  {
    pattern: /[ąćęłńóśźżěščřžýůúďťň]/i,
    averageCharsPerToken: 3.5
  }
];
function estimateTokenCount(text, options = {}) {
  if (!text)
    return 0;
  const { defaultCharsPerToken = DEFAULT_CHARS_PER_TOKEN, languageConfigs = DEFAULT_LANGUAGE_CONFIGS } = options;
  const segments = text.split(TOKEN_SPLIT_PATTERN).filter(Boolean);
  let tokenCount = 0;
  for (const segment of segments)
    tokenCount += estimateSegmentTokens(segment, languageConfigs, defaultCharsPerToken);
  return tokenCount;
}
function estimateSegmentTokens(segment, languageConfigs, defaultCharsPerToken) {
  if (PATTERNS.whitespace.test(segment))
    return 0;
  if (PATTERNS.cjk.test(segment))
    return getCharacterCount(segment);
  if (PATTERNS.numeric.test(segment))
    return 1;
  if (segment.length <= SHORT_TOKEN_THRESHOLD)
    return 1;
  if (PATTERNS.punctuation.test(segment))
    return segment.length > 1 ? Math.ceil(segment.length / 2) : 1;
  if (PATTERNS.alphanumeric.test(segment)) {
    const charsPerToken$1 = getLanguageSpecificCharsPerToken(segment, languageConfigs) ?? defaultCharsPerToken;
    return Math.ceil(segment.length / charsPerToken$1);
  }
  const charsPerToken = getLanguageSpecificCharsPerToken(segment, languageConfigs) ?? defaultCharsPerToken;
  return Math.ceil(segment.length / charsPerToken);
}
function getLanguageSpecificCharsPerToken(segment, languageConfigs) {
  for (const config of languageConfigs)
    if (config.pattern.test(segment))
      return config.averageCharsPerToken;
}
function getCharacterCount(text) {
  return Array.from(text).length;
}

// extensions/console/src/App.tsx
import { useCallback as useCallback11, useEffect as useEffect11, useRef as useRef9, useState as useState14 } from "react";
import { useRenderer } from "@opentui/react";

// extensions/console/src/theme.ts
var C = {
  primary: "#6c5ce7",
  primaryLight: "#a29bfe",
  accent: "#00b894",
  warn: "#fdcb6e",
  error: "#d63031",
  text: "#dfe6e9",
  textSec: "#b2bec3",
  dim: "#636e72",
  cursorFg: "#1e1e1e",
  border: "#636e72",
  borderActive: "#00b894",
  borderFilled: "#6c5ce7",
  heading: {
    1: "#fdcb6e",
    2: "#a29bfe",
    3: "#00b894",
    4: "#dfe6e9"
  },
  roleUser: "#00b894",
  roleAssistant: "#6c5ce7",
  toolPendingBg: "#1a2228",
  toolSuccessBg: "#1a2520",
  toolErrorBg: "#281a1a",
  toolWarnBg: "#28251a",
  panelBg: "#1e2228",
  thinkingBg: "#1a2228",
  command: "#00cec9"
};

// extensions/console/src/components/ApprovalBar.tsx
init_terminal_compat();
import { jsxDEV, Fragment } from "@opentui/react/jsx-dev-runtime";
function ApprovalBar({ toolName, choice, remainingCount, isCommandTool, approvalPage = "basic" }) {
  const showPolicyPage = isCommandTool && approvalPage === "policy";
  const borderColor = showPolicyPage ? C.command : choice === "approve" ? C.accent : C.error;
  return /* @__PURE__ */ jsxDEV("box", {
    flexDirection: "column",
    borderStyle: "single",
    borderColor,
    paddingLeft: 1,
    paddingRight: 1,
    paddingY: 0,
    children: /* @__PURE__ */ jsxDEV("text", {
      children: [
        /* @__PURE__ */ jsxDEV("span", {
          fg: C.warn,
          children: /* @__PURE__ */ jsxDEV("strong", {
            children: "? "
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV("span", {
          fg: C.text,
          children: showPolicyPage ? "记住选择 " : "确认执行 "
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV("span", {
          fg: C.warn,
          children: /* @__PURE__ */ jsxDEV("strong", {
            children: toolName
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV("span", {
          fg: C.dim,
          children: "  "
        }, undefined, false, undefined, this),
        showPolicyPage ? /* @__PURE__ */ jsxDEV(Fragment, {
          children: [
            /* @__PURE__ */ jsxDEV("span", {
              fg: choice === "approve" ? C.command : C.textSec,
              children: choice === "approve" ? "[(A)始终允许]" : " (A)始终允许 "
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("span", {
              fg: C.dim,
              children: " "
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("span", {
              fg: choice === "reject" ? "#e17055" : C.textSec,
              children: choice === "reject" ? "[(S)始终询问]" : " (S)始终询问 "
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV(Fragment, {
          children: [
            /* @__PURE__ */ jsxDEV("span", {
              fg: choice === "approve" ? C.accent : C.textSec,
              children: choice === "approve" ? "[(Y)批准]" : " (Y)批准 "
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("span", {
              fg: C.dim,
              children: " "
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("span", {
              fg: choice === "reject" ? C.error : C.textSec,
              children: choice === "reject" ? "[(N)拒绝]" : " (N)拒绝 "
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        remainingCount > 1 ? /* @__PURE__ */ jsxDEV("span", {
          fg: C.dim,
          children: `  (剩余 ${remainingCount - 1} 个)`
        }, undefined, false, undefined, this) : null,
        isCommandTool ? /* @__PURE__ */ jsxDEV("span", {
          fg: C.dim,
          children: showPolicyPage ? `  Tab${ICONS.arrowRight}返回` : `  Tab${ICONS.arrowRight}更多`
        }, undefined, false, undefined, this) : null
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/components/ConfirmBar.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV2 } from "@opentui/react/jsx-dev-runtime";
function ConfirmBar({ message, choice }) {
  return /* @__PURE__ */ jsxDEV2("box", {
    flexDirection: "column",
    borderStyle: "single",
    borderColor: choice === "confirm" ? C.warn : C.dim,
    paddingLeft: 1,
    paddingRight: 1,
    paddingY: 0,
    children: [
      /* @__PURE__ */ jsxDEV2("text", {
        children: [
          /* @__PURE__ */ jsxDEV2("span", {
            fg: C.error,
            children: /* @__PURE__ */ jsxDEV2("strong", {
              children: [
                ICONS.warning,
                " "
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("span", {
            fg: C.text,
            children: message
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV2("text", {
        children: [
          /* @__PURE__ */ jsxDEV2("span", {
            fg: C.dim,
            children: "  "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("span", {
            fg: choice === "confirm" ? C.warn : C.textSec,
            children: choice === "confirm" ? "[(Y)确认]" : " (Y)确认 "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("span", {
            fg: C.dim,
            children: " "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("span", {
            fg: choice === "cancel" ? C.accent : C.textSec,
            children: choice === "cancel" ? "[(N)取消]" : " (N)取消 "
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/text-layout.ts
var IS_CJK_LOCALE = (() => {
  const lang = (process.env.LANG || process.env.LC_ALL || process.env.LC_CTYPE || "").toLowerCase();
  return /^(zh|ja|ko|zh_|ja_|ko_)/.test(lang) || lang.includes(".gb") || lang.includes(".euc") || lang.includes(".big5") || lang.includes(".shift");
})();
var graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function splitGraphemes(text) {
  if (!text)
    return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}
function isWideCodePoint(codePoint) {
  return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || IS_CJK_LOCALE && codePoint >= 9600 && codePoint <= 9631 || IS_CJK_LOCALE && codePoint >= 9632 && codePoint <= 9727 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510 || codePoint >= 127744 && codePoint <= 129791 || codePoint >= 131072 && codePoint <= 262141);
}
function getGraphemeWidth(grapheme) {
  if (!grapheme)
    return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme))
    return 2;
  let width = 0;
  for (const symbol of Array.from(grapheme)) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }
  return width || 1;
}
function getTextWidth(text) {
  return splitGraphemes(text).reduce((total, grapheme) => total + getGraphemeWidth(grapheme), 0);
}

// extensions/console/src/components/HintBar.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV3, Fragment as Fragment2 } from "@opentui/react/jsx-dev-runtime";
function truncatePath(fullPath, maxWidth) {
  if (maxWidth <= 0)
    return "";
  if (getTextWidth(fullPath) <= maxWidth)
    return fullPath;
  const sep = fullPath.includes("\\") ? "\\" : "/";
  const parts = fullPath.split(sep).filter(Boolean);
  const prefix = /^[\/\\]/.test(fullPath) ? sep : "";
  if (parts.length <= 1)
    return hardTruncate(fullPath, maxWidth);
  const head = parts[0];
  for (let n = Math.min(parts.length - 1, 3);n >= 1; n--) {
    const tail = parts.slice(-n).join(sep);
    const truncated = `${prefix}${head}${sep}${ICONS.ellipsis}${sep}${tail}`;
    if (getTextWidth(truncated) <= maxWidth)
      return truncated;
  }
  const minimal = `${ICONS.ellipsis}${sep}${parts[parts.length - 1]}`;
  if (getTextWidth(minimal) <= maxWidth)
    return minimal;
  return hardTruncate(fullPath, maxWidth);
}
function hardTruncate(text, maxWidth) {
  if (maxWidth <= 1)
    return ICONS.ellipsis;
  let result = "";
  let width = 0;
  for (const ch of text) {
    const cw = getTextWidth(ch);
    if (width + cw > maxWidth - 1)
      break;
    result += ch;
    width += cw;
  }
  return result + ICONS.ellipsis;
}
function HintBar({ isGenerating, queueSize, copyMode, exitConfirmArmed, remoteHost }) {
  const cwd = process.cwd();
  const hasQueue = (queueSize ?? 0) > 0;
  let hintStr;
  if (exitConfirmArmed) {
    hintStr = "再次按 ctrl+c 退出";
  } else {
    const parts = [];
    parts.push(isGenerating ? "esc 中断生成" : "ctrl+j 换行");
    parts.push("ctrl+t 工具详情");
    if (isGenerating && hasQueue) {
      parts.push("/queue 管理队列");
    }
    parts.push(isGenerating ? "ctrl+s 立即发送" : copyMode ? "f6 返回滚动模式" : "f6 复制模式");
    hintStr = parts.join(`  ${ICONS.separator}  `);
  }
  const hintWidth = getTextWidth(hintStr);
  const termWidth = process.stdout.columns || 80;
  const usableWidth = termWidth - 3;
  const gap = 3;
  const availableForCwd = usableWidth - hintWidth - gap;
  const displayCwd = truncatePath(cwd, Math.max(availableForCwd, 20));
  return /* @__PURE__ */ jsxDEV3("box", {
    flexDirection: "row",
    paddingTop: 0,
    paddingRight: 1,
    children: [
      /* @__PURE__ */ jsxDEV3("box", {
        flexGrow: 1,
        flexShrink: 1,
        children: remoteHost ? /* @__PURE__ */ jsxDEV3("text", {
          fg: C.warn,
          children: [
            ICONS.lightning,
            " 远程模式 ",
            ICONS.emDash,
            " 所有操作和配置均作用于 ",
            remoteHost
          ]
        }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV3("text", {
          fg: C.dim,
          children: displayCwd
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      exitConfirmArmed ? /* @__PURE__ */ jsxDEV3("box", {
        flexShrink: 0,
        children: /* @__PURE__ */ jsxDEV3("text", {
          fg: C.warn,
          children: "再次按 ctrl+c 退出"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV3("box", {
        flexShrink: 0,
        children: /* @__PURE__ */ jsxDEV3("text", {
          fg: C.dim,
          children: [
            isGenerating ? "esc 中断生成" : "ctrl+j 换行",
            `  ${ICONS.separator}  ctrl+t 工具详情`,
            isGenerating && hasQueue ? /* @__PURE__ */ jsxDEV3(Fragment2, {
              children: [
                `  ${ICONS.separator}  `,
                /* @__PURE__ */ jsxDEV3("span", {
                  fg: C.warn,
                  children: "/queue 管理队列"
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this) : null,
            `  ${ICONS.separator}  `,
            isGenerating ? "ctrl+s 立即发送" : copyMode ? "f6 返回滚动模式" : "f6 复制模式"
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/InputBar.tsx
import { useEffect as useEffect3, useMemo, useRef as useRef2, useState as useState3 } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

// extensions/console/src/input-commands.ts
var COMMANDS = [
  { name: "/new", description: "新建对话" },
  { name: "/load", description: "加载历史对话" },
  { name: "/undo", description: "撤销最后一条消息" },
  { name: "/redo", description: "恢复上一次撤销" },
  { name: "/model", description: "查看或切换当前模型" },
  { name: "/settings", description: "打开设置中心（LLM / System / Tools / MCP）" },
  { name: "/mcp", description: "直接打开 MCP 管理区" },
  { name: "/sh", description: "执行命令（如 cd、dir、git 等）" },
  { name: "/reset-config", description: "重置配置为默认值" },
  { name: "/compact", description: "压缩上下文（总结历史消息）" },
  { name: "/net", description: "配置多端互联（Net）" },
  { name: "/remote", description: "连接远程 Iris 实例" },
  { name: "/disconnect", description: "断开远程连接", remoteOnly: true, color: "#fdcb6e" },
  { name: "/agent", description: "切换 Agent（多 Agent 模式）" },
  { name: "/memory", description: "查看长期记忆" },
  { name: "/extension", description: "管理扩展插件（查看/启用/禁用）" },
  { name: "/dream", description: "整理长期记忆（合并冗余、清理过时）" },
  { name: "/queue", description: "查看/管理排队消息" },
  { name: "/exit", description: "退出应用" }
];
function getCommandInput(cmd) {
  return cmd.name === "/sh" || cmd.name === "/model" || cmd.name === "/remote" ? `${cmd.name} ` : cmd.name;
}
function isExactCommandValue(value, cmd) {
  return value === cmd.name || value === getCommandInput(cmd);
}

// extensions/console/src/hooks/use-text-input.ts
import { useState, useCallback } from "react";
function wordBoundaryLeft(text, pos) {
  if (pos <= 0)
    return 0;
  let i = pos - 1;
  while (i > 0 && !/[a-zA-Z0-9_\-.]/.test(text[i]))
    i--;
  while (i > 0 && /[a-zA-Z0-9_\-.]/.test(text[i - 1]))
    i--;
  return i;
}
function wordBoundaryRight(text, pos) {
  const len = text.length;
  if (pos >= len)
    return len;
  let i = pos;
  while (i < len && /[a-zA-Z0-9_\-.]/.test(text[i]))
    i++;
  while (i < len && !/[a-zA-Z0-9_\-.]/.test(text[i]))
    i++;
  return i;
}
function useTextInput(initialValue = "") {
  const [state, setState] = useState({
    value: initialValue,
    cursor: initialValue.length
  });
  const handleKey = useCallback((key) => {
    setState((s) => {
      const { value, cursor } = s;
      if (key.name === "left" && !key.ctrl && !key.meta) {
        return { value, cursor: Math.max(0, cursor - 1) };
      }
      if (key.name === "right" && !key.ctrl && !key.meta) {
        return { value, cursor: Math.min(value.length, cursor + 1) };
      }
      if (key.name === "left" && (key.ctrl || key.meta)) {
        return { value, cursor: wordBoundaryLeft(value, cursor) };
      }
      if (key.name === "right" && (key.ctrl || key.meta)) {
        return { value, cursor: wordBoundaryRight(value, cursor) };
      }
      if (key.name === "home" || key.name === "a" && key.ctrl) {
        return { value, cursor: 0 };
      }
      if (key.name === "end" || key.name === "e" && key.ctrl) {
        return { value, cursor: value.length };
      }
      if (key.name === "backspace") {
        if (cursor === 0)
          return s;
        if (key.ctrl || key.meta) {
          const to = wordBoundaryLeft(value, cursor);
          return { value: value.slice(0, to) + value.slice(cursor), cursor: to };
        }
        return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
      }
      if (key.name === "delete" || key.name === "d" && key.ctrl) {
        if (cursor >= value.length)
          return s;
        return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
      }
      if (key.name === "u" && key.ctrl) {
        return { value: value.slice(cursor), cursor: 0 };
      }
      if (key.name === "k" && key.ctrl) {
        return { value: value.slice(0, cursor), cursor };
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        return { value: value.slice(0, cursor) + key.sequence + value.slice(cursor), cursor: cursor + 1 };
      }
      return s;
    });
    if (key.name === "left" || key.name === "right" || key.name === "home" || key.name === "end")
      return true;
    if (key.name === "backspace" || key.name === "delete")
      return true;
    if (["a", "e", "u", "k", "d"].includes(key.name) && key.ctrl)
      return true;
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta)
      return true;
    return false;
  }, []);
  const insert = useCallback((text) => {
    setState((s) => ({
      value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor),
      cursor: s.cursor + text.length
    }));
  }, []);
  const setValue = useCallback((value) => {
    setState({ value, cursor: value.length });
  }, []);
  const set = useCallback((value, cursor) => {
    setState({ value, cursor: Math.min(cursor, value.length) });
  }, []);
  return [state, { handleKey, insert, setValue, set }];
}

// extensions/console/src/hooks/use-cursor-blink.ts
import { useState as useState2, useEffect } from "react";
function useCursorBlink(intervalMs = 530) {
  const [visible, setVisible] = useState2(true);
  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((v) => !v);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return visible;
}

// extensions/console/src/hooks/use-paste.ts
import { useEffect as useEffect2, useCallback as useCallback2, useLayoutEffect, useRef } from "react";
import { decodePasteBytes } from "@opentui/core";
import { useAppContext } from "@opentui/react";
function usePaste(handler) {
  const { keyHandler } = useAppContext();
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  const stableHandler = useCallback2((event) => {
    handlerRef.current(decodePasteBytes(event.bytes));
  }, []);
  useEffect2(() => {
    keyHandler?.on("paste", stableHandler);
    return () => {
      keyHandler?.off("paste", stableHandler);
    };
  }, [keyHandler, stableHandler]);
}

// extensions/console/src/components/InputDisplay.tsx
import { jsxDEV as jsxDEV4, Fragment as Fragment3 } from "@opentui/react/jsx-dev-runtime";
function InputDisplay({ value, cursor, availableWidth, isActive, cursorVisible, placeholder, transform }) {
  const display = transform ? transform(value) : value;
  if (!display && !isActive) {
    return /* @__PURE__ */ jsxDEV4("text", {
      fg: C.dim,
      children: placeholder || ""
    }, undefined, false, undefined, this);
  }
  if (!display) {
    return /* @__PURE__ */ jsxDEV4("text", {
      children: [
        cursorVisible && /* @__PURE__ */ jsxDEV4("span", {
          bg: C.accent,
          fg: C.cursorFg,
          children: " "
        }, undefined, false, undefined, this),
        !cursorVisible && /* @__PURE__ */ jsxDEV4("span", {
          fg: C.accent,
          children: " "
        }, undefined, false, undefined, this),
        placeholder && /* @__PURE__ */ jsxDEV4("span", {
          fg: C.dim,
          children: ` ${placeholder}`
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  if (!isActive) {
    return /* @__PURE__ */ jsxDEV4("text", {
      fg: C.textSec,
      children: display
    }, undefined, false, undefined, this);
  }
  const before = display.slice(0, cursor);
  const rawAt = cursor < display.length ? display[cursor] : "";
  const after = cursor < display.length ? display.slice(cursor + 1) : "";
  let overlapEnd = false;
  if (!rawAt && before.length > 0 && availableWidth && availableWidth > 0) {
    const lastChar = before[before.length - 1];
    if (lastChar !== `
`) {
      const lastNewline = before.lastIndexOf(`
`);
      const lastLine = lastNewline >= 0 ? before.slice(lastNewline + 1) : before;
      const w = getTextWidth(lastLine);
      overlapEnd = w > 0 && w % availableWidth === 0;
    }
  }
  const displayBefore = overlapEnd ? before.slice(0, -1) : before;
  const cursorChar = overlapEnd ? before[before.length - 1] : rawAt;
  const atNewline = cursorChar === `
`;
  return /* @__PURE__ */ jsxDEV4("text", {
    wrapMode: "char",
    children: [
      /* @__PURE__ */ jsxDEV4("span", {
        fg: C.text,
        children: displayBefore
      }, undefined, false, undefined, this),
      cursorChar ? atNewline ? /* @__PURE__ */ jsxDEV4(Fragment3, {
        children: [
          cursorVisible && /* @__PURE__ */ jsxDEV4("span", {
            bg: C.accent,
            fg: C.cursorFg,
            children: " "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV4("span", {
            fg: C.text,
            children: `
`
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this) : cursorVisible ? /* @__PURE__ */ jsxDEV4("span", {
        bg: C.accent,
        fg: C.cursorFg,
        children: cursorChar
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV4("span", {
        fg: C.text,
        children: cursorChar
      }, undefined, false, undefined, this) : cursorVisible ? /* @__PURE__ */ jsxDEV4("span", {
        bg: C.accent,
        fg: C.cursorFg,
        children: " "
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV4("span", {
        children: " "
      }, undefined, false, undefined, this),
      after && /* @__PURE__ */ jsxDEV4("span", {
        fg: C.text,
        children: after
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/InputBar.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV5 } from "@opentui/react/jsx-dev-runtime";
function InputBar({ disabled, isGenerating, queueSize, onSubmit, onPrioritySubmit, onCycleThinkingEffort, isRemote }) {
  const [inputState, inputActions] = useTextInput("");
  const [selectedIndex, setSelectedIndex] = useState3(0);
  const cursorVisible = useCursorBlink();
  const { width: termWidth } = useTerminalDimensions();
  const visibleCommands = useMemo(() => COMMANDS.filter((cmd) => !cmd.remoteOnly || isRemote), [isRemote]);
  const pasteGuardRef = useRef2(false);
  const lastKeyTimeRef = useRef2(0);
  const rapidKeyCountRef = useRef2(0);
  const value = inputState.value;
  const inputDisabled = disabled;
  const isQueueMode = !disabled && isGenerating;
  const exactMatchIndex = useMemo(() => {
    return visibleCommands.findIndex((cmd) => isExactCommandValue(value, cmd));
  }, [value, visibleCommands]);
  const commandQuery = useMemo(() => {
    if (inputDisabled)
      return "";
    if (!value.startsWith("/"))
      return "";
    if (/\s/.test(value) && exactMatchIndex < 0)
      return "";
    return value;
  }, [inputDisabled, value, exactMatchIndex]);
  const [commandsDismissed, setCommandsDismissed] = useState3(false);
  useEffect3(() => {
    setCommandsDismissed(false);
  }, [commandQuery]);
  const showCommands = commandQuery.length > 0 && !commandsDismissed;
  const filtered = useMemo(() => {
    if (!showCommands)
      return [];
    if (exactMatchIndex >= 0)
      return visibleCommands;
    return visibleCommands.filter((cmd) => cmd.name.startsWith(commandQuery.trim()));
  }, [showCommands, exactMatchIndex, commandQuery, visibleCommands]);
  useEffect3(() => {
    if (!showCommands || filtered.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (exactMatchIndex >= 0) {
      setSelectedIndex(exactMatchIndex);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, filtered.length - 1));
  }, [showCommands, filtered.length, exactMatchIndex]);
  const applySelection = (index) => {
    if (filtered.length === 0)
      return;
    const normalizedIndex = (index % filtered.length + filtered.length) % filtered.length;
    setSelectedIndex(normalizedIndex);
  };
  useKeyboard((key) => {
    if (inputDisabled)
      return;
    if (pasteGuardRef.current)
      return;
    const now = Date.now();
    const delta = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;
    if (delta < 15) {
      rapidKeyCountRef.current++;
    } else if (delta > 80) {
      rapidKeyCountRef.current = 0;
    }
    if (showCommands && filtered.length > 0) {
      if (key.name === "up") {
        applySelection(selectedIndex + 1);
        return;
      }
      if (key.name === "down") {
        applySelection(selectedIndex - 1);
        return;
      }
      if (key.name === "tab") {
        const current = filtered[selectedIndex];
        if (current) {
          if (isExactCommandValue(value, current)) {
            const nextIndex = ((selectedIndex - 1) % filtered.length + filtered.length) % filtered.length;
            const nextCmd = filtered[nextIndex];
            if (nextCmd) {
              inputActions.setValue(getCommandInput(nextCmd));
              applySelection(nextIndex);
            }
          } else {
            inputActions.setValue(getCommandInput(current));
          }
        }
        return;
      }
    }
    if (key.ctrl && key.name === "s") {
      if (!isQueueMode)
        return;
      const text = value.trim();
      if (!text)
        return;
      onPrioritySubmit(text);
      inputActions.setValue("");
      setSelectedIndex(0);
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      if (rapidKeyCountRef.current >= 3) {
        inputActions.insert(`
`);
        return;
      }
      let text = value.trim();
      if (showCommands && filtered.length > 0) {
        const cmd = filtered[selectedIndex];
        if (cmd)
          text = getCommandInput(cmd);
      }
      if (!text)
        return;
      onSubmit(text);
      inputActions.setValue("");
      setSelectedIndex(0);
      return;
    }
    if (key.shift && (key.name === "left" || key.name === "right")) {
      onCycleThinkingEffort(key.name === "right" ? 1 : -1);
      return;
    }
    if (key.name === "escape") {
      if (showCommands) {
        setCommandsDismissed(true);
        setSelectedIndex(0);
      }
      return;
    }
    inputActions.handleKey(key);
  });
  usePaste((text) => {
    if (inputDisabled)
      return;
    pasteGuardRef.current = true;
    const cleaned = text.replace(/\r\n/g, `
`).replace(/\r/g, `
`).trim();
    if (cleaned) {
      inputActions.insert(cleaned);
    }
    setTimeout(() => {
      pasteGuardRef.current = false;
    }, 150);
  });
  const maxLen = filtered.length > 0 ? Math.max(...filtered.map((cmd) => cmd.name.length)) : 0;
  const MAX_VISIBLE_INPUT_LINES = 8;
  const availableWidth = Math.max(1, termWidth - 9);
  const visualLineCount = useMemo(() => {
    if (!value)
      return 1;
    const lines = value.split(`
`);
    let count = 0;
    for (const line of lines) {
      const w = getTextWidth(line);
      count += w === 0 ? 1 : Math.ceil(w / availableWidth);
    }
    return count;
  }, [value, availableWidth]);
  const needsInputScroll = visualLineCount > MAX_VISIBLE_INPUT_LINES;
  const promptColor = inputDisabled ? C.dim : isQueueMode ? C.warn : C.accent;
  const promptChar = isQueueMode ? `${ICONS.hourglass} ` : `${ICONS.selectorArrow} `;
  const placeholder = isQueueMode ? `输入消息（将排队发送）${ICONS.ellipsis}` : `输入消息${ICONS.ellipsis}`;
  const inputRow = /* @__PURE__ */ jsxDEV5("box", {
    flexDirection: "row",
    border: false,
    children: [
      /* @__PURE__ */ jsxDEV5("text", {
        fg: promptColor,
        children: /* @__PURE__ */ jsxDEV5("strong", {
          children: [
            promptChar,
            " "
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV5(InputDisplay, {
        value,
        cursor: inputState.cursor,
        availableWidth,
        isActive: !inputDisabled,
        cursorVisible,
        placeholder
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
  return /* @__PURE__ */ jsxDEV5("box", {
    flexDirection: "column",
    children: [
      filtered.length > 0 && /* @__PURE__ */ jsxDEV5("box", {
        flexDirection: "column",
        backgroundColor: C.panelBg,
        paddingX: 1,
        children: [...filtered].reverse().map((cmd, _i) => {
          const index = filtered.indexOf(cmd);
          const padded = cmd.name.padEnd(maxLen);
          const isSelected = index === selectedIndex;
          return /* @__PURE__ */ jsxDEV5("box", {
            paddingLeft: 1,
            backgroundColor: isSelected ? C.border : undefined,
            children: /* @__PURE__ */ jsxDEV5("text", {
              children: [
                /* @__PURE__ */ jsxDEV5("span", {
                  fg: isSelected ? C.accent : C.dim,
                  children: isSelected ? `${ICONS.triangleRight} ` : "  "
                }, undefined, false, undefined, this),
                isSelected ? /* @__PURE__ */ jsxDEV5("strong", {
                  children: /* @__PURE__ */ jsxDEV5("span", {
                    fg: cmd.color ?? C.text,
                    children: padded
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV5("span", {
                  fg: cmd.color ?? C.textSec,
                  children: padded
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV5("span", {
                  fg: isSelected ? C.textSec : C.dim,
                  children: [
                    "  ",
                    cmd.description
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, cmd.name, false, undefined, this);
        })
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV5("scrollbox", {
        height: Math.min(visualLineCount, MAX_VISIBLE_INPUT_LINES),
        stickyScroll: true,
        stickyStart: "bottom",
        verticalScrollbarOptions: { visible: needsInputScroll },
        horizontalScrollbarOptions: { visible: false },
        children: inputRow
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/StatusBar.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV6, Fragment as Fragment4 } from "@opentui/react/jsx-dev-runtime";
function StatusBar({ agentName, modeName, modelName, contextTokens, contextWindow, queueSize, remoteHost, backgroundTaskCount, delegateTaskCount, backgroundTaskTokens, backgroundTaskSpinnerFrame }) {
  const resolvedModeName = modeName ?? "normal";
  const modeNameCapitalized = resolvedModeName.charAt(0).toUpperCase() + resolvedModeName.slice(1);
  const contextStr = contextTokens > 0 ? contextTokens.toLocaleString() : "-";
  const contextLimitStr = contextWindow ? `/${contextWindow.toLocaleString()}` : "";
  const contextPercent = contextTokens > 0 && contextWindow ? ` (${Math.round(contextTokens / contextWindow * 100)}%)` : "";
  const hasBackgroundTasks = (backgroundTaskCount ?? 0) > 0;
  const hasDelegateTasks = (delegateTaskCount ?? 0) > 0;
  const spinner = hasBackgroundTasks ? SPINNER_FRAMES[(backgroundTaskSpinnerFrame ?? 0) % SPINNER_FRAMES.length] : "";
  return /* @__PURE__ */ jsxDEV6("box", {
    flexDirection: "row",
    marginTop: 1,
    children: [
      /* @__PURE__ */ jsxDEV6("box", {
        flexGrow: 1,
        children: /* @__PURE__ */ jsxDEV6("text", {
          children: [
            remoteHost ? /* @__PURE__ */ jsxDEV6("span", {
              fg: C.warn,
              children: /* @__PURE__ */ jsxDEV6("strong", {
                children: [
                  "[远程: ",
                  remoteHost,
                  "]"
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this) : null,
            remoteHost ? /* @__PURE__ */ jsxDEV6("span", {
              fg: C.dim,
              children: [
                " ",
                ICONS.separator,
                " "
              ]
            }, undefined, true, undefined, this) : null,
            agentName ? /* @__PURE__ */ jsxDEV6("span", {
              fg: C.accent,
              children: /* @__PURE__ */ jsxDEV6("strong", {
                children: [
                  "[",
                  agentName,
                  "]"
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this) : null,
            agentName ? /* @__PURE__ */ jsxDEV6("span", {
              fg: C.dim,
              children: [
                " ",
                ICONS.separator,
                " "
              ]
            }, undefined, true, undefined, this) : null,
            /* @__PURE__ */ jsxDEV6("span", {
              fg: C.primaryLight,
              children: /* @__PURE__ */ jsxDEV6("strong", {
                children: modeNameCapitalized
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV6("span", {
              fg: C.dim,
              children: [
                " ",
                ICONS.separator,
                " "
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ jsxDEV6("span", {
              fg: C.textSec,
              children: modelName
            }, undefined, false, undefined, this),
            queueSize != null && queueSize > 0 ? /* @__PURE__ */ jsxDEV6(Fragment4, {
              children: [
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.dim,
                  children: [
                    " ",
                    ICONS.separator,
                    " "
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.warn,
                  children: [
                    queueSize,
                    " 条排队中"
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this) : null,
            hasBackgroundTasks ? /* @__PURE__ */ jsxDEV6(Fragment4, {
              children: [
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.dim,
                  children: [
                    " ",
                    ICONS.separator,
                    " "
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.accent,
                  children: [
                    spinner,
                    " ",
                    backgroundTaskCount,
                    " 个后台任务",
                    backgroundTaskTokens != null && backgroundTaskTokens > 0 ? ` ${ICONS.upArrow}${backgroundTaskTokens.toLocaleString()}tk` : ""
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this) : null,
            hasDelegateTasks ? /* @__PURE__ */ jsxDEV6(Fragment4, {
              children: [
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.dim,
                  children: [
                    " ",
                    ICONS.separator,
                    " "
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.warn,
                  children: [
                    ICONS.delegateArrow,
                    " ",
                    delegateTaskCount,
                    " 个委派任务"
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this) : null
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6("box", {
        flexShrink: 0,
        children: /* @__PURE__ */ jsxDEV6("text", {
          fg: C.dim,
          children: [
            "ctx ",
            contextStr,
            contextLimitStr,
            contextPercent
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/ThinkingIndicator.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV7 } from "@opentui/react/jsx-dev-runtime";
var BLOCK_COUNT = 4;
var FILL_MAP = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  max: 4
};
var FILLED_CHAR = ICONS.thinkingFilled;
var DIM_CHAR = ICONS.thinkingDim;
function ThinkingIndicator({ level, showHint, isRemote }) {
  const filled = FILL_MAP[level];
  const isDisabled = level === "none";
  const blocks = [];
  for (let i = 0;i < BLOCK_COUNT; i++) {
    const isFilled = i < filled;
    blocks.push(/* @__PURE__ */ jsxDEV7("span", {
      fg: isFilled ? C.accent : C.dim,
      children: isFilled ? FILLED_CHAR : DIM_CHAR
    }, i, false, undefined, this));
  }
  return /* @__PURE__ */ jsxDEV7("box", {
    flexDirection: "row",
    children: [
      /* @__PURE__ */ jsxDEV7("box", {
        flexGrow: 1,
        children: /* @__PURE__ */ jsxDEV7("text", {
          children: [
            blocks,
            /* @__PURE__ */ jsxDEV7("span", {
              fg: isDisabled ? C.dim : C.accent,
              children: [
                " ",
                isDisabled ? "thinking off" : level
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      isRemote ? /* @__PURE__ */ jsxDEV7("box", {
        flexShrink: 0,
        children: /* @__PURE__ */ jsxDEV7("text", {
          fg: C.dim,
          children: "输入 /disconnect 断开远程连接"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : null,
      showHint ? /* @__PURE__ */ jsxDEV7("box", {
        flexShrink: 0,
        children: /* @__PURE__ */ jsxDEV7("text", {
          fg: C.dim,
          children: `shift+${ICONS.arrowLeft}/${ICONS.arrowRight} 调整思考强度`
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/BottomPanel.tsx
import { jsxDEV as jsxDEV8 } from "@opentui/react/jsx-dev-runtime";
function BottomPanel({
  hasMessages,
  pendingConfirm,
  confirmChoice,
  pendingApprovals,
  approvalChoice,
  approvalPage,
  isGenerating,
  queueSize,
  onSubmit,
  onPrioritySubmit,
  agentName,
  modeName,
  modelName,
  contextTokens,
  contextWindow,
  copyMode,
  exitConfirmArmed,
  backgroundTaskCount,
  delegateTaskCount,
  backgroundTaskTokens,
  backgroundTaskSpinnerFrame,
  thinkingEffort,
  onCycleThinkingEffort,
  remoteHost,
  isRemote
}) {
  const inputDisabled = !!(pendingConfirm || pendingApprovals.length > 0);
  return /* @__PURE__ */ jsxDEV8("box", {
    flexDirection: "column",
    flexShrink: 0,
    paddingX: 1,
    paddingBottom: 1,
    paddingTop: hasMessages ? 1 : 0,
    children: [
      pendingConfirm ? /* @__PURE__ */ jsxDEV8(ConfirmBar, {
        message: pendingConfirm.message,
        choice: confirmChoice
      }, undefined, false, undefined, this) : pendingApprovals.length > 0 ? /* @__PURE__ */ jsxDEV8(ApprovalBar, {
        toolName: pendingApprovals[0].toolName,
        choice: approvalChoice,
        remainingCount: pendingApprovals.length,
        isCommandTool: pendingApprovals[0].toolName === "shell" || pendingApprovals[0].toolName === "bash",
        approvalPage
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV8("box", {
        flexDirection: "column",
        borderStyle: "single",
        borderColor: isGenerating ? C.warn : C.border,
        paddingX: 1,
        paddingTop: 0,
        paddingBottom: 0,
        children: [
          /* @__PURE__ */ jsxDEV8(ThinkingIndicator, {
            level: thinkingEffort,
            showHint: !hasMessages,
            isRemote
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV8(InputBar, {
            disabled: inputDisabled,
            isGenerating,
            queueSize,
            onSubmit,
            onPrioritySubmit,
            onCycleThinkingEffort,
            isRemote
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV8(StatusBar, {
            agentName,
            modeName,
            modelName,
            contextTokens,
            contextWindow,
            queueSize,
            remoteHost,
            backgroundTaskCount,
            delegateTaskCount,
            backgroundTaskTokens,
            backgroundTaskSpinnerFrame
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV8(HintBar, {
        isGenerating,
        queueSize,
        copyMode,
        exitConfirmArmed,
        remoteHost
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/AgentListView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV9 } from "@opentui/react/jsx-dev-runtime";
function AgentListView({ agents, selectedIndex, currentAgentName }) {
  return /* @__PURE__ */ jsxDEV9("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV9("box", {
        padding: 1,
        children: [
          /* @__PURE__ */ jsxDEV9("text", {
            fg: C.primary,
            children: "切换 Agent"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV9("text", {
            fg: C.dim,
            children: `  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 切换  Esc 返回`
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV9("scrollbox", {
        flexGrow: 1,
        children: [
          agents.length === 0 && /* @__PURE__ */ jsxDEV9("text", {
            fg: C.dim,
            paddingLeft: 2,
            children: "暂无可用 Agent"
          }, undefined, false, undefined, this),
          agents.map((agent, index) => {
            const isSelected = index === selectedIndex;
            const isCurrent = agent.name === currentAgentName;
            const currentMarker = isCurrent ? ICONS.bullet : " ";
            return /* @__PURE__ */ jsxDEV9("box", {
              paddingLeft: 1,
              children: /* @__PURE__ */ jsxDEV9("text", {
                children: [
                  /* @__PURE__ */ jsxDEV9("span", {
                    fg: isSelected ? C.accent : C.dim,
                    children: isSelected ? `${ICONS.selectorArrow} ` : "  "
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV9("span", {
                    fg: isCurrent ? C.accent : C.dim,
                    children: [
                      currentMarker,
                      " "
                    ]
                  }, undefined, true, undefined, this),
                  isSelected ? /* @__PURE__ */ jsxDEV9("strong", {
                    children: /* @__PURE__ */ jsxDEV9("span", {
                      fg: C.text,
                      children: agent.name
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV9("span", {
                    fg: C.textSec,
                    children: agent.name
                  }, undefined, false, undefined, this),
                  agent.description ? /* @__PURE__ */ jsxDEV9("span", {
                    fg: C.dim,
                    children: [
                      "  ",
                      agent.description
                    ]
                  }, undefined, true, undefined, this) : null
                ]
              }, undefined, true, undefined, this)
            }, agent.name, false, undefined, this);
          })
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/GeneratingTimer.tsx
import { useState as useState5, useEffect as useEffect5, useRef as useRef4 } from "react";

// extensions/console/src/components/Spinner.tsx
import { useState as useState4, useEffect as useEffect4, useRef as useRef3 } from "react";
init_terminal_compat();
import { jsxDEV as jsxDEV10 } from "@opentui/react/jsx-dev-runtime";
var INTERVAL = 80;
function Spinner() {
  const [frame, setFrame] = useState4(0);
  const mountedRef = useRef3(true);
  useEffect4(() => {
    const timer = setInterval(() => {
      if (mountedRef.current) {
        setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      }
    }, INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);
  return /* @__PURE__ */ jsxDEV10("span", {
    fg: C.accent,
    children: SPINNER_FRAMES[frame]
  }, undefined, false, undefined, this);
}

// extensions/console/src/components/GeneratingTimer.tsx
import { jsxDEV as jsxDEV11 } from "@opentui/react/jsx-dev-runtime";
function GeneratingTimer({ isGenerating, retryInfo, label, paused }) {
  const [time, setTime] = useState5(0);
  const timerRef = useRef4(null);
  const active = isGenerating && !paused;
  useEffect5(() => {
    if (isGenerating) {
      setTime(0);
    }
  }, [isGenerating]);
  useEffect5(() => {
    if (active) {
      timerRef.current = setInterval(() => {
        setTime((t) => +(t + 0.1).toFixed(1));
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active]);
  if (!isGenerating)
    return null;
  if (retryInfo) {
    const briefError = (retryInfo.error || "").split(`
`)[0].slice(0, 60);
    return /* @__PURE__ */ jsxDEV11("box", {
      flexDirection: "column",
      children: [
        /* @__PURE__ */ jsxDEV11("text", {
          children: [
            /* @__PURE__ */ jsxDEV11(Spinner, {}, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV11("span", {
              fg: C.warn,
              children: /* @__PURE__ */ jsxDEV11("em", {
                children: ` retrying (${retryInfo.attempt}/${retryInfo.maxRetries})... (${time}s)`
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV11("text", {
          fg: C.dim,
          children: `  └ ${briefError}`
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV11("text", {
    children: [
      /* @__PURE__ */ jsxDEV11(Spinner, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV11("span", {
        fg: C.dim,
        children: /* @__PURE__ */ jsxDEV11("em", {
          children: ` ${label ?? "generating..."} (${time}s)`
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/MessageItem.tsx
import React5, { useEffect as useEffect6, useRef as useRef5, useState as useState6 } from "react";
import { useTerminalDimensions as useTerminalDimensions2 } from "@opentui/react";

// extensions/console/src/components/MarkdownText.tsx
import { useMemo as useMemo2 } from "react";
import { SyntaxStyle, parseColor } from "@opentui/core";
import { jsxDEV as jsxDEV12 } from "@opentui/react/jsx-dev-runtime";
function createSyntaxStyle() {
  return SyntaxStyle.fromStyles({
    default: { fg: parseColor(C.text) },
    conceal: { fg: parseColor(C.dim) },
    "markup.heading": { fg: parseColor(C.heading[1]), bold: true },
    "markup.heading.1": { fg: parseColor(C.heading[1]), bold: true },
    "markup.heading.2": { fg: parseColor(C.heading[2]), bold: true },
    "markup.heading.3": { fg: parseColor(C.heading[3]), bold: true },
    "markup.heading.4": { fg: parseColor(C.heading[4]), bold: true },
    "markup.strong": { fg: parseColor(C.text), bold: true },
    "markup.italic": { fg: parseColor(C.text), italic: true },
    "markup.strikethrough": { fg: parseColor(C.dim) },
    "markup.raw": { fg: parseColor(C.accent) },
    "markup.link": { fg: parseColor(C.primaryLight), underline: true },
    "markup.link.url": { fg: parseColor(C.dim) },
    "markup.link.label": { fg: parseColor(C.primaryLight) },
    "markup.list": { fg: parseColor(C.accent) },
    keyword: { fg: parseColor("#c792ea"), bold: true },
    "keyword.import": { fg: parseColor("#c792ea"), bold: true },
    string: { fg: parseColor("#ecc48d") },
    comment: { fg: parseColor(C.dim), italic: true },
    number: { fg: parseColor("#f78c6c") },
    boolean: { fg: parseColor("#ff5370") },
    constant: { fg: parseColor("#f78c6c") },
    function: { fg: parseColor("#82aaff") },
    "function.call": { fg: parseColor("#82aaff") },
    constructor: { fg: parseColor("#ffcb6b") },
    type: { fg: parseColor("#ffcb6b") },
    operator: { fg: parseColor("#89ddff") },
    variable: { fg: parseColor(C.text) },
    property: { fg: parseColor("#f07178") },
    bracket: { fg: parseColor(C.textSec) },
    punctuation: { fg: parseColor(C.textSec) }
  });
}
var TABLE_OPTIONS = {
  widthMode: "content",
  columnFitter: "balanced",
  wrapMode: "word"
};
function MarkdownText({ text, showCursor }) {
  const syntaxStyle = useMemo2(() => createSyntaxStyle(), []);
  if (!text) {
    return showCursor ? /* @__PURE__ */ jsxDEV12("text", {
      children: /* @__PURE__ */ jsxDEV12("span", {
        bg: C.accent,
        children: " "
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this) : null;
  }
  return /* @__PURE__ */ jsxDEV12("markdown", {
    content: text,
    syntaxStyle,
    streaming: showCursor,
    tableOptions: TABLE_OPTIONS
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/default.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV13 } from "@opentui/react/jsx-dev-runtime";
function DefaultRenderer({ result }) {
  const text = typeof result === "string" ? result.replace(/\n/g, " ") : JSON.stringify(result).replace(/\n/g, " ");
  const truncated = text.length > 80 ? text.slice(0, 80) + "..." : text;
  return /* @__PURE__ */ jsxDEV13("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV13("em", {
      children: [
        " ",
        ICONS.resultArrow,
        " ",
        truncated
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/shell.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV14 } from "@opentui/react/jsx-dev-runtime";
function lineCount(text) {
  if (!text)
    return 0;
  return text.split(`
`).filter(Boolean).length;
}
function firstLine(text, max) {
  if (!text)
    return "";
  const line = text.trimStart().split(`
`)[0] ?? "";
  return line.length > max ? line.slice(0, max) + ICONS.ellipsis : line;
}
function ShellRenderer({ result }) {
  const r = result || {};
  const exitCode = r.exitCode ?? 0;
  const isError = exitCode !== 0;
  if (r.killed) {
    return /* @__PURE__ */ jsxDEV14("text", {
      fg: "#ff0000",
      children: /* @__PURE__ */ jsxDEV14("em", {
        children: [
          ` ${ICONS.resultArrow} `,
          "killed (timeout)"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (isError) {
    const reason = firstLine(r.stderr, 100) || `exit ${exitCode}`;
    return /* @__PURE__ */ jsxDEV14("text", {
      fg: "#ff0000",
      children: /* @__PURE__ */ jsxDEV14("em", {
        children: [
          ` ${ICONS.resultArrow} `,
          reason
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const lines = lineCount(r.stdout);
  const summary = lines > 0 ? `${lines} lines output` : "done (no output)";
  return /* @__PURE__ */ jsxDEV14("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV14("em", {
      children: [
        ` ${ICONS.resultArrow} `,
        summary
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/read-file.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV15 } from "@opentui/react/jsx-dev-runtime";
function basename(p) {
  return p.split("/").pop() || p;
}
function ReadFileRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  if (items.length === 0) {
    return /* @__PURE__ */ jsxDEV15("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV15("em", {
        children: [
          ` ${ICONS.resultArrow}`,
          " read 0 lines (-)"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (items.length === 1) {
    const item = items[0];
    const lines = item.lineCount ?? 0;
    const name = item.path ?? "?";
    const range = item.startLine !== undefined && item.endLine !== undefined ? `:${item.startLine}-${item.endLine}` : "";
    return /* @__PURE__ */ jsxDEV15("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV15("em", {
        children: [
          ` ${ICONS.resultArrow}`,
          " read ",
          lines,
          " lines (",
          name,
          range,
          ")"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const totalLines = items.reduce((sum, item) => sum + (item.lineCount ?? 0), 0);
  const names = items.map((item) => basename(item.path ?? "?")).join(", ");
  return /* @__PURE__ */ jsxDEV15("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV15("em", {
      children: [
        ` ${ICONS.resultArrow}`,
        " read ",
        totalLines,
        " lines (",
        names,
        ")"
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/apply-diff.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV16 } from "@opentui/react/jsx-dev-runtime";
function countPatchLines(patch) {
  if (typeof patch !== "string")
    return { added: 0, deleted: 0 };
  let added = 0;
  let deleted = 0;
  const lines = patch.split(`
`);
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@"))
      continue;
    if (line.startsWith("+"))
      added++;
    else if (line.startsWith("-"))
      deleted++;
  }
  return { added, deleted };
}
function ApplyDiffRenderer({ args, result }) {
  const r = result || {};
  const isError = (r.failed ?? 0) > 0;
  const { added, deleted } = countPatchLines(args?.patch);
  const hasStats = added > 0 || deleted > 0;
  return /* @__PURE__ */ jsxDEV16("text", {
    fg: isError ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV16("em", {
      children: [
        ` ${ICONS.resultArrow} `,
        added > 0 && /* @__PURE__ */ jsxDEV16("span", {
          fg: "#57ab5a",
          children: [
            "+",
            added
          ]
        }, undefined, true, undefined, this),
        added > 0 && deleted > 0 && " ",
        deleted > 0 && /* @__PURE__ */ jsxDEV16("span", {
          fg: "#f47067",
          children: [
            "-",
            deleted
          ]
        }, undefined, true, undefined, this),
        hasStats && ", ",
        r.applied,
        "/",
        r.totalHunks,
        " hunks",
        isError ? `, ${r.failed} failed` : "",
        r.path ? ` (${r.path})` : ""
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/search-in-files.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV17 } from "@opentui/react/jsx-dev-runtime";
function truncStr(s, max) {
  return s.length > max ? s.slice(0, max) + ICONS.ellipsis : s;
}
function SearchInFilesRenderer({ args, result }) {
  const r = result || {};
  if (r.mode === "replace") {
    const total = r.totalReplacements ?? 0;
    const files = r.processedFiles ?? 0;
    const suffix2 = r.truncated ? " (truncated)" : "";
    const query = typeof args?.query === "string" ? truncStr(args.query, 16) : "";
    const replace = typeof args?.replace === "string" ? truncStr(args.replace, 16) : "";
    const transform = query ? ` "${query}" ${ICONS.arrowRight} "${replace}"` : "";
    const changedFiles = r.results ? r.results.filter((f) => f.changed).length : files;
    return /* @__PURE__ */ jsxDEV17("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV17("em", {
        children: [
          ` ${ICONS.resultArrow} `,
          /* @__PURE__ */ jsxDEV17("span", {
            fg: "#d2a8ff",
            children: total
          }, undefined, false, undefined, this),
          " replacements in",
          " ",
          /* @__PURE__ */ jsxDEV17("span", {
            fg: "#d2a8ff",
            children: changedFiles
          }, undefined, false, undefined, this),
          "/",
          files,
          " files",
          transform,
          suffix2
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const count = r.count ?? 0;
  const suffix = r.truncated ? " (truncated)" : "";
  return /* @__PURE__ */ jsxDEV17("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV17("em", {
      children: [
        ` ${ICONS.resultArrow} `,
        /* @__PURE__ */ jsxDEV17("span", {
          fg: "#d2a8ff",
          children: count
        }, undefined, false, undefined, this),
        " matches found",
        suffix
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/find-files.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV18 } from "@opentui/react/jsx-dev-runtime";
function FindFilesRenderer({ result }) {
  const r = result || {};
  const count = r.count ?? 0;
  const suffix = r.truncated ? " (truncated)" : "";
  return /* @__PURE__ */ jsxDEV18("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV18("em", {
      children: [
        ` ${ICONS.resultArrow} `,
        " ",
        count,
        " files found",
        suffix
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/list-files.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV19 } from "@opentui/react/jsx-dev-runtime";
function ListFilesRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const totalFiles = r.totalFiles ?? 0;
  const totalDirs = r.totalDirs ?? 0;
  const failCount = items.filter((i) => !i.success).length;
  const paths = items.filter((i) => i.success).map((i) => i.path ?? "?").join(", ");
  let summary = `${totalFiles} files, ${totalDirs} dirs`;
  if (paths)
    summary += ` (${paths})`;
  if (failCount > 0)
    summary += ` | ${failCount} failed`;
  return /* @__PURE__ */ jsxDEV19("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV19("em", {
      children: [
        ` ${ICONS.resultArrow} `,
        summary
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/write-file.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV20 } from "@opentui/react/jsx-dev-runtime";
function basename2(p) {
  return p.split("/").pop() || p;
}
function extractArgsFiles(args) {
  if (Array.isArray(args.files))
    return args.files;
  if (args.files && typeof args.files === "object")
    return [args.files];
  if (args.file && typeof args.file === "object")
    return [args.file];
  if (typeof args.path === "string" && typeof args.content === "string") {
    return [{ path: args.path, content: args.content }];
  }
  return [];
}
function countLines(content) {
  if (typeof content !== "string")
    return 0;
  if (content.length === 0)
    return 0;
  return content.endsWith(`
`) ? content.split(`
`).length - 1 : content.split(`
`).length;
}
function getLineCount(path, argsFiles) {
  if (!path)
    return 0;
  const entry = argsFiles.find((f) => f.path === path);
  return entry ? countLines(entry.content) : 0;
}
function WriteFileRenderer({ args, result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  const argsFiles = extractArgsFiles(args || {});
  if (items.length === 0) {
    return /* @__PURE__ */ jsxDEV20("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV20("em", {
        children: [
          ` ${ICONS.resultArrow}`,
          " wrote 0 files"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (items.length === 1) {
    const item = items[0];
    const action = item.action ?? (item.success ? "written" : "failed");
    const fg = item.success === false ? "#ff0000" : "#888";
    const lines = getLineCount(item.path, argsFiles);
    const hasLines = lines > 0 && action !== "unchanged";
    return /* @__PURE__ */ jsxDEV20("text", {
      fg,
      children: /* @__PURE__ */ jsxDEV20("em", {
        children: [
          ` ${ICONS.resultArrow} `,
          hasLines && (action === "created" ? /* @__PURE__ */ jsxDEV20("span", {
            fg: "#57ab5a",
            children: [
              "+",
              lines
            ]
          }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV20("span", {
            fg: "#d2a8ff",
            children: [
              "~",
              lines
            ]
          }, undefined, true, undefined, this)),
          hasLines ? " lines, " : "",
          action,
          " (",
          item.path ?? "?",
          ")"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const counts = {};
  let totalLines = 0;
  for (const item of items) {
    const key = item.success === false ? "failed" : item.action ?? "written";
    counts[key] = (counts[key] || 0) + 1;
    if (item.success !== false && item.action !== "unchanged") {
      totalLines += getLineCount(item.path, argsFiles);
    }
  }
  const parts = [];
  for (const action of ["created", "modified", "unchanged", "written", "failed"]) {
    if (counts[action]) {
      parts.push(`${counts[action]} ${action}`);
    }
  }
  const names = items.map((i) => basename2(i.path ?? "?")).join(", ");
  return /* @__PURE__ */ jsxDEV20("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV20("em", {
      children: [
        ` ${ICONS.resultArrow} `,
        totalLines > 0 && /* @__PURE__ */ jsxDEV20("span", {
          fg: "#d2a8ff",
          children: [
            "~",
            totalLines
          ]
        }, undefined, true, undefined, this),
        totalLines > 0 ? " lines, " : "",
        parts.join(", "),
        " (",
        names,
        ")"
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/delete-code.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV21 } from "@opentui/react/jsx-dev-runtime";
function DeleteCodeRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  if (items.length === 0) {
    return /* @__PURE__ */ jsxDEV21("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV21("em", {
        children: [
          ` ${ICONS.resultArrow}`,
          " deleted 0 lines"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return /* @__PURE__ */ jsxDEV21("text", {
        fg: "#ff0000",
        children: /* @__PURE__ */ jsxDEV21("em", {
          children: [
            ` ${ICONS.resultArrow}`,
            " failed (",
            item.error ?? item.path ?? "?",
            ")"
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this);
    }
    const deleted = item.deletedLines ?? 0;
    const range = item.start_line != null && item.end_line != null ? `:${item.start_line}-${item.end_line}` : "";
    return /* @__PURE__ */ jsxDEV21("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV21("em", {
        children: [
          ` ${ICONS.resultArrow}`,
          " ",
          /* @__PURE__ */ jsxDEV21("span", {
            fg: "#f47067",
            children: [
              "-",
              deleted
            ]
          }, undefined, true, undefined, this),
          " lines (",
          item.path ?? "?",
          range,
          ")"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const totalDeleted = items.reduce((sum, i) => sum + (i.deletedLines ?? 0), 0);
  const names = items.map((i) => i.path ?? "?").join(", ");
  return /* @__PURE__ */ jsxDEV21("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV21("em", {
      children: [
        ` ${ICONS.resultArrow}`,
        " ",
        /* @__PURE__ */ jsxDEV21("span", {
          fg: "#f47067",
          children: [
            "-",
            totalDeleted
          ]
        }, undefined, true, undefined, this),
        " lines in ",
        items.length,
        " files (",
        names,
        ")"
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/insert-code.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV22 } from "@opentui/react/jsx-dev-runtime";
function InsertCodeRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  if (items.length === 0) {
    return /* @__PURE__ */ jsxDEV22("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV22("em", {
        children: [
          ` ${ICONS.resultArrow}`,
          " inserted 0 lines"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return /* @__PURE__ */ jsxDEV22("text", {
        fg: "#ff0000",
        children: /* @__PURE__ */ jsxDEV22("em", {
          children: [
            ` ${ICONS.resultArrow}`,
            " failed (",
            item.error ?? item.path ?? "?",
            ")"
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this);
    }
    const inserted = item.insertedLines ?? 0;
    const pos = item.line != null ? ` at L${item.line}` : "";
    return /* @__PURE__ */ jsxDEV22("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV22("em", {
        children: [
          ` ${ICONS.resultArrow}`,
          " ",
          /* @__PURE__ */ jsxDEV22("span", {
            fg: "#57ab5a",
            children: [
              "+",
              inserted
            ]
          }, undefined, true, undefined, this),
          " lines",
          pos,
          " (",
          item.path ?? "?",
          ")"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const totalInserted = items.reduce((sum, i) => sum + (i.insertedLines ?? 0), 0);
  const names = items.map((i) => i.path ?? "?").join(", ");
  return /* @__PURE__ */ jsxDEV22("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV22("em", {
      children: [
        ` ${ICONS.resultArrow}`,
        " ",
        /* @__PURE__ */ jsxDEV22("span", {
          fg: "#57ab5a",
          children: [
            "+",
            totalInserted
          ]
        }, undefined, true, undefined, this),
        " lines in ",
        items.length,
        " files (",
        names,
        ")"
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/tool-renderers/index.ts
var renderers = {
  shell: ShellRenderer,
  bash: ShellRenderer,
  read_file: ReadFileRenderer,
  apply_diff: ApplyDiffRenderer,
  search_in_files: SearchInFilesRenderer,
  find_files: FindFilesRenderer,
  list_files: ListFilesRenderer,
  write_file: WriteFileRenderer,
  delete_code: DeleteCodeRenderer,
  insert_code: InsertCodeRenderer
};
function getToolRenderer(toolName) {
  return renderers[toolName] ?? DefaultRenderer;
}
var detailRenderers = {};
function getToolDetailRenderer(toolName) {
  return detailRenderers[toolName] ?? null;
}

// extensions/console/src/components/ToolCall.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV23 } from "@opentui/react/jsx-dev-runtime";
var TERMINAL_STATUSES = new Set(["success", "warning", "error"]);
function getArgsSummary(toolName, args) {
  switch (toolName) {
    case "bash":
    case "shell": {
      const cmd = String(args.command || "");
      return cmd.length > 60 ? `"${cmd.slice(0, 60)}${ICONS.ellipsis}"` : `"${cmd}"`;
    }
    case "read_file": {
      const files = Array.isArray(args.files) ? args.files : [];
      const filePaths = files.map((entry) => {
        if (!entry || typeof entry !== "object")
          return "";
        return String(entry.path ?? "").trim();
      }).filter(Boolean);
      if (filePaths.length > 1)
        return `${filePaths[0]} +${filePaths.length - 1}`;
      if (filePaths.length === 1)
        return filePaths[0];
      const singleFilePath = args.file && typeof args.file === "object" ? String(args.file.path ?? "").trim() : "";
      return singleFilePath || String(args.path || "");
    }
    case "apply_diff":
      return String(args.path || "");
    case "write_file": {
      const files = Array.isArray(args.files) ? args.files : [];
      if (files.length > 1) {
        const first = files[0] && typeof files[0] === "object" ? String(files[0].path ?? "") : "";
        return first ? `${first} +${files.length - 1}` : `${files.length} files`;
      }
      if (files.length === 1 && files[0] && typeof files[0] === "object") {
        return String(files[0].path ?? "");
      }
      return String(args.path || "");
    }
    case "delete_code":
    case "insert_code": {
      const files = Array.isArray(args.files) ? args.files : [];
      if (files.length > 1) {
        const first = files[0] && typeof files[0] === "object" ? String(files[0].path ?? "") : "";
        return first ? `${first} +${files.length - 1}` : `${files.length} files`;
      }
      if (files.length === 1 && files[0] && typeof files[0] === "object") {
        return String(files[0].path ?? "");
      }
      return String(args.path || "");
    }
    case "search_in_files": {
      const q = String(args.query || "");
      const p = String(args.path || "");
      const head = q.length > 20 ? `"${q.slice(0, 20)}${ICONS.ellipsis}"` : `"${q}"`;
      return p ? `${head} in ${p}` : head;
    }
    case "find_files": {
      const patterns = Array.isArray(args.patterns) ? args.patterns.map(String) : [];
      const first = patterns[0] ?? "";
      return first ? `"${first}"` : "";
    }
    default:
      return "";
  }
}
function ToolCall({ invocation }) {
  const { toolName, status, args, result, error, createdAt, updatedAt } = invocation;
  const progress = invocation.progress;
  const progressTokens = typeof progress?.tokens === "number" ? progress.tokens : undefined;
  const progressFrame = typeof progress?.frame === "number" ? progress.frame : undefined;
  const hasProgress = progress != null;
  const isFinal = TERMINAL_STATUSES.has(status);
  const isExecuting = status === "executing";
  const isAwaitingApproval = status === "awaiting_approval";
  const argsSummary = getArgsSummary(toolName, args);
  const Renderer = isFinal && result != null ? getToolRenderer(toolName) : null;
  const durationSec = (updatedAt - createdAt) / 1000;
  const duration = isFinal && durationSec > 0 ? durationSec.toFixed(1) + "s" : "";
  const nameBg = status === "error" ? C.error : isAwaitingApproval ? C.warn : C.accent;
  return /* @__PURE__ */ jsxDEV23("box", {
    flexDirection: "column",
    children: [
      /* @__PURE__ */ jsxDEV23("box", {
        flexDirection: "row",
        gap: 1,
        children: [
          /* @__PURE__ */ jsxDEV23("text", {
            children: [
              /* @__PURE__ */ jsxDEV23("span", {
                bg: nameBg,
                fg: C.cursorFg,
                children: [
                  " ",
                  toolName,
                  " "
                ]
              }, undefined, true, undefined, this),
              argsSummary.length > 0 && /* @__PURE__ */ jsxDEV23("span", {
                fg: C.dim,
                children: [
                  " ",
                  argsSummary
                ]
              }, undefined, true, undefined, this),
              status === "success" ? /* @__PURE__ */ jsxDEV23("span", {
                fg: C.accent,
                children: [
                  " ",
                  ICONS.checkmark
                ]
              }, undefined, true, undefined, this) : null,
              status === "warning" ? /* @__PURE__ */ jsxDEV23("span", {
                fg: C.warn,
                children: " !"
              }, undefined, false, undefined, this) : null,
              status === "error" ? /* @__PURE__ */ jsxDEV23("span", {
                fg: C.error,
                children: [
                  " ",
                  ICONS.crossmark
                ]
              }, undefined, true, undefined, this) : null,
              isAwaitingApproval ? /* @__PURE__ */ jsxDEV23("span", {
                fg: C.warn,
                children: " [待确认]"
              }, undefined, false, undefined, this) : null,
              !isFinal && !isExecuting && !isAwaitingApproval ? /* @__PURE__ */ jsxDEV23("span", {
                fg: C.dim,
                children: [
                  " [",
                  status,
                  "]"
                ]
              }, undefined, true, undefined, this) : null,
              duration ? /* @__PURE__ */ jsxDEV23("span", {
                fg: C.dim,
                children: [
                  " ",
                  duration
                ]
              }, undefined, true, undefined, this) : null,
              isExecuting && progressTokens != null && progressTokens > 0 ? /* @__PURE__ */ jsxDEV23("span", {
                fg: C.dim,
                children: [
                  " ",
                  ICONS.upArrow,
                  progressTokens.toLocaleString(),
                  "tk"
                ]
              }, undefined, true, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          isExecuting && hasProgress ? /* @__PURE__ */ jsxDEV23("text", {
            children: /* @__PURE__ */ jsxDEV23("span", {
              fg: C.accent,
              children: SPINNER_FRAMES[(progressFrame ?? 0) % SPINNER_FRAMES.length]
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : isExecuting ? /* @__PURE__ */ jsxDEV23("text", {
            children: /* @__PURE__ */ jsxDEV23(Spinner, {}, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      status === "error" && error && /* @__PURE__ */ jsxDEV23("text", {
        fg: C.error,
        children: /* @__PURE__ */ jsxDEV23("em", {
          children: [
            "  ",
            error
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      Renderer && result != null && /* @__PURE__ */ jsxDEV23("box", {
        paddingLeft: 2,
        children: Renderer({ toolName, args, result })
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/MessageItem.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV24 } from "@opentui/react/jsx-dev-runtime";
function truncateRight(line, maxChars) {
  if (line.length <= maxChars)
    return line;
  return `${line.slice(0, maxChars - 1)}${ICONS.ellipsis}`;
}
function getThoughtTailPreview(text, maxChars, lineCount2 = 2) {
  const lines = text.replace(/\r\n/g, `
`).split(`
`).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0)
    return [];
  const tail = lines.slice(-lineCount2);
  return tail.map((line) => truncateRight(line, maxChars));
}
function getSummaryPreview(text, maxChars) {
  const clean = text.replace(/^\[Context Summary\]\s*\n*/i, "").trim();
  const lines = clean.split(`
`).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0)
    return "";
  const first = lines[0];
  if (first.length <= maxChars)
    return first;
  return first.slice(0, maxChars - 1) + ICONS.ellipsis;
}
function formatElapsedMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}
function formatTokenSpeed(tokenOut, durationMs) {
  return `${(tokenOut / Math.max(durationMs / 1000, 0.001)).toFixed(1)} t/s`;
}
function formatTime(ms) {
  const d = new Date(ms);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = new Date;
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate())
    return hhmm;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (d.getFullYear() === now.getFullYear())
    return `${mm}/${dd} ${hhmm}`;
  return `${d.getFullYear()}/${mm}/${dd} ${hhmm}`;
}
function groupParts(parts) {
  const groups = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.type === "tool_use") {
      const allTools = [];
      const start = i;
      while (i < parts.length) {
        const p = parts[i];
        if (p.type === "tool_use") {
          allTools.push(...p.tools);
        } else if (p.type === "text" && !p.text.trim()) {} else {
          break;
        }
        i++;
      }
      groups.push({ kind: "tools", tools: allTools, startIndex: start });
    } else if (part.type === "text" && part.text.trim()) {
      groups.push({ kind: "text", part, index: i });
      i++;
    } else if (part.type === "thought") {
      groups.push({ kind: "thought", part, index: i });
      i++;
    } else {
      i++;
    }
  }
  return groups;
}
function NotificationPayloadBlock({ payload }) {
  const icon = payload.status === "completed" ? ICONS.checkmark : payload.status === "failed" ? ICONS.crossmark : ICONS.cancelled;
  const iconColor = payload.status === "completed" ? C.accent : C.error;
  const content = payload.result || payload.error || "";
  const firstLine2 = content.split(`
`).filter((l) => l.trim())[0] || "";
  const preview = firstLine2.length > 60 ? firstLine2.slice(0, 57) + "..." : firstLine2;
  return /* @__PURE__ */ jsxDEV24("box", {
    children: /* @__PURE__ */ jsxDEV24("text", {
      children: [
        /* @__PURE__ */ jsxDEV24("span", {
          fg: iconColor,
          children: icon
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV24("span", {
          fg: C.text,
          children: [
            " ",
            payload.description
          ]
        }, undefined, true, undefined, this),
        preview ? /* @__PURE__ */ jsxDEV24("span", {
          fg: C.dim,
          children: [
            ` ${ICONS.emDash} `,
            preview
          ]
        }, undefined, true, undefined, this) : null
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
var MessageItem = React5.memo(function MessageItem2({ msg, liveTools, liveParts, isStreaming, modelName, thoughtsToggleSignal }) {
  const { width: rawTermWidth } = useTerminalDimensions2();
  const termWidth = rawTermWidth - 1;
  const [thoughtsExpanded, setThoughtsExpanded] = useState6(false);
  const prevSignalRef = useRef5(thoughtsToggleSignal);
  useEffect6(() => {
    const prev = prevSignalRef.current;
    prevSignalRef.current = thoughtsToggleSignal;
    if (prev != null && thoughtsToggleSignal != null && thoughtsToggleSignal !== prev) {
      setThoughtsExpanded((p) => !p);
    }
  }, [thoughtsToggleSignal]);
  const isUser = msg.role === "user";
  const isSummary = msg.isSummary === true;
  if (isSummary) {
    const headerText2 = `${ICONS.separator} context `;
    const separatorLen2 = Math.max(2, termWidth - headerText2.length - 2);
    const preview = getSummaryPreview(msg.parts.filter((p) => p.type === "text").map((p) => p.text).join(`
`), Math.max(30, termWidth - 20));
    return /* @__PURE__ */ jsxDEV24("box", {
      flexDirection: "column",
      width: "100%",
      children: [
        /* @__PURE__ */ jsxDEV24("box", {
          marginBottom: 1,
          children: /* @__PURE__ */ jsxDEV24("text", {
            children: [
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.warn,
                children: /* @__PURE__ */ jsxDEV24("strong", {
                  children: headerText2
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.warn,
                children: "─".repeat(separatorLen2)
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV24("text", {
          fg: C.dim,
          children: preview
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV24("box", {
          marginTop: 1,
          children: /* @__PURE__ */ jsxDEV24("text", {
            fg: C.dim,
            children: [
              msg.createdAt != null ? formatTime(msg.createdAt) : "",
              msg.tokenIn != null ? `  ${ICONS.upArrow}${msg.tokenIn.toLocaleString()}` : ""
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  if (msg.isNotificationSummary && msg.notificationPayloads && msg.notificationPayloads.length > 0) {
    const headerText2 = `${ICONS.separator} bg-tasks completed `;
    const separatorLen2 = Math.max(2, termWidth - headerText2.length - 2);
    return /* @__PURE__ */ jsxDEV24("box", {
      flexDirection: "column",
      width: "100%",
      children: [
        /* @__PURE__ */ jsxDEV24("box", {
          marginBottom: 1,
          children: /* @__PURE__ */ jsxDEV24("text", {
            children: [
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.warn,
                children: /* @__PURE__ */ jsxDEV24("strong", {
                  children: headerText2
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.warn,
                children: "─".repeat(separatorLen2)
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV24("box", {
          flexDirection: "column",
          backgroundColor: C.toolPendingBg,
          paddingLeft: 1,
          children: msg.notificationPayloads.map((p, i) => /* @__PURE__ */ jsxDEV24("box", {
            children: /* @__PURE__ */ jsxDEV24(NotificationPayloadBlock, {
              payload: p
            }, undefined, false, undefined, this)
          }, `notif-${p.taskId || i}`, false, undefined, this))
        }, undefined, false, undefined, this),
        msg.createdAt != null && /* @__PURE__ */ jsxDEV24("box", {
          marginTop: 1,
          children: /* @__PURE__ */ jsxDEV24("text", {
            fg: C.dim,
            children: formatTime(msg.createdAt)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  const isNotification = msg.isNotification === true;
  const labelName = isSummary ? "context" : isUser ? "you" : msg.isCommand ? "shell" : isNotification ? "bg-task" : (msg.modelName || modelName || "iris").toLowerCase();
  const labelColor = isSummary ? C.warn : isUser ? C.roleUser : msg.isError ? C.error : msg.isCommand ? C.command : isNotification ? C.warn : C.roleAssistant;
  const headerText = `${ICONS.separator} ${labelName} `;
  const displayParts = [...msg.parts];
  if (liveParts && liveParts.length > 0)
    displayParts.push(...liveParts);
  if (liveTools && liveTools.length > 0)
    displayParts.push({ type: "tool_use", tools: liveTools });
  const hasAnyContent = displayParts.length > 0;
  const separatorLen = Math.max(2, termWidth - headerText.length - 2);
  const groups = groupParts(displayParts);
  return /* @__PURE__ */ jsxDEV24("box", {
    flexDirection: "column",
    width: "100%",
    children: [
      /* @__PURE__ */ jsxDEV24("box", {
        marginBottom: 1,
        children: /* @__PURE__ */ jsxDEV24("text", {
          children: [
            /* @__PURE__ */ jsxDEV24("span", {
              fg: labelColor,
              children: /* @__PURE__ */ jsxDEV24("strong", {
                children: headerText
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV24("span", {
              fg: labelColor,
              children: "─".repeat(separatorLen)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV24("box", {
        flexDirection: "column",
        width: "100%",
        children: [
          groups.map((group, gi) => {
            if (group.kind === "text" && group.part.text.length > 0) {
              const isLastGroup = gi === groups.length - 1;
              return /* @__PURE__ */ jsxDEV24("box", {
                marginTop: gi > 0 ? 1 : 0,
                children: isUser ? /* @__PURE__ */ jsxDEV24("text", {
                  fg: C.text,
                  children: group.part.text
                }, undefined, false, undefined, this) : msg.isError ? /* @__PURE__ */ jsxDEV24("text", {
                  fg: C.error,
                  children: group.part.text
                }, undefined, false, undefined, this) : msg.isCommand ? /* @__PURE__ */ jsxDEV24("text", {
                  fg: C.textSec,
                  children: group.part.text
                }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV24(MarkdownText, {
                  text: group.part.text,
                  showCursor: isLastGroup && isStreaming
                }, undefined, false, undefined, this)
              }, group.index, false, undefined, this);
            }
            if (group.kind === "thought") {
              const maxChars = Math.max(24, termWidth - 20);
              const allLines = group.part.text.replace(/\r\n/g, `
`).split(`
`).map((s) => s.trim()).filter(Boolean);
              const totalLines = allLines.length;
              const isLastGroup = gi === groups.length - 1;
              const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
              const isAfterTools = prevGroup?.kind === "tools";
              const prefix = group.part.durationMs != null ? `thinking   ${formatElapsedMs(group.part.durationMs)}` : "thinking";
              const hiddenLines = Math.max(0, totalLines - 2);
              const showFull = thoughtsExpanded && hiddenLines > 0;
              const displayLines = showFull ? allLines : getThoughtTailPreview(group.part.text, maxChars);
              return /* @__PURE__ */ jsxDEV24("box", {
                marginTop: isAfterTools ? 0 : gi > 0 ? 1 : 0,
                flexDirection: "column",
                backgroundColor: C.thinkingBg,
                paddingLeft: 1,
                children: [
                  /* @__PURE__ */ jsxDEV24("text", {
                    fg: C.primaryLight,
                    children: /* @__PURE__ */ jsxDEV24("em", {
                      children: `${ICONS.separator} ` + prefix
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV24("box", {
                    flexDirection: "column",
                    children: displayLines.length > 0 ? displayLines.map((line, li) => /* @__PURE__ */ jsxDEV24("text", {
                      fg: C.dim,
                      children: /* @__PURE__ */ jsxDEV24("em", {
                        children: [
                          "    ",
                          line,
                          li === displayLines.length - 1 && isLastGroup && isStreaming ? /* @__PURE__ */ jsxDEV24("span", {
                            bg: C.accent,
                            children: " "
                          }, undefined, false, undefined, this) : null
                        ]
                      }, undefined, true, undefined, this)
                    }, li, false, undefined, this)) : /* @__PURE__ */ jsxDEV24("text", {
                      fg: C.dim,
                      children: /* @__PURE__ */ jsxDEV24("em", {
                        children: [
                          "    ",
                          "..."
                        ]
                      }, undefined, true, undefined, this)
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this),
                  hiddenLines > 0 ? /* @__PURE__ */ jsxDEV24("text", {
                    fg: C.dim,
                    children: /* @__PURE__ */ jsxDEV24("em", {
                      children: [
                        `    ${ICONS.ellipsis} +`,
                        hiddenLines,
                        " lines (ctrl+o to ",
                        showFull ? "collapse" : "expand",
                        ")"
                      ]
                    }, undefined, true, undefined, this)
                  }, undefined, false, undefined, this) : null
                ]
              }, group.index, true, undefined, this);
            }
            if (group.kind === "tools") {
              const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
              const isConsecutiveTools = prevGroup?.kind === "tools";
              const isAfterThought = prevGroup?.kind === "thought";
              return /* @__PURE__ */ jsxDEV24("box", {
                flexDirection: "column",
                width: "100%",
                marginTop: isConsecutiveTools || isAfterThought ? 0 : gi > 0 ? 1 : 0,
                children: /* @__PURE__ */ jsxDEV24("box", {
                  flexDirection: "column",
                  backgroundColor: C.toolPendingBg,
                  paddingLeft: 1,
                  children: [
                    /* @__PURE__ */ jsxDEV24("text", {
                      fg: C.accent,
                      children: /* @__PURE__ */ jsxDEV24("strong", {
                        children: `${ICONS.separator} tools`
                      }, undefined, false, undefined, this)
                    }, undefined, false, undefined, this),
                    group.tools.map((inv) => /* @__PURE__ */ jsxDEV24(ToolCall, {
                      invocation: inv
                    }, inv.id, false, undefined, this))
                  ]
                }, undefined, true, undefined, this)
              }, `tools-${group.startIndex}`, false, undefined, this);
            }
            return null;
          }),
          isUser && (msg.createdAt != null || msg.tokenIn != null) && /* @__PURE__ */ jsxDEV24("box", {
            marginTop: hasAnyContent ? 1 : 0,
            children: /* @__PURE__ */ jsxDEV24("text", {
              fg: C.dim,
              children: [
                msg.createdAt != null ? formatTime(msg.createdAt) : "",
                msg.tokenIn != null ? `  ${ICONS.upArrow}${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ""}` : ""
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          !isUser && !isStreaming && (msg.createdAt != null || msg.durationMs != null || msg.tokenIn != null) && /* @__PURE__ */ jsxDEV24("box", {
            marginTop: hasAnyContent ? 1 : 0,
            children: /* @__PURE__ */ jsxDEV24("text", {
              fg: C.dim,
              children: [
                msg.createdAt != null ? formatTime(msg.createdAt) : "",
                msg.durationMs != null ? `  ${(msg.durationMs / 1000).toFixed(1)}s` : "",
                msg.tokenIn != null ? `  ${ICONS.upArrow}${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ""}` : "",
                msg.tokenOut != null ? `  ${ICONS.downArrow}${msg.tokenOut.toLocaleString()}` : "",
                msg.tokenOut != null && msg.streamOutputDurationMs != null ? `   ${formatTokenSpeed(msg.tokenOut, msg.streamOutputDurationMs)}` : ""
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          !hasAnyContent && isStreaming && /* @__PURE__ */ jsxDEV24("box", {
            children: /* @__PURE__ */ jsxDEV24(GeneratingTimer, {
              isGenerating: true
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          !hasAnyContent && !isStreaming && /* @__PURE__ */ jsxDEV24("text", {
            children: " "
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
});

// extensions/console/src/components/ChatMessageList.tsx
import { jsxDEV as jsxDEV25 } from "@opentui/react/jsx-dev-runtime";
function ChatMessageList({
  messages,
  streamingParts,
  isStreaming,
  isGenerating,
  retryInfo,
  modelName,
  generatingLabel,
  timerPaused,
  thoughtsToggleSignal
}) {
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = lastMessage?.role === "assistant" && (isStreaming || isGenerating && lastMessage.parts.length === 0);
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1;i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  return /* @__PURE__ */ jsxDEV25("scrollbox", {
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    paddingRight: 1,
    children: [
      messages.map((message, index) => {
        const isLastActive = lastIsActiveAssistant && index === messages.length - 1;
        const liveParts = isLastActive && streamingParts.length > 0 ? streamingParts : undefined;
        const hasVisibleContent = message.parts.length > 0 || !!liveParts;
        if (isLastActive && !hasVisibleContent) {
          return /* @__PURE__ */ jsxDEV25("box", {
            flexDirection: "column",
            paddingBottom: 1,
            children: /* @__PURE__ */ jsxDEV25(GeneratingTimer, {
              isGenerating,
              retryInfo,
              label: generatingLabel,
              paused: timerPaused
            }, undefined, false, undefined, this)
          }, message.id, false, undefined, this);
        }
        return /* @__PURE__ */ jsxDEV25("box", {
          flexDirection: "column",
          paddingBottom: 1,
          children: [
            /* @__PURE__ */ jsxDEV25(MessageItem, {
              msg: message,
              liveParts,
              isStreaming: isLastActive ? isStreaming : undefined,
              modelName,
              thoughtsToggleSignal: index === lastAssistantIndex ? thoughtsToggleSignal : undefined
            }, undefined, false, undefined, this),
            isLastActive && isStreaming && streamingParts.length === 0 ? /* @__PURE__ */ jsxDEV25(GeneratingTimer, {
              isGenerating,
              retryInfo,
              label: generatingLabel,
              paused: timerPaused
            }, undefined, false, undefined, this) : null
          ]
        }, message.id, true, undefined, this);
      }),
      isGenerating && !lastIsActiveAssistant && streamingParts.length === 0 ? /* @__PURE__ */ jsxDEV25("box", {
        flexDirection: "column",
        paddingBottom: 1,
        children: /* @__PURE__ */ jsxDEV25(GeneratingTimer, {
          isGenerating,
          retryInfo,
          label: generatingLabel,
          paused: timerPaused
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/DiffApprovalView.tsx
import { useMemo as useMemo3 } from "react";
import * as fs2 from "fs";
import * as path2 from "path";

// extensions/console/node_modules/irises-extension-sdk/dist/tool-utils.js
import * as fs from "node:fs";
import * as path from "node:path";
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, `
`).replace(/\r/g, `
`);
}
function sanitizeUnifiedDiffPatch(patch) {
  const normalized = normalizeLineEndings(patch);
  const lines = normalized.split(`
`);
  const out = [];
  for (const line of lines) {
    if (line.startsWith("```"))
      continue;
    if (line.startsWith("***")) {
      if (line === "***" || line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch") || line.startsWith("*** Update File:") || line.startsWith("*** Add File:") || line.startsWith("*** Delete File:") || line.startsWith("*** End of File")) {
        continue;
      }
    }
    out.push(line);
  }
  return out.join(`
`);
}
function parseUnifiedDiff(patch) {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split(`
`);
  let oldFile;
  let newFile;
  const hunks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      if (hunks.length > 0 || oldFile || newFile) {
        throw new Error("Multi-file patch is not supported. Please split into one apply_diff call per file.");
      }
      i++;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (oldFile && (hunks.length > 0 || newFile)) {
        throw new Error("Multi-file patch is not supported.");
      }
      oldFile = line.slice(4).trim().split("\t")[0]?.trim() || "";
      i++;
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (newFile && hunks.length > 0) {
        throw new Error("Multi-file patch is not supported.");
      }
      newFile = line.slice(4).trim().split("\t")[0]?.trim() || "";
      i++;
      continue;
    }
    if (line.startsWith("@@")) {
      const header = line;
      const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m) {
        throw new Error(`Invalid hunk header: ${header}. ` + `Expected format: @@ -oldStart,oldCount +newStart,newCount @@`);
      }
      const oldStart = parseInt(m[1], 10);
      const oldCount = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10);
      const newCount = m[4] ? parseInt(m[4], 10) : 1;
      const hunkLines = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith("@@") || l.startsWith("--- ") || l.startsWith("diff --git ") || l.startsWith("+++ "))
          break;
        if (l === "") {
          i++;
          continue;
        }
        if (l.startsWith("\\")) {
          i++;
          continue;
        }
        const prefix = l[0];
        const content = l.length > 0 ? l.slice(1) : "";
        if (prefix === " ") {
          hunkLines.push({ type: "context", content, raw: l });
        } else if (prefix === "+") {
          hunkLines.push({ type: "add", content, raw: l });
        } else if (prefix === "-") {
          hunkLines.push({ type: "del", content, raw: l });
        } else {
          throw new Error(`Invalid hunk line prefix '${prefix}' in line: ${l}`);
        }
        i++;
      }
      hunks.push({ oldStart, oldLines: oldCount, newStart, newLines: newCount, header, lines: hunkLines });
      continue;
    }
    i++;
  }
  if (hunks.length === 0) {
    throw new Error("No hunks (@@ ... @@) found in patch.");
  }
  return { oldFile, newFile, hunks };
}
var DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".limcode"
]);
var BINARY_DETECT_BYTES = 8 * 1024;
function toPosix(p) {
  return p.split(path.sep).join("/");
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function globToRegExp(glob) {
  const g = toPosix(glob.trim());
  let re = "^";
  for (let i = 0;i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      const next = g[i + 1];
      if (next === "*") {
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:.*\\/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      continue;
    }
    if ("\\.^$+()[]{}|".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re);
}
function shouldIgnoreByPath(relativePosixPath) {
  const parts = relativePosixPath.split("/");
  return parts.some((p) => DEFAULT_IGNORED_DIRS.has(p));
}
function isLikelyBinary(buf) {
  const n = Math.min(buf.length, BINARY_DETECT_BYTES);
  if (n === 0)
    return false;
  let suspicious = 0;
  for (let i = 0;i < n; i++) {
    const b = buf[i];
    if (b === 0)
      return true;
    const isAllowedWhitespace = b === 9 || b === 10 || b === 13;
    const isControl = b < 32 && !isAllowedWhitespace || b === 127;
    if (isControl)
      suspicious++;
  }
  const ratio = suspicious / n;
  return ratio > 0.3;
}
function swapByteOrder16(buf) {
  const len = buf.length - buf.length % 2;
  const out = Buffer.allocUnsafe(len);
  for (let i = 0;i < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}
function decodeText(buf) {
  const hasCRLF = buf.includes(Buffer.from(`\r
`));
  if (buf.length >= 3 && buf[0] === 239 && buf[1] === 187 && buf[2] === 191) {
    return {
      text: buf.subarray(3).toString("utf8"),
      encoding: "utf-8",
      hasBom: true,
      hasCRLF
    };
  }
  if (buf.length >= 2 && buf[0] === 255 && buf[1] === 254) {
    return {
      text: buf.subarray(2).toString("utf16le"),
      encoding: "utf-16le",
      hasBom: true,
      hasCRLF
    };
  }
  if (buf.length >= 2 && buf[0] === 254 && buf[1] === 255) {
    const swapped = swapByteOrder16(buf.subarray(2));
    return {
      text: swapped.toString("utf16le"),
      encoding: "utf-16be",
      hasBom: true,
      hasCRLF
    };
  }
  return {
    text: buf.toString("utf8"),
    encoding: "utf-8",
    hasBom: false,
    hasCRLF
  };
}
function buildSearchRegex(query, isRegex) {
  if (!query || !query.trim()) {
    throw new Error("query 不能为空");
  }
  return isRegex ? new RegExp(query, "g") : new RegExp(escapeRegex(query), "g");
}
function walkFiles(rootAbs, onFile, shouldStop, relPosixDir = "") {
  if (shouldStop())
    return;
  const dirAbs = relPosixDir ? path.join(rootAbs, relPosixDir) : rootAbs;
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    if (shouldStop())
      return;
    const relPosix = relPosixDir ? `${relPosixDir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(ent.name))
        continue;
      if (shouldIgnoreByPath(relPosix))
        continue;
      walkFiles(rootAbs, onFile, shouldStop, relPosix);
      continue;
    }
    if (ent.isFile()) {
      if (shouldIgnoreByPath(relPosix))
        continue;
      onFile(path.join(dirAbs, ent.name), relPosix);
    }
  }
}
function normalizeObjectArrayArg(args, options) {
  const arrayValue = args[options.arrayKey];
  if (Array.isArray(arrayValue) && arrayValue.length > 0) {
    const normalized = arrayValue.filter(options.isEntry);
    return normalized.length === arrayValue.length ? normalized : undefined;
  }
  if (options.isEntry(arrayValue)) {
    return [arrayValue];
  }
  for (const key of options.singularKeys ?? []) {
    const singularValue = args[key];
    if (options.isEntry(singularValue)) {
      return [singularValue];
    }
  }
  if (options.isEntry(args)) {
    return [args];
  }
  return;
}
function resolveProjectPath(inputPath, baseCwd) {
  const cwd = baseCwd ?? process.cwd();
  const resolved = path.resolve(cwd, inputPath);
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    throw new Error(`路径超出项目目录: ${inputPath}`);
  }
  return resolved;
}
function isWriteEntry(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string" && typeof value.content === "string";
}
function normalizeWriteArgs(args) {
  if (Array.isArray(args.files) && args.files.length > 0) {
    const normalized = args.files.filter(isWriteEntry);
    return normalized.length === args.files.length ? normalized : undefined;
  }
  if (isWriteEntry(args.files)) {
    return [args.files];
  }
  if (isWriteEntry(args.file)) {
    return [args.file];
  }
  if (isWriteEntry(args)) {
    return [{
      path: args.path,
      content: args.content
    }];
  }
  return;
}
function isInsertEntry(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string" && typeof value.line === "number" && typeof value.content === "string";
}
function normalizeInsertArgs(args) {
  return normalizeObjectArrayArg(args, {
    arrayKey: "files",
    singularKeys: ["file"],
    isEntry: isInsertEntry
  });
}
function isDeleteCodeEntry(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string" && typeof value.start_line === "number" && typeof value.end_line === "number";
}
function normalizeDeleteCodeArgs(args) {
  return normalizeObjectArrayArg(args, {
    arrayKey: "files",
    singularKeys: ["file"],
    isEntry: isDeleteCodeEntry
  });
}

// extensions/console/src/components/DiffApprovalView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV26 } from "@opentui/react/jsx-dev-runtime";
var DEFAULT_SEARCH_PATTERN = "**/*";
var DEFAULT_SEARCH_MAX_FILES = 50;
var DEFAULT_SEARCH_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
function normalizeLineEndings2(text) {
  return text.replace(/\r\n/g, `
`).replace(/\r/g, `
`);
}
function sanitizePatchText(patch) {
  const lines = normalizeLineEndings2(patch).split(`
`);
  const out = [];
  for (const line of lines) {
    if (line.startsWith("```"))
      continue;
    if (line === "***" || line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch") || line.startsWith("*** Update File:") || line.startsWith("*** Add File:") || line.startsWith("*** Delete File:") || line.startsWith("*** End of File"))
      continue;
    out.push(line);
  }
  return out.join(`
`).trim();
}
function getSafePatch(value) {
  if (typeof value === "string")
    return value;
  if (value == null)
    return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function toDiffLinePrefix(type) {
  if (type === "add")
    return "+";
  if (type === "del")
    return "-";
  return " ";
}
function buildDisplayDiff(filePath, patch) {
  const cleaned = sanitizePatchText(patch);
  if (!cleaned)
    return "";
  try {
    const parsed = parseUnifiedDiff(cleaned);
    const fallbackOld = `a/${filePath || "file"}`;
    const fallbackNew = `b/${filePath || "file"}`;
    const body = parsed.hunks.map((hunk) => {
      const lines = hunk.lines.map((line) => `${toDiffLinePrefix(line.type)}${line.content}`);
      const oldCount = hunk.lines.filter((l) => l.type === "context" || l.type === "del").length;
      const newCount = hunk.lines.filter((l) => l.type === "context" || l.type === "add").length;
      const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
      return [header, ...lines].join(`
`);
    }).join(`
`);
    return [`--- ${parsed.oldFile ?? fallbackOld}`, `+++ ${parsed.newFile ?? fallbackNew}`, body].filter(Boolean).join(`
`);
  } catch {
    if (/^(diff --git |--- |\+\+\+ )/m.test(cleaned))
      return cleaned;
    if (/^@@/m.test(cleaned)) {
      const p = filePath || "file";
      return `--- a/${p}
+++ b/${p}
${cleaned}`;
    }
    return cleaned;
  }
}
function inferFiletype(filePath) {
  const ext = filePath.toLowerCase().match(/\.[^.\\/]+$/)?.[0] ?? "";
  const map = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".markdown": "markdown",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".css": "css",
    ".html": "html",
    ".htm": "html",
    ".py": "python",
    ".sh": "bash",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".sql": "sql"
  };
  return map[ext];
}
function normalizePositiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : fallback;
}
function toWholeFileDiffLines(text) {
  if (!text)
    return [];
  const lines = normalizeLineEndings2(text).split(`
`);
  if (lines.length > 0 && lines[lines.length - 1] === "")
    lines.pop();
  return lines;
}
function buildWholeFileDiff(filePath, before, after, existed) {
  if (before === after)
    return "";
  const beforeLines = toWholeFileDiffLines(before);
  const afterLines = toWholeFileDiffLines(after);
  const bodyLines = [
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ];
  if (bodyLines.length === 0)
    return "";
  const oldFile = existed ? `a/${filePath}` : "/dev/null";
  return [
    `--- ${oldFile}`,
    `+++ b/${filePath}`,
    `@@ -${beforeLines.length > 0 ? 1 : 0},${beforeLines.length} +${afterLines.length > 0 ? 1 : 0},${afterLines.length} @@`,
    ...bodyLines
  ].join(`
`);
}
function createMsg(id, filePath, label, message) {
  return { id, filePath, label, filetype: inferFiletype(filePath), message };
}
function buildApplyDiffPreview(inv) {
  const filePath = typeof inv.args.path === "string" ? inv.args.path : "";
  const rawPatch = getSafePatch(inv.args.patch);
  const displayDiff = buildDisplayDiff(filePath, rawPatch);
  return {
    title: "Diff 审批",
    toolLabel: "apply_diff",
    summary: [filePath ? `目标文件：${filePath}` : "目标文件：未提供"],
    items: [displayDiff ? { id: `${inv.id}:apply_diff`, filePath, label: filePath || "补丁预览", diff: displayDiff, filetype: inferFiletype(filePath) } : createMsg(`${inv.id}:apply_diff.empty`, filePath, filePath || "补丁预览", "当前补丁为空，无法显示 diff。")]
  };
}
function buildWriteFilePreview(inv) {
  const fileList = normalizeWriteArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: "Diff 审批",
      toolLabel: "write_file",
      summary: ["参数不完整，无法生成 write_file 预览。"],
      items: [createMsg(`${inv.id}:write_file.invalid`, "", "write_file", "files 参数无效。")]
    };
  }
  const items = [];
  let created = 0, modified = 0, unchanged = 0, errored = 0;
  fileList.forEach((entry, i) => {
    try {
      const resolved = resolveProjectPath(entry.path);
      let existed = false, before = "";
      if (fs2.existsSync(resolved)) {
        before = fs2.readFileSync(resolved, "utf-8");
        existed = true;
      }
      if (existed && before === entry.content) {
        unchanged++;
        return;
      }
      const diff = buildWholeFileDiff(entry.path, before, entry.content, existed);
      const action = existed ? "修改" : "新增";
      items.push(diff ? { id: `${inv.id}:write_file:${i}`, filePath: entry.path, label: `${entry.path} ${ICONS.separator} ${action}`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} ${ICONS.separator} ${action}`, existed ? "内容变化特殊，无法显示 diff。" : "将创建空文件。"));
      if (existed)
        modified++;
      else
        created++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} ${ICONS.separator} 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`共 ${fileList.length} 个文件`, `新增 ${created}，修改 ${modified}，未变化 ${unchanged}`];
  if (errored > 0)
    summary.push(`${errored} 个文件无法生成预览`);
  if (items.length === 0)
    items.push(createMsg(`${inv.id}:write_file.empty`, "", "write_file", "本次 write_file 不会产生实际变更。"));
  return { title: "Diff 审批", toolLabel: "write_file", summary, items };
}
function buildInsertCodePreview(inv) {
  const fileList = normalizeInsertArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: "Diff 审批",
      toolLabel: "insert_code",
      summary: ["参数不完整，无法生成 insert_code 预览。"],
      items: [createMsg(`${inv.id}:insert_code.invalid`, "", "insert_code", "files 参数无效。")]
    };
  }
  const items = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry, i) => {
    try {
      const resolved = resolveProjectPath(entry.path);
      const before = fs2.readFileSync(resolved, "utf-8");
      const lines = before.split(`
`);
      const insertLines = entry.content.split(`
`);
      const idx = entry.line - 1;
      const after = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join(`
`);
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? { id: `${inv.id}:insert_code:${i}`, filePath: entry.path, label: `${entry.path} ${ICONS.separator} 第 ${entry.line} 行前插入 ${insertLines.length} 行`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} ${ICONS.separator} 插入`, "无法显示 diff。"));
      successCount++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} ${ICONS.separator} 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`共 ${fileList.length} 个操作`, `可预览 ${successCount} 个`];
  if (errored > 0)
    summary.push(`${errored} 个操作无法生成预览`);
  if (items.length === 0)
    items.push(createMsg(`${inv.id}:insert_code.empty`, "", "insert_code", "无可预览的变更。"));
  return { title: "Diff 审批", toolLabel: "insert_code", summary, items };
}
function buildDeleteCodePreview(inv) {
  const fileList = normalizeDeleteCodeArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: "Diff 审批",
      toolLabel: "delete_code",
      summary: ["参数不完整，无法生成 delete_code 预览。"],
      items: [createMsg(`${inv.id}:delete_code.invalid`, "", "delete_code", "files 参数无效。")]
    };
  }
  const items = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry, i) => {
    try {
      const resolved = resolveProjectPath(entry.path);
      const before = fs2.readFileSync(resolved, "utf-8");
      const lines = before.split(`
`);
      const after = [...lines.slice(0, entry.start_line - 1), ...lines.slice(entry.end_line)].join(`
`);
      const deletedCount = entry.end_line - entry.start_line + 1;
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? { id: `${inv.id}:delete_code:${i}`, filePath: entry.path, label: `${entry.path} ${ICONS.separator} 删除第 ${entry.start_line}-${entry.end_line} 行（${deletedCount} 行）`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} ${ICONS.separator} 删除`, "无法显示 diff。"));
      successCount++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} ${ICONS.separator} 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`共 ${fileList.length} 个操作`, `可预览 ${successCount} 个`];
  if (errored > 0)
    summary.push(`${errored} 个操作无法生成预览`);
  if (items.length === 0)
    items.push(createMsg(`${inv.id}:delete_code.empty`, "", "delete_code", "无可预览的变更。"));
  return { title: "Diff 审批", toolLabel: "delete_code", summary, items };
}
function buildSearchReplacePreview(inv) {
  const inputPath = typeof inv.args.path === "string" ? inv.args.path : ".";
  const pattern = typeof inv.args.pattern === "string" ? inv.args.pattern : DEFAULT_SEARCH_PATTERN;
  const isRegex = inv.args.isRegex === true;
  const query = String(inv.args.query ?? "");
  const replace = inv.args.replace;
  const maxFiles = normalizePositiveInteger(inv.args.maxFiles, DEFAULT_SEARCH_MAX_FILES);
  const maxFileSizeBytes = normalizePositiveInteger(inv.args.maxFileSizeBytes, DEFAULT_SEARCH_MAX_FILE_SIZE_BYTES);
  if (typeof replace !== "string") {
    return {
      title: "Diff 审批",
      toolLabel: "search_in_files.replace",
      summary: ["replace 参数缺失。"],
      items: [createMsg(`${inv.id}:search_replace.invalid`, inputPath, "search_in_files.replace", "replace 模式下必须提供 replace 参数。")]
    };
  }
  try {
    const regex = buildSearchRegex(query, isRegex);
    const rootAbs = resolveProjectPath(inputPath);
    const stat = fs2.statSync(rootAbs);
    const patternRe = globToRegExp(pattern);
    const items = [];
    let processedFiles = 0, changedFiles = 0, unchangedFiles = 0;
    let skippedBinary = 0, skippedTooLarge = 0, totalReplacements = 0;
    let truncated = false;
    const shouldStop = () => processedFiles >= maxFiles;
    const processFile = (fileAbs, relPosix) => {
      if (shouldStop())
        return;
      if (stat.isDirectory() && !patternRe.test(relPosix))
        return;
      processedFiles++;
      const displayPath = stat.isDirectory() ? toPosix(path2.join(inputPath, relPosix)) : toPosix(inputPath);
      const buf = fs2.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes) {
        skippedTooLarge++;
        return;
      }
      if (isLikelyBinary(buf)) {
        skippedBinary++;
        return;
      }
      const decoded = decodeText(buf);
      const countRegex = new RegExp(regex.source, regex.flags);
      let replacements = 0;
      for (;; ) {
        const m = countRegex.exec(decoded.text);
        if (!m)
          break;
        if (m[0].length === 0) {
          countRegex.lastIndex++;
          continue;
        }
        replacements++;
      }
      if (replacements === 0) {
        unchangedFiles++;
        return;
      }
      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      if (newText === decoded.text) {
        unchangedFiles++;
        return;
      }
      const diff = buildWholeFileDiff(displayPath, decoded.text, newText, true);
      items.push(diff ? { id: `${inv.id}:search_replace:${displayPath}`, filePath: displayPath, label: `${displayPath} ${ICONS.separator} ${replacements} 处替换`, diff, filetype: inferFiletype(displayPath) } : createMsg(`${inv.id}:search_replace:${displayPath}`, displayPath, `${displayPath} ${ICONS.separator} ${replacements} 处替换`, "文件将变化，但无法显示 diff。"));
      changedFiles++;
      totalReplacements += replacements;
    };
    if (stat.isFile())
      processFile(rootAbs, toPosix(path2.basename(rootAbs)));
    else {
      walkFiles(rootAbs, processFile, shouldStop);
      if (processedFiles >= maxFiles)
        truncated = true;
    }
    const summary = [
      `路径 ${inputPath} ${ICONS.separator} pattern ${pattern}`,
      `已处理 ${processedFiles} 个文件 ${ICONS.separator} 将变更 ${changedFiles} 个文件 ${ICONS.separator} 共 ${totalReplacements} 处替换`
    ];
    if (unchangedFiles > 0)
      summary.push(`无实际变化 ${unchangedFiles} 个文件`);
    if (skippedBinary > 0 || skippedTooLarge > 0)
      summary.push(`跳过二进制 ${skippedBinary} 个 ${ICONS.separator} 跳过过大文件 ${skippedTooLarge} 个`);
    if (truncated)
      summary.push(`已达到 maxFiles=${maxFiles}，预览已截断`);
    if (items.length === 0)
      items.push(createMsg(`${inv.id}:search_replace.empty`, inputPath, "search_in_files.replace", "当前 replace 不会修改任何文件。"));
    return { title: "Diff 审批", toolLabel: "search_in_files.replace", summary, items };
  } catch (err) {
    return {
      title: "Diff 审批",
      toolLabel: "search_in_files.replace",
      summary: ["生成预览时发生错误。"],
      items: [createMsg(`${inv.id}:search_replace.error`, inputPath, "search_in_files.replace", err instanceof Error ? err.message : String(err))]
    };
  }
}
function buildPreview(invocation) {
  switch (invocation.toolName) {
    case "apply_diff":
      return buildApplyDiffPreview(invocation);
    case "write_file":
      return buildWriteFilePreview(invocation);
    case "insert_code":
      return buildInsertCodePreview(invocation);
    case "delete_code":
      return buildDeleteCodePreview(invocation);
    case "search_in_files":
      if ((invocation.args.mode ?? "search") === "replace") {
        return buildSearchReplacePreview(invocation);
      }
      break;
  }
  return {
    title: "Diff 审批",
    toolLabel: invocation.toolName,
    summary: ["当前工具不支持 diff 审批预览。"],
    items: [createMsg(`${invocation.id}:unsupported`, "", invocation.toolName, "当前工具不支持 diff 审批预览。")]
  };
}
function DiffApprovalView({ invocation, pendingCount, choice, view, showLineNumbers, wrapMode, previewIndex = 0 }) {
  const preview = useMemo3(() => buildPreview(invocation), [invocation]);
  const normalizedPreviewIndex = preview.items.length > 0 ? (previewIndex % preview.items.length + preview.items.length) % preview.items.length : 0;
  const currentItem = preview.items[normalizedPreviewIndex];
  return /* @__PURE__ */ jsxDEV26("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    backgroundColor: "#0d1117",
    children: [
      /* @__PURE__ */ jsxDEV26("box", {
        flexDirection: "column",
        borderStyle: "double",
        borderColor: C.warn,
        paddingX: 1,
        paddingY: 0,
        flexShrink: 0,
        children: [
          /* @__PURE__ */ jsxDEV26("text", {
            children: [
              /* @__PURE__ */ jsxDEV26("span", {
                fg: C.warn,
                children: /* @__PURE__ */ jsxDEV26("strong", {
                  children: preview.title
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV26("span", {
                fg: C.dim,
                children: `  ${preview.toolLabel}`
              }, undefined, false, undefined, this),
              pendingCount > 1 ? /* @__PURE__ */ jsxDEV26("span", {
                fg: C.dim,
                children: `  (剩余 ${pendingCount - 1} 个)`
              }, undefined, false, undefined, this) : null,
              preview.items.length > 1 ? /* @__PURE__ */ jsxDEV26("span", {
                fg: C.dim,
                children: `  (预览 ${normalizedPreviewIndex + 1}/${preview.items.length})`
              }, undefined, false, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV26("text", {
            children: [
              /* @__PURE__ */ jsxDEV26("span", {
                fg: C.text,
                children: "文件 "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV26("span", {
                fg: C.primaryLight,
                children: currentItem?.filePath || "(未提供路径)"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV26("span", {
                fg: C.dim,
                children: `  视图:${view === "split" ? "分栏" : "统一"}  行号:${showLineNumbers ? "开" : "关"}  换行:${wrapMode === "word" ? "开" : "关"}`
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          currentItem?.label ? /* @__PURE__ */ jsxDEV26("text", {
            fg: C.dim,
            children: currentItem.label
          }, undefined, false, undefined, this) : null,
          preview.summary.map((line, index) => /* @__PURE__ */ jsxDEV26("text", {
            fg: C.dim,
            children: line
          }, `${preview.toolLabel}.summary.${index}`, false, undefined, this))
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV26("scrollbox", {
        flexGrow: 1,
        flexShrink: 1,
        marginTop: 1,
        borderStyle: "single",
        borderColor: C.border,
        verticalScrollbarOptions: { visible: true },
        horizontalScrollbarOptions: { visible: false },
        children: currentItem?.diff ? /* @__PURE__ */ jsxDEV26("diff", {
          diff: currentItem.diff,
          view,
          filetype: currentItem.filetype,
          showLineNumbers,
          wrapMode,
          addedBg: "#17361f",
          removedBg: "#3b1f24",
          contextBg: "#0d1117",
          lineNumberFg: "#6b7280",
          lineNumberBg: "#111827",
          addedLineNumberBg: "#122b18",
          removedLineNumberBg: "#2f161b",
          addedSignColor: "#22c55e",
          removedSignColor: "#ef4444",
          selectionBg: "#264f78",
          selectionFg: "#ffffff",
          style: { width: "100%" }
        }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV26("text", {
          fg: currentItem?.message ? C.textSec : C.dim,
          paddingX: 1,
          paddingY: 1,
          children: currentItem?.message ?? "当前补丁为空，无法显示 diff。"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV26("box", {
        flexDirection: "column",
        marginTop: 1,
        borderStyle: "single",
        borderColor: choice === "approve" ? C.accent : C.error,
        paddingX: 1,
        paddingY: 0,
        flexShrink: 0,
        children: [
          /* @__PURE__ */ jsxDEV26("text", {
            children: [
              /* @__PURE__ */ jsxDEV26("span", {
                fg: C.text,
                children: "审批结果 "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV26("span", {
                fg: choice === "approve" ? C.accent : C.textSec,
                children: choice === "approve" ? "[批准]" : " 批准 "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV26("span", {
                fg: C.dim,
                children: " "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV26("span", {
                fg: choice === "reject" ? C.error : C.textSec,
                children: choice === "reject" ? "[拒绝]" : " 拒绝 "
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV26("text", {
            fg: C.dim,
            children: [
              preview.items.length > 1 ? `${ICONS.arrowUp} / ${ICONS.arrowDown} 切换文件　` : "",
              `Tab / ${ICONS.arrowLeft} / ${ICONS.arrowRight} 切换　Enter 确认　Y 批准　N 拒绝　V 切换视图　L 切换行号　W 切换换行　Esc 中断本次生成`
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/InitWarnings.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV27 } from "@opentui/react/jsx-dev-runtime";
var MAX_VISIBLE_LINES = 3;
function InitWarnings({ warnings, color, icon }) {
  if (warnings.length === 0)
    return null;
  const fg = color ?? C.warn;
  const prefix = icon ?? ICONS.warning;
  return /* @__PURE__ */ jsxDEV27("box", {
    flexDirection: "column",
    paddingLeft: 2,
    paddingRight: 2,
    paddingBottom: 1,
    maxHeight: MAX_VISIBLE_LINES + 1,
    children: warnings.map((msg, i) => /* @__PURE__ */ jsxDEV27("box", {
      children: /* @__PURE__ */ jsxDEV27("text", {
        children: [
          /* @__PURE__ */ jsxDEV27("span", {
            fg,
            children: [
              prefix,
              " "
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV27("span", {
            fg,
            children: msg
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, i, false, undefined, this))
  }, undefined, false, undefined, this);
}

// extensions/console/src/components/LogoScreen.tsx
import { jsxDEV as jsxDEV28 } from "@opentui/react/jsx-dev-runtime";
function LogoScreen() {
  return /* @__PURE__ */ jsxDEV28("box", {
    flexDirection: "column",
    flexGrow: 1,
    padding: 1,
    alignItems: "center",
    justifyContent: "center",
    children: /* @__PURE__ */ jsxDEV28("box", {
      flexDirection: "column",
      border: false,
      padding: 2,
      alignItems: "center",
      children: [
        /* @__PURE__ */ jsxDEV28("text", {
          fg: C.primary,
          children: /* @__PURE__ */ jsxDEV28("strong", {
            children: "▀█▀ █▀█ ▀█▀ █▀▀"
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV28("text", {
          fg: C.primary,
          children: /* @__PURE__ */ jsxDEV28("strong", {
            children: " █  █▀▄  █  ▀▀█"
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV28("text", {
          fg: C.primary,
          children: /* @__PURE__ */ jsxDEV28("strong", {
            children: "▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀"
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV28("text", {
          children: " "
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV28("text", {
          fg: C.dim,
          children: "模块化 AI 智能代理框架"
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/components/ToolDetailView.tsx
import { useState as useState7, useCallback as useCallback3 } from "react";
import { useKeyboard as useKeyboard2 } from "@opentui/react";
init_terminal_compat();
import { jsxDEV as jsxDEV29 } from "@opentui/react/jsx-dev-runtime";
var TERMINAL_STATUSES2 = new Set(["success", "warning", "error"]);
var STATUS_ICON = {
  streaming: ICONS.statusStreaming,
  queued: ICONS.statusQueued,
  awaiting_approval: ICONS.statusApproval,
  executing: ICONS.statusExecuting,
  awaiting_apply: ICONS.statusApply,
  success: ICONS.statusSuccess,
  warning: ICONS.statusWarning,
  error: ICONS.statusError
};
var STATUS_LABEL = {
  streaming: "输出中",
  queued: "等待中",
  awaiting_approval: "等待审批",
  executing: "执行中",
  awaiting_apply: "等待应用",
  success: "成功",
  warning: "警告",
  error: "失败"
};
var OUTPUT_LABEL = {
  stdout: "OUT",
  stderr: "ERR",
  log: "LOG",
  chat: "CHAT",
  data: "DATA"
};
var OUTPUT_COLOR = {
  stdout: "#aaa",
  stderr: "#ff6b6b",
  log: "#888",
  chat: "#7ec8e3",
  data: "#b8bb26"
};
function ts(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function dur(startMs, endMs) {
  const s = (endMs - startMs) / 1000;
  if (s < 0.05)
    return "";
  if (s < 60)
    return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}
function truncate(text, max) {
  const oneLine = text.replace(/\n/g, "↵ ");
  return oneLine.length > max ? oneLine.slice(0, max) + ICONS.ellipsis : oneLine;
}
function childArgsSummary(toolName, args) {
  switch (toolName) {
    case "shell":
    case "bash":
      return truncate(String(args.command || ""), 40);
    case "read_file":
    case "write_file":
    case "apply_diff":
    case "delete_code":
    case "insert_code": {
      if (Array.isArray(args.files) && args.files.length > 0) {
        const first = args.files[0];
        const path3 = typeof first === "object" && first ? String(first.path || "") : "";
        return args.files.length > 1 ? `${path3} +${args.files.length - 1}` : path3;
      }
      return String(args.path || "");
    }
    case "search_in_files":
      return `"${truncate(String(args.query || ""), 20)}" in ${args.path || "."}`;
    case "find_files":
      return Array.isArray(args.patterns) ? String(args.patterns[0] || "") : "";
    case "sub_agent":
      return truncate(String(args.prompt || ""), 50);
    default:
      return "";
  }
}
function Divider({ label }) {
  if (label) {
    return /* @__PURE__ */ jsxDEV29("text", {
      children: [
        /* @__PURE__ */ jsxDEV29("span", {
          fg: C.dim,
          children: "─── "
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV29("span", {
          fg: C.accent,
          children: /* @__PURE__ */ jsxDEV29("strong", {
            children: label
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV29("span", {
          fg: C.dim,
          children: " " + "─".repeat(50)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV29("text", {
    children: /* @__PURE__ */ jsxDEV29("span", {
      fg: C.dim,
      children: "─".repeat(60)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function ToolDetailView({ data, breadcrumb, onNavigateChild, onClose, onAbort }) {
  const { invocation, output, children } = data;
  const { toolName, status, args, result, error, createdAt, updatedAt } = invocation;
  const [selectedIdx, setSelectedIdx] = useState7(0);
  const isFinal = TERMINAL_STATUSES2.has(status);
  const isExecuting = status === "executing";
  const DetailRenderer = getToolDetailRenderer(toolName);
  const ResultRenderer = isFinal && result != null ? getToolRenderer(toolName) : null;
  useKeyboard2(useCallback3((key) => {
    if (key.name === "escape" || key.name === "q") {
      onClose();
      return;
    }
    if (key.name === "a" && !isFinal && onAbort) {
      onAbort(invocation.id);
      return;
    }
    if (children.length > 0) {
      if (key.name === "up" || key.name === "k") {
        setSelectedIdx((p) => Math.max(0, p - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedIdx((p) => Math.min(children.length - 1, p + 1));
      } else if (key.name === "return") {
        const c = children[selectedIdx];
        if (c)
          onNavigateChild(c.id);
      }
    }
  }, [onClose, onAbort, isFinal, invocation.id, children, selectedIdx, onNavigateChild]));
  if (DetailRenderer) {
    return /* @__PURE__ */ jsxDEV29("box", {
      flexDirection: "column",
      width: "100%",
      children: [
        /* @__PURE__ */ jsxDEV29(BreadcrumbBar, {
          breadcrumb,
          toolName
        }, undefined, false, undefined, this),
        DetailRenderer({ invocation, output, children, onNavigateChild }),
        /* @__PURE__ */ jsxDEV29(FooterBar, {
          isFinal,
          hasAbort: !!onAbort,
          hasChildren: children.length > 0
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV29("box", {
    flexDirection: "column",
    width: "100%",
    children: [
      /* @__PURE__ */ jsxDEV29(BreadcrumbBar, {
        breadcrumb,
        toolName
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV29("box", {
        children: [
          /* @__PURE__ */ jsxDEV29("text", {
            children: [
              /* @__PURE__ */ jsxDEV29("span", {
                bg: status === "error" ? C.error : C.accent,
                fg: C.cursorFg,
                children: /* @__PURE__ */ jsxDEV29("strong", {
                  children: [
                    " ",
                    toolName,
                    " "
                  ]
                }, undefined, true, undefined, this)
              }, undefined, false, undefined, this),
              "  ",
              /* @__PURE__ */ jsxDEV29("span", {
                fg: isFinal ? status === "error" ? C.error : C.accent : C.dim,
                children: [
                  STATUS_ICON[status] || ICONS.statusQueued,
                  " ",
                  STATUS_LABEL[status] || status
                ]
              }, undefined, true, undefined, this),
              dur(createdAt, updatedAt) ? /* @__PURE__ */ jsxDEV29("span", {
                fg: C.dim,
                children: [
                  "  ",
                  dur(createdAt, updatedAt)
                ]
              }, undefined, true, undefined, this) : null,
              "  "
            ]
          }, undefined, true, undefined, this),
          isExecuting && /* @__PURE__ */ jsxDEV29(Spinner, {}, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV29("box", {
        marginTop: 0,
        children: /* @__PURE__ */ jsxDEV29("text", {
          children: [
            /* @__PURE__ */ jsxDEV29("span", {
              fg: C.dim,
              children: [
                "  ",
                ICONS.timer,
                " ",
                ts(createdAt)
              ]
            }, undefined, true, undefined, this),
            isFinal ? /* @__PURE__ */ jsxDEV29("span", {
              fg: C.dim,
              children: [
                ` ${ICONS.arrowRight} `,
                ts(updatedAt)
              ]
            }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV29("span", {
              fg: C.dim,
              children: ` ${ICONS.arrowRight} ${ICONS.ellipsis}`
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV29(Divider, {
        label: "参数"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV29(ArgsSection, {
        args
      }, undefined, false, undefined, this),
      output.length > 0 && /* @__PURE__ */ jsxDEV29("box", {
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxDEV29(Divider, {
            label: `输出 (${output.length})`
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV29(OutputSection, {
            output
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      children.length > 0 && /* @__PURE__ */ jsxDEV29("box", {
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxDEV29(Divider, {
            label: `子工具 (${children.length})`
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV29(ChildrenSection, {
            children,
            selectedIdx
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      isFinal && /* @__PURE__ */ jsxDEV29("box", {
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxDEV29(Divider, {
            label: "结果"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV29(ResultSection, {
            status,
            error,
            result,
            toolName,
            args,
            Renderer: ResultRenderer
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV29(Divider, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV29(FooterBar, {
        isFinal,
        hasAbort: !!onAbort,
        hasChildren: children.length > 0
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function BreadcrumbBar({ breadcrumb, toolName }) {
  return /* @__PURE__ */ jsxDEV29("box", {
    marginBottom: 0,
    children: /* @__PURE__ */ jsxDEV29("text", {
      children: [
        /* @__PURE__ */ jsxDEV29("span", {
          fg: C.dim,
          children: `${ICONS.arrowLeft} [Esc] `
        }, undefined, false, undefined, this),
        breadcrumb.map((b) => /* @__PURE__ */ jsxDEV29("span", {
          children: [
            /* @__PURE__ */ jsxDEV29("span", {
              fg: C.dim,
              children: b.toolName
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV29("span", {
              fg: C.dim,
              children: " › "
            }, undefined, false, undefined, this)
          ]
        }, b.toolId, true, undefined, this)),
        /* @__PURE__ */ jsxDEV29("span", {
          fg: C.accent,
          children: /* @__PURE__ */ jsxDEV29("strong", {
            children: toolName
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function ArgsSection({ args }) {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return /* @__PURE__ */ jsxDEV29("text", {
      fg: C.dim,
      children: "  (无参数)"
    }, undefined, false, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV29("box", {
    flexDirection: "column",
    children: [
      entries.slice(0, 8).map(([key, val]) => {
        let display;
        if (typeof val === "string") {
          display = truncate(val, 80);
        } else if (Array.isArray(val)) {
          display = `[${val.length} items]`;
        } else if (val && typeof val === "object") {
          display = truncate(JSON.stringify(val), 80);
        } else {
          display = String(val);
        }
        return /* @__PURE__ */ jsxDEV29("text", {
          children: [
            /* @__PURE__ */ jsxDEV29("span", {
              fg: C.accent,
              children: [
                "  ",
                key
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ jsxDEV29("span", {
              fg: C.dim,
              children: " = "
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV29("span", {
              children: display
            }, undefined, false, undefined, this)
          ]
        }, key, true, undefined, this);
      }),
      entries.length > 8 && /* @__PURE__ */ jsxDEV29("text", {
        fg: C.dim,
        children: `  ${ICONS.ellipsis} +${entries.length - 8} 更多参数`
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function OutputSection({ output }) {
  const visible = output.length > 20 ? output.slice(-20) : output;
  const skipped = output.length - visible.length;
  return /* @__PURE__ */ jsxDEV29("box", {
    flexDirection: "column",
    children: [
      skipped > 0 && /* @__PURE__ */ jsxDEV29("text", {
        fg: C.dim,
        children: `  ${ICONS.ellipsis} 省略 ${skipped} 条`
      }, undefined, false, undefined, this),
      visible.map((entry, i) => /* @__PURE__ */ jsxDEV29("text", {
        children: [
          /* @__PURE__ */ jsxDEV29("span", {
            fg: C.dim,
            children: [
              "  ",
              ts(entry.timestamp),
              " "
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV29("span", {
            fg: OUTPUT_COLOR[entry.type] || C.dim,
            children: [
              "[",
              OUTPUT_LABEL[entry.type] || entry.type,
              "]"
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV29("span", {
            children: [
              " ",
              truncate(entry.content, 100)
            ]
          }, undefined, true, undefined, this)
        ]
      }, i, true, undefined, this))
    ]
  }, undefined, true, undefined, this);
}
function ChildrenSection({ children, selectedIdx }) {
  return /* @__PURE__ */ jsxDEV29("box", {
    flexDirection: "column",
    children: children.map((child, i) => {
      const sel = i === selectedIdx;
      const icon = STATUS_ICON[child.status] || ICONS.statusQueued;
      const d = dur(child.createdAt, child.updatedAt);
      const summary = childArgsSummary(child.toolName, child.args);
      return /* @__PURE__ */ jsxDEV29("text", {
        children: [
          /* @__PURE__ */ jsxDEV29("span", {
            fg: sel ? C.accent : C.dim,
            children: sel ? ` ${ICONS.triangleRight} ` : "   "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV29("span", {
            bg: child.status === "error" ? C.error : C.accent,
            fg: C.cursorFg,
            children: [
              " ",
              child.toolName,
              " "
            ]
          }, undefined, true, undefined, this),
          summary ? /* @__PURE__ */ jsxDEV29("span", {
            fg: C.dim,
            children: [
              " ",
              summary
            ]
          }, undefined, true, undefined, this) : null,
          /* @__PURE__ */ jsxDEV29("span", {
            children: [
              " ",
              icon
            ]
          }, undefined, true, undefined, this),
          d ? /* @__PURE__ */ jsxDEV29("span", {
            fg: C.dim,
            children: [
              " ",
              d
            ]
          }, undefined, true, undefined, this) : null
        ]
      }, child.id, true, undefined, this);
    })
  }, undefined, false, undefined, this);
}
function ResultSection({ status, error, result, toolName, args, Renderer }) {
  if (status === "error" && error) {
    return /* @__PURE__ */ jsxDEV29("text", {
      fg: C.error,
      children: [
        "  ",
        error
      ]
    }, undefined, true, undefined, this);
  }
  if (Renderer && result != null) {
    return /* @__PURE__ */ jsxDEV29("box", {
      paddingLeft: 2,
      children: Renderer({ toolName, args, result })
    }, undefined, false, undefined, this);
  }
  if (result != null) {
    const text_content = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    const lines = text_content.split(`
`);
    const visible = lines.length > 10 ? lines.slice(0, 10) : lines;
    return /* @__PURE__ */ jsxDEV29("box", {
      flexDirection: "column",
      children: [
        visible.map((line, i) => /* @__PURE__ */ jsxDEV29("text", {
          fg: C.dim,
          children: [
            "  ",
            line
          ]
        }, i, true, undefined, this)),
        lines.length > 10 && /* @__PURE__ */ jsxDEV29("text", {
          fg: C.dim,
          children: `  ${ICONS.ellipsis} +${lines.length - 10} 行`
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV29("text", {
    fg: C.dim,
    children: "  (无结果)"
  }, undefined, false, undefined, this);
}
function FooterBar({ isFinal, hasAbort, hasChildren }) {
  return /* @__PURE__ */ jsxDEV29("box", {
    children: /* @__PURE__ */ jsxDEV29("text", {
      children: [
        /* @__PURE__ */ jsxDEV29("span", {
          fg: C.dim,
          children: " [Esc/q] 返回"
        }, undefined, false, undefined, this),
        !isFinal && hasAbort ? /* @__PURE__ */ jsxDEV29("span", {
          fg: C.dim,
          children: "  [a] 终止"
        }, undefined, false, undefined, this) : null,
        hasChildren ? /* @__PURE__ */ jsxDEV29("span", {
          fg: C.dim,
          children: `  [${ICONS.arrowUp}${ICONS.arrowDown}] 选择子工具  [Enter] 查看详情`
        }, undefined, false, undefined, this) : null
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// extensions/console/src/components/ModelListView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV30 } from "@opentui/react/jsx-dev-runtime";
function ModelListView({ models, selectedIndex }) {
  return /* @__PURE__ */ jsxDEV30("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV30("box", {
        padding: 1,
        children: [
          /* @__PURE__ */ jsxDEV30("text", {
            fg: C.primary,
            children: "切换模型"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV30("text", {
            fg: C.dim,
            children: `  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 切换  Esc 返回`
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV30("scrollbox", {
        flexGrow: 1,
        children: models.map((info, index) => {
          const isSelected = index === selectedIndex;
          const currentMarker = info.current ? ICONS.bullet : " ";
          return /* @__PURE__ */ jsxDEV30("box", {
            paddingLeft: 1,
            children: /* @__PURE__ */ jsxDEV30("text", {
              children: [
                /* @__PURE__ */ jsxDEV30("span", {
                  fg: isSelected ? C.accent : C.dim,
                  children: isSelected ? `${ICONS.selectorArrow} ` : "  "
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV30("span", {
                  fg: info.current ? C.accent : C.dim,
                  children: [
                    currentMarker,
                    " "
                  ]
                }, undefined, true, undefined, this),
                isSelected ? /* @__PURE__ */ jsxDEV30("strong", {
                  children: /* @__PURE__ */ jsxDEV30("span", {
                    fg: C.text,
                    children: info.modelName
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV30("span", {
                  fg: C.textSec,
                  children: info.modelName
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV30("span", {
                  fg: C.dim,
                  children: [
                    "  ",
                    info.modelId,
                    "  ",
                    info.provider
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, info.modelName, false, undefined, this);
        })
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/QueueListView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV31 } from "@opentui/react/jsx-dev-runtime";
function formatQueueTime(timestamp) {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function truncatePreview(text, maxLen) {
  const single = text.replace(/\r\n/g, `
`).replace(/\n/g, " ↵ ").trim();
  if (single.length <= maxLen)
    return single;
  return single.slice(0, maxLen - 1) + ICONS.ellipsis;
}
function countNewlines(text) {
  let count = 0;
  for (const ch of text)
    if (ch === `
`)
      count++;
  return count;
}
function QueueListView({ queue, selectedIndex, editingId, editingValue, editingCursor }) {
  const isEditing = editingId != null;
  const cursorVisible = useCursorBlink();
  return /* @__PURE__ */ jsxDEV31("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV31("box", {
        padding: 1,
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxDEV31("box", {
            children: [
              /* @__PURE__ */ jsxDEV31("text", {
                fg: C.primary,
                children: "消息队列"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV31("text", {
                fg: C.dim,
                children: `  (${queue.length} 条待发送)`
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV31("box", {
            paddingTop: 0,
            children: isEditing ? /* @__PURE__ */ jsxDEV31("text", {
              fg: C.dim,
              children: "  Ctrl+J 换行  Enter 确认  Ctrl+U 清空  Esc 取消"
            }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV31("text", {
              fg: C.dim,
              children: `  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Ctrl/Shift+${ICONS.arrowUp}${ICONS.arrowDown} 移动  e 编辑  d 删除  c 清空队列  Esc 返回`
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV31("scrollbox", {
        flexGrow: 1,
        children: [
          queue.length === 0 && /* @__PURE__ */ jsxDEV31("text", {
            fg: C.dim,
            paddingLeft: 2,
            children: "队列为空"
          }, undefined, false, undefined, this),
          queue.map((msg, index) => {
            const isSelected = index === selectedIndex;
            const isMsgEditing = msg.id === editingId;
            const time = formatQueueTime(msg.createdAt);
            if (isMsgEditing) {
              const nlCount = countNewlines(editingValue);
              return /* @__PURE__ */ jsxDEV31("box", {
                paddingLeft: 1,
                flexDirection: "column",
                children: [
                  /* @__PURE__ */ jsxDEV31("text", {
                    children: [
                      /* @__PURE__ */ jsxDEV31("span", {
                        fg: C.accent,
                        children: "❯ "
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV31("span", {
                        fg: C.dim,
                        children: `${index + 1}. `
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV31("span", {
                        fg: C.warn,
                        children: "[编辑中]"
                      }, undefined, false, undefined, this),
                      nlCount > 0 ? /* @__PURE__ */ jsxDEV31("span", {
                        fg: C.dim,
                        children: ` (${nlCount + 1} 行)`
                      }, undefined, false, undefined, this) : null,
                      /* @__PURE__ */ jsxDEV31("span", {
                        fg: C.dim,
                        children: `  ${time}`
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  /* @__PURE__ */ jsxDEV31("box", {
                    paddingLeft: 4,
                    children: /* @__PURE__ */ jsxDEV31(InputDisplay, {
                      value: editingValue,
                      cursor: editingCursor,
                      isActive: true,
                      cursorVisible
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this)
                ]
              }, msg.id, true, undefined, this);
            }
            const preview = truncatePreview(msg.text, 60);
            return /* @__PURE__ */ jsxDEV31("box", {
              paddingLeft: 1,
              children: /* @__PURE__ */ jsxDEV31("text", {
                children: [
                  /* @__PURE__ */ jsxDEV31("span", {
                    fg: isSelected ? C.accent : C.dim,
                    children: isSelected ? "❯ " : "  "
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV31("span", {
                    fg: C.dim,
                    children: `${index + 1}. `
                  }, undefined, false, undefined, this),
                  isSelected ? /* @__PURE__ */ jsxDEV31("strong", {
                    children: /* @__PURE__ */ jsxDEV31("span", {
                      fg: C.text,
                      children: preview
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV31("span", {
                    fg: C.textSec,
                    children: preview
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV31("span", {
                    fg: C.dim,
                    children: `  ${time}`
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, msg.id, false, undefined, this);
          })
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/ToolListView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV32 } from "@opentui/react/jsx-dev-runtime";
var STATUS_ICON2 = {
  streaming: ICONS.statusStreaming,
  queued: ICONS.statusQueued,
  awaiting_approval: ICONS.statusApproval,
  executing: ICONS.statusExecuting,
  awaiting_apply: ICONS.statusApply,
  success: ICONS.statusSuccess,
  warning: ICONS.statusWarning,
  error: ICONS.statusError
};
function formatDuration(startMs, endMs) {
  const s = (endMs - startMs) / 1000;
  if (s < 0.05)
    return "";
  if (s < 60)
    return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}
function argsSummary(toolName, args) {
  switch (toolName) {
    case "shell":
    case "bash": {
      const cmd = String(args.command || "");
      return cmd.length > 40 ? `"${cmd.slice(0, 40)}${ICONS.ellipsis}"` : `"${cmd}"`;
    }
    case "read_file":
    case "write_file":
    case "apply_diff":
    case "delete_code":
    case "insert_code": {
      if (Array.isArray(args.files) && args.files.length > 0) {
        const first = args.files[0];
        const path3 = typeof first === "object" && first ? String(first.path || "") : "";
        return args.files.length > 1 ? `${path3} +${args.files.length - 1}` : path3;
      }
      return String(args.path || "");
    }
    case "search_in_files": {
      const q = String(args.query || "");
      const head = q.length > 20 ? `"${q.slice(0, 20)}${ICONS.ellipsis}"` : `"${q}"`;
      return args.path ? `${head} in ${args.path}` : head;
    }
    case "find_files":
      return Array.isArray(args.patterns) ? String(args.patterns[0] || "") : "";
    case "sub_agent": {
      const prompt = String(args.prompt || "");
      return prompt.length > 50 ? `"${prompt.slice(0, 50)}${ICONS.ellipsis}"` : `"${prompt}"`;
    }
    default:
      return "";
  }
}
function ToolListView({ tools, selectedIndex }) {
  if (tools.length === 0) {
    return /* @__PURE__ */ jsxDEV32("box", {
      flexDirection: "column",
      paddingX: 1,
      children: [
        /* @__PURE__ */ jsxDEV32("text", {
          fg: C.dim,
          children: "当前会话没有工具执行记录。"
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV32("text", {
          fg: C.dim,
          children: " "
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV32("text", {
          fg: C.dim,
          children: "Esc 返回"
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV32("box", {
    flexDirection: "column",
    paddingX: 1,
    children: [
      /* @__PURE__ */ jsxDEV32("text", {
        children: [
          /* @__PURE__ */ jsxDEV32("span", {
            fg: C.accent,
            children: /* @__PURE__ */ jsxDEV32("strong", {
              children: " 工具执行记录 "
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV32("span", {
            fg: C.dim,
            children: [
              "(",
              tools.length,
              ")"
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV32("text", {
        fg: C.dim,
        children: "─".repeat(60)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV32("scrollbox", {
        flexGrow: 1,
        children: tools.map((inv, i) => {
          const sel = i === selectedIndex;
          const icon = STATUS_ICON2[inv.status] || ICONS.statusQueued;
          const d = formatDuration(inv.createdAt, inv.updatedAt);
          const summary = argsSummary(inv.toolName, inv.args);
          const time = new Date(inv.createdAt);
          const timeStr = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;
          return /* @__PURE__ */ jsxDEV32("text", {
            children: [
              /* @__PURE__ */ jsxDEV32("span", {
                fg: sel ? C.accent : C.dim,
                children: sel ? ` ${ICONS.selectorArrow} ` : "   "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV32("span", {
                fg: C.dim,
                children: [
                  timeStr,
                  " "
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ jsxDEV32("span", {
                bg: inv.status === "error" ? C.error : C.accent,
                fg: C.cursorFg,
                children: [
                  " ",
                  inv.toolName,
                  " "
                ]
              }, undefined, true, undefined, this),
              summary ? /* @__PURE__ */ jsxDEV32("span", {
                fg: sel ? undefined : C.dim,
                children: [
                  " ",
                  summary
                ]
              }, undefined, true, undefined, this) : null,
              /* @__PURE__ */ jsxDEV32("span", {
                children: [
                  " ",
                  icon
                ]
              }, undefined, true, undefined, this),
              d ? /* @__PURE__ */ jsxDEV32("span", {
                fg: C.dim,
                children: [
                  " ",
                  d
                ]
              }, undefined, true, undefined, this) : null
            ]
          }, inv.id, true, undefined, this);
        })
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV32("text", {
        fg: C.dim,
        children: "─".repeat(60)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV32("text", {
        fg: C.dim,
        children: ` ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 查看详情  Esc 返回`
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/SessionListView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV33 } from "@opentui/react/jsx-dev-runtime";
function SessionListView({ sessions, selectedIndex }) {
  return /* @__PURE__ */ jsxDEV33("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV33("box", {
        padding: 1,
        children: [
          /* @__PURE__ */ jsxDEV33("text", {
            fg: C.primary,
            children: "历史对话"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV33("text", {
            fg: C.dim,
            children: `  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 加载  Esc 返回`
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV33("scrollbox", {
        flexGrow: 1,
        children: [
          sessions.length === 0 && /* @__PURE__ */ jsxDEV33("text", {
            fg: C.dim,
            paddingLeft: 2,
            children: "暂无历史对话"
          }, undefined, false, undefined, this),
          sessions.map((meta, index) => {
            const isSelected = index === selectedIndex;
            const time = new Date(meta.updatedAt ?? 0).toLocaleString("zh-CN");
            return /* @__PURE__ */ jsxDEV33("box", {
              paddingLeft: 1,
              children: /* @__PURE__ */ jsxDEV33("text", {
                children: [
                  /* @__PURE__ */ jsxDEV33("span", {
                    fg: isSelected ? C.accent : C.dim,
                    children: isSelected ? `${ICONS.selectorArrow} ` : "  "
                  }, undefined, false, undefined, this),
                  isSelected ? /* @__PURE__ */ jsxDEV33("strong", {
                    children: /* @__PURE__ */ jsxDEV33("span", {
                      fg: C.text,
                      children: meta.title
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV33("span", {
                    fg: C.textSec,
                    children: meta.title
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV33("span", {
                    fg: C.dim,
                    children: [
                      "  ",
                      meta.cwd,
                      "  ",
                      time
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, meta.id, false, undefined, this);
          })
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/MemoryListView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV34 } from "@opentui/react/jsx-dev-runtime";
var TYPE_LABELS = {
  user: "user",
  feedback: "feedback",
  project: "project",
  reference: "reference"
};
var FILTER_CYCLE = ["all", "user", "feedback", "project", "reference"];
function nextFilter(current) {
  const idx = FILTER_CYCLE.indexOf(current);
  return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
}
function filterMemories(items, filter) {
  if (filter === "all")
    return items;
  return items.filter((m) => m.type === filter);
}
function MemoryListView({ memories, selectedIndex, expandedId, filter, pendingDeleteId }) {
  const filtered = filterMemories(memories, filter);
  const total = memories.length;
  const shown = filtered.length;
  const filterLabel = filter === "all" ? `(${total} ${ICONS.separator} Tab ${ICONS.triangleRight})` : `[${filter}] (${shown}/${total} ${ICONS.separator} Tab ${ICONS.triangleRight})`;
  return /* @__PURE__ */ jsxDEV34("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV34("box", {
        padding: 1,
        children: [
          /* @__PURE__ */ jsxDEV34("text", {
            fg: C.primary,
            children: `${ICONS.bullet} `
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV34("text", {
            fg: C.primary,
            children: "Memory "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV34("text", {
            fg: C.dim,
            children: filterLabel
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV34("text", {
            fg: C.dim,
            children: `  ${ICONS.arrowUp}${ICONS.arrowDown} select  Enter expand  D delete  Esc back`
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV34("scrollbox", {
        flexGrow: 1,
        children: [
          filtered.length === 0 && /* @__PURE__ */ jsxDEV34("text", {
            fg: C.dim,
            paddingLeft: 2,
            children: filter === "all" ? "No memories yet." : `No ${filter} memories.`
          }, undefined, false, undefined, this),
          filtered.map((item, index) => {
            const isSelected = index === selectedIndex;
            const isExpanded = item.id === expandedId;
            const isPendingDelete = item.id === pendingDeleteId;
            const typeTag = TYPE_LABELS[item.type] ?? item.type;
            const age = formatAge(item.updatedAt);
            return /* @__PURE__ */ jsxDEV34("box", {
              flexDirection: "column",
              paddingLeft: 1,
              children: [
                /* @__PURE__ */ jsxDEV34("box", {
                  children: /* @__PURE__ */ jsxDEV34("text", {
                    children: [
                      /* @__PURE__ */ jsxDEV34("span", {
                        fg: isSelected ? C.accent : C.dim,
                        children: isSelected ? `${ICONS.selectorArrow} ` : "  "
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV34("span", {
                        fg: C.dim,
                        children: `[${typeTag}] `
                      }, undefined, false, undefined, this),
                      isSelected ? /* @__PURE__ */ jsxDEV34("strong", {
                        children: /* @__PURE__ */ jsxDEV34("span", {
                          fg: C.text,
                          children: item.name || `#${item.id}`
                        }, undefined, false, undefined, this)
                      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV34("span", {
                        fg: C.textSec,
                        children: item.name || `#${item.id}`
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV34("span", {
                        fg: C.dim,
                        children: ` ${ICONS.emDash} ${item.description || "(no description)"}`
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV34("span", {
                        fg: C.dim,
                        children: `  ${age}`
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this)
                }, undefined, false, undefined, this),
                isPendingDelete && /* @__PURE__ */ jsxDEV34("box", {
                  paddingLeft: 4,
                  children: /* @__PURE__ */ jsxDEV34("text", {
                    fg: C.error,
                    children: "Delete this memory? (D) confirm  (Esc) cancel"
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this),
                isExpanded && !isPendingDelete && /* @__PURE__ */ jsxDEV34("box", {
                  paddingLeft: 4,
                  paddingBottom: 1,
                  children: /* @__PURE__ */ jsxDEV34("text", {
                    fg: C.textSec,
                    children: item.content
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              ]
            }, item.id, true, undefined, this);
          })
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function formatAge(unixSec) {
  const now = Date.now() / 1000;
  const diff = now - unixSec;
  if (diff < 60)
    return "just now";
  if (diff < 3600)
    return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)
    return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30)
    return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString("zh-CN");
}

// extensions/console/src/components/ExtensionListView.tsx
init_terminal_compat();
import { jsxDEV as jsxDEV35 } from "@opentui/react/jsx-dev-runtime";
var STATUS_LABELS = {
  active: { label: "active", color: "#2ecc71" },
  disabled: { label: "disabled", color: "#e74c3c" },
  available: { label: "available", color: "#f39c12" },
  platform: { label: "platform", color: "#95a5a6" }
};
function ExtensionListView({
  extensions,
  selectedIndex,
  togglingName,
  statusMessage,
  statusIsError
}) {
  const total = extensions.length;
  return /* @__PURE__ */ jsxDEV35("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV35("box", {
        padding: 1,
        children: [
          /* @__PURE__ */ jsxDEV35("text", {
            fg: C.primary,
            children: `${ICONS.bullet} `
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV35("text", {
            fg: C.primary,
            children: "Extension "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV35("text", {
            fg: C.dim,
            children: `(${total} extensions)`
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV35("text", {
            fg: C.dim,
            children: `  ${ICONS.arrowUp}${ICONS.arrowDown} select  Enter toggle  Esc back`
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      statusMessage && /* @__PURE__ */ jsxDEV35("box", {
        paddingLeft: 2,
        paddingBottom: 1,
        children: /* @__PURE__ */ jsxDEV35("text", {
          fg: statusIsError ? C.error : C.accent,
          children: statusMessage
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV35("scrollbox", {
        flexGrow: 1,
        children: [
          extensions.length === 0 && /* @__PURE__ */ jsxDEV35("text", {
            fg: C.dim,
            paddingLeft: 2,
            children: "No extensions found."
          }, undefined, false, undefined, this),
          extensions.map((item, index) => {
            const isSelected = index === selectedIndex;
            const statusInfo = STATUS_LABELS[item.status] ?? STATUS_LABELS.platform;
            const isToggling = item.name === togglingName;
            return /* @__PURE__ */ jsxDEV35("box", {
              paddingLeft: 1,
              children: /* @__PURE__ */ jsxDEV35("text", {
                children: [
                  /* @__PURE__ */ jsxDEV35("span", {
                    fg: isSelected ? C.accent : C.dim,
                    children: isSelected ? `${ICONS.selectorArrow} ` : "  "
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV35("span", {
                    fg: statusInfo.color,
                    children: `[${isToggling ? "..." : statusInfo.label}] `
                  }, undefined, false, undefined, this),
                  isSelected ? /* @__PURE__ */ jsxDEV35("strong", {
                    children: /* @__PURE__ */ jsxDEV35("span", {
                      fg: C.text,
                      children: item.name
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV35("span", {
                    fg: C.textSec,
                    children: item.name
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV35("span", {
                    fg: C.dim,
                    children: ` v${item.version}`
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV35("span", {
                    fg: C.dim,
                    children: ` ${ICONS.emDash} ${item.description || "(no description)"}`
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, item.name, false, undefined, this);
          })
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/components/SettingsView.tsx
import { useCallback as useCallback4, useEffect as useEffect7, useMemo as useMemo4, useState as useState8 } from "react";
import { useKeyboard as useKeyboard3, useTerminalDimensions as useTerminalDimensions3 } from "@opentui/react";
init_terminal_compat();

// extensions/console/src/diff-approval.ts
var CONSOLE_DIFF_APPROVAL_VIEW_TOOLS = new Set([
  "apply_diff",
  "write_file",
  "insert_code",
  "delete_code",
  "search_in_files"
]);
function supportsConsoleDiffApprovalViewSetting(toolName) {
  return CONSOLE_DIFF_APPROVAL_VIEW_TOOLS.has(toolName);
}
function getConsoleDiffApprovalViewDescription(toolName) {
  switch (toolName) {
    case "search_in_files":
      return "空格切换。仅在 replace 模式需要手动确认时生效。";
    case "insert_code":
      return "空格切换。insert_code 需要手动确认时，打开 diff 审批页。";
    case "delete_code":
      return "空格切换。delete_code 需要手动确认时，打开 diff 审批页。";
    case "write_file":
      return "空格切换。write_file 需要手动确认时，打开 diff 审批页。";
    case "apply_diff":
      return "空格切换。apply_diff 需要手动确认时，打开 diff 审批页。";
    default:
      return "空格切换。需要手动确认时，打开 diff 审批页。";
  }
}

// extensions/console/src/settings.ts
var CONSOLE_LLM_PROVIDER_OPTIONS = [
  "gemini",
  "openai-compatible",
  "openai-responses",
  "claude"
];
var CONSOLE_MCP_TRANSPORT_OPTIONS = [
  "stdio",
  "sse",
  "streamable-http"
];
function normalizeTransport(value) {
  if (value === "sse" || value === "streamable-http")
    return value;
  if (value === "http")
    return "streamable-http";
  return "stdio";
}
function sanitizeServerName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
function createEmptyModel(provider = "gemini", modelName = "", defaults = {}) {
  const providerDefaults = defaults[provider] ?? defaults.gemini ?? {};
  return {
    modelName,
    provider,
    apiKey: "",
    modelId: providerDefaults.model ?? "",
    baseUrl: providerDefaults.baseUrl ?? ""
  };
}
function applyModelProviderChange(model, nextProvider, defaults = {}) {
  const oldDefaults = defaults[model.provider] ?? {};
  const newDefaults = defaults[nextProvider] ?? {};
  return {
    ...model,
    provider: nextProvider,
    apiKey: model.apiKey,
    modelId: !model.modelId || model.modelId === oldDefaults.model ? newDefaults.model ?? model.modelId : model.modelId,
    baseUrl: !model.baseUrl || model.baseUrl === oldDefaults.baseUrl ? newDefaults.baseUrl ?? model.baseUrl : model.baseUrl
  };
}
function createDefaultMCPServerEntry() {
  return {
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    cwd: "",
    url: "",
    authHeader: "",
    timeout: 30000,
    enabled: true
  };
}
function cloneConsoleSettingsSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}
function buildModelPayload(model) {
  const payload = {
    provider: model.provider,
    model: model.modelId,
    baseUrl: model.baseUrl
  };
  payload.apiKey = model.apiKey || null;
  return payload;
}
function validateSnapshot(snapshot) {
  if (!Number.isFinite(snapshot.system.maxToolRounds) || snapshot.system.maxToolRounds < 1 || snapshot.system.maxToolRounds > 2000) {
    return "工具最大轮次必须在 1 到 2000 之间";
  }
  if (!Number.isFinite(snapshot.system.maxRetries) || snapshot.system.maxRetries < 0 || snapshot.system.maxRetries > 20) {
    return "最大重试次数必须在 0 到 20 之间";
  }
  if (!Number.isFinite(snapshot.system.maxAgentDepth) || snapshot.system.maxAgentDepth < 1 || snapshot.system.maxAgentDepth > 20) {
    return "最大代理深度必须在 1 到 20 之间";
  }
  if (!Array.isArray(snapshot.models) || snapshot.models.length === 0) {
    return "至少需要保留一个模型";
  }
  const modelNames = new Set;
  for (const model of snapshot.models) {
    const modelName = model.modelName.trim();
    if (!modelName) {
      return "模型名称不能为空";
    }
    if (modelNames.has(modelName)) {
      return `模型名称 "${modelName}" 重复`;
    }
    if (!model.modelId.trim()) {
      return `模型 "${modelName}" 缺少模型 ID`;
    }
    modelNames.add(modelName);
  }
  if (!snapshot.defaultModelName.trim()) {
    return "默认模型名称不能为空";
  }
  if (!modelNames.has(snapshot.defaultModelName.trim())) {
    return `默认模型 "${snapshot.defaultModelName}" 不存在`;
  }
  const names = new Set;
  for (const server of snapshot.mcpServers) {
    const trimmedName = server.name.trim();
    const safeName = sanitizeServerName(trimmedName);
    if (!trimmedName) {
      return "MCP 服务器名称不能为空";
    }
    if (safeName !== trimmedName) {
      return `MCP 服务器名称 "${trimmedName}" 仅支持字母、数字和下划线`;
    }
    if (names.has(trimmedName)) {
      return `MCP 服务器名称 "${trimmedName}" 重复`;
    }
    names.add(trimmedName);
    if (!Number.isFinite(server.timeout) || server.timeout < 1000 || server.timeout > 120000) {
      return `MCP 服务器 "${trimmedName}" 的超时必须在 1000 到 120000 毫秒之间`;
    }
    if (server.transport === "stdio" && !server.command.trim()) {
      return `MCP 服务器 "${trimmedName}" 缺少 command`;
    }
    if (server.transport !== "stdio" && !server.url.trim()) {
      return `MCP 服务器 "${trimmedName}" 缺少 url`;
    }
  }
  return null;
}
function buildLLMPayload(snapshot) {
  const models = {};
  for (const originalName of snapshot.modelOriginalNames) {
    if (!snapshot.models.some((model) => model.modelName.trim() === originalName)) {
      models[originalName] = null;
    }
  }
  for (const model of snapshot.models) {
    const modelName = model.modelName.trim();
    if (!modelName)
      continue;
    if (model.originalModelName && model.originalModelName !== modelName) {
      models[model.originalModelName] = null;
    }
    models[modelName] = buildModelPayload(model);
  }
  return {
    defaultModel: snapshot.defaultModelName.trim(),
    models
  };
}
function buildMCPPayload(snapshot) {
  const servers = {};
  for (const originalName of snapshot.mcpOriginalNames) {
    if (!snapshot.mcpServers.some((server) => server.name.trim() === originalName)) {
      servers[originalName] = null;
    }
  }
  for (const server of snapshot.mcpServers) {
    const name = sanitizeServerName(server.name.trim());
    if (!name)
      continue;
    if (server.originalName && server.originalName !== name) {
      servers[server.originalName] = null;
    }
    const entry = {
      transport: server.transport,
      enabled: server.enabled,
      timeout: server.timeout || 30000
    };
    if (server.transport === "stdio") {
      entry.command = server.command.trim();
      entry.args = server.args.split(/\r?\n/g).map((arg) => arg.trim()).filter(Boolean);
      entry.cwd = server.cwd.trim() ? server.cwd.trim() : null;
      entry.url = null;
      entry.headers = null;
    } else {
      entry.url = server.url.trim();
      entry.command = null;
      entry.args = null;
      entry.cwd = null;
      if (server.authHeader.trim()) {
        entry.headers = { Authorization: server.authHeader.trim() };
      } else if (!server.authHeader.trim()) {
        entry.headers = null;
      }
    }
    servers[name] = entry;
  }
  return Object.keys(servers).length > 0 ? { servers } : null;
}

class ConsoleSettingsController {
  backend;
  configManager;
  mcpManager;
  extensions;
  constructor(options) {
    this.backend = options.backend;
    this.configManager = options.configManager;
    this.mcpManager = options.mcpManager;
    this.extensions = options.extensions;
  }
  async loadSnapshot() {
    const data = this.configManager?.readEditableConfig() ?? {};
    const llm = this.configManager?.parseLLMConfig(data.llm) ?? {};
    const system = this.configManager?.parseSystemConfig(data.system) ?? {};
    const toolsConfig = this.configManager?.parseToolsConfig(data.tools) ?? {};
    const registeredToolNames = this.backend.getToolNames?.() ?? [];
    const configuredToolNames = Object.keys(toolsConfig.permissions ?? {});
    const allToolNames = Array.from(new Set([...registeredToolNames, ...configuredToolNames])).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const rawMcpServers = data.mcp?.servers && typeof data.mcp.servers === "object" ? data.mcp.servers : {};
    const permissions = toolsConfig.permissions ?? {};
    return {
      models: (llm.models ?? []).map((model) => ({
        modelName: model.modelName,
        originalModelName: model.modelName,
        provider: model.provider,
        apiKey: model.apiKey,
        modelId: model.model,
        baseUrl: model.baseUrl
      })),
      modelOriginalNames: (llm.models ?? []).map((model) => model.modelName),
      defaultModelName: llm.defaultModelName ?? "",
      system: {
        systemPrompt: system.systemPrompt ?? "",
        maxToolRounds: system.maxToolRounds ?? 30,
        stream: system.stream !== false,
        retryOnError: system.retryOnError !== false,
        maxRetries: system.maxRetries ?? 3,
        logRequests: system.logRequests === true,
        maxAgentDepth: system.maxAgentDepth ?? 3,
        defaultMode: system.defaultMode ?? "",
        asyncSubAgents: system.asyncSubAgents === true
      },
      toolPolicies: allToolNames.map((name) => ({
        name,
        configured: Object.prototype.hasOwnProperty.call(permissions, name),
        autoApprove: permissions[name]?.autoApprove === true,
        registered: registeredToolNames.includes(name),
        showApprovalView: supportsConsoleDiffApprovalViewSetting(name) ? permissions[name]?.showApprovalView !== false : permissions[name]?.showApprovalView,
        allowPatterns: permissions[name]?.allowPatterns,
        denyPatterns: permissions[name]?.denyPatterns
      })),
      autoApproveAll: toolsConfig.autoApproveAll === true,
      autoApproveConfirmation: toolsConfig.autoApproveConfirmation === true,
      autoApproveDiff: toolsConfig.autoApproveDiff === true,
      mcpServers: Object.entries(rawMcpServers).map(([name, cfg]) => ({
        name,
        originalName: name,
        transport: normalizeTransport(cfg?.transport),
        command: cfg?.command ? String(cfg.command) : "",
        args: Array.isArray(cfg?.args) ? cfg.args.map((arg) => String(arg)).join(`
`) : "",
        cwd: cfg?.cwd ? String(cfg.cwd) : "",
        url: cfg?.url ? String(cfg.url) : "",
        authHeader: cfg?.headers?.Authorization ? String(cfg.headers.Authorization) : "",
        timeout: typeof cfg?.timeout === "number" ? cfg.timeout : 30000,
        enabled: cfg?.enabled !== false
      })),
      mcpStatus: this.mcpManager?.listServers?.() ?? [],
      mcpOriginalNames: Object.keys(rawMcpServers)
    };
  }
  async saveSnapshot(snapshot) {
    const draft = cloneConsoleSettingsSnapshot(snapshot);
    const validationError = validateSnapshot(draft);
    if (validationError) {
      return {
        ok: false,
        restartRequired: false,
        message: validationError
      };
    }
    const updates = {
      llm: buildLLMPayload(draft),
      system: {
        systemPrompt: draft.system.systemPrompt,
        maxToolRounds: draft.system.maxToolRounds,
        stream: draft.system.stream,
        retryOnError: draft.system.retryOnError,
        maxRetries: draft.system.maxRetries,
        logRequests: draft.system.logRequests,
        maxAgentDepth: draft.system.maxAgentDepth,
        defaultMode: draft.system.defaultMode || null,
        asyncSubAgents: draft.system.asyncSubAgents
      },
      tools: {
        autoApproveAll: draft.autoApproveAll || null,
        autoApproveConfirmation: draft.autoApproveConfirmation || null,
        autoApproveDiff: draft.autoApproveDiff || null,
        ...draft.toolPolicies.reduce((result, tool) => {
          if (!tool.configured) {
            return result;
          }
          const entry = { autoApprove: tool.autoApprove };
          if (typeof tool.showApprovalView === "boolean")
            entry.showApprovalView = tool.showApprovalView;
          if (tool.allowPatterns?.length)
            entry.allowPatterns = tool.allowPatterns;
          if (tool.denyPatterns?.length)
            entry.denyPatterns = tool.denyPatterns;
          result[tool.name] = entry;
          return result;
        }, {})
      },
      mcp: buildMCPPayload(draft)
    };
    let mergedRaw;
    try {
      ({ mergedRaw } = this.configManager?.updateEditableConfig(updates) ?? { mergedRaw: {} });
    } catch (err) {
      return {
        ok: false,
        restartRequired: false,
        message: err instanceof Error ? err.message : String(err)
      };
    }
    let restartRequired = false;
    let message = "已保存并生效";
    try {
      const result = await this.configManager?.applyRuntimeConfigReload(mergedRaw);
      if (result && !result.success) {
        restartRequired = true;
        message = `已保存，需要重启生效：${result.error ?? "未知错误"}`;
      }
    } catch (err) {
      restartRequired = true;
      const detail = err instanceof Error ? err.message : String(err);
      message = `已保存，需要重启生效：${detail}`;
    }
    try {
      const refreshed = await this.loadSnapshot();
      return {
        ok: true,
        restartRequired,
        message,
        snapshot: refreshed
      };
    } catch (err) {
      return {
        ok: true,
        restartRequired: true,
        message: `已保存，但刷新设置视图失败：${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
}

// extensions/console/src/components/SettingsView.tsx
import { jsxDEV as jsxDEV36 } from "@opentui/react/jsx-dev-runtime";
function getToolPolicyMode(configured, autoApprove) {
  if (!configured)
    return "disabled";
  return autoApprove ? "auto" : "manual";
}
function formatToolPolicyMode(mode) {
  if (mode === "auto")
    return "自动执行";
  if (mode === "manual")
    return "手动确认";
  return "不允许";
}
function getStatusColor(kind) {
  switch (kind) {
    case "success":
      return C.accent;
    case "warning":
      return C.warn;
    case "error":
      return C.error;
    default:
      return C.dim;
  }
}
function boolText(value) {
  return value ? "开启" : "关闭";
}
function transportLabel(value) {
  if (value === "stdio")
    return "stdio（本地进程）";
  if (value === "sse")
    return "sse（远程事件流）";
  return "streamable-http（远程 HTTP）";
}
function previewText(value, maxLength) {
  if (!value)
    return "(空)";
  const normalized = value.replace(/\r\n/g, `
`);
  const lines = normalized.split(`
`).filter(Boolean);
  const firstLine2 = lines[0] ?? "";
  const compact = firstLine2.length > maxLength ? `${firstLine2.slice(0, Math.max(1, maxLength - 1))}${ICONS.ellipsis}` : firstLine2;
  if (lines.length <= 1) {
    return compact || "(空)";
  }
  return `${lines.length} 行 ${ICONS.separator} ${compact}`;
}
function getEditableFingerprint(snapshot) {
  if (!snapshot)
    return "";
  return JSON.stringify({
    models: snapshot.models,
    modelOriginalNames: snapshot.modelOriginalNames,
    defaultModelName: snapshot.defaultModelName,
    system: snapshot.system,
    toolPolicies: snapshot.toolPolicies,
    autoApproveAll: snapshot.autoApproveAll,
    autoApproveConfirmation: snapshot.autoApproveConfirmation,
    autoApproveDiff: snapshot.autoApproveDiff,
    mcpServers: snapshot.mcpServers,
    mcpOriginalNames: snapshot.mcpOriginalNames
  });
}
function escapeMultilineForInput(value) {
  return value.replace(/\r\n/g, `
`).replace(/\n/g, "\\n");
}
function restoreMultilineFromInput(value) {
  return value.replace(/\\n/g, `
`);
}
function cycleValue(values, current, direction) {
  const currentIndex = values.indexOf(current);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (normalizedIndex + direction + values.length) % values.length;
  return values[nextIndex];
}
function buildRows(snapshot, termWidth) {
  const rows = [];
  const maxPreview = Math.max(18, termWidth - 38);
  const statusMap = new Map;
  for (const info of snapshot.mcpStatus) {
    statusMap.set(info.name, info);
  }
  const pushField = (id, section, label, value, target, description, indent = 2) => {
    rows.push({ id, kind: "field", section, label, value, target, description, indent });
  };
  rows.push({
    id: "section.general",
    kind: "section",
    section: "general",
    label: "模型与系统",
    description: "管理 LLM 模型池、默认模型、系统提示词、工具轮次与流式输出。"
  });
  rows.push({
    id: "model.add",
    kind: "action",
    section: "general",
    label: "新增模型",
    value: "Enter / A",
    target: { kind: "action", action: "addModel" },
    description: "创建新的模型草稿。",
    indent: 2
  });
  snapshot.models.forEach((model, index) => {
    const displayName = model.modelName || `model_${index + 1}`;
    rows.push({
      id: `model.${index}.summary`,
      kind: "info",
      section: "general",
      label: `${displayName} ${ICONS.separator} ${model.provider} ${ICONS.separator} ${model.modelId || "(空模型 ID)"}`,
      indent: 4
    });
    pushField(`model.${index}.default`, "general", "设为默认", boolText(snapshot.defaultModelName === model.modelName && !!model.modelName), { kind: "modelDefault", modelIndex: index }, "Space 或 Enter 设为默认模型。", 6);
    pushField(`model.${index}.provider`, "general", "Provider", model.provider, { kind: "modelProvider", modelIndex: index }, "左右方向键切换 Provider。", 6);
    pushField(`model.${index}.modelName`, "general", "名称", model.modelName || "(空)", { kind: "modelField", modelIndex: index, field: "modelName" }, "回车编辑。", 6);
    pushField(`model.${index}.modelId`, "general", "模型 ID", model.modelId || "(空)", { kind: "modelField", modelIndex: index, field: "modelId" }, "回车编辑。", 6);
    pushField(`model.${index}.apiKey`, "general", "API Key", model.apiKey || "未配置", { kind: "modelField", modelIndex: index, field: "apiKey" }, undefined, 6);
    pushField(`model.${index}.baseUrl`, "general", "Base URL", model.baseUrl || "(空)", { kind: "modelField", modelIndex: index, field: "baseUrl" }, "回车编辑。", 6);
  });
  pushField("system.systemPrompt", "general", "System / Prompt", previewText(snapshot.system.systemPrompt, maxPreview), { kind: "systemField", field: "systemPrompt" }, "回车编辑；\\n 表示换行。");
  pushField("system.maxToolRounds", "general", "System / Max Tool Rounds", String(snapshot.system.maxToolRounds), { kind: "systemField", field: "maxToolRounds" });
  pushField("system.stream", "general", "System / Stream Output", boolText(snapshot.system.stream), { kind: "systemField", field: "stream" }, "空格切换。");
  pushField("system.retryOnError", "general", "System / 报错自动重试", boolText(snapshot.system.retryOnError), { kind: "systemField", field: "retryOnError" }, "LLM 调用失败时自动重试，空格切换。");
  pushField("system.maxRetries", "general", "System / 最大重试次数", String(snapshot.system.maxRetries), { kind: "systemField", field: "maxRetries" }, "报错重试的最大次数（0-20），回车编辑。");
  pushField("system.logRequests", "general", "System / 记录请求日志", boolText(snapshot.system.logRequests), { kind: "systemField", field: "logRequests" }, "将 LLM 请求/响应记录到日志文件，空格切换。");
  pushField("system.maxAgentDepth", "general", "System / 最大代理深度", String(snapshot.system.maxAgentDepth), { kind: "systemField", field: "maxAgentDepth" }, "子代理最大嵌套深度（1-20），回车编辑。");
  pushField("system.defaultMode", "general", "System / 默认模式", snapshot.system.defaultMode || "(未设置)", { kind: "systemField", field: "defaultMode" }, "启动时默认使用的模式（如 code），回车编辑。");
  pushField("system.asyncSubAgents", "general", "System / 异步子代理", boolText(snapshot.system.asyncSubAgents), { kind: "systemField", field: "asyncSubAgents" }, "启用后子代理可在后台异步执行，主对话不阻塞。需在 sub_agents.yaml 中定义子代理类型。空格切换。");
  rows.push({ id: "section.tools", kind: "section", section: "tools", label: `工具执行策略（${snapshot.toolPolicies.length}）` });
  pushField("tools.autoApproveAll", "tools", "全部自动批准", boolText(snapshot.autoApproveAll), { kind: "toolGlobalToggle", field: "autoApproveAll" }, "跳过所有审批（一类确认 + 二类 diff 预览），最高优先级。空格切换。");
  pushField("tools.autoApproveConfirmation", "tools", "跳过确认审批", boolText(snapshot.autoApproveConfirmation), { kind: "toolGlobalToggle", field: "autoApproveConfirmation" }, "仅跳过一类审批（Y/N 确认），二类审批（diff 预览）仍生效。空格切换。");
  pushField("tools.autoApproveDiff", "tools", "跳过 Diff 审批", boolText(snapshot.autoApproveDiff), { kind: "toolGlobalToggle", field: "autoApproveDiff" }, "仅跳过二类审批（diff 预览），一类审批（Y/N 确认）仍生效。空格切换。");
  snapshot.toolPolicies.forEach((tool, index) => {
    const mode = getToolPolicyMode(tool.configured, tool.autoApprove);
    rows.push({
      id: `tool.${tool.name}`,
      kind: "field",
      section: "tools",
      label: `Tool / ${tool.name}${tool.registered ? "" : "（当前未注册）"}`,
      value: formatToolPolicyMode(mode),
      target: { kind: "toolPolicy", toolIndex: index },
      description: "空格或左右方向键切换。",
      indent: 2
    });
    if (supportsConsoleDiffApprovalViewSetting(tool.name)) {
      pushField(`tool.${tool.name}.approvalView`, "tools", "审批视图", boolText(tool.showApprovalView !== false), { kind: "toolApprovalView", toolIndex: index }, getConsoleDiffApprovalViewDescription(tool.name), 6);
    }
  });
  rows.push({ id: "section.mcp", kind: "section", section: "mcp", label: `MCP 服务器（${snapshot.mcpServers.length}）` });
  rows.push({
    id: "mcp.add",
    kind: "action",
    section: "mcp",
    label: "新增 MCP 服务器",
    value: "Enter / A",
    target: { kind: "action", action: "addMcp" },
    indent: 2
  });
  if (snapshot.mcpServers.length === 0) {
    rows.push({ id: "mcp.empty", kind: "info", section: "mcp", label: "暂无 MCP 服务器，按 Enter 或 A 新建。", indent: 4 });
  }
  snapshot.mcpServers.forEach((server, index) => {
    const status = server.enabled === false ? { name: server.name, status: "disabled", toolCount: 0, error: undefined } : statusMap.get(server.originalName ?? server.name) ?? statusMap.get(server.name);
    const errorText = status && "error" in status ? status.error : undefined;
    const summary = status ? `${server.name || `server_${index + 1}`} ${ICONS.separator} ${server.enabled ? "启用" : "禁用"} ${ICONS.separator} ${transportLabel(server.transport)} ${ICONS.separator} ${status.status}${errorText ? ` ${ICONS.separator} ${errorText}` : ` ${ICONS.separator} ${status.toolCount} tools`}` : `${server.name || `server_${index + 1}`} ${ICONS.separator} ${server.enabled ? "未应用" : "禁用"} ${ICONS.separator} ${transportLabel(server.transport)}`;
    rows.push({ id: `mcp.${index}.summary`, kind: "info", section: "mcp", label: summary, indent: 4 });
    pushField(`mcp.${index}.name`, "mcp", "名称", server.name || "(空)", { kind: "mcpField", serverIndex: index, field: "name" }, "按 D 删除。", 6);
    pushField(`mcp.${index}.enabled`, "mcp", "启用", boolText(server.enabled), { kind: "mcpField", serverIndex: index, field: "enabled" }, "空格切换。", 6);
    pushField(`mcp.${index}.transport`, "mcp", "传输", transportLabel(server.transport), { kind: "mcpField", serverIndex: index, field: "transport" }, "左右方向键切换。", 6);
    if (server.transport === "stdio") {
      pushField(`mcp.${index}.command`, "mcp", "命令", server.command || "(空)", { kind: "mcpField", serverIndex: index, field: "command" }, undefined, 6);
      pushField(`mcp.${index}.cwd`, "mcp", "工作目录", server.cwd || "(空)", { kind: "mcpField", serverIndex: index, field: "cwd" }, undefined, 6);
      pushField(`mcp.${index}.args`, "mcp", "参数", previewText(server.args, maxPreview), { kind: "mcpField", serverIndex: index, field: "args" }, "\\n 表示多行。", 6);
    } else {
      pushField(`mcp.${index}.url`, "mcp", "URL", server.url || "(空)", { kind: "mcpField", serverIndex: index, field: "url" }, undefined, 6);
      pushField(`mcp.${index}.authHeader`, "mcp", "Authorization", server.authHeader || "(空)", { kind: "mcpField", serverIndex: index, field: "authHeader" }, undefined, 6);
    }
    pushField(`mcp.${index}.timeout`, "mcp", "超时（ms）", String(server.timeout), { kind: "mcpField", serverIndex: index, field: "timeout" }, undefined, 6);
  });
  return rows;
}
var BUILTIN_SECTIONS = [
  { id: "general", label: "模型与系统", icon: "01" },
  { id: "tools", label: "工具策略", icon: "02" },
  { id: "mcp", label: "MCP 服务", icon: "03" }
];
function SettingsView({ initialSection = "general", onBack, onLoad, onSave, pluginTabs }) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions3();
  const [loading, setLoading] = useState8(true);
  const [saving, setSaving] = useState8(false);
  const [draft, setDraft] = useState8(null);
  const [baseline, setBaseline] = useState8(null);
  const [selectedRowId, setSelectedRowId] = useState8("");
  const [editor, setEditor] = useState8(null);
  const [editorValue, setEditorValue] = useState8("");
  const [statusText, setStatusText] = useState8("");
  const [statusKind, setStatusKind] = useState8("info");
  const [pendingLeaveConfirm, setPendingLeaveConfirm] = useState8(false);
  const [pluginDraft, setPluginDraft] = useState8({});
  const [pluginBaseline, setPluginBaseline] = useState8({});
  const sections = useMemo4(() => {
    const pluginSections = (pluginTabs ?? []).map((tab, i) => ({
      id: tab.id,
      label: tab.label,
      icon: tab.icon ?? String(BUILTIN_SECTIONS.length + i + 1).padStart(2, "0")
    }));
    return [...BUILTIN_SECTIONS, ...pluginSections];
  }, [pluginTabs]);
  const setStatus = useCallback4((text, kind = "info") => {
    setStatusText(text);
    setStatusKind(kind);
  }, []);
  const isDirty = useMemo4(() => {
    const builtinDirty = getEditableFingerprint(draft) !== getEditableFingerprint(baseline);
    const pluginDirty = JSON.stringify(pluginDraft) !== JSON.stringify(pluginBaseline);
    return builtinDirty || pluginDirty;
  }, [draft, baseline, pluginDraft, pluginBaseline]);
  const rows = useMemo4(() => {
    if (!draft)
      return [];
    const builtinRows = buildRows(draft, termWidth);
    for (const tab of pluginTabs ?? []) {
      builtinRows.push({
        id: `plugin-section-${tab.id}`,
        kind: "section",
        section: tab.id,
        label: tab.label
      });
      let lastGroup = "";
      for (const field of tab.fields) {
        if (field.group && field.group !== lastGroup) {
          lastGroup = field.group;
          builtinRows.push({
            id: `plugin-group-${tab.id}-${field.group}`,
            kind: "info",
            section: tab.id,
            label: `── ${field.group} ──`
          });
        }
        if (field.description) {
          builtinRows.push({
            id: `plugin-desc-${tab.id}-${field.key}`,
            kind: "info",
            section: tab.id,
            label: "",
            description: field.description
          });
        }
        const rawValue = pluginDraft[tab.id]?.[field.key] ?? field.defaultValue;
        let displayValue;
        if (field.type === "toggle") {
          displayValue = rawValue ? "开启" : "关闭";
        } else if (field.type === "select") {
          const opt = field.options?.find((o) => o.value === String(rawValue));
          displayValue = opt?.label ?? String(rawValue ?? "");
        } else {
          displayValue = String(rawValue ?? "");
        }
        builtinRows.push({
          id: `plugin-${tab.id}-${field.key}`,
          kind: "field",
          section: tab.id,
          label: field.label,
          value: displayValue,
          target: { kind: "pluginField", tabId: tab.id, fieldKey: field.key, fieldType: field.type }
        });
      }
    }
    return builtinRows;
  }, [draft, termWidth, pluginTabs, pluginDraft]);
  const selectableRows = useMemo4(() => rows.filter((row) => row.target), [rows]);
  const selectedRow = useMemo4(() => rows.find((row) => row.id === selectedRowId), [rows, selectedRowId]);
  const currentSection = useMemo4(() => selectedRow?.section ?? initialSection, [selectedRow, initialSection]);
  const sectionRows = useMemo4(() => rows.filter((r) => r.section === currentSection && r.kind !== "section"), [rows, currentSection]);
  const selectedSelectableIndex = useMemo4(() => {
    return selectableRows.findIndex((row) => row.id === selectedRowId);
  }, [selectableRows, selectedRowId]);
  const sectionSelectableRows = useMemo4(() => selectableRows.filter((row) => row.section === currentSection), [selectableRows, currentSection]);
  const selectedSectionIndex = useMemo4(() => sectionSelectableRows.findIndex((row) => row.id === selectedRowId), [sectionSelectableRows, selectedRowId]);
  useEffect7(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await onLoad();
        if (cancelled)
          return;
        const cloned = cloneConsoleSettingsSnapshot(snapshot);
        setDraft(cloned);
        setBaseline(cloneConsoleSettingsSnapshot(snapshot));
        setStatus("已加载当前配置", "success");
        setPendingLeaveConfirm(false);
        if (pluginTabs && pluginTabs.length > 0) {
          const entries = await Promise.all(pluginTabs.map(async (tab) => {
            try {
              return [tab.id, await tab.onLoad()];
            } catch {
              return [tab.id, {}];
            }
          }));
          const data = Object.fromEntries(entries);
          if (!cancelled) {
            setPluginDraft(structuredClone(data));
            setPluginBaseline(structuredClone(data));
          }
        }
      } catch (err) {
        if (cancelled)
          return;
        setStatus(`加载配置失败：${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        if (!cancelled)
          setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [onLoad, setStatus, pluginTabs]);
  useEffect7(() => {
    if (rows.length === 0)
      return;
    if (selectedRowId && rows.some((row) => row.id === selectedRowId && row.target))
      return;
    const preferred = rows.find((row) => row.section === initialSection && row.target) ?? rows.find((row) => row.target);
    if (preferred)
      setSelectedRowId(preferred.id);
  }, [rows, selectedRowId, initialSection]);
  const updateDraft = useCallback4((updater) => {
    setDraft((prev) => {
      if (!prev)
        return prev;
      const next = cloneConsoleSettingsSnapshot(prev);
      updater(next);
      return next;
    });
    setPendingLeaveConfirm(false);
  }, []);
  const reloadSnapshot = useCallback4(async () => {
    setLoading(true);
    setEditor(null);
    try {
      const snapshot = await onLoad();
      setDraft(cloneConsoleSettingsSnapshot(snapshot));
      setBaseline(cloneConsoleSettingsSnapshot(snapshot));
      setStatus("已从磁盘重新加载配置", "success");
      setPendingLeaveConfirm(false);
    } catch (err) {
      setStatus(`重新加载失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [onLoad, setStatus]);
  const handleAddModel = useCallback4(() => {
    let nextIndex = 0;
    updateDraft((snapshot) => {
      nextIndex = snapshot.models.length;
      snapshot.models.push(createEmptyModel());
    });
    setSelectedRowId(`model.${nextIndex}.modelName`);
    setStatus("已新增模型草稿，请先填写名称后保存", "info");
  }, [setStatus, updateDraft]);
  const handleAddMcpServer = useCallback4(() => {
    let nextIndex = 0;
    updateDraft((snapshot) => {
      nextIndex = snapshot.mcpServers.length;
      snapshot.mcpServers.push(createDefaultMCPServerEntry());
    });
    setSelectedRowId(`mcp.${nextIndex}.name`);
    setStatus("已新增 MCP 服务器草稿，请先填写名称后保存", "info");
  }, [setStatus, updateDraft]);
  const startEdit = useCallback4((target) => {
    if (!draft)
      return;
    if (target.kind === "modelField") {
      const model = draft.models[target.modelIndex];
      if (!model)
        return;
      const value2 = model[target.field];
      setEditor({ target, label: `${model.modelName || `model_${target.modelIndex + 1}`}.${target.field}`, value: value2 });
      setEditorValue(String(value2 ?? ""));
      return;
    }
    if (target.kind === "systemField") {
      const rawValue2 = target.field === "maxToolRounds" ? String(draft.system.maxToolRounds) : target.field === "maxRetries" ? String(draft.system.maxRetries) : target.field === "maxAgentDepth" ? String(draft.system.maxAgentDepth) : target.field === "defaultMode" ? draft.system.defaultMode ?? "" : target.field === "stream" ? String(draft.system.stream) : draft.system.systemPrompt;
      const value2 = target.field === "systemPrompt" ? escapeMultilineForInput(rawValue2) : rawValue2;
      setEditor({ target, label: `system.${target.field}`, value: value2, hint: target.field === "systemPrompt" ? "\\n 表示换行" : undefined });
      setEditorValue(value2);
      return;
    }
    const server = draft.mcpServers[target.serverIndex];
    if (!server)
      return;
    const rawValue = String(server[target.field] ?? "");
    const value = target.field === "args" ? escapeMultilineForInput(rawValue) : rawValue;
    setEditor({ target, label: `mcp.${server.name || `server_${target.serverIndex + 1}`}.${target.field}`, value, hint: target.field === "args" ? "\\n 表示多行参数" : undefined });
    setEditorValue(value);
  }, [draft]);
  const applyCycle = useCallback4((target, direction) => {
    updateDraft((snapshot) => {
      if (target.kind === "modelProvider") {
        const model = snapshot.models[target.modelIndex];
        if (!model)
          return;
        const next = cycleValue(CONSOLE_LLM_PROVIDER_OPTIONS, model.provider, direction);
        snapshot.models[target.modelIndex] = applyModelProviderChange(model, next);
        return;
      }
      if (target.kind === "mcpField" && target.field === "transport") {
        const current = snapshot.mcpServers[target.serverIndex]?.transport;
        if (!current)
          return;
        snapshot.mcpServers[target.serverIndex].transport = cycleValue(CONSOLE_MCP_TRANSPORT_OPTIONS, current, direction);
      }
      if (target.kind === "toolPolicy") {
        const tool = snapshot.toolPolicies[target.toolIndex];
        if (!tool)
          return;
        const modes = ["disabled", "manual", "auto"];
        const current = getToolPolicyMode(tool.configured, tool.autoApprove);
        const next = cycleValue(modes, current, direction);
        tool.configured = next !== "disabled";
        tool.autoApprove = next === "auto";
      }
    });
  }, [updateDraft]);
  const applyToggle = useCallback4((target) => {
    updateDraft((snapshot) => {
      if (target.kind === "modelDefault") {
        const model = snapshot.models[target.modelIndex];
        if (!model || !model.modelName.trim())
          return;
        snapshot.defaultModelName = model.modelName.trim();
        return;
      }
      if (target.kind === "systemField" && target.field === "stream") {
        snapshot.system.stream = !snapshot.system.stream;
        return;
      }
      if (target.kind === "systemField" && target.field === "retryOnError") {
        snapshot.system.retryOnError = !snapshot.system.retryOnError;
        return;
      }
      if (target.kind === "systemField" && target.field === "logRequests") {
        snapshot.system.logRequests = !snapshot.system.logRequests;
        return;
      }
      if (target.kind === "systemField" && target.field === "asyncSubAgents") {
        snapshot.system.asyncSubAgents = !snapshot.system.asyncSubAgents;
        return;
      }
      if (target.kind === "toolGlobalToggle") {
        snapshot[target.field] = !snapshot[target.field];
        return;
      }
      if (target.kind === "toolApprovalView") {
        const tool = snapshot.toolPolicies[target.toolIndex];
        if (tool)
          tool.showApprovalView = tool.showApprovalView === false;
        return;
      }
      if (target.kind === "mcpField" && target.field === "enabled") {
        const server = snapshot.mcpServers[target.serverIndex];
        if (server)
          server.enabled = !server.enabled;
      }
    });
  }, [updateDraft]);
  const submitEditor = useCallback4(() => {
    if (!editor)
      return;
    if (editor.target.kind === "pluginField") {
      const { tabId, fieldKey, fieldType } = editor.target;
      let finalValue = editorValue;
      if (fieldType === "number") {
        const parsed = Number(editorValue.trim());
        if (!Number.isFinite(parsed)) {
          setStatus("请输入有效数字", "error");
          return;
        }
        finalValue = parsed;
      }
      setPluginDraft((prev) => {
        const next = structuredClone(prev);
        (next[tabId] ??= {})[fieldKey] = finalValue;
        return next;
      });
      setStatus("字段已更新，按 S 保存并热重载", "success");
      setEditor(null);
      setEditorValue("");
      return;
    }
    const value = editor.target.kind === "systemField" && editor.target.field === "systemPrompt" ? restoreMultilineFromInput(editorValue) : editor.target.kind === "mcpField" && editor.target.field === "args" ? restoreMultilineFromInput(editorValue) : editorValue;
    if (editor.target.kind === "systemField" && editor.target.field === "maxToolRounds") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1) {
        setStatus("请输入大于等于 1 的有效数字", "error");
        return;
      }
    }
    if (editor.target.kind === "systemField" && editor.target.field === "maxRetries") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20) {
        setStatus("最大重试次数必须在 0 到 20 之间", "error");
        return;
      }
    }
    if (editor.target.kind === "systemField" && editor.target.field === "maxAgentDepth") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
        setStatus("最大代理深度必须在 1 到 20 之间", "error");
        return;
      }
    }
    if (editor.target.kind === "mcpField" && editor.target.field === "timeout") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1000) {
        setStatus("MCP 超时必须是大于等于 1000 的数字", "error");
        return;
      }
    }
    updateDraft((snapshot) => {
      if (editor.target.kind === "modelField") {
        const model = snapshot.models[editor.target.modelIndex];
        if (!model)
          return;
        if (editor.target.field === "modelName") {
          const previousName = model.modelName;
          model.modelName = value.trim();
          if (snapshot.defaultModelName === previousName)
            snapshot.defaultModelName = model.modelName;
        } else if (editor.target.field === "modelId") {
          model.modelId = value;
        } else if (editor.target.field === "apiKey") {
          model.apiKey = value;
        } else {
          model.baseUrl = value;
        }
        return;
      }
      if (editor.target.kind === "systemField") {
        if (editor.target.field === "systemPrompt")
          snapshot.system.systemPrompt = value;
        else if (editor.target.field === "maxToolRounds")
          snapshot.system.maxToolRounds = Number(value.trim());
        else if (editor.target.field === "maxRetries")
          snapshot.system.maxRetries = Number(value.trim());
        else if (editor.target.field === "maxAgentDepth")
          snapshot.system.maxAgentDepth = Number(value.trim());
        else if (editor.target.field === "defaultMode")
          snapshot.system.defaultMode = value.trim();
        return;
      }
      if (editor.target.kind !== "mcpField")
        return;
      const mcpTarget = editor.target;
      const server = snapshot.mcpServers[mcpTarget.serverIndex];
      if (!server)
        return;
      const field = mcpTarget.field;
      if (field === "name")
        server.name = value.replace(/[^a-zA-Z0-9_]/g, "_");
      else if (field === "timeout")
        server.timeout = Number(value.trim());
      else if (field === "command")
        server.command = value;
      else if (field === "args")
        server.args = value;
      else if (field === "cwd")
        server.cwd = value;
      else if (field === "url")
        server.url = value;
      else if (field === "authHeader")
        server.authHeader = value;
      else
        server.transport = value;
    });
    setStatus("字段已更新，按 S 保存并热重载", "success");
    setEditor(null);
    setEditorValue("");
  }, [editor, editorValue, setStatus, updateDraft]);
  const handleSave = useCallback4(async () => {
    if (!draft || saving)
      return;
    setSaving(true);
    setStatus("正在保存并尝试热重载...", "info");
    try {
      const result = await onSave(draft);
      if (!result.ok) {
        setStatus(`保存失败：${result.message}`, "error");
        return;
      }
      if (result.snapshot) {
        setDraft(cloneConsoleSettingsSnapshot(result.snapshot));
        setBaseline(cloneConsoleSettingsSnapshot(result.snapshot));
      } else {
        setBaseline(cloneConsoleSettingsSnapshot(draft));
      }
      setPendingLeaveConfirm(false);
      setStatus(result.message, result.restartRequired ? "warning" : "success");
      if (pluginTabs && pluginTabs.length > 0) {
        const pluginErrors = [];
        for (const tab of pluginTabs) {
          const tabData = pluginDraft[tab.id] ?? {};
          try {
            const r = await tab.onSave(tabData);
            if (!r.success)
              pluginErrors.push(`${tab.label}: ${r.error ?? "未知错误"}`);
          } catch (e) {
            pluginErrors.push(`${tab.label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (pluginErrors.length > 0) {
          setStatus(`部分插件配置保存失败：${pluginErrors.join("; ")}`, "warning");
        } else {
          setPluginBaseline(structuredClone(pluginDraft));
        }
      }
    } catch (err) {
      setStatus(`保存失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, saving, setStatus, pluginTabs, pluginDraft]);
  const handleDeleteCurrentModel = useCallback4(() => {
    if (!selectedRow?.target || !draft) {
      setStatus("请先选中某个模型字段后再删除", "warning");
      return;
    }
    if (selectedRow.target.kind !== "modelField" && selectedRow.target.kind !== "modelProvider" && selectedRow.target.kind !== "modelDefault") {
      setStatus("请先选中某个模型字段后再删除", "warning");
      return;
    }
    if (draft.models.length <= 1) {
      setStatus("至少需要保留一个模型", "warning");
      return;
    }
    const index = selectedRow.target.modelIndex;
    const model = draft.models[index];
    if (!model)
      return;
    updateDraft((snapshot) => {
      snapshot.models.splice(index, 1);
      if (snapshot.defaultModelName === model.modelName)
        snapshot.defaultModelName = snapshot.models[0]?.modelName ?? "";
    });
    setStatus(`已删除模型草稿：${model.modelName || `model_${index + 1}`}（未保存）`, "warning");
  }, [draft, selectedRow, setStatus, updateDraft]);
  const handleDeleteCurrentServer = useCallback4(() => {
    if (!selectedRow?.target || selectedRow.target.kind !== "mcpField" || !draft) {
      setStatus("请先选中某个 MCP 服务器字段后再删除", "warning");
      return;
    }
    const index = selectedRow.target.serverIndex;
    const server = draft.mcpServers[index];
    if (!server)
      return;
    updateDraft((snapshot) => {
      snapshot.mcpServers.splice(index, 1);
    });
    setStatus(`已删除 MCP 草稿：${server.name || `server_${index + 1}`}（未保存）`, "warning");
  }, [draft, selectedRow, setStatus, updateDraft]);
  useKeyboard3((key) => {
    if (editor) {
      if (key.name === "escape") {
        setEditor(null);
        setEditorValue("");
        setStatus("已取消编辑", "warning");
        key.preventDefault();
      }
      if (key.name === "enter" || key.name === "return") {
        submitEditor();
        key.preventDefault();
      }
      return;
    }
    if (loading || saving) {
      if (key.name === "escape")
        onBack();
      return;
    }
    const currentIndex = selectedSectionIndex >= 0 ? selectedSectionIndex : 0;
    if (key.name === "up") {
      const prev = sectionSelectableRows[Math.max(0, currentIndex - 1)];
      if (prev)
        setSelectedRowId(prev.id);
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === "down") {
      const next = sectionSelectableRows[Math.min(sectionSelectableRows.length - 1, currentIndex + 1)];
      if (next)
        setSelectedRowId(next.id);
      setPendingLeaveConfirm(false);
      return;
    }
    if (selectedRow?.target && key.name === "left") {
      if (selectedRow.target.kind === "modelProvider" || selectedRow.target.kind === "toolPolicy" || selectedRow.target.kind === "mcpField" && selectedRow.target.field === "transport") {
        applyCycle(selectedRow.target, -1);
      }
      setPendingLeaveConfirm(false);
      return;
    }
    if (selectedRow?.target && key.name === "right") {
      if (selectedRow.target.kind === "modelProvider" || selectedRow.target.kind === "toolPolicy" || selectedRow.target.kind === "mcpField" && selectedRow.target.field === "transport") {
        applyCycle(selectedRow.target, 1);
      }
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === "escape") {
      if (isDirty && !pendingLeaveConfirm) {
        setPendingLeaveConfirm(true);
        setStatus("当前有未保存修改，再按一次 Esc 将直接返回", "warning");
        return;
      }
      onBack();
      return;
    }
    if (key.name === "s") {
      handleSave();
      return;
    }
    const numKey = parseInt(key.name ?? "", 10);
    if (numKey >= 1 && numKey <= sections.length) {
      const targetSection = sections[numKey - 1];
      if (targetSection) {
        const firstInSection = selectableRows.find((r) => r.section === targetSection.id);
        if (firstInSection)
          setSelectedRowId(firstInSection.id);
      }
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === "r") {
      reloadSnapshot();
      return;
    }
    if (key.name === "a") {
      if (selectedRow?.section === "mcp")
        handleAddMcpServer();
      else
        handleAddModel();
      return;
    }
    if (key.name === "d") {
      if (selectedRow?.target?.kind === "mcpField")
        handleDeleteCurrentServer();
      else
        handleDeleteCurrentModel();
      return;
    }
    if (key.name === "space" && selectedRow?.target) {
      if (selectedRow.target.kind === "modelDefault" || selectedRow.target.kind === "toolApprovalView" || selectedRow.target.kind === "toolGlobalToggle" || selectedRow.target.kind === "systemField" && (selectedRow.target.field === "stream" || selectedRow.target.field === "retryOnError" || selectedRow.target.field === "logRequests" || selectedRow.target.field === "asyncSubAgents") || selectedRow.target.kind === "mcpField" && selectedRow.target.field === "enabled") {
        applyToggle(selectedRow.target);
      } else if (selectedRow.target.kind === "pluginField" && selectedRow.target.fieldType === "toggle") {
        const { tabId, fieldKey } = selectedRow.target;
        setPluginDraft((prev) => {
          const next = structuredClone(prev);
          (next[tabId] ??= {})[fieldKey] = !next[tabId]?.[fieldKey];
          return next;
        });
      } else if (selectedRow.target.kind === "toolPolicy") {
        applyCycle(selectedRow.target, 1);
      }
      return;
    }
    if ((key.name === "enter" || key.name === "return") && selectedRow?.target) {
      if (selectedRow.target.kind === "action") {
        if (selectedRow.target.action === "addMcp")
          handleAddMcpServer();
        else
          handleAddModel();
        return;
      }
      if (selectedRow.target.kind === "modelDefault" || selectedRow.target.kind === "toolApprovalView" || selectedRow.target.kind === "toolGlobalToggle" || selectedRow.target.kind === "systemField" && (selectedRow.target.field === "stream" || selectedRow.target.field === "retryOnError" || selectedRow.target.field === "logRequests" || selectedRow.target.field === "asyncSubAgents") || selectedRow.target.kind === "mcpField" && selectedRow.target.field === "enabled") {
        applyToggle(selectedRow.target);
        return;
      }
      if (selectedRow.target.kind === "modelProvider" || selectedRow.target.kind === "toolPolicy" || selectedRow.target.kind === "mcpField" && selectedRow.target.field === "transport") {
        applyCycle(selectedRow.target, 1);
        return;
      }
      if (selectedRow.target.kind === "pluginField") {
        const { tabId, fieldKey, fieldType } = selectedRow.target;
        if (fieldType === "toggle") {
          setPluginDraft((prev) => {
            const next = structuredClone(prev);
            (next[tabId] ??= {})[fieldKey] = !next[tabId]?.[fieldKey];
            return next;
          });
        } else if (fieldType === "text" || fieldType === "number") {
          const currentVal = pluginDraft[tabId]?.[fieldKey] ?? "";
          setEditor({
            target: selectedRow.target,
            label: `${tabId}.${fieldKey}`,
            value: String(currentVal)
          });
          setEditorValue(String(currentVal));
        } else if (fieldType === "select") {
          const tab = pluginTabs?.find((t) => t.id === tabId);
          const field = tab?.fields.find((f) => f.key === fieldKey);
          if (field?.options && field.options.length > 0) {
            const currentVal = String(pluginDraft[tabId]?.[fieldKey] ?? "");
            const idx = field.options.findIndex((o) => o.value === currentVal);
            const nextIdx = (idx + 1) % field.options.length;
            setPluginDraft((prev) => {
              const next = structuredClone(prev);
              (next[tabId] ??= {})[fieldKey] = field.options[nextIdx].value;
              return next;
            });
          }
        }
        return;
      }
      if (selectedRow.target.kind === "modelField" || selectedRow.target.kind === "systemField" && selectedRow.target.field !== "stream" && selectedRow.target.field !== "retryOnError" && selectedRow.target.field !== "logRequests" && selectedRow.target.field !== "asyncSubAgents" || selectedRow.target.kind === "mcpField" && selectedRow.target.field !== "enabled" && selectedRow.target.field !== "transport") {
        startEdit(selectedRow.target);
      }
    }
  });
  const listHeight = Math.max(10, termHeight - (editor ? 26 : 22));
  const selectedRowSectionIndex = Math.max(0, sectionRows.findIndex((row) => row.id === selectedRowId));
  let windowStart = Math.max(0, selectedRowSectionIndex - Math.floor(listHeight / 2));
  let windowEnd = Math.min(sectionRows.length, windowStart + listHeight);
  if (windowEnd - windowStart < listHeight) {
    windowStart = Math.max(0, windowEnd - listHeight);
  }
  const visibleRows = sectionRows.slice(windowStart, windowEnd);
  if (loading && !draft) {
    return /* @__PURE__ */ jsxDEV36("box", {
      width: "100%",
      height: "100%",
      justifyContent: "center",
      alignItems: "center",
      children: /* @__PURE__ */ jsxDEV36("text", {
        fg: "#888",
        children: "正在加载配置..."
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV36("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV36("box", {
        flexDirection: "row",
        flexGrow: 1,
        children: [
          /* @__PURE__ */ jsxDEV36("box", {
            width: 24,
            flexShrink: 0,
            flexDirection: "column",
            paddingTop: 1,
            paddingLeft: 2,
            paddingRight: 1,
            children: [
              /* @__PURE__ */ jsxDEV36("text", {
                fg: C.primary,
                children: /* @__PURE__ */ jsxDEV36("strong", {
                  children: "IRIS"
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV36("box", {
                marginTop: 1,
                flexDirection: "column",
                children: sections.map((sec) => /* @__PURE__ */ jsxDEV36("text", {
                  fg: currentSection === sec.id ? C.accent : "#555",
                  children: [
                    currentSection === sec.id ? ICONS.dotFilled : ICONS.dotEmpty,
                    " ",
                    sec.icon,
                    " ",
                    sec.label
                  ]
                }, sec.id, true, undefined, this))
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV36("box", {
            flexGrow: 1,
            flexDirection: "column",
            paddingTop: 1,
            paddingLeft: 2,
            children: [
              /* @__PURE__ */ jsxDEV36("box", {
                alignItems: "center",
                paddingBottom: 1,
                flexShrink: 0,
                children: /* @__PURE__ */ jsxDEV36("ascii-font", {
                  text: "IRIS",
                  font: "block",
                  color: C.primary
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV36("box", {
                flexDirection: "column",
                marginBottom: 1,
                flexShrink: 0,
                children: [
                  /* @__PURE__ */ jsxDEV36("text", {
                    fg: "#888",
                    children: "在终端内管理模型池、系统参数、工具策略与 MCP 服务器。"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV36("text", {
                    fg: isDirty ? C.warn : C.accent,
                    children: [
                      isDirty ? `${ICONS.dotFilled} 有未保存修改` : `${ICONS.checkmark} 当前草稿已同步`,
                      saving ? `  ${ICONS.separator}  保存中...` : ""
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ jsxDEV36("scrollbox", {
                flexGrow: 1,
                children: [
                  windowStart > 0 && /* @__PURE__ */ jsxDEV36("text", {
                    fg: "#888",
                    children: ICONS.ellipsis
                  }, undefined, false, undefined, this),
                  visibleRows.map((row) => {
                    const isSelected = row.id === selectedRowId && !!row.target;
                    const prefix = row.kind === "action" ? isSelected ? "❯" : "•" : row.kind === "field" ? isSelected ? "❯" : " " : " ";
                    return /* @__PURE__ */ jsxDEV36("box", {
                      paddingLeft: row.indent ?? 0,
                      children: /* @__PURE__ */ jsxDEV36("text", {
                        children: [
                          /* @__PURE__ */ jsxDEV36("span", {
                            fg: isSelected ? "#00ffff" : C.dim,
                            children: prefix
                          }, undefined, false, undefined, this),
                          /* @__PURE__ */ jsxDEV36("span", {
                            children: " "
                          }, undefined, false, undefined, this),
                          isSelected && row.kind !== "info" ? /* @__PURE__ */ jsxDEV36("span", {
                            fg: C.accent,
                            children: /* @__PURE__ */ jsxDEV36("strong", {
                              children: row.label
                            }, undefined, false, undefined, this)
                          }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV36("span", {
                            fg: isSelected ? "#00ffff" : undefined,
                            children: row.label
                          }, undefined, false, undefined, this),
                          row.value != null && /* @__PURE__ */ jsxDEV36("span", {
                            fg: isSelected ? "#00ffff" : C.dim,
                            children: `  ${row.value}`
                          }, undefined, false, undefined, this)
                        ]
                      }, undefined, true, undefined, this)
                    }, row.id, false, undefined, this);
                  }),
                  windowEnd < sectionRows.length && /* @__PURE__ */ jsxDEV36("text", {
                    fg: "#888",
                    children: ICONS.ellipsis
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV36("box", {
        flexDirection: "column",
        marginTop: 1,
        paddingX: 2,
        children: [
          /* @__PURE__ */ jsxDEV36("text", {
            fg: C.dim,
            children: "─".repeat(Math.max(3, termWidth - 4))
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV36("box", {
            flexDirection: "column",
            minHeight: 4,
            children: [
              selectedRow?.description && !editor && /* @__PURE__ */ jsxDEV36("text", {
                fg: "#888",
                children: selectedRow.description
              }, undefined, false, undefined, this),
              statusText && /* @__PURE__ */ jsxDEV36("text", {
                fg: getStatusColor(statusKind),
                children: statusText
              }, undefined, false, undefined, this),
              editor ? /* @__PURE__ */ jsxDEV36("box", {
                flexDirection: "column",
                children: [
                  /* @__PURE__ */ jsxDEV36("text", {
                    fg: C.accent,
                    children: /* @__PURE__ */ jsxDEV36("strong", {
                      children: [
                        "编辑：",
                        editor.label
                      ]
                    }, undefined, true, undefined, this)
                  }, undefined, false, undefined, this),
                  editor.hint && /* @__PURE__ */ jsxDEV36("text", {
                    fg: "#888",
                    children: editor.hint
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV36("box", {
                    children: [
                      /* @__PURE__ */ jsxDEV36("text", {
                        fg: C.accent,
                        children: "❯ "
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV36("input", {
                        value: editorValue,
                        onInput: setEditorValue,
                        focused: true
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  /* @__PURE__ */ jsxDEV36("text", {
                    fg: "#888",
                    children: `Enter 保存 ${ICONS.separator} Esc 取消`
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV36("text", {
                fg: "#888",
                children: `${ICONS.arrowUp}${ICONS.arrowDown} 选择  ${ICONS.arrowLeft}${ICONS.arrowRight} 切换  1~${sections.length} 分栏  Space 布尔  Enter 编辑  A 新增  D 删除  S 保存  R 重载  Esc 返回`
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/hooks/use-app-handle.ts
import { useCallback as useCallback5, useEffect as useEffect8, useRef as useRef6, useState as useState9 } from "react";

// extensions/console/src/message-utils.ts
var msgIdCounter = 0;
function nextMsgId() {
  return `msg-${++msgIdCounter}`;
}
function appendMergedMessagePart(parts, nextPart) {
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
  if (lastPart && lastPart.type === "text" && nextPart.type === "text") {
    lastPart.text += nextPart.text;
    return;
  }
  if (lastPart && lastPart.type === "thought" && nextPart.type === "thought") {
    lastPart.text += nextPart.text;
    if (nextPart.durationMs != null)
      lastPart.durationMs = nextPart.durationMs;
    return;
  }
  if (lastPart && lastPart.type === "tool_use" && nextPart.type === "tool_use") {
    lastPart.tools.push(...nextPart.tools);
    return;
  }
  parts.push(nextPart);
}
function mergeMessageParts(parts) {
  const merged = [];
  for (const part of parts) {
    const copy = part.type === "tool_use" ? { type: "tool_use", tools: [...part.tools] } : { ...part };
    appendMergedMessagePart(merged, copy);
  }
  return merged;
}
function applyToolInvocationsToParts(parts, invocations, appendLeftover = true) {
  const nextParts = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.type !== "tool_use") {
      nextParts.push(part);
      continue;
    }
    const expectedCount = Math.max(1, part.tools.length);
    const assigned = invocations.slice(cursor, cursor + expectedCount);
    cursor += assigned.length;
    nextParts.push({ type: "tool_use", tools: assigned.length > 0 ? assigned : part.tools });
  }
  if (appendLeftover && cursor < invocations.length)
    nextParts.push({ type: "tool_use", tools: invocations.slice(cursor) });
  return nextParts;
}
function appendAssistantParts(prev, partsToAppend, meta) {
  const normalizedParts = mergeMessageParts(partsToAppend);
  if (normalizedParts.length === 0)
    return prev;
  if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].isError) {
    const copy = [...prev];
    const last = copy[copy.length - 1];
    copy[copy.length - 1] = { ...last, parts: mergeMessageParts([...last.parts, ...normalizedParts]), ...meta };
    return copy;
  }
  return [...prev, { id: nextMsgId(), role: "assistant", parts: normalizedParts, ...meta }];
}
function appendCommandMessage(setMessages, text, options) {
  setMessages((prev) => [
    ...prev.filter((message) => !message.isCommand),
    {
      id: nextMsgId(),
      role: "assistant",
      parts: [{ type: "text", text }],
      isCommand: true,
      isError: options?.isError
    }
  ]);
}

// extensions/console/src/undo-redo.ts
var MAX_STACK_SIZE = 200;
function createUndoRedoStack() {
  return { redoStack: [] };
}
function performUndo(messages, stack) {
  if (messages.length === 0)
    return null;
  const removed = messages[messages.length - 1];
  const next = messages.slice(0, -1);
  stack.redoStack.push(removed);
  if (stack.redoStack.length > MAX_STACK_SIZE) {
    stack.redoStack.splice(0, stack.redoStack.length - MAX_STACK_SIZE);
  }
  return { messages: next, removed };
}
function performRedo(messages, stack) {
  if (stack.redoStack.length === 0)
    return null;
  const restored = stack.redoStack.pop();
  const next = [...messages, restored];
  return { messages: next, restored };
}
function clearRedo(stack) {
  stack.redoStack.length = 0;
}

// extensions/console/src/hooks/use-app-handle.ts
function useAppHandle({ onReady, undoRedoRef, drainCallbackRef }) {
  const [messages, setMessages] = useState9([]);
  const [streamingParts, setStreamingParts] = useState9([]);
  const [isStreaming, setIsStreaming] = useState9(false);
  const [isGenerating, setIsGenerating] = useState9(false);
  const [generatingLabel, setGeneratingLabelState] = useState9();
  const [contextTokens, setContextTokens] = useState9(0);
  const [retryInfo, setRetryInfo] = useState9(null);
  const [pendingApprovals, setPendingApprovals] = useState9([]);
  const [pendingApplies, setPendingApplies] = useState9([]);
  const [toolInvocations, setToolInvocationsState] = useState9([]);
  const [backgroundTaskCount, setBackgroundTaskCount] = useState9(0);
  const [delegateTaskCount, setDelegateTaskCount] = useState9(0);
  const backgroundTaskTokenMapRef = useRef6(new Map);
  const [backgroundTaskTokens, setBackgroundTaskTokens] = useState9(0);
  const spinnerFrameRef = useRef6(0);
  const [backgroundTaskSpinnerFrame, setBackgroundTaskSpinnerFrame] = useState9(0);
  const [toolDetailData, setToolDetailData] = useState9(null);
  const [toolDetailStack, setToolDetailStack] = useState9([]);
  const [toolListItems, setToolListItems] = useState9([]);
  const streamPartsRef = useRef6([]);
  const toolInvocationsRef = useRef6([]);
  const throttleTimerRef = useRef6(null);
  const uncommittedStreamPartsRef = useRef6([]);
  const lastUsageRef = useRef6(null);
  const notificationContextRef = useRef6({ active: false });
  const commitTools = useCallback5(() => {
    toolInvocationsRef.current = [];
    setToolInvocationsState([]);
    setPendingApprovals([]);
    setPendingApplies([]);
  }, []);
  useEffect8(() => {
    return () => {
      if (throttleTimerRef.current)
        clearTimeout(throttleTimerRef.current);
    };
  }, []);
  useEffect8(() => {
    const handle = {
      addMessage(role, content, meta) {
        clearRedo(undoRedoRef.current);
        const textPart = { type: "text", text: content };
        if (role === "assistant") {
          setMessages((prev) => appendAssistantParts(prev, [textPart], meta));
          return;
        }
        setMessages((prev) => [
          ...prev.filter((m) => !m.isError && !m.isCommand && !(m.role === "assistant" && m.parts.length === 0)),
          { id: nextMsgId(), role, parts: [textPart], createdAt: Date.now(), ...meta }
        ]);
      },
      addErrorMessage(text) {
        setMessages((prev) => [
          ...prev.filter((m) => !(m.role === "assistant" && m.parts.length === 0)),
          { id: nextMsgId(), role: "assistant", parts: [{ type: "text", text }], isError: true }
        ]);
      },
      addStructuredMessage(role, parts, meta) {
        clearRedo(undoRedoRef.current);
        const normalizedParts = mergeMessageParts(parts);
        if (normalizedParts.length === 0)
          return;
        if (role === "assistant") {
          setMessages((prev) => appendAssistantParts(prev, normalizedParts, meta));
          return;
        }
        setMessages((prev) => [...prev, { id: nextMsgId(), role, parts: normalizedParts, ...meta }]);
      },
      startStream() {
        if (toolInvocationsRef.current.length > 0)
          commitTools();
        setIsStreaming(true);
        uncommittedStreamPartsRef.current = [];
        streamPartsRef.current = [];
        setStreamingParts([]);
        const isNotif = notificationContextRef.current.active;
        const notifDesc = notificationContextRef.current.description;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !isNotif && !last.isError)
            return prev;
          return [...prev, {
            id: nextMsgId(),
            role: "assistant",
            parts: [],
            ...isNotif ? { isNotification: true, notificationDescription: notifDesc } : {}
          }];
        });
      },
      pushStreamParts(parts) {
        for (const part of parts)
          appendMergedMessagePart(streamPartsRef.current, { ...part });
        if (!throttleTimerRef.current) {
          throttleTimerRef.current = setTimeout(() => {
            throttleTimerRef.current = null;
            setStreamingParts([...streamPartsRef.current]);
          }, 60);
        }
      },
      endStream() {
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        uncommittedStreamPartsRef.current = [...streamPartsRef.current];
        streamPartsRef.current = [];
        setStreamingParts([...uncommittedStreamPartsRef.current]);
      },
      finalizeAssistantParts(parts, meta) {
        const normalizedParts = mergeMessageParts(parts);
        uncommittedStreamPartsRef.current = [];
        setStreamingParts([]);
        setIsStreaming(false);
        const isNotif = notificationContextRef.current.active;
        const notifDesc = notificationContextRef.current.description;
        const notifMeta = isNotif ? { isNotification: true, notificationDescription: notifDesc } : {};
        setMessages((prev) => {
          if (normalizedParts.length === 0 && !meta)
            return prev;
          const last = prev[prev.length - 1];
          if (normalizedParts.length === 0) {
            if (!last || last.role !== "assistant")
              return prev;
            const copy2 = [...prev];
            copy2[copy2.length - 1] = { ...last, ...meta, ...notifMeta };
            return copy2;
          }
          if (prev.length === 0)
            return [{ id: nextMsgId(), role: "assistant", parts: normalizedParts, ...meta, ...notifMeta }];
          if (last.role !== "assistant")
            return [...prev, { id: nextMsgId(), role: "assistant", parts: normalizedParts, ...meta, ...notifMeta }];
          if (isNotif && !last.isNotification) {
            return [...prev, { id: nextMsgId(), role: "assistant", parts: normalizedParts, ...meta, ...notifMeta }];
          }
          if (last.isError) {
            return [...prev, { id: nextMsgId(), role: "assistant", parts: normalizedParts, ...meta, ...notifMeta }];
          }
          const copy = [...prev];
          let finalParts = mergeMessageParts([...last.parts, ...normalizedParts]);
          const pending = toolInvocationsRef.current;
          if (pending.length > 0 && finalParts.some((p) => p.type === "tool_use")) {
            finalParts = mergeMessageParts(applyToolInvocationsToParts(finalParts, pending));
          }
          copy[copy.length - 1] = { ...last, parts: finalParts, ...meta, ...notifMeta };
          return copy;
        });
      },
      setToolInvocations(invocations) {
        const copy = [...invocations];
        toolInvocationsRef.current = copy;
        setToolInvocationsState(copy);
        setPendingApprovals(copy.filter((invocation) => invocation.status === "awaiting_approval"));
        setPendingApplies(copy.filter((invocation) => invocation.status === "awaiting_apply"));
        setMessages((prev) => {
          if (prev.length === 0)
            return prev;
          const last = prev[prev.length - 1];
          if (last.role !== "assistant")
            return prev;
          if (last.parts.length === 0)
            return prev;
          const nextParts = applyToolInvocationsToParts(last.parts, copy, false);
          const copyMessages = [...prev];
          copyMessages[copyMessages.length - 1] = { ...last, parts: mergeMessageParts(nextParts) };
          return copyMessages;
        });
      },
      setGenerating(generating) {
        if (!generating) {
          const uncommitted = uncommittedStreamPartsRef.current.length > 0 ? uncommittedStreamPartsRef.current : streamPartsRef.current;
          if (uncommitted.length > 0) {
            setMessages((prev) => appendAssistantParts(prev, uncommitted));
            uncommittedStreamPartsRef.current = [];
          }
          setStreamingParts([]);
          streamPartsRef.current = [];
          setIsStreaming(false);
          setMessages((prev) => {
            if (prev.length === 0)
              return prev;
            const last = prev[prev.length - 1];
            if (last.role === "assistant" && last.parts.length === 0)
              return prev.slice(0, -1);
            return prev;
          });
        }
        setIsGenerating(generating);
        if (!generating)
          setGeneratingLabelState(undefined);
        setRetryInfo(null);
      },
      setGeneratingLabel(label) {
        setGeneratingLabelState(label);
      },
      clearMessages() {
        setMessages([]);
        setStreamingParts([]);
        streamPartsRef.current = [];
        uncommittedStreamPartsRef.current = [];
      },
      commitTools,
      setUserTokens(tokenCount) {
        setMessages((prev) => {
          for (let i = prev.length - 1;i >= 0; i--) {
            if (prev[i].role === "user") {
              const copy = [...prev];
              copy[i] = { ...copy[i], tokenIn: tokenCount };
              return copy;
            }
          }
          return prev;
        });
      },
      addSummaryMessage(summaryText, tokenCount) {
        setMessages((prev) => [
          ...prev.filter((m) => !m.isCommand),
          {
            id: nextMsgId(),
            role: "user",
            parts: [{ type: "text", text: summaryText }],
            isSummary: true,
            tokenIn: tokenCount
          }
        ]);
      },
      setUsage(usage) {
        setContextTokens(usage.totalTokenCount ?? 0);
        lastUsageRef.current = usage;
      },
      finalizeResponse(durationMs) {
        const usage = lastUsageRef.current;
        setMessages((prev) => {
          if (prev.length === 0)
            return prev;
          const last = prev[prev.length - 1];
          if (last.role !== "assistant")
            return prev;
          const copy = [...prev];
          copy[copy.length - 1] = {
            ...last,
            tokenIn: usage?.promptTokenCount,
            cachedTokenIn: usage?.cachedContentTokenCount,
            tokenOut: usage?.candidatesTokenCount,
            durationMs
          };
          return copy;
        });
        lastUsageRef.current = null;
      },
      setRetryInfo(info) {
        setRetryInfo(info);
      },
      setNotificationContext(description) {
        notificationContextRef.current = {
          active: true,
          description: description ?? notificationContextRef.current.description
        };
      },
      clearNotificationContext() {
        notificationContextRef.current = { active: false };
      },
      setNotificationPayloads(payloads) {
        setMessages((prev) => [...prev, {
          id: nextMsgId(),
          role: "assistant",
          parts: [],
          isNotificationSummary: true,
          notificationPayloads: payloads,
          createdAt: Date.now()
        }]);
      },
      updateBackgroundTaskCount(delta) {
        setBackgroundTaskCount((prev) => Math.max(0, prev + delta));
      },
      updateDelegateTaskCount(delta) {
        setDelegateTaskCount((prev) => Math.max(0, prev + delta));
      },
      updateBackgroundTaskTokens(taskId, tokens) {
        backgroundTaskTokenMapRef.current.set(taskId, tokens);
        let total = 0;
        for (const v of backgroundTaskTokenMapRef.current.values())
          total += v;
        setBackgroundTaskTokens(total);
      },
      removeBackgroundTaskTokens(taskId) {
        backgroundTaskTokenMapRef.current.delete(taskId);
        let total = 0;
        for (const v of backgroundTaskTokenMapRef.current.values())
          total += v;
        setBackgroundTaskTokens(total);
      },
      advanceBackgroundTaskSpinner() {
        spinnerFrameRef.current += 1;
        if (spinnerFrameRef.current % 4 === 0) {
          setBackgroundTaskSpinnerFrame(spinnerFrameRef.current);
        }
      },
      openToolDetail(data, breadcrumb) {
        setToolDetailData(data);
        setToolDetailStack(breadcrumb);
      },
      updateToolDetailData(data) {
        setToolDetailData(data);
      },
      closeToolDetail() {
        setToolDetailStack((prev) => {
          if (prev.length > 1)
            return prev;
          return [];
        });
        setToolDetailData(null);
      },
      drainQueue() {
        return drainCallbackRef.current?.() ?? undefined;
      },
      openToolList(tools) {
        setToolListItems(tools);
      }
    };
    onReady(handle);
  }, [commitTools, drainCallbackRef, onReady, undoRedoRef]);
  return {
    messages,
    streamingParts,
    isStreaming,
    isGenerating,
    generatingLabel,
    contextTokens,
    retryInfo,
    pendingApprovals,
    pendingApplies,
    toolInvocations,
    backgroundTaskCount,
    delegateTaskCount,
    backgroundTaskTokens,
    backgroundTaskSpinnerFrame,
    setMessages,
    commitTools,
    toolDetailData,
    toolDetailStack,
    toolListItems
  };
}

// extensions/console/src/hooks/use-app-keyboard.ts
import { useKeyboard as useKeyboard4 } from "@opentui/react";
function closeConfirm(setPendingConfirm, setConfirmChoice) {
  setPendingConfirm(null);
  setConfirmChoice("confirm");
}
function useAppKeyboard({
  viewMode,
  setViewMode,
  setCopyMode,
  pendingConfirm,
  confirmChoice,
  setPendingConfirm,
  setConfirmChoice,
  exitConfirm,
  isGenerating,
  pendingApplies,
  pendingApprovals,
  onOpenToolDetail,
  approval,
  onExit,
  onAbort,
  onToolApply,
  onToolApproval,
  onAddCommandPattern,
  sessionList,
  modelList,
  selectedIndex,
  setSelectedIndex,
  undoRedoRef,
  onClearRedoStack,
  setMessages,
  commitTools,
  onLoadSession,
  onSwitchModel,
  modelState,
  queue,
  queueRemove,
  queueMoveUp,
  queueMoveDown,
  queueEdit,
  queueClear,
  queueEditingId,
  setQueueEditingId,
  queueEditState,
  queueEditActions,
  onToggleThoughts,
  toolListItems,
  agentList,
  onSelectAgent,
  memoryList,
  memoryFilter,
  setMemoryFilter,
  memoryExpandedId,
  setMemoryExpandedId,
  memoryPendingDeleteId,
  setMemoryPendingDeleteId,
  setMemoryList,
  onDeleteMemory,
  extensionList,
  setExtensionList,
  onToggleExtension,
  onListExtensions,
  setExtensionTogglingName,
  setExtensionStatusMessage,
  setExtensionStatusIsError
}) {
  useKeyboard4((key) => {
    if (key.ctrl && key.name === "c") {
      if (exitConfirm.exitConfirmArmed) {
        exitConfirm.clearExitConfirm();
        onExit();
      } else {
        exitConfirm.armExitConfirm();
      }
      return;
    }
    if (key.name === "f6") {
      setCopyMode((prev) => !prev);
      return;
    }
    if (key.ctrl && key.name === "o") {
      onToggleThoughts();
      return;
    }
    if (key.name === "t" && key.ctrl) {
      onOpenToolDetail("");
      return;
    }
    if (viewMode === "settings")
      return;
    if (viewMode === "tool-detail")
      return;
    if (viewMode === "tool-list") {
      if (key.name === "escape") {
        setViewMode("chat");
      } else if (key.name === "up")
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down")
        setSelectedIndex((prev) => Math.min(toolListItems.length - 1, prev + 1));
      else if (key.name === "return") {
        const selected = toolListItems[selectedIndex];
        if (selected) {
          onOpenToolDetail(selected.id);
        }
      }
      return;
    }
    if (viewMode === "memory-list") {
      const filtered = filterMemories(memoryList, memoryFilter);
      if (key.name === "escape") {
        if (memoryPendingDeleteId !== null) {
          setMemoryPendingDeleteId(null);
        } else {
          setViewMode("chat");
        }
      } else if (key.name === "up") {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        setMemoryPendingDeleteId(null);
      } else if (key.name === "down") {
        setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
        setMemoryPendingDeleteId(null);
      } else if (key.name === "return") {
        const item = filtered[selectedIndex];
        if (item)
          setMemoryExpandedId(memoryExpandedId === item.id ? null : item.id);
      } else if (key.name === "tab") {
        const next = nextFilter(memoryFilter);
        setMemoryFilter(next);
        setSelectedIndex(0);
        setMemoryExpandedId(null);
        setMemoryPendingDeleteId(null);
      } else if (key.name === "d") {
        const item = filtered[selectedIndex];
        if (!item)
          return;
        if (memoryPendingDeleteId === item.id) {
          onDeleteMemory?.(item.id).then((ok) => {
            if (ok) {
              setMemoryList((prev) => prev.filter((m) => m.id !== item.id));
              setMemoryPendingDeleteId(null);
              setMemoryExpandedId(null);
              const newFiltered = filterMemories(memoryList.filter((m) => m.id !== item.id), memoryFilter);
              if (selectedIndex >= newFiltered.length) {
                setSelectedIndex(Math.max(0, newFiltered.length - 1));
              }
            }
          });
        } else {
          setMemoryPendingDeleteId(item.id);
        }
      }
      return;
    }
    if (viewMode === "extension-list") {
      if (key.name === "escape") {
        setExtensionStatusMessage(null);
        setViewMode("chat");
      } else if (key.name === "up") {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedIndex((prev) => Math.min(extensionList.length - 1, prev + 1));
      } else if (key.name === "return") {
        const item = extensionList[selectedIndex];
        if (!item || item.status === "platform" || !onToggleExtension)
          return;
        setExtensionTogglingName(item.name);
        setExtensionStatusMessage(null);
        onToggleExtension(item.name).then(async ({ ok, message }) => {
          setExtensionTogglingName(null);
          setExtensionStatusMessage(message);
          setExtensionStatusIsError(!ok);
          if (ok && onListExtensions) {
            try {
              const list = await onListExtensions();
              setExtensionList(list);
            } catch {}
          }
        }).catch((err) => {
          setExtensionTogglingName(null);
          setExtensionStatusMessage(`操作失败: ${err}`);
          setExtensionStatusIsError(true);
        });
      }
      return;
    }
    if (viewMode === "agent-list") {
      if (key.name === "escape") {
        setViewMode("chat");
      } else if (key.name === "up")
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down")
        setSelectedIndex((prev) => Math.min(agentList.length - 1, prev + 1));
      else if (key.name === "return") {
        const selected = agentList[selectedIndex];
        if (selected) {
          onSelectAgent?.(selected.name);
          setViewMode("chat");
        }
      }
      return;
    }
    if (pendingConfirm && key.name === "escape") {
      closeConfirm(setPendingConfirm, setConfirmChoice);
      return;
    }
    if (key.name === "escape") {
      if (viewMode === "queue-list") {
        if (queueEditingId) {
          setQueueEditingId(null);
          queueEditActions.setValue("");
          return;
        }
        setViewMode("chat");
        return;
      }
      if (isGenerating) {
        onAbort();
        return;
      }
      if (viewMode === "session-list" || viewMode === "model-list") {
        setViewMode("chat");
        return;
      }
      return;
    }
    if (viewMode === "queue-list") {
      if (queue.length === 0) {
        setViewMode("chat");
        return;
      }
      if (queueEditingId) {
        if (key.ctrl && (key.name === "j" || key.name === "return" || key.name === "enter")) {
          queueEditActions.insert(`
`);
          return;
        }
        if (!key.ctrl && (key.name === "enter" || key.name === "return")) {
          const trimmed = queueEditState.value.trim();
          if (trimmed) {
            queueEdit(queueEditingId, trimmed);
          }
          setQueueEditingId(null);
          queueEditActions.setValue("");
          return;
        }
        queueEditActions.handleKey(key);
        return;
      }
      if (!key.shift && !key.ctrl && key.name === "up") {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (!key.shift && !key.ctrl && key.name === "down") {
        setSelectedIndex((prev) => Math.min(queue.length - 1, prev + 1));
        return;
      }
      if ((key.shift || key.ctrl) && key.name === "up") {
        const selected = queue[selectedIndex];
        if (selected && queueMoveUp(selected.id)) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        }
        return;
      }
      if ((key.shift || key.ctrl) && key.name === "down") {
        const selected = queue[selectedIndex];
        if (selected && queueMoveDown(selected.id)) {
          setSelectedIndex((prev) => Math.min(queue.length - 1, prev + 1));
        }
        return;
      }
      if (key.name === "e") {
        const selected = queue[selectedIndex];
        if (selected) {
          setQueueEditingId(selected.id);
          queueEditActions.setValue(selected.text);
        }
        return;
      }
      if (key.name === "d" || key.name === "delete") {
        const selected = queue[selectedIndex];
        if (selected) {
          queueRemove(selected.id);
          setSelectedIndex((prev) => Math.min(prev, queue.length - 2));
          if (queue.length <= 1) {
            setViewMode("chat");
          }
        }
        return;
      }
      if (key.name === "c") {
        queueClear();
        setViewMode("chat");
        appendCommandMessage(setMessages, "队列已清空。");
        return;
      }
      return;
    }
    if (isGenerating && pendingApplies.length > 0) {
      const current = pendingApplies[0];
      if (key.name === "up" || key.name === "down") {
        approval.setPreviewIndex((prev) => key.name === "up" ? prev - 1 : prev + 1);
        return;
      }
      if (key.name === "tab" || key.name === "left" || key.name === "right") {
        approval.toggleChoice();
        return;
      }
      if (key.name === "v") {
        approval.toggleDiffView();
        return;
      }
      if (key.name === "l") {
        approval.toggleLineNumbers();
        return;
      }
      if (key.name === "w") {
        approval.toggleWrapMode();
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        onToolApply(current.id, approval.approvalChoice === "approve");
        approval.resetChoice();
        return;
      }
      if (key.name === "y") {
        onToolApply(current.id, true);
        approval.resetChoice();
        return;
      }
      if (key.name === "n") {
        onToolApply(current.id, false);
        approval.resetChoice();
        return;
      }
      return;
    }
    if (isGenerating && pendingApprovals.length > 0) {
      const inv = pendingApprovals[0];
      const isCommandTool = inv.toolName === "shell" || inv.toolName === "bash";
      if (key.name === "tab" && isCommandTool) {
        approval.toggleApprovalPage();
        return;
      }
      if (key.name === "left" || key.name === "up" || key.name === "right" || key.name === "down") {
        approval.toggleChoice();
        return;
      }
      if (key.name === "y") {
        onToolApproval(inv.id, true);
        approval.resetChoice();
        return;
      }
      if (key.name === "n") {
        onToolApproval(inv.id, false);
        approval.resetChoice();
        return;
      }
      if (approval.approvalPage === "policy" && isCommandTool) {
        const command = typeof inv.args?.command === "string" ? inv.args.command : "";
        if (key.name === "enter" || key.name === "return") {
          onToolApproval(inv.id, true);
          onAddCommandPattern?.(inv.toolName, command, approval.approvalChoice === "approve" ? "allow" : "deny");
          approval.resetChoice();
          return;
        }
        if (key.name === "a") {
          onToolApproval(inv.id, true);
          onAddCommandPattern?.(inv.toolName, command, "allow");
          approval.resetChoice();
          return;
        }
        if (key.name === "s") {
          onToolApproval(inv.id, true);
          onAddCommandPattern?.(inv.toolName, command, "deny");
          approval.resetChoice();
          return;
        }
      } else {
        if (key.name === "enter" || key.name === "return") {
          onToolApproval(inv.id, approval.approvalChoice === "approve");
          approval.resetChoice();
          return;
        }
      }
      return;
    }
    if (pendingConfirm) {
      if (key.name === "left" || key.name === "up" || key.name === "right" || key.name === "down") {
        setConfirmChoice((prev) => prev === "confirm" ? "cancel" : "confirm");
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        if (confirmChoice === "confirm")
          pendingConfirm.action();
        closeConfirm(setPendingConfirm, setConfirmChoice);
        return;
      }
      if (key.name === "y") {
        pendingConfirm.action();
        closeConfirm(setPendingConfirm, setConfirmChoice);
        return;
      }
      if (key.name === "n") {
        closeConfirm(setPendingConfirm, setConfirmChoice);
        return;
      }
      return;
    }
    if (viewMode === "session-list") {
      if (key.name === "up")
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down")
        setSelectedIndex((prev) => Math.min(sessionList.length - 1, prev + 1));
      else if (key.name === "enter" || key.name === "return") {
        const selected = sessionList[selectedIndex];
        if (selected) {
          clearRedo(undoRedoRef.current);
          onClearRedoStack();
          setMessages([]);
          commitTools();
          setViewMode("chat");
          onLoadSession(selected.id).catch(() => {});
        }
      }
      return;
    }
    if (viewMode === "model-list") {
      if (key.name === "up")
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down")
        setSelectedIndex((prev) => Math.min(modelList.length - 1, prev + 1));
      else if (key.name === "enter" || key.name === "return") {
        const selected = modelList[selectedIndex];
        if (selected) {
          const result = onSwitchModel(selected.modelName);
          modelState.updateModel(result);
          setViewMode("chat");
        }
      }
      return;
    }
  });
}

// extensions/console/src/hooks/use-approval.ts
import { useCallback as useCallback6, useEffect as useEffect9, useState as useState10 } from "react";
function useApproval(pendingApprovals, pendingApplies) {
  const [approvalChoice, setApprovalChoice] = useState10("approve");
  const [approvalPage, setApprovalPage] = useState10("basic");
  const [diffView, setDiffView] = useState10("unified");
  const [showLineNumbers, setShowLineNumbers] = useState10(true);
  const [wrapMode, setWrapMode] = useState10("word");
  const [previewIndex, setPreviewIndex] = useState10(0);
  useEffect9(() => {
    setApprovalChoice("approve");
    setApprovalPage("basic");
  }, [pendingApprovals[0]?.id]);
  useEffect9(() => {
    setApprovalChoice("approve");
    setDiffView("unified");
    setShowLineNumbers(true);
    setWrapMode("word");
    setPreviewIndex(0);
  }, [pendingApplies[0]?.id]);
  const resetChoice = useCallback6(() => {
    setApprovalChoice("approve");
    setApprovalPage("basic");
  }, []);
  const toggleApprovalPage = useCallback6(() => {
    setApprovalPage((prev) => prev === "basic" ? "policy" : "basic");
  }, []);
  const toggleChoice = useCallback6(() => {
    setApprovalChoice((prev) => prev === "approve" ? "reject" : "approve");
  }, []);
  const toggleDiffView = useCallback6(() => {
    setDiffView((prev) => prev === "unified" ? "split" : "unified");
  }, []);
  const toggleLineNumbers = useCallback6(() => {
    setShowLineNumbers((prev) => !prev);
  }, []);
  const toggleWrapMode = useCallback6(() => {
    setWrapMode((prev) => prev === "none" ? "word" : "none");
  }, []);
  return {
    approvalChoice,
    approvalPage,
    diffView,
    showLineNumbers,
    wrapMode,
    previewIndex,
    setPreviewIndex,
    resetChoice,
    toggleChoice,
    toggleApprovalPage,
    toggleDiffView,
    toggleLineNumbers,
    toggleWrapMode
  };
}

// extensions/console/src/hooks/use-command-dispatch.ts
import { useCallback as useCallback7 } from "react";
function resetRedo(undoRedoRef, onClearRedoStack) {
  clearRedo(undoRedoRef.current);
  onClearRedoStack();
}
function useCommandDispatch({
  onSubmit,
  onUndo,
  onRedo,
  onClearRedoStack,
  onNewSession,
  onListSessions,
  onRunCommand,
  onListModels,
  onSwitchModel,
  onResetConfig,
  onExit,
  onListAgents,
  setAgentList,
  onDream,
  onListMemories,
  setMemoryList,
  setMemoryFilter,
  setMemoryExpandedId,
  setMemoryPendingDeleteId,
  onListExtensions,
  setExtensionList,
  onRemoteConnect,
  onRemoteDisconnect,
  isRemote,
  remoteHost,
  onSummarize,
  undoRedoRef,
  setMessages,
  commitTools,
  setViewMode,
  setSessionList,
  setModelList,
  setSelectedIndex,
  setPendingConfirm,
  setConfirmChoice,
  setSettingsInitialSection,
  modelState,
  queueClear,
  queueSize
}) {
  return useCallback7((text) => {
    if (text === "/exit") {
      onExit();
      return;
    }
    if (text === "/agent") {
      if (onListAgents) {
        const agents = onListAgents();
        if (agents.length > 0) {
          setAgentList(agents);
          setSelectedIndex(0);
          setViewMode("agent-list");
          return;
        }
      }
      appendCommandMessage(setMessages, "当前只有一个 Agent，无需切换。");
      return;
    }
    if (text === "/disconnect" || text === "/remote disconnect") {
      if (!isRemote) {
        appendCommandMessage(setMessages, "当前未连接远程实例。");
        return;
      }
      if (onRemoteDisconnect) {
        onRemoteDisconnect();
        return;
      }
      return;
    }
    if (text === "/remote" || text === "/remote ") {
      if (isRemote) {
        appendCommandMessage(setMessages, `当前已连接远程实例: ${remoteHost}
输入 /disconnect 断开连接。`);
        return;
      }
      if (onRemoteConnect) {
        onRemoteConnect();
        return;
      }
      appendCommandMessage(setMessages, "远程连接功能不可用。");
      return;
    }
    if (text.startsWith("/remote ") && text !== "/remote disconnect") {
      const name = text.slice(8).trim();
      if (name) {
        if (onRemoteConnect) {
          onRemoteConnect(name);
        }
        return;
      }
      if (onRemoteConnect && !isRemote) {
        onRemoteConnect();
      }
      return;
    }
    if (text === "/net") {
      setSettingsInitialSection("net");
      setViewMode("settings");
      return;
    }
    if (text === "/new") {
      resetRedo(undoRedoRef, onClearRedoStack);
      queueClear();
      setMessages([]);
      commitTools();
      onNewSession();
      return;
    }
    if (text === "/undo") {
      onUndo().then((ok) => {
        if (!ok)
          return;
        setMessages((prev) => {
          const result = performUndo(prev, undoRedoRef.current);
          if (!result)
            return prev;
          return result.messages;
        });
      }).catch(() => {});
      return;
    }
    if (text === "/redo") {
      onRedo().then((ok) => {
        if (!ok)
          return;
        setMessages((prev) => {
          const result = performRedo(prev, undoRedoRef.current);
          if (!result)
            return prev;
          return result.messages;
        });
      }).catch(() => {});
      return;
    }
    if (text === "/load") {
      queueClear();
      onListSessions().then((metas) => {
        setSessionList(metas);
        setSelectedIndex(0);
        setViewMode("session-list");
      });
      return;
    }
    if (text === "/reset-config") {
      setPendingConfirm({
        message: "确认重置所有配置为默认值？当前配置将被覆盖。",
        action: async () => {
          const result = await onResetConfig();
          appendCommandMessage(setMessages, result.message + (result.success ? `
重启应用后生效。` : ""));
        }
      });
      setConfirmChoice("confirm");
      return;
    }
    if (text === "/settings" || text === "/mcp") {
      setSettingsInitialSection(text === "/mcp" ? "mcp" : "general");
      setViewMode("settings");
      return;
    }
    if (text === "/memory") {
      if (!onListMemories) {
        appendCommandMessage(setMessages, "Memory system not enabled.");
        return;
      }
      onListMemories().then((list) => {
        setMemoryList(list);
        setMemoryFilter("all");
        setMemoryExpandedId(null);
        setMemoryPendingDeleteId(null);
        setSelectedIndex(0);
        setViewMode("memory-list");
      }).catch((err) => {
        appendCommandMessage(setMessages, `Failed to load memories: ${err}`, { isError: true });
      });
      return;
    }
    if (text === "/extension") {
      if (!onListExtensions) {
        appendCommandMessage(setMessages, "Extension management not available.");
        return;
      }
      onListExtensions().then((list) => {
        setExtensionList(list);
        setSelectedIndex(0);
        setViewMode("extension-list");
      }).catch((err) => {
        appendCommandMessage(setMessages, `Failed to load extensions: ${err}`, { isError: true });
      });
      return;
    }
    if (text === "/dream") {
      if (!onDream) {
        appendCommandMessage(setMessages, "记忆系统未启用。请先在 /memory 中开启。");
        return;
      }
      appendCommandMessage(setMessages, "Iris 做梦中...");
      onDream().then(async ({ ok, message }) => {
        appendCommandMessage(setMessages, message, ok ? undefined : { isError: true });
        if (ok && onListMemories) {
          try {
            const list = await onListMemories();
            setMemoryList(list);
            setMemoryFilter("all");
            setMemoryExpandedId(null);
            setMemoryPendingDeleteId(null);
            setSelectedIndex(0);
            setViewMode("memory-list");
          } catch {}
        }
      }).catch((err) => {
        appendCommandMessage(setMessages, `归纳失败: ${err}`, { isError: true });
      });
      return;
    }
    if (text === "/queue") {
      if (queueSize === 0) {
        appendCommandMessage(setMessages, "队列为空，无待发送消息。");
        return;
      }
      setSelectedIndex(0);
      setViewMode("queue-list");
      return;
    }
    if (text === "/queue clear") {
      const count = queueSize;
      queueClear();
      appendCommandMessage(setMessages, count > 0 ? `已清空 ${count} 条排队消息。` : "队列已为空。");
      return;
    }
    if (text.startsWith("/model")) {
      resetRedo(undoRedoRef, onClearRedoStack);
      const arg = text.slice("/model".length).trim();
      if (!arg) {
        const models = onListModels();
        setModelList(models);
        const currentIndex = models.findIndex((model) => model.current);
        setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
        setViewMode("model-list");
      } else {
        const result = onSwitchModel(arg);
        modelState.updateModel(result);
        appendCommandMessage(setMessages, result.message);
      }
      return;
    }
    if (text === "/compact") {
      onSummarize().then((result) => {
        if (!result.ok) {
          appendCommandMessage(setMessages, result.message, { isError: true });
        }
      }).catch((err) => {
        appendCommandMessage(setMessages, `Context compression failed: ${err.message ?? err}`, { isError: true });
      });
      return;
    }
    if (text.startsWith("/sh ") || text === "/sh") {
      const cmd = text.slice(4).trim();
      if (!cmd)
        return;
      resetRedo(undoRedoRef, onClearRedoStack);
      try {
        const result = onRunCommand(cmd);
        appendCommandMessage(setMessages, result.output || "(无输出)");
      } catch (error) {
        appendCommandMessage(setMessages, `执行失败: ${error.message}`, { isError: true });
      }
      return;
    }
    resetRedo(undoRedoRef, onClearRedoStack);
    onSubmit(text);
  }, [
    commitTools,
    modelState,
    onClearRedoStack,
    onExit,
    onListModels,
    onListSessions,
    onNewSession,
    onRedo,
    onRemoteConnect,
    onRemoteDisconnect,
    isRemote,
    remoteHost,
    onResetConfig,
    onRunCommand,
    onSubmit,
    onListAgents,
    setAgentList,
    onDream,
    onSwitchModel,
    onSummarize,
    onUndo,
    queueClear,
    queueSize,
    setConfirmChoice,
    setMessages,
    setModelList,
    setPendingConfirm,
    setSelectedIndex,
    setSessionList,
    setSettingsInitialSection,
    setViewMode,
    undoRedoRef
  ]);
}

// extensions/console/src/hooks/use-exit-confirm.ts
import { useCallback as useCallback8, useEffect as useEffect10, useRef as useRef7, useState as useState11 } from "react";
function useExitConfirm({ timeoutMs = 1500 } = {}) {
  const [exitConfirmArmed, setExitConfirmArmed] = useState11(false);
  const exitConfirmTimerRef = useRef7(null);
  const clearExitConfirm = useCallback8(() => {
    if (exitConfirmTimerRef.current) {
      clearTimeout(exitConfirmTimerRef.current);
      exitConfirmTimerRef.current = null;
    }
    setExitConfirmArmed(false);
  }, []);
  const armExitConfirm = useCallback8(() => {
    if (exitConfirmTimerRef.current)
      clearTimeout(exitConfirmTimerRef.current);
    setExitConfirmArmed(true);
    exitConfirmTimerRef.current = setTimeout(() => {
      exitConfirmTimerRef.current = null;
      setExitConfirmArmed(false);
    }, timeoutMs);
  }, [timeoutMs]);
  useEffect10(() => {
    return () => {
      if (exitConfirmTimerRef.current)
        clearTimeout(exitConfirmTimerRef.current);
    };
  }, []);
  return {
    exitConfirmArmed,
    clearExitConfirm,
    armExitConfirm
  };
}

// extensions/console/src/hooks/use-message-queue.ts
import { useCallback as useCallback9, useRef as useRef8, useState as useState12 } from "react";
var queueIdCounter = 0;
function useMessageQueue() {
  const [queue, setQueue] = useState12([]);
  const queueRef = useRef8([]);
  const sync = useCallback9((next) => {
    queueRef.current = next;
    setQueue(next);
  }, []);
  const prepend = useCallback9((text) => {
    const msg = {
      id: `queued-${++queueIdCounter}`,
      text,
      createdAt: Date.now()
    };
    const next = [msg, ...queueRef.current];
    sync(next);
    return msg;
  }, [sync]);
  const enqueue = useCallback9((text) => {
    const msg = {
      id: `queued-${++queueIdCounter}`,
      text,
      createdAt: Date.now()
    };
    const next = [...queueRef.current, msg];
    sync(next);
    return msg;
  }, [sync]);
  const dequeue = useCallback9(() => {
    const current = queueRef.current;
    if (current.length === 0)
      return;
    const [first, ...rest] = current;
    sync(rest);
    return first;
  }, [sync]);
  const peek = useCallback9(() => {
    return queueRef.current[0];
  }, []);
  const edit = useCallback9((id, newText) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0)
      return false;
    const next = [...current];
    next[index] = { ...next[index], text: newText };
    sync(next);
    return true;
  }, [sync]);
  const remove = useCallback9((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0)
      return false;
    const next = current.filter((m) => m.id !== id);
    sync(next);
    return true;
  }, [sync]);
  const moveUp = useCallback9((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index <= 0)
      return false;
    const next = [...current];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    sync(next);
    return true;
  }, [sync]);
  const moveDown = useCallback9((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0 || index >= current.length - 1)
      return false;
    const next = [...current];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    sync(next);
    return true;
  }, [sync]);
  const clear = useCallback9(() => {
    sync([]);
  }, [sync]);
  return {
    queue,
    prepend,
    enqueue,
    dequeue,
    peek,
    edit,
    remove,
    moveUp,
    moveDown,
    clear,
    size: queue.length
  };
}

// extensions/console/src/hooks/use-model-state.ts
import { useCallback as useCallback10, useState as useState13 } from "react";
function useModelState({ modelId, modelName, contextWindow }) {
  const [currentModelId, setCurrentModelId] = useState13(modelId);
  const [currentModelName, setCurrentModelName] = useState13(modelName);
  const [currentContextWindow, setCurrentContextWindow] = useState13(contextWindow);
  const updateModel = useCallback10((result) => {
    if (result.modelId)
      setCurrentModelId(result.modelId);
    if (result.modelName)
      setCurrentModelName(result.modelName);
    if ("contextWindow" in result)
      setCurrentContextWindow(result.contextWindow);
  }, []);
  return {
    currentModelId,
    currentModelName,
    currentContextWindow,
    updateModel
  };
}

// extensions/console/src/App.tsx
import { jsxDEV as jsxDEV37 } from "@opentui/react/jsx-dev-runtime";
function App({
  onReady,
  onSubmit,
  onOpenToolDetail,
  onNavigateToolDetail,
  onCloseToolDetail,
  onUndo,
  onRedo,
  onClearRedoStack,
  onToolApproval,
  onToolApply,
  onAddCommandPattern,
  onAbort,
  onNewSession,
  onLoadSession,
  onListSessions,
  onRunCommand,
  onListModels,
  onSwitchModel,
  onLoadSettings,
  onSaveSettings,
  onResetConfig,
  onExit,
  onSummarize,
  onListAgents,
  onSelectAgent,
  onThinkingEffortChange,
  initWarnings,
  agentName,
  modeName,
  modelId,
  modelName,
  contextWindow,
  pluginSettingsTabs,
  onDream,
  onListMemories,
  onDeleteMemory,
  onListExtensions,
  onToggleExtension,
  onRemoteConnect,
  onRemoteDisconnect,
  remoteHost,
  initWarningsColor,
  initWarningsIcon
}) {
  const [viewMode, setViewMode] = useState14("chat");
  const [sessionList, setSessionList] = useState14([]);
  const [selectedIndex, setSelectedIndex] = useState14(0);
  const [settingsInitialSection, setSettingsInitialSection] = useState14("general");
  const [modelList, setModelList] = useState14([]);
  const [agentList, setAgentList] = useState14([]);
  const [copyMode, setCopyMode] = useState14(false);
  const [pendingConfirm, setPendingConfirm] = useState14(null);
  const [confirmChoice, setConfirmChoice] = useState14("confirm");
  const [thinkingEffort, setThinkingEffort] = useState14("none");
  const [thoughtsToggleSignal, setThoughtsToggleSignal] = useState14(0);
  const [memoryList, setMemoryList] = useState14([]);
  const [memoryFilter, setMemoryFilter] = useState14("all");
  const [memoryExpandedId, setMemoryExpandedId] = useState14(null);
  const [memoryPendingDeleteId, setMemoryPendingDeleteId] = useState14(null);
  const [extensionList, setExtensionList] = useState14([]);
  const [extensionTogglingName, setExtensionTogglingName] = useState14(null);
  const [extensionStatusMessage, setExtensionStatusMessage] = useState14(null);
  const [extensionStatusIsError, setExtensionStatusIsError] = useState14(false);
  const [queueEditingId, setQueueEditingId] = useState14(null);
  const [queueEditState, queueEditActions] = useTextInput("");
  const renderer = useRenderer();
  const undoRedoRef = useRef9(createUndoRedoStack());
  const messageQueue = useMessageQueue();
  const drainCallbackRef = useRef9(null);
  drainCallbackRef.current = () => {
    if (viewMode === "queue-list")
      return;
    const msg = messageQueue.dequeue();
    return msg?.text;
  };
  const appState = useAppHandle({ onReady, undoRedoRef, drainCallbackRef });
  const approval = useApproval(appState.pendingApprovals, appState.pendingApplies);
  const exitConfirm = useExitConfirm();
  const modelState = useModelState({ modelId, modelName, contextWindow });
  const queueAwareSubmit = useCallback11((text) => {
    if (appState.isGenerating) {
      messageQueue.enqueue(text);
    } else {
      onSubmit(text);
    }
  }, [appState.isGenerating, messageQueue, onSubmit]);
  const handlePrioritySubmit = useCallback11((text) => {
    messageQueue.prepend(text);
    onAbort();
  }, [messageQueue, onAbort]);
  const cycleThinkingEffort = useCallback11((direction) => {
    const levels = ["none", "low", "medium", "high", "max"];
    setThinkingEffort((prev) => {
      const idx = levels.indexOf(prev);
      const next = idx + direction;
      if (next < 0 || next >= levels.length)
        return prev;
      const newLevel = levels[next];
      onThinkingEffortChange?.(newLevel);
      return newLevel;
    });
  }, [onThinkingEffortChange]);
  const handleSubmit = useCommandDispatch({
    onSubmit: queueAwareSubmit,
    onUndo,
    onRedo,
    onClearRedoStack,
    onNewSession,
    onListSessions,
    onRunCommand,
    onListModels,
    onSwitchModel,
    onResetConfig,
    onExit,
    onListAgents,
    setAgentList,
    onDream,
    onListMemories,
    setMemoryList,
    setMemoryFilter,
    setMemoryExpandedId,
    setMemoryPendingDeleteId,
    onListExtensions,
    setExtensionList,
    onRemoteConnect,
    onRemoteDisconnect,
    isRemote: !!remoteHost,
    remoteHost,
    onSummarize,
    undoRedoRef,
    setMessages: appState.setMessages,
    commitTools: appState.commitTools,
    setViewMode,
    setSessionList,
    setModelList,
    setSelectedIndex,
    setPendingConfirm,
    setConfirmChoice,
    setSettingsInitialSection,
    modelState,
    queueClear: messageQueue.clear,
    queueSize: messageQueue.size
  });
  useEffect11(() => {
    if (!renderer)
      return;
    renderer.useMouse = !copyMode;
  }, [renderer, copyMode]);
  const prevViewModeRef = useRef9(viewMode);
  useEffect11(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (prev === "queue-list" && viewMode === "chat" && !appState.isGenerating && messageQueue.size > 0) {
      const next = messageQueue.dequeue();
      if (next) {
        onSubmit(next.text);
      }
    }
  }, [viewMode, appState.isGenerating, messageQueue, onSubmit]);
  useEffect11(() => {
    if (appState.toolDetailData && viewMode !== "tool-detail") {
      setViewMode("tool-detail");
    } else if (!appState.toolDetailData && viewMode === "tool-detail") {
      setViewMode("chat");
    }
  }, [appState.toolDetailData, viewMode]);
  useEffect11(() => {
    if (appState.toolListItems.length > 0 && viewMode !== "tool-list" && viewMode !== "tool-detail") {
      setSelectedIndex(0);
      setViewMode("tool-list");
    }
  }, [appState.toolListItems]);
  useAppKeyboard({
    viewMode,
    setViewMode,
    setCopyMode,
    pendingConfirm,
    confirmChoice,
    setPendingConfirm,
    setConfirmChoice,
    exitConfirm,
    isGenerating: appState.isGenerating,
    pendingApplies: appState.pendingApplies,
    pendingApprovals: appState.pendingApprovals,
    onOpenToolDetail,
    approval,
    onExit,
    onAbort,
    onToolApply,
    onToolApproval,
    onAddCommandPattern,
    sessionList,
    modelList,
    selectedIndex,
    setSelectedIndex,
    undoRedoRef,
    onClearRedoStack,
    setMessages: appState.setMessages,
    commitTools: appState.commitTools,
    onLoadSession,
    onSwitchModel,
    modelState,
    queue: messageQueue.queue,
    queueRemove: messageQueue.remove,
    queueMoveUp: messageQueue.moveUp,
    queueMoveDown: messageQueue.moveDown,
    queueEdit: messageQueue.edit,
    queueClear: messageQueue.clear,
    queueEditingId,
    setQueueEditingId,
    queueEditState,
    queueEditActions,
    onToggleThoughts: () => setThoughtsToggleSignal((prev) => prev + 1),
    toolListItems: appState.toolListItems,
    agentList,
    onSelectAgent,
    memoryList,
    memoryFilter,
    setMemoryFilter,
    memoryExpandedId,
    setMemoryExpandedId,
    memoryPendingDeleteId,
    setMemoryPendingDeleteId,
    setMemoryList,
    onDeleteMemory,
    extensionList,
    setExtensionList,
    onToggleExtension,
    onListExtensions,
    setExtensionTogglingName,
    setExtensionStatusMessage,
    setExtensionStatusIsError
  });
  const currentApply = appState.isGenerating ? appState.pendingApplies[0] : undefined;
  const hasMessages = appState.messages.length > 0 || appState.isGenerating;
  if (viewMode === "settings") {
    return /* @__PURE__ */ jsxDEV37(SettingsView, {
      initialSection: settingsInitialSection,
      onBack: () => setViewMode("chat"),
      onLoad: onLoadSettings,
      onSave: onSaveSettings,
      pluginTabs: pluginSettingsTabs
    }, undefined, false, undefined, this);
  }
  if (viewMode === "session-list") {
    return /* @__PURE__ */ jsxDEV37(SessionListView, {
      sessions: sessionList,
      selectedIndex
    }, undefined, false, undefined, this);
  }
  if (viewMode === "model-list") {
    return /* @__PURE__ */ jsxDEV37(ModelListView, {
      models: modelList,
      selectedIndex
    }, undefined, false, undefined, this);
  }
  if (viewMode === "agent-list") {
    return /* @__PURE__ */ jsxDEV37(AgentListView, {
      agents: agentList,
      selectedIndex,
      currentAgentName: agentName
    }, undefined, false, undefined, this);
  }
  if (viewMode === "memory-list") {
    return /* @__PURE__ */ jsxDEV37(MemoryListView, {
      memories: memoryList,
      selectedIndex,
      expandedId: memoryExpandedId,
      filter: memoryFilter,
      pendingDeleteId: memoryPendingDeleteId
    }, undefined, false, undefined, this);
  }
  if (viewMode === "extension-list") {
    return /* @__PURE__ */ jsxDEV37(ExtensionListView, {
      extensions: extensionList,
      selectedIndex,
      togglingName: extensionTogglingName,
      statusMessage: extensionStatusMessage,
      statusIsError: extensionStatusIsError
    }, undefined, false, undefined, this);
  }
  if (viewMode === "queue-list") {
    return /* @__PURE__ */ jsxDEV37(QueueListView, {
      queue: messageQueue.queue,
      selectedIndex,
      editingId: queueEditingId,
      editingValue: queueEditState.value,
      editingCursor: queueEditState.cursor
    }, undefined, false, undefined, this);
  }
  if (currentApply) {
    return /* @__PURE__ */ jsxDEV37(DiffApprovalView, {
      invocation: currentApply,
      pendingCount: appState.pendingApplies.length,
      choice: approval.approvalChoice,
      view: approval.diffView,
      showLineNumbers: approval.showLineNumbers,
      wrapMode: approval.wrapMode,
      previewIndex: approval.previewIndex
    }, undefined, false, undefined, this);
  }
  if (viewMode === "tool-list") {
    return /* @__PURE__ */ jsxDEV37(ToolListView, {
      tools: appState.toolListItems,
      selectedIndex
    }, undefined, false, undefined, this);
  }
  if (viewMode === "tool-detail" && appState.toolDetailData) {
    return /* @__PURE__ */ jsxDEV37("box", {
      flexDirection: "column",
      width: "100%",
      height: "100%",
      children: /* @__PURE__ */ jsxDEV37(ToolDetailView, {
        data: appState.toolDetailData,
        breadcrumb: appState.toolDetailStack,
        onNavigateChild: onNavigateToolDetail,
        onClose: onCloseToolDetail,
        onAbort: (toolId) => {
          onOpenToolDetail(toolId);
        }
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV37("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      !hasMessages ? /* @__PURE__ */ jsxDEV37(LogoScreen, {}, undefined, false, undefined, this) : null,
      !hasMessages && initWarnings && initWarnings.length > 0 ? /* @__PURE__ */ jsxDEV37(InitWarnings, {
        warnings: initWarnings,
        color: initWarningsColor,
        icon: initWarningsIcon
      }, undefined, false, undefined, this) : null,
      hasMessages ? /* @__PURE__ */ jsxDEV37(ChatMessageList, {
        messages: appState.messages,
        streamingParts: appState.streamingParts,
        isStreaming: appState.isStreaming,
        isGenerating: appState.isGenerating,
        retryInfo: appState.retryInfo,
        modelName: modelState.currentModelName,
        generatingLabel: appState.generatingLabel,
        timerPaused: appState.pendingApprovals.length > 0 || appState.pendingApplies.length > 0,
        thoughtsToggleSignal
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ jsxDEV37(BottomPanel, {
        hasMessages,
        pendingConfirm,
        confirmChoice,
        pendingApprovals: appState.pendingApprovals,
        approvalChoice: approval.approvalChoice,
        approvalPage: approval.approvalPage,
        isGenerating: appState.isGenerating,
        queueSize: messageQueue.size,
        onSubmit: handleSubmit,
        onPrioritySubmit: handlePrioritySubmit,
        agentName,
        modeName,
        modelName: modelState.currentModelName,
        contextTokens: appState.contextTokens,
        contextWindow: modelState.currentContextWindow,
        copyMode,
        exitConfirmArmed: exitConfirm.exitConfirmArmed,
        backgroundTaskCount: appState.backgroundTaskCount,
        delegateTaskCount: appState.delegateTaskCount,
        backgroundTaskTokens: appState.backgroundTaskTokens,
        backgroundTaskSpinnerFrame: appState.backgroundTaskSpinnerFrame,
        thinkingEffort,
        onCycleThinkingEffort: cycleThinkingEffort,
        remoteHost,
        isRemote: !!remoteHost
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// extensions/console/src/opentui-runtime.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
import { addDefaultParsers, clearEnvCache } from "@opentui/core";
var OPENTUI_RUNTIME_DIR_NAME = "opentui";
var REQUIRED_ASSET_FILES = [
  "javascript/highlights.scm",
  "javascript/tree-sitter-javascript.wasm",
  "typescript/highlights.scm",
  "typescript/tree-sitter-typescript.wasm",
  "markdown/highlights.scm",
  "markdown/injections.scm",
  "markdown/tree-sitter-markdown.wasm",
  "markdown_inline/highlights.scm",
  "markdown_inline/tree-sitter-markdown_inline.wasm",
  "zig/highlights.scm",
  "zig/tree-sitter-zig.wasm"
];
var configured = false;
var warned = false;
function warnRuntimeIssue(message) {
  if (warned)
    return;
  warned = true;
  console.warn(`[ConsolePlatform] ${message}`);
}
function resolveBundledRuntimeDir(isCompiledBinary) {
  if (!isCompiledBinary)
    return null;
  try {
    const execDir = path3.dirname(fs3.realpathSync(process.execPath));
    const candidates = [
      path3.join(execDir, OPENTUI_RUNTIME_DIR_NAME),
      path3.join(path3.resolve(execDir, ".."), OPENTUI_RUNTIME_DIR_NAME)
    ];
    for (const candidate of candidates) {
      if (fs3.existsSync(path3.join(candidate, "parser.worker.js"))) {
        return candidate;
      }
    }
  } catch {}
  return null;
}
function hasBundledAssets(assetsRoot) {
  return REQUIRED_ASSET_FILES.every((relativePath) => fs3.existsSync(path3.join(assetsRoot, relativePath)));
}
function createBundledParsers(assetsRoot) {
  const asset = (...segments) => path3.join(assetsRoot, ...segments);
  return [
    {
      filetype: "javascript",
      aliases: ["javascriptreact"],
      queries: {
        highlights: [asset("javascript", "highlights.scm")]
      },
      wasm: asset("javascript", "tree-sitter-javascript.wasm")
    },
    {
      filetype: "typescript",
      aliases: ["typescriptreact"],
      queries: {
        highlights: [asset("typescript", "highlights.scm")]
      },
      wasm: asset("typescript", "tree-sitter-typescript.wasm")
    },
    {
      filetype: "markdown",
      queries: {
        highlights: [asset("markdown", "highlights.scm")],
        injections: [asset("markdown", "injections.scm")]
      },
      wasm: asset("markdown", "tree-sitter-markdown.wasm"),
      injectionMapping: {
        nodeTypes: {
          inline: "markdown_inline",
          pipe_table_cell: "markdown_inline"
        },
        infoStringMap: {
          javascript: "javascript",
          js: "javascript",
          jsx: "javascriptreact",
          javascriptreact: "javascriptreact",
          typescript: "typescript",
          ts: "typescript",
          tsx: "typescriptreact",
          typescriptreact: "typescriptreact",
          markdown: "markdown",
          md: "markdown"
        }
      }
    },
    {
      filetype: "markdown_inline",
      queries: {
        highlights: [asset("markdown_inline", "highlights.scm")]
      },
      wasm: asset("markdown_inline", "tree-sitter-markdown_inline.wasm")
    },
    {
      filetype: "zig",
      queries: {
        highlights: [asset("zig", "highlights.scm")]
      },
      wasm: asset("zig", "tree-sitter-zig.wasm")
    }
  ];
}
function configureBundledOpenTuiTreeSitter(isCompiledBinary) {
  if (configured)
    return;
  const runtimeDir = resolveBundledRuntimeDir(isCompiledBinary);
  const workerPath = process.env.OTUI_TREE_SITTER_WORKER_PATH?.trim() || (runtimeDir ? path3.join(runtimeDir, "parser.worker.js") : "");
  if (!workerPath) {
    if (isCompiledBinary) {
      warnRuntimeIssue("未找到 OpenTUI tree-sitter worker，Markdown 标题和加粗高亮可能不可用。");
    }
    configured = true;
    return;
  }
  process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath;
  clearEnvCache();
  if (runtimeDir) {
    const assetsRoot = path3.join(runtimeDir, "assets");
    if (hasBundledAssets(assetsRoot)) {
      addDefaultParsers(createBundledParsers(assetsRoot));
    } else {
      warnRuntimeIssue("未找到完整的 OpenTUI tree-sitter 资源目录，Markdown 代码高亮可能不可用。");
    }
  }
  configured = true;
}

// extensions/console/src/resize-watcher.ts
function getTerminalSize(renderer) {
  const width = process.stdout.columns || renderer.width || 80;
  const height = process.stdout.rows || renderer.height || 24;
  return { width, height };
}
function applyResize(renderer, width, height) {
  if (typeof renderer.handleResize === "function") {
    renderer.handleResize(width, height);
    return;
  }
  if (typeof renderer.processResize === "function") {
    renderer.processResize(width, height);
    return;
  }
  renderer.requestRender();
}
function attachCompiledResizeWatcher(renderer, isCompiledBinary) {
  if (!isCompiledBinary || !process.stdout.isTTY) {
    return () => {};
  }
  const internalRenderer = renderer;
  let { width: lastWidth, height: lastHeight } = getTerminalSize(internalRenderer);
  let disposed = false;
  const syncResize = () => {
    if (disposed)
      return;
    const { width, height } = getTerminalSize(internalRenderer);
    if (width <= 0 || height <= 0)
      return;
    if (width === lastWidth && height === lastHeight)
      return;
    lastWidth = width;
    lastHeight = height;
    applyResize(internalRenderer, width, height);
  };
  const stdoutResizeListener = () => {
    syncResize();
  };
  process.stdout.on("resize", stdoutResizeListener);
  const pollInterval = setInterval(syncResize, 120);
  pollInterval.unref?.();
  const dispose = () => {
    if (disposed)
      return;
    disposed = true;
    clearInterval(pollInterval);
    process.stdout.off("resize", stdoutResizeListener);
    internalRenderer.off("destroy", dispose);
  };
  internalRenderer.on("destroy", dispose);
  syncResize();
  return dispose;
}

// extensions/console/src/index.ts
init_terminal_compat();
function generateCommandPattern(command) {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens[0])
    return "*";
  if (tokens.length <= 1)
    return tokens[0] + " *";
  if (tokens[1].startsWith("-"))
    return tokens[0] + " *";
  return tokens[0] + " " + tokens[1] + " *";
}
function createToolInvocationFromFunctionCall(part, index, defaultStatus, response, durationMs) {
  let status = defaultStatus;
  let result;
  let error;
  if (response != null) {
    if ("error" in response && typeof response.error === "string") {
      status = "error";
      error = response.error;
    } else if ("result" in response) {
      result = response.result;
    } else {
      result = response;
    }
  }
  const now = Date.now();
  return {
    id: `history-tool-${Date.now()}-${index}-${part.functionCall.name}`,
    toolName: part.functionCall.name,
    args: part.functionCall.args ?? {},
    status,
    result,
    error,
    createdAt: durationMs != null ? now - durationMs : now,
    updatedAt: now
  };
}
function convertPartsToMessageParts(parts, toolStatus = "success", responseParts) {
  const result = [];
  let toolIndex = 0;
  const responseByCallId = new Map;
  const responseByIndex = [];
  if (responseParts) {
    for (const rp of responseParts) {
      if (rp.functionResponse.callId) {
        responseByCallId.set(rp.functionResponse.callId, rp);
      }
      responseByIndex.push(rp);
    }
  }
  for (const part of parts) {
    if ("text" in part) {
      if (part.thought === true) {
        result.push({ type: "thought", text: part.text ?? "", durationMs: part.thoughtDurationMs });
      } else {
        result.push({ type: "text", text: part.text ?? "" });
      }
      continue;
    }
    if ("functionCall" in part) {
      let matchedResponse;
      let matchedDurationMs;
      const callId = part.functionCall.callId;
      if (callId && responseByCallId.has(callId)) {
        const matched = responseByCallId.get(callId).functionResponse;
        matchedResponse = matched.response;
        matchedDurationMs = matched.durationMs;
      } else if (toolIndex < responseByIndex.length) {
        const matched = responseByIndex[toolIndex]?.functionResponse;
        matchedResponse = matched?.response;
        matchedDurationMs = matched?.durationMs;
      }
      const invocation = createToolInvocationFromFunctionCall(part, toolIndex++, toolStatus, matchedResponse, matchedDurationMs);
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last && last.type === "tool_use") {
        last.tools.push(invocation);
      } else {
        result.push({ type: "tool_use", tools: [invocation] });
      }
    }
  }
  return result;
}
function getMessageMeta(content) {
  const meta = {};
  if (content.usageMetadata?.promptTokenCount != null)
    meta.tokenIn = content.usageMetadata.promptTokenCount;
  if (content.usageMetadata?.candidatesTokenCount != null)
    meta.tokenOut = content.usageMetadata.candidatesTokenCount;
  if (content.createdAt != null)
    meta.createdAt = content.createdAt;
  if (content.isSummary)
    meta.isSummary = true;
  if (content.durationMs != null)
    meta.durationMs = content.durationMs;
  if (content.streamOutputDurationMs != null)
    meta.streamOutputDurationMs = content.streamOutputDurationMs;
  if (content.modelName)
    meta.modelName = content.modelName;
  return Object.keys(meta).length > 0 ? meta : undefined;
}
function generateSessionId() {
  const now = new Date;
  const ts2 = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "_" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts2}_${rand}`;
}

class ConsolePlatform extends PlatformAdapter {
  sessionId;
  modeName;
  modelId;
  modelName;
  contextWindow;
  backend;
  agentName;
  settingsController;
  initWarnings;
  initWarningsColor;
  initWarningsIcon;
  exitResolve;
  renderer;
  appHandle;
  disposeResizeWatcher;
  api;
  _activeHandles = new Map;
  isCompiledBinary;
  currentToolIds = new Set;
  currentThinkingEffort = "none";
  _toolDetailStack = [];
  historyMutationQueue = Promise.resolve();
  originalBackend = null;
  remoteClient = null;
  _isRemote = false;
  _remoteHost = "";
  originalApi = null;
  originalSettingsController = null;
  originalAgentName;
  _isGenerating = false;
  constructor(backend, options) {
    super();
    this.backend = backend;
    this.sessionId = generateSessionId();
    this.modeName = options.modeName;
    this.modelId = options.modelId;
    this.modelName = options.modelName;
    this.contextWindow = options.contextWindow;
    this.agentName = options.agentName;
    this.initWarnings = options.initWarnings ?? [];
    this.api = options.api;
    this.isCompiledBinary = options.isCompiledBinary ?? false;
    this.settingsController = new ConsoleSettingsController({
      backend,
      configManager: options.api?.configManager,
      mcpManager: options.getMCPManager(),
      extensions: options.extensions
    });
  }
  enqueueHistoryMutation(task) {
    const next = this.historyMutationQueue.then(task, task);
    this.historyMutationQueue = next.then(() => {
      return;
    }, () => {
      return;
    });
    return next;
  }
  async start() {
    this.api?.setLogLevel?.(LogLevel.SILENT);
    configureBundledOpenTuiTreeSitter(this.isCompiledBinary);
    this.backend.on("assistant:content", (sid, content) => {
      if (sid === this.sessionId) {
        const meta = getMessageMeta(content);
        const parts = convertPartsToMessageParts(content.parts, "queued");
        this.appHandle?.finalizeAssistantParts(parts, meta);
      }
    });
    this.backend.on("stream:start", (sid) => {
      if (sid === this.sessionId) {
        this.appHandle?.startStream();
      }
    });
    this.backend.on("stream:parts", (sid, parts) => {
      if (sid === this.sessionId) {
        this.appHandle?.pushStreamParts(convertPartsToMessageParts(parts, "streaming"));
      }
    });
    this.backend.on("stream:chunk", (sid, _chunk) => {
      if (sid === this.sessionId) {}
    });
    this.backend.on("stream:end", (sid) => {
      if (sid === this.sessionId) {
        this.appHandle?.endStream();
      }
    });
    this.backend.on("tool:execute", (sid, handle) => {
      if (sid !== this.sessionId)
        return;
      this._activeHandles.set(handle.id, handle);
      this.currentToolIds.add(handle.id);
      const refreshUI = () => {
        const invocations = Array.from(this._activeHandles.values()).filter((h) => this.currentToolIds.has(h.id)).map((h) => h.getSnapshot());
        this.appHandle?.setToolInvocations(invocations);
        this.refreshToolDetailIfNeeded();
      };
      handle.on("state", refreshUI);
      handle.on("output", refreshUI);
      handle.on("child", (childHandle) => {
        this._activeHandles.set(childHandle.id, childHandle);
        this.currentToolIds.add(childHandle.id);
        childHandle.on("state", refreshUI);
        childHandle.on("output", refreshUI);
        refreshUI();
      });
      refreshUI();
    });
    this.backend.on("error", (sid, error) => {
      if (sid === this.sessionId) {
        this.appHandle?.addErrorMessage(error);
      }
    });
    this.backend.on("usage", (sid, usage) => {
      if (sid === this.sessionId) {
        this.appHandle?.setUsage(usage);
      }
    });
    this.backend.on("retry", (sid, attempt, maxRetries, error) => {
      if (sid === this.sessionId) {
        this.appHandle?.setRetryInfo({ attempt, maxRetries, error });
      }
    });
    this.backend.on("user:token", (sid, tokenCount) => {
      if (sid === this.sessionId) {
        this.appHandle?.setUserTokens(tokenCount);
      }
    });
    this.backend.on("done", (sid, durationMs) => {
      if (sid === this.sessionId) {
        this.appHandle?.finalizeResponse(durationMs);
        this.appHandle?.clearNotificationContext();
      }
    });
    this.backend.on("turn:start", (sid, _turnId, mode) => {
      if (sid === this.sessionId) {
        if (mode === "task-notification") {
          this.appHandle?.setNotificationContext();
        } else {
          this.appHandle?.clearNotificationContext();
        }
      }
    });
    this.backend.on("agent:notification", (sid, _taskId, status, summary, taskType, silent) => {
      if (sid === this.sessionId) {
        const isDelegate = taskType === "delegate";
        const isCron = taskType === "cron";
        if (isCron) {
          if (status === "registered") {
            this.appHandle?.updateBackgroundTaskCount(1);
          } else if (status === "completed" || status === "failed" || status === "killed") {
            this.appHandle?.updateBackgroundTaskCount(-1);
            this.appHandle?.removeBackgroundTaskTokens(_taskId);
          } else if (status === "token-update") {
            const tokens = parseInt(summary, 10);
            if (!isNaN(tokens)) {
              this.appHandle?.updateBackgroundTaskTokens(_taskId, tokens);
            }
          } else if (status === "chunk-heartbeat") {
            this.appHandle?.advanceBackgroundTaskSpinner();
          }
        } else if (isDelegate) {
          if (status === "registered") {
            this.appHandle?.updateDelegateTaskCount(1);
          } else if (status === "completed" || status === "failed" || status === "killed") {
            this.appHandle?.updateDelegateTaskCount(-1);
            this.appHandle?.setNotificationContext(summary);
          }
        } else {
          if (status === "registered") {
            this.appHandle?.updateBackgroundTaskCount(1);
          } else if (status === "completed" || status === "failed" || status === "killed") {
            this.appHandle?.updateBackgroundTaskCount(-1);
            this.appHandle?.removeBackgroundTaskTokens(_taskId);
            this.appHandle?.setNotificationContext(summary);
          } else if (status === "token-update") {
            const tokens = parseInt(summary, 10);
            if (!isNaN(tokens)) {
              this.appHandle?.updateBackgroundTaskTokens(_taskId, tokens);
            }
          } else if (status === "chunk-heartbeat") {
            this.appHandle?.advanceBackgroundTaskSpinner();
          }
        }
      }
    });
    this.backend.on("notification:payloads", (sid, payloads) => {
      if (sid === this.sessionId) {
        this.appHandle?.setNotificationPayloads(payloads);
      }
    });
    this.backend.on("task:result", (sid, _taskId, status, description, _taskType, silent, result) => {
      if (sid !== this.sessionId)
        return;
      if (!silent)
        return;
      let text;
      if (status === "completed") {
        const preview = (result ?? "").slice(0, 200);
        text = `${ICONS.clock} ${description} 完成：${preview}`;
      } else if (status === "killed") {
        text = `${ICONS.clock} ${description} 被中止`;
      } else {
        text = `${ICONS.clock} ${description} 失败：${result ?? "未知错误"}`;
      }
      this.appHandle?.addMessage("assistant", text);
    });
    this.backend.on("auto-compact", (sid, summaryText) => {
      if (sid === this.sessionId) {
        const fullText = `[Context Summary]

${summaryText}`;
        const tokenCount = estimateTokenCount(fullText);
        this.appHandle?.addSummaryMessage(fullText, tokenCount > 0 ? tokenCount : undefined);
      }
    });
    return new Promise(async (resolve3, reject) => {
      try {
        this.renderer = await createCliRenderer({
          exitOnCtrlC: false,
          useMouse: true,
          enableMouseMovement: false
        });
      } catch (err) {
        if (err instanceof Error && err.message?.includes("Raw mode")) {
          console.error("[ConsolePlatform] Fatal: 当前终端不支持 Raw mode。");
          process.exit(1);
        }
        reject(err);
        return;
      }
      this.disposeResizeWatcher = attachCompiledResizeWatcher(this.renderer, this.isCompiledBinary);
      const element = React10.createElement(App, {
        onReady: (handle) => {
          this.appHandle = handle;
          resolve3();
        },
        onSubmit: (text) => this.handleInput(text),
        onUndo: async () => {
          try {
            const result = await this.enqueueHistoryMutation(async () => {
              return await this.backend.undo?.(this.sessionId, "last-visible-message");
            });
            return Boolean(result);
          } catch (err) {
            console.warn("[ConsolePlatform] onUndo 持久化失败:", err);
            return false;
          }
        },
        onRedo: async () => {
          try {
            const result = await this.enqueueHistoryMutation(async () => {
              return await this.backend.redo?.(this.sessionId);
            });
            return Boolean(result);
          } catch (err) {
            console.warn("[ConsolePlatform] onRedo 持久化失败:", err);
            return false;
          }
        },
        onClearRedoStack: () => {
          this.backend.clearRedo?.(this.sessionId);
        },
        onToolApproval: (toolId, approved) => {
          this.backend.getToolHandle?.(toolId)?.approve(approved);
        },
        onToolApply: (toolId, applied) => {
          this.backend.getToolHandle?.(toolId)?.apply(applied);
        },
        onAddCommandPattern: (toolName, command, type) => {
          this.addCommandPattern(toolName, command, type);
        },
        onAbort: () => {
          this.backend.abortChat?.(this.sessionId);
        },
        onOpenToolDetail: (toolId) => {
          this.openToolDetail(toolId);
        },
        onNavigateToolDetail: (toolId) => {
          this.navigateToolDetail(toolId);
        },
        onCloseToolDetail: () => {
          this.closeToolDetail();
        },
        onNewSession: () => this.handleNewSession(),
        onLoadSession: (id) => this.handleLoadSession(id),
        onListSessions: () => this.handleListSessions(),
        onRunCommand: (cmd) => this.handleRunCommand(cmd),
        onListModels: () => this.handleListModels(),
        onSwitchModel: (modelName) => this.handleSwitchModel(modelName),
        onLoadSettings: () => this.handleLoadSettings(),
        onSaveSettings: (snapshot) => this.handleSaveSettings(snapshot),
        onResetConfig: () => this.handleResetConfig(),
        onExit: () => {
          this.stop().then(() => {
            this.exitResolve?.("exit");
          });
        },
        onSummarize: () => this.handleSummarize(),
        onListAgents: () => this.handleListAgents(),
        onSelectAgent: (name) => this.handleSelectAgent(name),
        onDream: () => this.handleDream(),
        onListMemories: () => this.handleListMemories(),
        onDeleteMemory: (id) => this.handleDeleteMemory(id),
        onListExtensions: () => this.handleListExtensions(),
        onToggleExtension: (name) => this.handleToggleExtension(name),
        onRemoteConnect: (name) => this.handleRemoteConnect(name),
        onRemoteDisconnect: () => this.handleRemoteDisconnect(),
        remoteHost: this._remoteHost || undefined,
        onThinkingEffortChange: (level) => this.applyThinkingEffort(level),
        agentName: this.agentName,
        modeName: this.modeName,
        modelId: this.modelId,
        modelName: this.modelName,
        contextWindow: this.contextWindow,
        initWarnings: this.initWarnings,
        initWarningsColor: this.initWarningsColor,
        initWarningsIcon: this.initWarningsIcon,
        pluginSettingsTabs: this.api?.getConsoleSettingsTabs?.() ?? []
      });
      createRoot(this.renderer).render(element);
    });
  }
  async stop() {
    if (!this.renderer)
      return;
    const r = this.renderer;
    this.renderer = undefined;
    this.disposeResizeWatcher?.();
    if (process.platform === "win32") {
      try {
        if (process.stdin.isTTY)
          process.stdin.setRawMode(false);
      } catch {}
      try {
        process.stdin.pause();
      } catch {}
      const { writeSync } = __require("fs");
      try {
        writeSync(1, "\x1B[?1000l" + "\x1B[?1002l" + "\x1B[?1006l" + "\x1B[?2004l" + "\x1B[0m");
      } catch {}
      process.on("exit", () => {
        const { spawnSync } = __require("child_process");
        const seq = "\x1B[?1049l\x1B[?25h";
        try {
          const r1 = spawnSync("node", ["-e", `process.stdout.write(${JSON.stringify(seq)})`], { stdio: "inherit", timeout: 2000, windowsHide: true });
          if (r1.status === 0)
            return;
        } catch {}
        try {
          const psCmd = `[Console]::Write([char]27 + '[?1049l' + [char]27 + '[?25h')`;
          const r2 = spawnSync("powershell", ["-NoProfile", "-Command", psCmd], { stdio: "inherit", timeout: 2000, windowsHide: true });
          if (r2.status === 0)
            return;
        } catch {}
        try {
          writeSync(1, "\x1B[2J\x1B[H\x1B[?25h");
        } catch {}
      });
    } else {
      r.destroy();
    }
    await new Promise((resolve3) => setTimeout(resolve3, 100));
  }
  waitForExit() {
    return new Promise((resolve3) => {
      this.exitResolve = resolve3;
    });
  }
  handleListAgents() {
    return this.api?.listAgents?.() ?? [];
  }
  async handleSelectAgent(targetName) {
    const network = this.api?.agentNetwork;
    if (!network)
      return;
    if (targetName === network.selfName)
      return;
    await this.stop();
    const targetHandle = network.getPeerBackendHandle?.(targetName);
    if (targetHandle) {
      this.backend = targetHandle;
      this.agentName = targetName;
      const modelInfo = targetHandle.getCurrentModelInfo?.();
      if (modelInfo) {
        this.modelName = modelInfo.modelName;
        this.modelId = modelInfo.modelId;
        this.contextWindow = modelInfo.contextWindow;
      }
      this.sessionId = generateSessionId();
      this.currentToolIds.clear();
      this._activeHandles.clear();
      const peerAPI = network.getPeerAPI?.(targetName);
      if (peerAPI) {
        this.api = peerAPI;
        this.settingsController = new ConsoleSettingsController({
          backend: targetHandle,
          configManager: peerAPI.configManager,
          mcpManager: peerAPI.mcpManager,
          extensions: peerAPI.extensions
        });
      }
    }
    await this.start();
  }
  async doRemoteConnect(url, token) {
    const { showConnectingStatus: showConnectingStatus2, showConnectSuccess: showConnectSuccess2, showConnectError: showConnectError2 } = await Promise.resolve().then(() => (init_remote_wizard(), exports_remote_wizard));
    showConnectingStatus2(url);
    try {
      const { WsIPCClient } = await import("../../src/net/client");
      const { RemoteBackendHandle } = await import("../../src/ipc/remote-backend-handle");
      const wsClient = new WsIPCClient;
      const handshake = await wsClient.connect(url, token);
      let remoteBackend;
      let remoteApi;
      try {
        remoteBackend = new RemoteBackendHandle(wsClient);
        remoteBackend._streamEnabled = handshake.streamEnabled;
        await remoteBackend.initCaches();
        await wsClient.subscribe("*");
        const { createRemoteApiProxy } = await import("../../src/ipc/remote-api-proxy");
        remoteApi = createRemoteApiProxy(wsClient, handshake.agentName);
        if (typeof remoteApi.initCaches === "function") {
          await remoteApi.initCaches();
        }
      } catch (initErr) {
        wsClient.disconnect();
        throw initErr;
      }
      this.originalBackend = this.backend;
      this.originalApi = this.api;
      this.originalSettingsController = this.settingsController;
      this.originalAgentName = this.agentName;
      this.remoteClient = wsClient;
      this.backend = remoteBackend;
      this.api = remoteApi;
      this.settingsController = new ConsoleSettingsController({
        backend: remoteBackend,
        configManager: remoteApi.configManager,
        mcpManager: undefined,
        extensions: undefined
      });
      this._isRemote = true;
      this.agentName = handshake.agentName === "__global__" ? undefined : handshake.agentName;
      try {
        this._remoteHost = new URL(url).host;
      } catch {
        this._remoteHost = url;
      }
      const modelInfo = remoteBackend.getCurrentModelInfo?.();
      if (modelInfo) {
        this.modelName = modelInfo.modelName ?? this.modelName;
        this.modelId = modelInfo.modelId ?? this.modelId;
        this.contextWindow = modelInfo.contextWindow ?? this.contextWindow;
      }
      this.sessionId = generateSessionId();
      this.currentToolIds.clear();
      this._activeHandles.clear();
      showConnectSuccess2(handshake.agentName, this.modelName);
      this.initWarnings = [`已连接到远程 Iris — ${this._remoteHost} (agent=${handshake.agentName}, model=${this.modelName})
输入 /disconnect 断开连接`];
      this.initWarningsColor = "#00cec9";
      this.initWarningsIcon = ICONS.dotFilled;
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      showConnectError2(err.message);
      await new Promise((r) => setTimeout(r, 2000));
      throw err;
    }
  }
  readSavedRemotes() {
    try {
      const config = this.api?.configManager?.readEditableConfig?.();
      const remotes = config?.net?.remotes;
      if (remotes && typeof remotes === "object")
        return remotes;
    } catch {}
    return {};
  }
  migrateLastRemote() {
    try {
      const config = this.api?.configManager?.readEditableConfig?.();
      const lastRemote = config?.net?.lastRemote;
      if (!lastRemote?.url)
        return;
      const remotes = config?.net?.remotes ?? {};
      const alreadyExists = Object.values(remotes).some((r) => r?.url === lastRemote.url);
      if (!alreadyExists) {
        this.api?.configManager?.updateEditableConfig?.({
          net: { remotes: { _last: { url: lastRemote.url, token: lastRemote.token } } }
        });
      }
      this.api?.configManager?.updateEditableConfig?.({
        net: { lastRemote: null }
      });
    } catch {}
  }
  saveRemote(name, url, token) {
    try {
      const api = this.originalApi ?? this.api;
      api?.configManager?.updateEditableConfig?.({
        net: { remotes: { [name]: { url, token } } }
      });
    } catch {}
  }
  deleteSavedRemote(name) {
    try {
      this.api?.configManager?.updateEditableConfig?.({
        net: { remotes: { [name]: null } }
      });
    } catch {}
  }
  async handleRemoteConnect(quickName) {
    await this.stop();
    this.migrateLastRemote();
    const remotes = this.readSavedRemotes();
    if (quickName) {
      const entry = remotes[quickName];
      if (!entry) {
        const { showConnectError: showConnectError2 } = await Promise.resolve().then(() => (init_remote_wizard(), exports_remote_wizard));
        showConnectError2(`未找到已保存的连接: ${quickName}`);
        await new Promise((r) => setTimeout(r, 1500));
        await this.start();
        return;
      }
      if (entry.token) {
        try {
          await this.doRemoteConnect(entry.url, entry.token);
        } catch {}
        await this.start();
        return;
      }
      const { showInputPhase: showInputPhase2 } = await Promise.resolve().then(() => (init_remote_wizard(), exports_remote_wizard));
      const result2 = await showInputPhase2({ prefillUrl: entry.url, urlLocked: true });
      if (!result2) {
        await this.start();
        return;
      }
      try {
        await this.doRemoteConnect(entry.url, result2.token);
        this.saveRemote(quickName, entry.url, result2.token);
      } catch {}
      await this.start();
      return;
    }
    const saved = Object.entries(remotes).map(([name, entry]) => ({
      name,
      url: entry.url,
      hasToken: !!entry.token
    }));
    let discoveryPromise;
    try {
      const { discoverLanInstances } = await import("../../src/net/discovery");
      discoveryPromise = discoverLanInstances();
    } catch {}
    const { showRemoteConnectWizard: showRemoteConnectWizard2, showSavePrompt: showSavePrompt2 } = await Promise.resolve().then(() => (init_remote_wizard(), exports_remote_wizard));
    const result = await showRemoteConnectWizard2({
      saved,
      discoveryPromise,
      onDelete: (name) => this.deleteSavedRemote(name)
    });
    if (!result) {
      await this.start();
      return;
    }
    let connectUrl = result.url;
    let connectToken = result.token;
    if (result.source === "saved" && result.savedName && !connectToken) {
      const entry = remotes[result.savedName];
      if (entry?.token)
        connectToken = entry.token;
    }
    try {
      await this.doRemoteConnect(connectUrl, connectToken);
      if (result.source !== "saved") {
        const saveName = await showSavePrompt2();
        if (saveName) {
          this.saveRemote(saveName, connectUrl, connectToken);
        }
      }
    } catch {}
    await this.start();
  }
  async handleRemoteDisconnect() {
    if (!this._isRemote || !this.originalBackend)
      return;
    await this.stop();
    if (this.remoteClient) {
      this.remoteClient.disconnect();
      this.remoteClient = null;
    }
    const disconnectedHost = this._remoteHost;
    this.backend = this.originalBackend;
    this.originalBackend = null;
    if (this.originalApi) {
      this.api = this.originalApi;
      this.originalApi = null;
    }
    if (this.originalSettingsController) {
      this.settingsController = this.originalSettingsController;
      this.originalSettingsController = null;
    }
    this.agentName = this.originalAgentName;
    this.originalAgentName = undefined;
    this._isRemote = false;
    this._remoteHost = "";
    this.initWarnings = [`已断开远程连接 (${disconnectedHost})，已回到本地`];
    this.initWarningsColor = "#74b9ff";
    this.initWarningsIcon = ICONS.dotEmpty;
    const modelInfo = this.backend.getCurrentModelInfo?.();
    if (modelInfo) {
      this.modelName = modelInfo.modelName ?? this.modelName;
      this.modelId = modelInfo.modelId ?? this.modelId;
      this.contextWindow = modelInfo.contextWindow ?? this.contextWindow;
    }
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
    this._activeHandles.clear();
    await this.start();
  }
  createHistoricalHandle(inv) {
    return {
      id: inv.id,
      toolName: inv.toolName,
      status: inv.status,
      depth: inv.depth ?? 0,
      parentId: inv.parentToolId,
      signal: new AbortController().signal,
      getSnapshot: () => ({ ...inv }),
      getOutputHistory: () => [],
      getChildren: () => [],
      abort: () => {},
      approve: () => {},
      apply: () => {},
      send: () => {},
      on: () => {},
      off: () => {},
      emit: () => false
    };
  }
  handleNewSession() {
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
    this._activeHandles.clear();
  }
  openToolDetail(toolId) {
    if (!toolId) {
      const all = Array.from(this._activeHandles.values());
      if (all.length === 0) {
        if (!this._isGenerating) {
          this.appHandle?.addErrorMessage("当前会话没有工具执行记录。");
        }
        return;
      }
      const tools = all.map((h) => h.getSnapshot()).sort((a, b) => a.createdAt - b.createdAt);
      this.appHandle?.openToolList(tools);
      return;
    }
    const handle = this._activeHandles.get(toolId);
    if (!handle) {
      this.appHandle?.addErrorMessage("未找到指定的工具执行记录。");
      return;
    }
    this._toolDetailStack = [handle.id];
    this.pushToolDetailData(handle.id);
  }
  navigateToolDetail(toolId) {
    const handle = this._activeHandles.get(toolId);
    if (!handle)
      return;
    this._toolDetailStack.push(toolId);
    this.pushToolDetailData(toolId);
  }
  closeToolDetail() {
    if (this._toolDetailStack.length > 1) {
      this._toolDetailStack.pop();
      const parentId = this._toolDetailStack[this._toolDetailStack.length - 1];
      this.pushToolDetailData(parentId);
    } else {
      this._toolDetailStack = [];
      this.appHandle?.closeToolDetail();
    }
  }
  addCommandPattern(toolName, command, type) {
    const pattern = generateCommandPattern(command);
    const key = type === "allow" ? "allowPatterns" : "denyPatterns";
    const policies = this.backend.getToolPolicies?.();
    if (!policies) {
      return;
    }
    let policy = policies[toolName];
    if (!policy) {
      policy = { autoApprove: false };
      policies[toolName] = policy;
    }
    const arr = policy[key];
    if (arr) {
      if (!arr.includes(pattern))
        arr.push(pattern);
    } else {
      policy[key] = [pattern];
    }
    const oppositeKey = type === "allow" ? "denyPatterns" : "allowPatterns";
    const oppositeArr = policy[oppositeKey];
    if (oppositeArr) {
      const idx = oppositeArr.indexOf(pattern);
      if (idx !== -1)
        oppositeArr.splice(idx, 1);
    }
    const configManager = this.api?.configManager;
    if (configManager) {
      try {
        const raw = configManager.readEditableConfig();
        const tools = raw.tools ?? {};
        const toolSection = tools[toolName] ?? {};
        const existing = Array.isArray(toolSection[key]) ? toolSection[key] : [];
        if (!existing.includes(pattern)) {
          existing.push(pattern);
        }
        const oppositeKey2 = type === "allow" ? "denyPatterns" : "allowPatterns";
        const opposite = Array.isArray(toolSection[oppositeKey2]) ? toolSection[oppositeKey2] : [];
        const oidx = opposite.indexOf(pattern);
        if (oidx !== -1)
          opposite.splice(oidx, 1);
        const updates = { [key]: existing };
        if (oidx !== -1)
          updates[oppositeKey2] = opposite;
        configManager.updateEditableConfig({ tools: { [toolName]: updates } });
      } catch {}
    }
  }
  pushToolDetailData(toolId) {
    const handle = this._activeHandles.get(toolId);
    if (!handle)
      return;
    const invocation = handle.getSnapshot();
    const output = handle.getOutputHistory?.() ?? [];
    const childHandles = handle.getChildren?.() ?? [];
    const children = childHandles.map((ch) => ch.getSnapshot());
    const breadcrumb = this._toolDetailStack.map((id) => {
      const h = this._activeHandles.get(id);
      return { toolId: id, toolName: h?.toolName ?? id };
    });
    const breadcrumbForView = breadcrumb.slice(0, -1);
    this.appHandle?.openToolDetail({ invocation, output, children }, breadcrumbForView);
  }
  refreshToolDetailIfNeeded() {
    if (this._toolDetailStack.length === 0)
      return;
    const currentId = this._toolDetailStack[this._toolDetailStack.length - 1];
    if (this._activeHandles.has(currentId)) {
      this.pushToolDetailData(currentId);
    }
  }
  handleRunCommand(cmd) {
    return this.backend.runCommand?.(cmd) ?? { output: "", cwd: "" };
  }
  handleListModels() {
    return this.backend.listModels?.() ?? [];
  }
  handleSwitchModel(modelName) {
    try {
      const info = this.backend.switchModel?.(modelName, "console");
      if (!info)
        return { ok: false, message: "模型切换功能不可用" };
      this.modelName = info.modelName;
      this.modelId = info.modelId;
      this.contextWindow = info.contextWindow;
      if (this.currentThinkingEffort !== "none") {
        this.applyThinkingEffort(this.currentThinkingEffort);
      }
      return {
        ok: true,
        message: `当前模型已切换为：${info.modelName}  ${info.modelId}`,
        modelName: info.modelName,
        modelId: info.modelId,
        contextWindow: info.contextWindow
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `切换模型失败：${detail}` };
    }
  }
  applyThinkingEffort(level) {
    this.currentThinkingEffort = level;
    const router = this.api?.router;
    if (!router)
      return;
    if (level === "none") {
      router.removeCurrentModelRequestBodyKeys?.("thinking", "output_config");
    } else {
      router.patchCurrentModelRequestBody?.({
        thinking: { type: "enabled", budget_tokens: 1e4 },
        output_config: { effort: level }
      });
    }
  }
  async handleLoadSession(id) {
    this.sessionId = id;
    this.currentToolIds.clear();
    this._activeHandles.clear();
    const history = await this.backend.getHistory?.(id) ?? [];
    const responseMap = new Map;
    for (let i = 0;i < history.length; i++) {
      const msg = history[i];
      if (msg.role === "model" && msg.parts.some((p) => ("functionCall" in p))) {
        const next = i + 1 < history.length ? history[i + 1] : undefined;
        if (next && next.role === "user") {
          const responses = next.parts.filter((p) => ("functionResponse" in p));
          if (responses.length > 0)
            responseMap.set(i, responses);
        }
      }
    }
    for (let i = 0;i < history.length; i++) {
      const msg = history[i];
      const role = msg.role === "user" ? "user" : "assistant";
      const parts = convertPartsToMessageParts(msg.parts, "success", responseMap.get(i));
      for (const part of parts) {
        if (part.type === "tool_use") {
          for (const inv of part.tools) {
            this._activeHandles.set(inv.id, this.createHistoricalHandle(inv));
          }
        }
      }
      const meta = getMessageMeta(msg);
      if (parts.length > 0) {
        this.appHandle?.addStructuredMessage(role, parts, meta);
      }
      if (msg.usageMetadata) {
        this.appHandle?.setUsage(msg.usageMetadata);
      }
    }
  }
  async handleListSessions() {
    return await this.backend.listSessionMetas?.() ?? [];
  }
  async handleLoadSettings() {
    return this.settingsController.loadSnapshot();
  }
  async handleSaveSettings(snapshot) {
    return this.settingsController.saveSnapshot(snapshot);
  }
  async handleResetConfig() {
    try {
      await this.backend.resetConfigToDefaults?.();
      return { success: true, message: "配置已重置" };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  }
  async handleDream() {
    const mem = this.api?.memory;
    if (!mem?.dream) {
      return { ok: false, message: "记忆系统未启用。请先在 /memory 中开启。" };
    }
    try {
      const result = await mem.dream();
      return { ok: result.ok, message: result.message };
    } catch (err) {
      return { ok: false, message: `归纳失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  async handleListMemories() {
    const mem = this.api?.memory;
    if (!mem?.list)
      return [];
    try {
      return await mem.list(undefined, 500);
    } catch {
      return [];
    }
  }
  async handleDeleteMemory(id) {
    const mem = this.api?.memory;
    if (!mem?.delete)
      return false;
    try {
      return await mem.delete(id);
    } catch {
      return false;
    }
  }
  async handleListExtensions() {
    const ext = this.api?.extensions;
    const configManager = this.api?.configManager;
    if (!ext?.discover || !configManager)
      return [];
    try {
      const packages = ext.discover();
      const raw = configManager.readEditableConfig();
      const pluginEntries = raw?.plugins ?? [];
      const pluginMap = new Map(pluginEntries.map((p) => [p.name, p]));
      const active = this.api?.pluginManager?.listPlugins?.() ?? [];
      const activeNames = new Set(active.map((p) => p.name));
      return packages.map((pkg) => {
        const name = pkg.manifest.name;
        const hasPlugin = !!pkg.manifest.plugin;
        const inConfig = pluginMap.get(name);
        let status;
        if (!hasPlugin) {
          status = "platform";
        } else if (activeNames.has(name)) {
          status = "active";
        } else if (inConfig && inConfig.enabled === false) {
          status = "disabled";
        } else if (inConfig) {
          status = "disabled";
        } else {
          status = "available";
        }
        return {
          name,
          version: pkg.manifest.version,
          description: pkg.manifest.description || "",
          status,
          hasPlugin,
          source: pkg.source
        };
      });
    } catch {
      return [];
    }
  }
  async handleToggleExtension(name) {
    const ext = this.api?.extensions;
    const configManager = this.api?.configManager;
    if (!ext || !configManager) {
      return { ok: false, message: "扩展管理 API 不可用" };
    }
    try {
      const raw = configManager.readEditableConfig();
      const pluginEntries = [...raw?.plugins ?? []];
      const existing = pluginEntries.find((p) => p.name === name);
      const active = this.api?.pluginManager?.listPlugins?.() ?? [];
      const isActive = active.some((p) => p.name === name);
      if (isActive) {
        await ext.deactivate(name);
        if (existing) {
          existing.enabled = false;
        } else {
          pluginEntries.push({ name, enabled: false });
        }
        configManager.updateEditableConfig({ plugins: pluginEntries });
        return { ok: true, message: `已禁用 "${name}"` };
      } else {
        await ext.activate(name);
        if (existing) {
          existing.enabled = true;
        } else {
          pluginEntries.push({ name, enabled: true });
        }
        configManager.updateEditableConfig({ plugins: pluginEntries });
        return { ok: true, message: `已启用 "${name}"` };
      }
    } catch (err) {
      return { ok: false, message: `操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  async handleSummarize() {
    this.appHandle?.setGeneratingLabel("compressing context...");
    this._isGenerating = true;
    this.appHandle?.setGenerating(true);
    try {
      const summaryText = await this.backend.summarize?.(this.sessionId) ?? "";
      const fullText = `[Context Summary]

${summaryText}`;
      const tokenCount = estimateTokenCount(fullText);
      this.appHandle?.addSummaryMessage(fullText, tokenCount > 0 ? tokenCount : undefined);
      return { ok: true, message: "Context compressed." };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.appHandle?.addErrorMessage(`Context compression failed: ${detail}`);
      return { ok: false, message: detail };
    } finally {
      this._isGenerating = false;
      this.appHandle?.setGenerating(false);
    }
  }
  async handleInput(text) {
    this._isGenerating = true;
    this.appHandle?.setGenerating(true);
    let currentText = text;
    while (currentText) {
      this.appHandle?.addMessage("user", currentText);
      this.currentToolIds.clear();
      try {
        await this.backend.chat(this.sessionId, currentText, undefined, undefined, "console");
      } finally {
        this.appHandle?.commitTools();
      }
      currentText = this.appHandle?.drainQueue();
    }
    this._isGenerating = false;
    this.appHandle?.setGenerating(false);
  }
}
async function consoleFactory(rawContext) {
  const context = rawContext;
  if (typeof globalThis.Bun === "undefined") {
    console.error(`[Iris] Console 平台需要 Bun 运行时。
` + `  - 请优先使用: bun run dev
` + `  - 或直接执行: bun src/index.ts
` + "  - 或切换到其他平台（如 web）");
    process.exit(1);
  }
  const currentModel = context.router?.getCurrentModelInfo?.() ?? { modelName: "default", modelId: "" };
  return new ConsolePlatform(context.backend, {
    modeName: context.config?.system?.defaultMode ?? "default",
    modelName: currentModel.modelName ?? "default",
    modelId: currentModel.modelId ?? "",
    contextWindow: currentModel.contextWindow,
    configDir: context.configDir ?? "",
    getMCPManager: context.getMCPManager ?? (() => {
      return;
    }),
    setMCPManager: context.setMCPManager ?? (() => {}),
    agentName: context.agentName,
    initWarnings: context.initWarnings,
    extensions: context.extensions,
    api: context.api,
    isCompiledBinary: context.isCompiledBinary ?? false
  });
}
export {
  consoleFactory as default,
  ConsolePlatform
};
