var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// extensions/console/src/remote-wizard.ts
var remote_wizard_exports = {};
__export(remote_wizard_exports, {
  showConnectError: () => showConnectError,
  showConnectSuccess: () => showConnectSuccess,
  showConnectingStatus: () => showConnectingStatus,
  showInputPhase: () => showInputPhase,
  showRemoteConnectWizard: () => showRemoteConnectWizard,
  showSavePrompt: () => showSavePrompt
});
function showSelectionPhase(options) {
  return new Promise((resolve3) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
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
        if (done) return;
        discovered = results;
        discoveryDone = true;
        items = buildItems();
        if (cursor >= items.length) cursor = items.length - 1;
        render();
      }).catch(() => {
        if (done) return;
        discoveryDone = true;
        render();
      });
    } else {
      discoveryDone = true;
    }
    function render() {
      if (done) return;
      const lines = [];
      lines.push("");
      lines.push(`  ${ansi.magenta}${ansi.bold}\u2501\u2501 Iris \u2014 \u8FDC\u7A0B\u8FDE\u63A5 ${ansi.reset}`);
      lines.push("");
      if (options.saved.length > 0) {
        lines.push(`  ${ansi.dim}\u5DF2\u4FDD\u5B58:${ansi.reset}`);
        for (let i = 0; i < options.saved.length; i++) {
          const s = options.saved[i];
          const isCurrent = cursor === i;
          const arrow = isCurrent ? `${ansi.cyan}\u25B8 ` : "  ";
          const nameStr = isCurrent ? `${ansi.cyan}${ansi.bold}${s.name}${ansi.reset}` : s.name;
          const host = s.url.replace(/^wss?:\/\//, "");
          const tokenHint = s.hasToken ? `${ansi.dim} \u2713${ansi.reset}` : "";
          lines.push(`  ${arrow}${nameStr}${ansi.reset} ${ansi.dim}(${host})${ansi.reset}${tokenHint}`);
        }
        lines.push("");
      }
      const savedLen = options.saved.length;
      if (!discoveryDone) {
        lines.push(`  ${ansi.dim}\u5C40\u57DF\u7F51: ${ansi.yellow}\u641C\u7D22\u4E2D...${ansi.reset}`);
        lines.push("");
      } else if (discovered.length > 0) {
        lines.push(`  ${ansi.dim}\u5C40\u57DF\u7F51\u53D1\u73B0:${ansi.reset}`);
        for (let i = 0; i < discovered.length; i++) {
          const d = discovered[i];
          const idx = savedLen + i;
          const isCurrent = cursor === idx;
          const arrow = isCurrent ? `${ansi.cyan}\u25B8 ` : "  ";
          const nameStr = isCurrent ? `${ansi.cyan}${ansi.bold}${d.name}${ansi.reset}` : d.name;
          const agentHint = d.agent ? ` [${d.agent}]` : "";
          lines.push(`  ${arrow}${nameStr}${ansi.reset} ${ansi.dim}(${d.host}:${d.port}${agentHint})${ansi.reset}`);
        }
        lines.push("");
      } else {
        lines.push(`  ${ansi.dim}\u5C40\u57DF\u7F51: \u672A\u53D1\u73B0\u5176\u4ED6\u5B9E\u4F8B${ansi.reset}`);
        lines.push("");
      }
      const manualIdx = items.length - 1;
      const isManualCurrent = cursor === manualIdx;
      const manualStyle = isManualCurrent ? `${ansi.cyan}${ansi.bold}\u25B8 [ \u624B\u52A8\u8F93\u5165 ]${ansi.reset}` : `  ${ansi.dim}[ \u624B\u52A8\u8F93\u5165 ]${ansi.reset}`;
      lines.push(`  ${manualStyle}`);
      lines.push("");
      const hints = ["\u2191\u2193 \u9009\u62E9", "Enter \u8FDE\u63A5"];
      if (options.saved.length > 0 && cursor < savedLen) {
        hints.push("d \u5220\u9664");
      }
      hints.push("Esc \u53D6\u6D88");
      lines.push(`  ${ansi.dim}${hints.join("  \xB7  ")}${ansi.reset}`);
      lines.push("");
      stdout.write(ansi.clear + ansi.hideCursor + lines.join("\n"));
    }
    function cleanup() {
      done = true;
      stdin.removeListener("data", onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }
    function onData(buf) {
      const key = buf.toString("utf-8");
      if (key === "\x1B" || key === "") {
        cleanup();
        resolve3(null);
        return;
      }
      if (key === "\x1B[A") {
        if (cursor > 0) cursor--;
        render();
        return;
      }
      if (key === "\x1B[B") {
        if (cursor < items.length - 1) cursor++;
        render();
        return;
      }
      if (key === "	") {
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
          } catch {
          }
          options.saved = options.saved.filter((s) => s.name !== item.name);
          items = buildItems();
          if (cursor >= items.length) cursor = items.length - 1;
          render();
        }
        return;
      }
      if (key === "\r" || key === "\n") {
        const item = items[cursor];
        if (!item) return;
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
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    function render() {
      const lines = [];
      lines.push("");
      lines.push(`  ${ansi.magenta}${ansi.bold}\u2501\u2501 Iris \u2014 \u8FDC\u7A0B\u8FDE\u63A5 ${ansi.reset}`);
      lines.push("");
      if (opts.urlLocked) {
        lines.push(`  ${ansi.dim}\u5730\u5740${ansi.reset}  ${url}`);
      } else {
        const urlLabel = focusedField === 0 ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
        const urlCursor = focusedField === 0 ? `${ansi.cyan}\u258E${ansi.reset}` : "";
        lines.push(`  ${urlLabel}\u5730\u5740${ansi.reset}  ${url}${urlCursor}`);
      }
      lines.push("");
      const tokenLabel = focusedField === 1 ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
      const tokenCursor = focusedField === 1 ? `${ansi.cyan}\u258E${ansi.reset}` : "";
      const maskedToken = "\u2022".repeat(token.length);
      lines.push(`  ${tokenLabel}Token${ansi.reset} ${maskedToken}${tokenCursor}`);
      lines.push("");
      const connectStyle = focusedField === 2 ? `${ansi.green}${ansi.bold}[ \u8FDE\u63A5 ]${ansi.reset}` : `${ansi.dim}[ \u8FDE\u63A5 ]${ansi.reset}`;
      lines.push(`  ${connectStyle}`);
      lines.push("");
      if (status) {
        const statusColor = statusIsError ? ansi.red : ansi.green;
        lines.push(`  ${statusColor}${status}${ansi.reset}`);
        lines.push("");
      }
      lines.push(`  ${ansi.dim}Tab \u5207\u6362\u5B57\u6BB5  Enter \u786E\u8BA4  Esc \u8FD4\u56DE${ansi.reset}`);
      lines.push("");
      stdout.write(ansi.clear + ansi.hideCursor + lines.join("\n"));
    }
    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
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
      if (key === "\x1B" || key === "") {
        cleanup();
        resolve3(null);
        return;
      }
      if (key === "	") {
        nextField();
        render();
        return;
      }
      if (key === "\x1B[Z") {
        prevField();
        render();
        return;
      }
      if (key === "\r" || key === "\n") {
        if (focusedField === 2) {
          if (!url.trim() || url.trim() === "ws://") {
            status = "\u8BF7\u8F93\u5165\u8FDC\u7A0B\u5730\u5740";
            statusIsError = true;
            render();
            return;
          }
          if (!token.trim()) {
            status = "\u8BF7\u8F93\u5165 Token";
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
      if (key === "\x7F" || key === "\b") {
        if (focusedField === 0 && !opts.urlLocked && url.length > 0) url = url.slice(0, -1);
        else if (focusedField === 1 && token.length > 0) token = token.slice(0, -1);
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
        if (focusedField === 0 && !opts.urlLocked) url += key;
        else if (focusedField === 1) token += key;
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
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    function render() {
      const lines = [];
      lines.push("");
      lines.push(`  ${ansi.green}${ansi.bold}\u2713 \u5DF2\u8FDE\u63A5\u5230\u8FDC\u7A0B Iris${ansi.reset}`);
      lines.push("");
      lines.push(`  ${ansi.dim}\u4FDD\u5B58\u6B64\u8FDE\u63A5\uFF1F\u8F93\u5165\u540D\u79F0\u540E\u56DE\u8F66\u4FDD\u5B58\uFF0CEsc \u8DF3\u8FC7${ansi.reset}`);
      lines.push("");
      lines.push(`  ${ansi.cyan}${ansi.bold}\u540D\u79F0${ansi.reset} ${name}${ansi.cyan}\u258E${ansi.reset}`);
      lines.push("");
      if (status) {
        lines.push(`  ${ansi.red}${status}${ansi.reset}`);
        lines.push("");
      }
      stdout.write(ansi.clear + ansi.hideCursor + lines.join("\n"));
    }
    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(ansi.showCursor + ansi.clear);
    }
    function onData(buf) {
      const key = buf.toString("utf-8");
      if (key === "\x1B" || key === "") {
        cleanup();
        resolve3(null);
        return;
      }
      if (key === "\r" || key === "\n") {
        const trimmed = name.trim();
        if (!trimmed) {
          status = "\u8BF7\u8F93\u5165\u8FDE\u63A5\u540D\u79F0";
          render();
          return;
        }
        if (!/^[\w-]+$/.test(trimmed)) {
          status = "\u540D\u79F0\u53EA\u80FD\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u3001-\u3001_";
          render();
          return;
        }
        cleanup();
        resolve3(trimmed);
        return;
      }
      if (key === "\x7F" || key === "\b") {
        if (name.length > 0) name = name.slice(0, -1);
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
    if (!input2) return null;
    return { url: input2.url, token: input2.token, source: "manual" };
  }
  const selection = await showSelectionPhase(options);
  if (!selection) return null;
  if (selection.action === "connect-saved") {
    if (selection.hasToken) {
      return { url: selection.url, token: "", source: "saved", savedName: selection.name };
    }
    const input2 = await showInputPhase({ prefillUrl: selection.url, urlLocked: true });
    if (!input2) return null;
    return { url: input2.url, token: input2.token, source: "saved", savedName: selection.name };
  }
  if (selection.action === "connect-discovered") {
    const url = `ws://${selection.host}:${selection.port}`;
    const input2 = await showInputPhase({ prefillUrl: url, urlLocked: true });
    if (!input2) return null;
    return { url: input2.url, token: input2.token, source: "discovered" };
  }
  const input = await showInputPhase();
  if (!input) return null;
  return { url: input.url, token: input.token, source: "manual" };
}
function showConnectingStatus(url) {
  process.stdout.write(
    ansi.clear + `
  ${ansi.cyan}\u6B63\u5728\u8FDE\u63A5\u5230 ${url}...${ansi.reset}
`
  );
}
function showConnectSuccess(agentName, modelName) {
  process.stdout.write(
    `  ${ansi.green}\u5DF2\u8FDE\u63A5\u5230\u8FDC\u7A0B Iris (agent=${agentName}, model=${modelName})${ansi.reset}
`
  );
}
function showConnectError(error) {
  process.stdout.write(
    `  ${ansi.red}\u8FDE\u63A5\u5931\u8D25: ${error}${ansi.reset}
`
  );
}
var ESC, CSI, ansi;
var init_remote_wizard = __esm({
  "extensions/console/src/remote-wizard.ts"() {
    "use strict";
    ESC = "\x1B";
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
  }
});

// extensions/console/src/index.ts
import React10 from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

// packages/extension-sdk/dist/platform.js
var PlatformAdapter = class {
  get name() {
    return this.constructor.name;
  }
};

// packages/extension-sdk/dist/logger.js
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
  if (!text) return 0;
  const { defaultCharsPerToken = DEFAULT_CHARS_PER_TOKEN, languageConfigs = DEFAULT_LANGUAGE_CONFIGS } = options;
  const segments = text.split(TOKEN_SPLIT_PATTERN).filter(Boolean);
  let tokenCount = 0;
  for (const segment of segments) tokenCount += estimateSegmentTokens(segment, languageConfigs, defaultCharsPerToken);
  return tokenCount;
}
function estimateSegmentTokens(segment, languageConfigs, defaultCharsPerToken) {
  if (PATTERNS.whitespace.test(segment)) return 0;
  if (PATTERNS.cjk.test(segment)) return getCharacterCount(segment);
  if (PATTERNS.numeric.test(segment)) return 1;
  if (segment.length <= SHORT_TOKEN_THRESHOLD) return 1;
  if (PATTERNS.punctuation.test(segment)) return segment.length > 1 ? Math.ceil(segment.length / 2) : 1;
  if (PATTERNS.alphanumeric.test(segment)) {
    const charsPerToken$1 = getLanguageSpecificCharsPerToken(segment, languageConfigs) ?? defaultCharsPerToken;
    return Math.ceil(segment.length / charsPerToken$1);
  }
  const charsPerToken = getLanguageSpecificCharsPerToken(segment, languageConfigs) ?? defaultCharsPerToken;
  return Math.ceil(segment.length / charsPerToken);
}
function getLanguageSpecificCharsPerToken(segment, languageConfigs) {
  for (const config of languageConfigs) if (config.pattern.test(segment)) return config.averageCharsPerToken;
}
function getCharacterCount(text) {
  return Array.from(text).length;
}

// extensions/console/src/App.tsx
import { useCallback as useCallback11, useEffect as useEffect11, useRef as useRef9, useState as useState14 } from "react";
import { useRenderer } from "@opentui/react";

// extensions/console/src/theme.ts
var C = {
  /** 主色（紫） */
  primary: "#6c5ce7",
  /** 主色浅色 */
  primaryLight: "#a29bfe",
  /** 强调色（绿）— 选中、活动、光标、成功 */
  accent: "#00b894",
  /** 警告色（黄） */
  warn: "#fdcb6e",
  /** 错误色（红） */
  error: "#d63031",
  /** 主文本 */
  text: "#dfe6e9",
  /** 次要文本 */
  textSec: "#b2bec3",
  /** 暗淡文本（提示 / 分隔线 / 禁用） */
  dim: "#636e72",
  /** 光标前景（反色） */
  cursorFg: "#1e1e1e",
  /** 边框默认色 */
  border: "#636e72",
  /** 边框活动色 */
  borderActive: "#00b894",
  /** 边框已填写色 */
  borderFilled: "#6c5ce7",
  /** 标题颜色 */
  heading: {
    1: "#fdcb6e",
    2: "#a29bfe",
    3: "#00b894",
    4: "#dfe6e9"
  },
  /** 用户角色色 */
  roleUser: "#00b894",
  /** 助手角色色 */
  roleAssistant: "#6c5ce7",
  /** 工具执行中背景（冷蓝灰调） */
  toolPendingBg: "#1a2228",
  /** 工具成功背景（微绿调） */
  toolSuccessBg: "#1a2520",
  /** 工具失败背景（微红调） */
  toolErrorBg: "#281a1a",
  /** 工具警告背景（微黄调） */
  toolWarnBg: "#28251a",
  /** 指令面板背景 */
  panelBg: "#1e2228",
  /** 思考区域背景 */
  thinkingBg: "#1a2228",
  /** 命令/Shell 输出色（青） */
  command: "#00cec9"
};

// extensions/console/src/components/ApprovalBar.tsx
import { Fragment, jsx, jsxs } from "@opentui/react/jsx-runtime";
function ApprovalBar({ toolName, choice, remainingCount, isCommandTool, approvalPage = "basic" }) {
  const showPolicyPage = isCommandTool && approvalPage === "policy";
  const borderColor = showPolicyPage ? C.command : choice === "approve" ? C.accent : C.error;
  return /* @__PURE__ */ jsx(
    "box",
    {
      flexDirection: "column",
      borderStyle: "single",
      borderColor,
      paddingLeft: 1,
      paddingRight: 1,
      paddingY: 0,
      children: /* @__PURE__ */ jsxs("text", { children: [
        /* @__PURE__ */ jsx("span", { fg: C.warn, children: /* @__PURE__ */ jsx("strong", { children: "? " }) }),
        /* @__PURE__ */ jsx("span", { fg: C.text, children: showPolicyPage ? "\u8BB0\u4F4F\u9009\u62E9 " : "\u786E\u8BA4\u6267\u884C " }),
        /* @__PURE__ */ jsx("span", { fg: C.warn, children: /* @__PURE__ */ jsx("strong", { children: toolName }) }),
        /* @__PURE__ */ jsx("span", { fg: C.dim, children: "  " }),
        showPolicyPage ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("span", { fg: choice === "approve" ? C.command : C.textSec, children: choice === "approve" ? "[(A)\u59CB\u7EC8\u5141\u8BB8]" : " (A)\u59CB\u7EC8\u5141\u8BB8 " }),
          /* @__PURE__ */ jsx("span", { fg: C.dim, children: " " }),
          /* @__PURE__ */ jsx("span", { fg: choice === "reject" ? "#e17055" : C.textSec, children: choice === "reject" ? "[(S)\u59CB\u7EC8\u8BE2\u95EE]" : " (S)\u59CB\u7EC8\u8BE2\u95EE " })
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("span", { fg: choice === "approve" ? C.accent : C.textSec, children: choice === "approve" ? "[(Y)\u6279\u51C6]" : " (Y)\u6279\u51C6 " }),
          /* @__PURE__ */ jsx("span", { fg: C.dim, children: " " }),
          /* @__PURE__ */ jsx("span", { fg: choice === "reject" ? C.error : C.textSec, children: choice === "reject" ? "[(N)\u62D2\u7EDD]" : " (N)\u62D2\u7EDD " })
        ] }),
        remainingCount > 1 ? /* @__PURE__ */ jsx("span", { fg: C.dim, children: `  (\u5269\u4F59 ${remainingCount - 1} \u4E2A)` }) : null,
        isCommandTool ? /* @__PURE__ */ jsx("span", { fg: C.dim, children: showPolicyPage ? "  Tab\u2192\u8FD4\u56DE" : "  Tab\u2192\u66F4\u591A" }) : null
      ] })
    }
  );
}

// extensions/console/src/components/ConfirmBar.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "@opentui/react/jsx-runtime";
function ConfirmBar({ message, choice }) {
  return /* @__PURE__ */ jsxs2(
    "box",
    {
      flexDirection: "column",
      borderStyle: "single",
      borderColor: choice === "confirm" ? C.warn : C.dim,
      paddingLeft: 1,
      paddingRight: 1,
      paddingY: 0,
      children: [
        /* @__PURE__ */ jsxs2("text", { children: [
          /* @__PURE__ */ jsx2("span", { fg: C.error, children: /* @__PURE__ */ jsx2("strong", { children: "\u26A0 " }) }),
          /* @__PURE__ */ jsx2("span", { fg: C.text, children: message })
        ] }),
        /* @__PURE__ */ jsxs2("text", { children: [
          /* @__PURE__ */ jsx2("span", { fg: C.dim, children: "  " }),
          /* @__PURE__ */ jsx2("span", { fg: choice === "confirm" ? C.warn : C.textSec, children: choice === "confirm" ? "[(Y)\u786E\u8BA4]" : " (Y)\u786E\u8BA4 " }),
          /* @__PURE__ */ jsx2("span", { fg: C.dim, children: " " }),
          /* @__PURE__ */ jsx2("span", { fg: choice === "cancel" ? C.accent : C.textSec, children: choice === "cancel" ? "[(N)\u53D6\u6D88]" : " (N)\u53D6\u6D88 " })
        ] })
      ]
    }
  );
}

// extensions/console/src/text-layout.ts
var graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
function splitGraphemes(text) {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}
function isWideCodePoint(codePoint) {
  return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510 || codePoint >= 127744 && codePoint <= 129791 || codePoint >= 131072 && codePoint <= 262141);
}
function getGraphemeWidth(grapheme) {
  if (!grapheme) return 0;
  if (new RegExp("\\p{Extended_Pictographic}", "u").test(grapheme)) return 2;
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
import { Fragment as Fragment2, jsx as jsx3, jsxs as jsxs3 } from "@opentui/react/jsx-runtime";
function truncatePath(fullPath, maxWidth) {
  if (maxWidth <= 0) return "";
  if (getTextWidth(fullPath) <= maxWidth) return fullPath;
  const sep2 = fullPath.includes("\\") ? "\\" : "/";
  const parts = fullPath.split(sep2).filter(Boolean);
  const prefix = /^[\/\\]/.test(fullPath) ? sep2 : "";
  if (parts.length <= 1) return hardTruncate(fullPath, maxWidth);
  const head = parts[0];
  for (let n = Math.min(parts.length - 1, 3); n >= 1; n--) {
    const tail = parts.slice(-n).join(sep2);
    const truncated = `${prefix}${head}${sep2}\u2026${sep2}${tail}`;
    if (getTextWidth(truncated) <= maxWidth) return truncated;
  }
  const minimal = `\u2026${sep2}${parts[parts.length - 1]}`;
  if (getTextWidth(minimal) <= maxWidth) return minimal;
  return hardTruncate(fullPath, maxWidth);
}
function hardTruncate(text, maxWidth) {
  if (maxWidth <= 1) return "\u2026";
  let result = "";
  let width = 0;
  for (const ch of text) {
    const cw = getTextWidth(ch);
    if (width + cw > maxWidth - 1) break;
    result += ch;
    width += cw;
  }
  return result + "\u2026";
}
function HintBar({ isGenerating, queueSize, copyMode, exitConfirmArmed, remoteHost }) {
  const cwd = process.cwd();
  const hasQueue = (queueSize ?? 0) > 0;
  let hintStr;
  if (exitConfirmArmed) {
    hintStr = "\u518D\u6B21\u6309 ctrl+c \u9000\u51FA";
  } else {
    const parts = [];
    parts.push(isGenerating ? "esc \u4E2D\u65AD\u751F\u6210" : "ctrl+j \u6362\u884C");
    parts.push("ctrl+t \u5DE5\u5177\u8BE6\u60C5");
    if (!isGenerating) parts.push("shift+\u2190/\u2192 \u601D\u8003");
    if (isGenerating && hasQueue) {
      parts.push("/queue \u7BA1\u7406\u961F\u5217");
    }
    parts.push(isGenerating ? "ctrl+s \u7ACB\u5373\u53D1\u9001" : copyMode ? "f6 \u8FD4\u56DE\u6EDA\u52A8\u6A21\u5F0F" : "f6 \u590D\u5236\u6A21\u5F0F");
    hintStr = parts.join("  \xB7  ");
  }
  const hintWidth = getTextWidth(hintStr);
  const termWidth = process.stdout.columns || 80;
  const usableWidth = termWidth - 3;
  const gap = 3;
  const availableForCwd = usableWidth - hintWidth - gap;
  const displayCwd = truncatePath(cwd, Math.max(availableForCwd, 20));
  return /* @__PURE__ */ jsxs3("box", { flexDirection: "row", paddingTop: 0, paddingRight: 1, children: [
    /* @__PURE__ */ jsx3("box", { flexGrow: 1, children: remoteHost ? /* @__PURE__ */ jsxs3("text", { fg: C.warn, children: [
      "\u26A1 \u8FDC\u7A0B\u6A21\u5F0F \u2014 \u6240\u6709\u64CD\u4F5C\u548C\u914D\u7F6E\u5747\u4F5C\u7528\u4E8E ",
      remoteHost
    ] }) : /* @__PURE__ */ jsx3("text", { fg: C.dim, children: displayCwd }) }),
    exitConfirmArmed ? /* @__PURE__ */ jsx3("text", { fg: C.warn, children: "\u518D\u6B21\u6309 ctrl+c \u9000\u51FA" }) : /* @__PURE__ */ jsxs3("text", { fg: C.dim, children: [
      isGenerating ? "esc \u4E2D\u65AD\u751F\u6210" : "ctrl+j \u6362\u884C",
      "  \xB7  ctrl+t \u5DE5\u5177\u8BE6\u60C5",
      isGenerating && hasQueue ? /* @__PURE__ */ jsxs3(Fragment2, { children: [
        "  \xB7  ",
        /* @__PURE__ */ jsx3("span", { fg: C.warn, children: "/queue \u7BA1\u7406\u961F\u5217" })
      ] }) : null,
      "  \xB7  ",
      isGenerating ? "ctrl+s \u7ACB\u5373\u53D1\u9001" : copyMode ? "f6 \u8FD4\u56DE\u6EDA\u52A8\u6A21\u5F0F" : "f6 \u590D\u5236\u6A21\u5F0F"
    ] })
  ] });
}

// extensions/console/src/components/InputBar.tsx
import { useEffect as useEffect3, useMemo, useRef as useRef2, useState as useState3 } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

// extensions/console/src/input-commands.ts
var COMMANDS = [
  { name: "/new", description: "\u65B0\u5EFA\u5BF9\u8BDD" },
  { name: "/load", description: "\u52A0\u8F7D\u5386\u53F2\u5BF9\u8BDD" },
  { name: "/undo", description: "\u64A4\u9500\u6700\u540E\u4E00\u6761\u6D88\u606F" },
  { name: "/redo", description: "\u6062\u590D\u4E0A\u4E00\u6B21\u64A4\u9500" },
  { name: "/model", description: "\u67E5\u770B\u6216\u5207\u6362\u5F53\u524D\u6A21\u578B" },
  { name: "/settings", description: "\u6253\u5F00\u8BBE\u7F6E\u4E2D\u5FC3\uFF08LLM / System / Tools / MCP\uFF09" },
  { name: "/mcp", description: "\u76F4\u63A5\u6253\u5F00 MCP \u7BA1\u7406\u533A" },
  { name: "/sh", description: "\u6267\u884C\u547D\u4EE4\uFF08\u5982 cd\u3001dir\u3001git \u7B49\uFF09" },
  { name: "/reset-config", description: "\u91CD\u7F6E\u914D\u7F6E\u4E3A\u9ED8\u8BA4\u503C" },
  { name: "/compact", description: "\u538B\u7F29\u4E0A\u4E0B\u6587\uFF08\u603B\u7ED3\u5386\u53F2\u6D88\u606F\uFF09" },
  { name: "/net", description: "\u914D\u7F6E\u591A\u7AEF\u4E92\u8054\uFF08Net\uFF09" },
  { name: "/remote", description: "\u8FDE\u63A5\u8FDC\u7A0B Iris \u5B9E\u4F8B" },
  { name: "/disconnect", description: "\u65AD\u5F00\u8FDC\u7A0B\u8FDE\u63A5", remoteOnly: true, color: "#fdcb6e" },
  { name: "/agent", description: "\u5207\u6362 Agent\uFF08\u591A Agent \u6A21\u5F0F\uFF09" },
  { name: "/queue", description: "\u67E5\u770B/\u7BA1\u7406\u6392\u961F\u6D88\u606F" },
  { name: "/exit", description: "\u9000\u51FA\u5E94\u7528" }
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
  if (pos <= 0) return 0;
  let i = pos - 1;
  while (i > 0 && !/[a-zA-Z0-9_\-.]/.test(text[i])) i--;
  while (i > 0 && /[a-zA-Z0-9_\-.]/.test(text[i - 1])) i--;
  return i;
}
function wordBoundaryRight(text, pos) {
  const len = text.length;
  if (pos >= len) return len;
  let i = pos;
  while (i < len && /[a-zA-Z0-9_\-.]/.test(text[i])) i++;
  while (i < len && !/[a-zA-Z0-9_\-.]/.test(text[i])) i++;
  return i;
}
function useTextInput(initialValue = "") {
  const [state, setState] = useState({
    value: initialValue,
    cursor: initialValue.length
  });
  const handleKey = useCallback(
    (key) => {
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
          if (cursor === 0) return s;
          if (key.ctrl || key.meta) {
            const to = wordBoundaryLeft(value, cursor);
            return { value: value.slice(0, to) + value.slice(cursor), cursor: to };
          }
          return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
        }
        if (key.name === "delete" || key.name === "d" && key.ctrl) {
          if (cursor >= value.length) return s;
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
      if (key.name === "left" || key.name === "right" || key.name === "home" || key.name === "end") return true;
      if (key.name === "backspace" || key.name === "delete") return true;
      if (["a", "e", "u", "k", "d"].includes(key.name) && key.ctrl) return true;
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) return true;
      return false;
    },
    []
  );
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
  const stableHandler = useCallback2(
    (event) => {
      handlerRef.current(decodePasteBytes(event.bytes));
    },
    []
  );
  useEffect2(() => {
    keyHandler?.on("paste", stableHandler);
    return () => {
      keyHandler?.off("paste", stableHandler);
    };
  }, [keyHandler, stableHandler]);
}

// extensions/console/src/components/InputDisplay.tsx
import { Fragment as Fragment3, jsx as jsx4, jsxs as jsxs4 } from "@opentui/react/jsx-runtime";
function InputDisplay({ value, cursor, availableWidth, isActive, cursorVisible, placeholder, transform }) {
  const display = transform ? transform(value) : value;
  if (!display && !isActive) {
    return /* @__PURE__ */ jsx4("text", { fg: C.dim, children: placeholder || "" });
  }
  if (!display) {
    return /* @__PURE__ */ jsxs4("text", { children: [
      cursorVisible && /* @__PURE__ */ jsx4("span", { bg: C.accent, fg: C.cursorFg, children: " " }),
      !cursorVisible && /* @__PURE__ */ jsx4("span", { fg: C.accent, children: " " }),
      placeholder && /* @__PURE__ */ jsx4("span", { fg: C.dim, children: ` ${placeholder}` })
    ] });
  }
  if (!isActive) {
    return /* @__PURE__ */ jsx4("text", { fg: C.textSec, children: display });
  }
  const before = display.slice(0, cursor);
  const rawAt = cursor < display.length ? display[cursor] : "";
  const after = cursor < display.length ? display.slice(cursor + 1) : "";
  let overlapEnd = false;
  if (!rawAt && before.length > 0 && availableWidth && availableWidth > 0) {
    const lastChar = before[before.length - 1];
    if (lastChar !== "\n") {
      const lastNewline = before.lastIndexOf("\n");
      const lastLine = lastNewline >= 0 ? before.slice(lastNewline + 1) : before;
      const w = getTextWidth(lastLine);
      overlapEnd = w > 0 && w % availableWidth === 0;
    }
  }
  const displayBefore = overlapEnd ? before.slice(0, -1) : before;
  const cursorChar = overlapEnd ? before[before.length - 1] : rawAt;
  const atNewline = cursorChar === "\n";
  return /* @__PURE__ */ jsxs4("text", { wrapMode: "char", children: [
    /* @__PURE__ */ jsx4("span", { fg: C.text, children: displayBefore }),
    cursorChar ? atNewline ? /* @__PURE__ */ jsxs4(Fragment3, { children: [
      cursorVisible && /* @__PURE__ */ jsx4("span", { bg: C.accent, fg: C.cursorFg, children: " " }),
      /* @__PURE__ */ jsx4("span", { fg: C.text, children: "\n" })
    ] }) : cursorVisible ? /* @__PURE__ */ jsx4("span", { bg: C.accent, fg: C.cursorFg, children: cursorChar }) : /* @__PURE__ */ jsx4("span", { fg: C.text, children: cursorChar }) : cursorVisible ? /* @__PURE__ */ jsx4("span", { bg: C.accent, fg: C.cursorFg, children: " " }) : /* @__PURE__ */ jsx4("span", { children: " " }),
    after && /* @__PURE__ */ jsx4("span", { fg: C.text, children: after })
  ] });
}

// extensions/console/src/components/InputBar.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "@opentui/react/jsx-runtime";
function InputBar({ disabled, isGenerating, queueSize, onSubmit, onPrioritySubmit, onCycleThinkingEffort, isRemote }) {
  const [inputState, inputActions] = useTextInput("");
  const [selectedIndex, setSelectedIndex] = useState3(0);
  const cursorVisible = useCursorBlink();
  const { width: termWidth } = useTerminalDimensions();
  const visibleCommands = useMemo(
    () => COMMANDS.filter((cmd) => !cmd.remoteOnly || isRemote),
    [isRemote]
  );
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
    if (inputDisabled) return "";
    if (!value.startsWith("/")) return "";
    if (/\s/.test(value) && exactMatchIndex < 0) return "";
    return value;
  }, [inputDisabled, value, exactMatchIndex]);
  const [commandsDismissed, setCommandsDismissed] = useState3(false);
  useEffect3(() => {
    setCommandsDismissed(false);
  }, [commandQuery]);
  const showCommands = commandQuery.length > 0 && !commandsDismissed;
  const filtered = useMemo(() => {
    if (!showCommands) return [];
    if (exactMatchIndex >= 0) return visibleCommands;
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
    if (filtered.length === 0) return;
    const normalizedIndex = (index % filtered.length + filtered.length) % filtered.length;
    setSelectedIndex(normalizedIndex);
  };
  useKeyboard((key) => {
    if (inputDisabled) return;
    if (pasteGuardRef.current) return;
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
          applySelection(isExactCommandValue(value, current) ? selectedIndex - 1 : selectedIndex);
        }
        return;
      }
    }
    if (key.ctrl && key.name === "s") {
      if (!isQueueMode) return;
      const text = value.trim();
      if (!text) return;
      onPrioritySubmit(text);
      inputActions.setValue("");
      setSelectedIndex(0);
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      if (rapidKeyCountRef.current >= 3) {
        inputActions.insert("\n");
        return;
      }
      let text = value.trim();
      if (showCommands && filtered.length > 0) {
        const cmd = filtered[selectedIndex];
        if (cmd) text = getCommandInput(cmd);
      }
      if (!text) return;
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
    if (inputDisabled) return;
    pasteGuardRef.current = true;
    const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
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
    if (!value) return 1;
    const lines = value.split("\n");
    let count = 0;
    for (const line of lines) {
      const w = getTextWidth(line);
      count += w === 0 ? 1 : Math.ceil(w / availableWidth);
    }
    return count;
  }, [value, availableWidth]);
  const needsInputScroll = visualLineCount > MAX_VISIBLE_INPUT_LINES;
  const promptColor = inputDisabled ? C.dim : isQueueMode ? C.warn : C.accent;
  const promptChar = isQueueMode ? "\u23F3 " : "\u276F ";
  const placeholder = isQueueMode ? "\u8F93\u5165\u6D88\u606F\uFF08\u5C06\u6392\u961F\u53D1\u9001\uFF09\u2026" : "\u8F93\u5165\u6D88\u606F\u2026";
  const inputRow = /* @__PURE__ */ jsxs5("box", { flexDirection: "row", border: false, children: [
    /* @__PURE__ */ jsx5("text", { fg: promptColor, children: /* @__PURE__ */ jsxs5("strong", { children: [
      promptChar,
      " "
    ] }) }),
    /* @__PURE__ */ jsx5(
      InputDisplay,
      {
        value,
        cursor: inputState.cursor,
        availableWidth,
        isActive: !inputDisabled,
        cursorVisible,
        placeholder
      }
    )
  ] });
  return /* @__PURE__ */ jsxs5("box", { flexDirection: "column", children: [
    filtered.length > 0 && /* @__PURE__ */ jsx5("box", { flexDirection: "column", backgroundColor: C.panelBg, paddingX: 1, children: [...filtered].reverse().map((cmd, _i) => {
      const index = filtered.indexOf(cmd);
      const padded = cmd.name.padEnd(maxLen);
      const isSelected = index === selectedIndex;
      return /* @__PURE__ */ jsx5("box", { paddingLeft: 1, backgroundColor: isSelected ? C.border : void 0, children: /* @__PURE__ */ jsxs5("text", { children: [
        /* @__PURE__ */ jsx5("span", { fg: isSelected ? C.accent : C.dim, children: isSelected ? "\u25B8 " : "  " }),
        isSelected ? /* @__PURE__ */ jsx5("strong", { children: /* @__PURE__ */ jsx5("span", { fg: cmd.color ?? C.text, children: padded }) }) : /* @__PURE__ */ jsx5("span", { fg: cmd.color ?? C.textSec, children: padded }),
        /* @__PURE__ */ jsxs5("span", { fg: isSelected ? C.textSec : C.dim, children: [
          "  ",
          cmd.description
        ] })
      ] }) }, cmd.name);
    }) }),
    /* @__PURE__ */ jsx5(
      "scrollbox",
      {
        height: Math.min(visualLineCount, MAX_VISIBLE_INPUT_LINES),
        stickyScroll: true,
        stickyStart: "bottom",
        verticalScrollbarOptions: { visible: needsInputScroll },
        horizontalScrollbarOptions: { visible: false },
        children: inputRow
      }
    )
  ] });
}

// extensions/console/src/components/StatusBar.tsx
import { Fragment as Fragment4, jsx as jsx6, jsxs as jsxs6 } from "@opentui/react/jsx-runtime";
var SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
function StatusBar({ agentName, modeName, modelName, contextTokens, contextWindow, queueSize, remoteHost, backgroundTaskCount, delegateTaskCount, backgroundTaskTokens, backgroundTaskSpinnerFrame }) {
  const resolvedModeName = modeName ?? "normal";
  const modeNameCapitalized = resolvedModeName.charAt(0).toUpperCase() + resolvedModeName.slice(1);
  const contextStr = contextTokens > 0 ? contextTokens.toLocaleString() : "-";
  const contextLimitStr = contextWindow ? `/${contextWindow.toLocaleString()}` : "";
  const contextPercent = contextTokens > 0 && contextWindow ? ` (${Math.round(contextTokens / contextWindow * 100)}%)` : "";
  const hasBackgroundTasks = (backgroundTaskCount ?? 0) > 0;
  const hasDelegateTasks = (delegateTaskCount ?? 0) > 0;
  const spinner = hasBackgroundTasks ? SPINNER_FRAMES[(backgroundTaskSpinnerFrame ?? 0) % SPINNER_FRAMES.length] : "";
  return /* @__PURE__ */ jsxs6("box", { flexDirection: "row", marginTop: 1, children: [
    /* @__PURE__ */ jsx6("box", { flexGrow: 1, children: /* @__PURE__ */ jsxs6("text", { children: [
      remoteHost ? /* @__PURE__ */ jsx6("span", { fg: C.warn, children: /* @__PURE__ */ jsxs6("strong", { children: [
        "[\u8FDC\u7A0B: ",
        remoteHost,
        "]"
      ] }) }) : null,
      remoteHost ? /* @__PURE__ */ jsx6("span", { fg: C.dim, children: " \xB7 " }) : null,
      agentName ? /* @__PURE__ */ jsx6("span", { fg: C.accent, children: /* @__PURE__ */ jsxs6("strong", { children: [
        "[",
        agentName,
        "]"
      ] }) }) : null,
      agentName ? /* @__PURE__ */ jsx6("span", { fg: C.dim, children: " \xB7 " }) : null,
      /* @__PURE__ */ jsx6("span", { fg: C.primaryLight, children: /* @__PURE__ */ jsx6("strong", { children: modeNameCapitalized }) }),
      /* @__PURE__ */ jsx6("span", { fg: C.dim, children: " \xB7 " }),
      /* @__PURE__ */ jsx6("span", { fg: C.textSec, children: modelName }),
      queueSize != null && queueSize > 0 ? /* @__PURE__ */ jsxs6(Fragment4, { children: [
        /* @__PURE__ */ jsx6("span", { fg: C.dim, children: " \xB7 " }),
        /* @__PURE__ */ jsxs6("span", { fg: C.warn, children: [
          queueSize,
          " \u6761\u6392\u961F\u4E2D"
        ] })
      ] }) : null,
      hasBackgroundTasks ? /* @__PURE__ */ jsxs6(Fragment4, { children: [
        /* @__PURE__ */ jsx6("span", { fg: C.dim, children: " \xB7 " }),
        /* @__PURE__ */ jsxs6("span", { fg: C.accent, children: [
          spinner,
          " ",
          backgroundTaskCount,
          " \u4E2A\u540E\u53F0\u4EFB\u52A1",
          backgroundTaskTokens != null && backgroundTaskTokens > 0 ? ` \u2191${backgroundTaskTokens.toLocaleString()}tk` : ""
        ] })
      ] }) : null,
      hasDelegateTasks ? /* @__PURE__ */ jsxs6(Fragment4, { children: [
        /* @__PURE__ */ jsx6("span", { fg: C.dim, children: " \xB7 " }),
        /* @__PURE__ */ jsxs6("span", { fg: C.warn, children: [
          "\u21E2 ",
          delegateTaskCount,
          " \u4E2A\u59D4\u6D3E\u4EFB\u52A1"
        ] })
      ] }) : null
    ] }) }),
    /* @__PURE__ */ jsx6("box", { children: /* @__PURE__ */ jsxs6("text", { fg: C.dim, children: [
      "ctx ",
      contextStr,
      contextLimitStr,
      contextPercent
    ] }) })
  ] });
}

// extensions/console/src/components/ThinkingIndicator.tsx
import { jsx as jsx7, jsxs as jsxs7 } from "@opentui/react/jsx-runtime";
var BLOCK_COUNT = 4;
var FILL_MAP = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  max: 4
};
var FILLED_CHAR = "\u25A3";
var DIM_CHAR = "\u25A2";
function ThinkingIndicator({ level, showHint, isRemote }) {
  const filled = FILL_MAP[level];
  const isDisabled = level === "none";
  const blocks = [];
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const isFilled = i < filled;
    blocks.push(
      /* @__PURE__ */ jsx7("span", { fg: isFilled ? C.accent : C.dim, children: isFilled ? FILLED_CHAR : DIM_CHAR }, i)
    );
  }
  return /* @__PURE__ */ jsxs7("box", { flexDirection: "row", children: [
    /* @__PURE__ */ jsx7("box", { flexGrow: 1, children: /* @__PURE__ */ jsxs7("text", { children: [
      blocks,
      /* @__PURE__ */ jsxs7("span", { fg: isDisabled ? C.dim : C.accent, children: [
        " ",
        isDisabled ? "thinking off" : level
      ] })
    ] }) }),
    isRemote ? /* @__PURE__ */ jsx7("box", { children: /* @__PURE__ */ jsx7("text", { fg: C.dim, children: "\u8F93\u5165 /disconnect \u65AD\u5F00\u8FDC\u7A0B\u8FDE\u63A5" }) }) : null,
    showHint ? /* @__PURE__ */ jsx7("box", { children: /* @__PURE__ */ jsx7("text", { fg: C.dim, children: `shift+\u2190/\u2192 \u8C03\u6574\u601D\u8003\u5F3A\u5EA6` }) }) : null
  ] });
}

// extensions/console/src/components/BottomPanel.tsx
import { jsx as jsx8, jsxs as jsxs8 } from "@opentui/react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs8("box", { flexDirection: "column", flexShrink: 0, paddingX: 1, paddingBottom: 1, paddingTop: hasMessages ? 1 : 0, children: [
    pendingConfirm ? /* @__PURE__ */ jsx8(ConfirmBar, { message: pendingConfirm.message, choice: confirmChoice }) : pendingApprovals.length > 0 ? /* @__PURE__ */ jsx8(
      ApprovalBar,
      {
        toolName: pendingApprovals[0].toolName,
        choice: approvalChoice,
        remainingCount: pendingApprovals.length,
        isCommandTool: pendingApprovals[0].toolName === "shell" || pendingApprovals[0].toolName === "bash",
        approvalPage
      }
    ) : /* @__PURE__ */ jsxs8(
      "box",
      {
        flexDirection: "column",
        borderStyle: "single",
        borderColor: isGenerating ? C.warn : C.border,
        paddingX: 1,
        paddingTop: 0,
        paddingBottom: 0,
        children: [
          /* @__PURE__ */ jsx8(ThinkingIndicator, { level: thinkingEffort, showHint: !hasMessages, isRemote }),
          /* @__PURE__ */ jsx8(
            InputBar,
            {
              disabled: inputDisabled,
              isGenerating,
              queueSize,
              onSubmit,
              onPrioritySubmit,
              onCycleThinkingEffort,
              isRemote
            }
          ),
          /* @__PURE__ */ jsx8(
            StatusBar,
            {
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
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx8(
      HintBar,
      {
        isGenerating,
        queueSize,
        copyMode,
        exitConfirmArmed,
        remoteHost
      }
    )
  ] });
}

// extensions/console/src/components/AgentListView.tsx
import { jsx as jsx9, jsxs as jsxs9 } from "@opentui/react/jsx-runtime";
function AgentListView({ agents, selectedIndex, currentAgentName }) {
  return /* @__PURE__ */ jsxs9("box", { flexDirection: "column", width: "100%", height: "100%", children: [
    /* @__PURE__ */ jsxs9("box", { padding: 1, children: [
      /* @__PURE__ */ jsx9("text", { fg: C.primary, children: "\u5207\u6362 Agent" }),
      /* @__PURE__ */ jsx9("text", { fg: C.dim, children: "  \u2191\u2193 \u9009\u62E9  Enter \u5207\u6362  Esc \u8FD4\u56DE" })
    ] }),
    /* @__PURE__ */ jsxs9("scrollbox", { flexGrow: 1, children: [
      agents.length === 0 && /* @__PURE__ */ jsx9("text", { fg: C.dim, paddingLeft: 2, children: "\u6682\u65E0\u53EF\u7528 Agent" }),
      agents.map((agent, index) => {
        const isSelected = index === selectedIndex;
        const isCurrent = agent.name === currentAgentName;
        const currentMarker = isCurrent ? "\u2022" : " ";
        return /* @__PURE__ */ jsx9("box", { paddingLeft: 1, children: /* @__PURE__ */ jsxs9("text", { children: [
          /* @__PURE__ */ jsx9("span", { fg: isSelected ? C.accent : C.dim, children: isSelected ? "\u276F " : "  " }),
          /* @__PURE__ */ jsxs9("span", { fg: isCurrent ? C.accent : C.dim, children: [
            currentMarker,
            " "
          ] }),
          isSelected ? /* @__PURE__ */ jsx9("strong", { children: /* @__PURE__ */ jsx9("span", { fg: C.text, children: agent.name }) }) : /* @__PURE__ */ jsx9("span", { fg: C.textSec, children: agent.name }),
          agent.description ? /* @__PURE__ */ jsxs9("span", { fg: C.dim, children: [
            "  ",
            agent.description
          ] }) : null
        ] }) }, agent.name);
      })
    ] })
  ] });
}

// extensions/console/src/components/GeneratingTimer.tsx
import { useState as useState5, useEffect as useEffect5, useRef as useRef4 } from "react";

// extensions/console/src/components/Spinner.tsx
import { useState as useState4, useEffect as useEffect4, useRef as useRef3 } from "react";
import { jsx as jsx10 } from "@opentui/react/jsx-runtime";
var FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var INTERVAL = 80;
function Spinner() {
  const [frame, setFrame] = useState4(0);
  const mountedRef = useRef3(true);
  useEffect4(() => {
    const timer = setInterval(() => {
      if (mountedRef.current) {
        setFrame((f) => (f + 1) % FRAMES.length);
      }
    }, INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);
  return /* @__PURE__ */ jsx10("span", { fg: C.accent, children: FRAMES[frame] });
}

// extensions/console/src/components/GeneratingTimer.tsx
import { jsx as jsx11, jsxs as jsxs10 } from "@opentui/react/jsx-runtime";
function GeneratingTimer({ isGenerating, retryInfo, label }) {
  const [time, setTime] = useState5(0);
  const timerRef = useRef4(null);
  useEffect5(() => {
    if (isGenerating) {
      setTime(0);
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
  }, [isGenerating]);
  if (!isGenerating) return null;
  if (retryInfo) {
    const briefError = (retryInfo.error || "").split("\n")[0].slice(0, 60);
    return /* @__PURE__ */ jsxs10("box", { flexDirection: "column", children: [
      /* @__PURE__ */ jsxs10("text", { children: [
        /* @__PURE__ */ jsx11(Spinner, {}),
        /* @__PURE__ */ jsx11("span", { fg: C.warn, children: /* @__PURE__ */ jsx11("em", { children: ` retrying (${retryInfo.attempt}/${retryInfo.maxRetries})... (${time}s)` }) })
      ] }),
      /* @__PURE__ */ jsx11("text", { fg: C.dim, children: `  \u2514 ${briefError}` })
    ] });
  }
  return /* @__PURE__ */ jsxs10("text", { children: [
    /* @__PURE__ */ jsx11(Spinner, {}),
    /* @__PURE__ */ jsx11("span", { fg: C.dim, children: /* @__PURE__ */ jsx11("em", { children: ` ${label ?? "generating..."} (${time}s)` }) })
  ] });
}

// extensions/console/src/components/MessageItem.tsx
import React5, { useEffect as useEffect6, useRef as useRef5, useState as useState6 } from "react";
import { useTerminalDimensions as useTerminalDimensions2 } from "@opentui/react";

// extensions/console/src/components/MarkdownText.tsx
import { useMemo as useMemo2 } from "react";
import { SyntaxStyle, parseColor } from "@opentui/core";
import { jsx as jsx12 } from "@opentui/react/jsx-runtime";
function createSyntaxStyle() {
  return SyntaxStyle.fromStyles({
    // ── Markdown 标记 ──
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
    // ── 代码块语法高亮 (Tree-sitter token names) ──
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
    return showCursor ? /* @__PURE__ */ jsx12("text", { children: /* @__PURE__ */ jsx12("span", { bg: C.accent, children: " " }) }) : null;
  }
  return /* @__PURE__ */ jsx12("markdown", { content: text, syntaxStyle, streaming: showCursor, tableOptions: TABLE_OPTIONS });
}

// extensions/console/src/tool-renderers/default.tsx
import { jsx as jsx13, jsxs as jsxs11 } from "@opentui/react/jsx-runtime";
function DefaultRenderer({ result }) {
  const text = typeof result === "string" ? result.replace(/\n/g, " ") : JSON.stringify(result).replace(/\n/g, " ");
  const truncated = text.length > 80 ? text.slice(0, 80) + "..." : text;
  return /* @__PURE__ */ jsx13("text", { fg: "#888", children: /* @__PURE__ */ jsxs11("em", { children: [
    " \u21B3 ",
    truncated
  ] }) });
}

// extensions/console/src/tool-renderers/shell.tsx
import { jsx as jsx14, jsxs as jsxs12 } from "@opentui/react/jsx-runtime";
function lineCount(text) {
  if (!text) return 0;
  return text.split("\n").filter(Boolean).length;
}
function firstLine(text, max) {
  if (!text) return "";
  const line = text.trimStart().split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max) + "\u2026" : line;
}
function ShellRenderer({ result }) {
  const r = result || {};
  const exitCode = r.exitCode ?? 0;
  const isError = exitCode !== 0;
  if (r.killed) {
    return /* @__PURE__ */ jsx14("text", { fg: "#ff0000", children: /* @__PURE__ */ jsxs12("em", { children: [
      " \u21B3 ",
      "killed (timeout)"
    ] }) });
  }
  if (isError) {
    const reason = firstLine(r.stderr, 100) || `exit ${exitCode}`;
    return /* @__PURE__ */ jsx14("text", { fg: "#ff0000", children: /* @__PURE__ */ jsxs12("em", { children: [
      " \u21B3 ",
      reason
    ] }) });
  }
  const lines = lineCount(r.stdout);
  const summary = lines > 0 ? `${lines} lines output` : "done (no output)";
  return /* @__PURE__ */ jsx14("text", { fg: "#888", children: /* @__PURE__ */ jsxs12("em", { children: [
    " \u21B3 ",
    summary
  ] }) });
}

// extensions/console/src/tool-renderers/read-file.tsx
import { jsx as jsx15, jsxs as jsxs13 } from "@opentui/react/jsx-runtime";
function basename(p) {
  return p.split("/").pop() || p;
}
function ReadFileRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  if (items.length === 0) {
    return /* @__PURE__ */ jsx15("text", { fg: "#888", children: /* @__PURE__ */ jsxs13("em", { children: [
      " \u21B3",
      " read 0 lines (-)"
    ] }) });
  }
  if (items.length === 1) {
    const item = items[0];
    const lines = item.lineCount ?? 0;
    const name = item.path ?? "?";
    const range = item.startLine !== void 0 && item.endLine !== void 0 ? `:${item.startLine}-${item.endLine}` : "";
    return /* @__PURE__ */ jsx15("text", { fg: "#888", children: /* @__PURE__ */ jsxs13("em", { children: [
      " \u21B3",
      " read ",
      lines,
      " lines (",
      name,
      range,
      ")"
    ] }) });
  }
  const totalLines = items.reduce((sum, item) => sum + (item.lineCount ?? 0), 0);
  const names = items.map((item) => basename(item.path ?? "?")).join(", ");
  return /* @__PURE__ */ jsx15("text", { fg: "#888", children: /* @__PURE__ */ jsxs13("em", { children: [
    " \u21B3",
    " read ",
    totalLines,
    " lines (",
    names,
    ")"
  ] }) });
}

// extensions/console/src/tool-renderers/apply-diff.tsx
import { jsx as jsx16, jsxs as jsxs14 } from "@opentui/react/jsx-runtime";
function countPatchLines(patch) {
  if (typeof patch !== "string") return { added: 0, deleted: 0 };
  let added = 0;
  let deleted = 0;
  const lines = patch.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) deleted++;
  }
  return { added, deleted };
}
function ApplyDiffRenderer({ args, result }) {
  const r = result || {};
  const isError = (r.failed ?? 0) > 0;
  const { added, deleted } = countPatchLines(args?.patch);
  const hasStats = added > 0 || deleted > 0;
  return /* @__PURE__ */ jsx16("text", { fg: isError ? "#ffff00" : "#888", children: /* @__PURE__ */ jsxs14("em", { children: [
    " \u21B3 ",
    added > 0 && /* @__PURE__ */ jsxs14("span", { fg: "#57ab5a", children: [
      "+",
      added
    ] }),
    added > 0 && deleted > 0 && " ",
    deleted > 0 && /* @__PURE__ */ jsxs14("span", { fg: "#f47067", children: [
      "-",
      deleted
    ] }),
    hasStats && ", ",
    r.applied,
    "/",
    r.totalHunks,
    " hunks",
    isError ? `, ${r.failed} failed` : "",
    r.path ? ` (${r.path})` : ""
  ] }) });
}

// extensions/console/src/tool-renderers/search-in-files.tsx
import { jsx as jsx17, jsxs as jsxs15 } from "@opentui/react/jsx-runtime";
function truncStr(s, max) {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}
function SearchInFilesRenderer({ args, result }) {
  const r = result || {};
  if (r.mode === "replace") {
    const total = r.totalReplacements ?? 0;
    const files = r.processedFiles ?? 0;
    const suffix2 = r.truncated ? " (truncated)" : "";
    const query = typeof args?.query === "string" ? truncStr(args.query, 16) : "";
    const replace = typeof args?.replace === "string" ? truncStr(args.replace, 16) : "";
    const transform = query ? ` "${query}" \u2192 "${replace}"` : "";
    const changedFiles = r.results ? r.results.filter((f) => f.changed).length : files;
    return /* @__PURE__ */ jsx17("text", { fg: "#888", children: /* @__PURE__ */ jsxs15("em", { children: [
      " \u21B3 ",
      /* @__PURE__ */ jsx17("span", { fg: "#d2a8ff", children: total }),
      " replacements in",
      " ",
      /* @__PURE__ */ jsx17("span", { fg: "#d2a8ff", children: changedFiles }),
      "/",
      files,
      " files",
      transform,
      suffix2
    ] }) });
  }
  const count = r.count ?? 0;
  const suffix = r.truncated ? " (truncated)" : "";
  return /* @__PURE__ */ jsx17("text", { fg: "#888", children: /* @__PURE__ */ jsxs15("em", { children: [
    " \u21B3 ",
    /* @__PURE__ */ jsx17("span", { fg: "#d2a8ff", children: count }),
    " matches found",
    suffix
  ] }) });
}

// extensions/console/src/tool-renderers/find-files.tsx
import { jsx as jsx18, jsxs as jsxs16 } from "@opentui/react/jsx-runtime";
function FindFilesRenderer({ result }) {
  const r = result || {};
  const count = r.count ?? 0;
  const suffix = r.truncated ? " (truncated)" : "";
  return /* @__PURE__ */ jsx18("text", { fg: "#888", children: /* @__PURE__ */ jsxs16("em", { children: [
    " \u21B3 ",
    " ",
    count,
    " files found",
    suffix
  ] }) });
}

// extensions/console/src/tool-renderers/list-files.tsx
import { jsx as jsx19, jsxs as jsxs17 } from "@opentui/react/jsx-runtime";
function ListFilesRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const totalFiles = r.totalFiles ?? 0;
  const totalDirs = r.totalDirs ?? 0;
  const failCount = items.filter((i) => !i.success).length;
  const paths = items.filter((i) => i.success).map((i) => i.path ?? "?").join(", ");
  let summary = `${totalFiles} files, ${totalDirs} dirs`;
  if (paths) summary += ` (${paths})`;
  if (failCount > 0) summary += ` | ${failCount} failed`;
  return /* @__PURE__ */ jsx19("text", { fg: failCount > 0 ? "#ffff00" : "#888", children: /* @__PURE__ */ jsxs17("em", { children: [
    " \u21B3 ",
    summary
  ] }) });
}

// extensions/console/src/tool-renderers/write-file.tsx
import { jsx as jsx20, jsxs as jsxs18 } from "@opentui/react/jsx-runtime";
function basename2(p) {
  return p.split("/").pop() || p;
}
function extractArgsFiles(args) {
  if (Array.isArray(args.files)) return args.files;
  if (args.files && typeof args.files === "object") return [args.files];
  if (args.file && typeof args.file === "object") return [args.file];
  if (typeof args.path === "string" && typeof args.content === "string") {
    return [{ path: args.path, content: args.content }];
  }
  return [];
}
function countLines(content) {
  if (typeof content !== "string") return 0;
  if (content.length === 0) return 0;
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
}
function getLineCount(path4, argsFiles) {
  if (!path4) return 0;
  const entry = argsFiles.find((f) => f.path === path4);
  return entry ? countLines(entry.content) : 0;
}
function WriteFileRenderer({ args, result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  const argsFiles = extractArgsFiles(args || {});
  if (items.length === 0) {
    return /* @__PURE__ */ jsx20("text", { fg: "#888", children: /* @__PURE__ */ jsxs18("em", { children: [
      " \u21B3",
      " wrote 0 files"
    ] }) });
  }
  if (items.length === 1) {
    const item = items[0];
    const action = item.action ?? (item.success ? "written" : "failed");
    const fg = item.success === false ? "#ff0000" : "#888";
    const lines = getLineCount(item.path, argsFiles);
    const hasLines = lines > 0 && action !== "unchanged";
    return /* @__PURE__ */ jsx20("text", { fg, children: /* @__PURE__ */ jsxs18("em", { children: [
      " \u21B3 ",
      hasLines && (action === "created" ? /* @__PURE__ */ jsxs18("span", { fg: "#57ab5a", children: [
        "+",
        lines
      ] }) : /* @__PURE__ */ jsxs18("span", { fg: "#d2a8ff", children: [
        "~",
        lines
      ] })),
      hasLines ? " lines, " : "",
      action,
      " (",
      item.path ?? "?",
      ")"
    ] }) });
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
  return /* @__PURE__ */ jsx20("text", { fg: failCount > 0 ? "#ffff00" : "#888", children: /* @__PURE__ */ jsxs18("em", { children: [
    " \u21B3 ",
    totalLines > 0 && /* @__PURE__ */ jsxs18("span", { fg: "#d2a8ff", children: [
      "~",
      totalLines
    ] }),
    totalLines > 0 ? " lines, " : "",
    parts.join(", "),
    " (",
    names,
    ")"
  ] }) });
}

// extensions/console/src/tool-renderers/delete-code.tsx
import { jsx as jsx21, jsxs as jsxs19 } from "@opentui/react/jsx-runtime";
function DeleteCodeRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  if (items.length === 0) {
    return /* @__PURE__ */ jsx21("text", { fg: "#888", children: /* @__PURE__ */ jsxs19("em", { children: [
      " \u21B3",
      " deleted 0 lines"
    ] }) });
  }
  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return /* @__PURE__ */ jsx21("text", { fg: "#ff0000", children: /* @__PURE__ */ jsxs19("em", { children: [
        " \u21B3",
        " failed (",
        item.error ?? item.path ?? "?",
        ")"
      ] }) });
    }
    const deleted = item.deletedLines ?? 0;
    const range = item.start_line != null && item.end_line != null ? `:${item.start_line}-${item.end_line}` : "";
    return /* @__PURE__ */ jsx21("text", { fg: "#888", children: /* @__PURE__ */ jsxs19("em", { children: [
      " \u21B3",
      " ",
      /* @__PURE__ */ jsxs19("span", { fg: "#f47067", children: [
        "-",
        deleted
      ] }),
      " lines (",
      item.path ?? "?",
      range,
      ")"
    ] }) });
  }
  const totalDeleted = items.reduce((sum, i) => sum + (i.deletedLines ?? 0), 0);
  const names = items.map((i) => i.path ?? "?").join(", ");
  return /* @__PURE__ */ jsx21("text", { fg: failCount > 0 ? "#ffff00" : "#888", children: /* @__PURE__ */ jsxs19("em", { children: [
    " \u21B3",
    " ",
    /* @__PURE__ */ jsxs19("span", { fg: "#f47067", children: [
      "-",
      totalDeleted
    ] }),
    " lines in ",
    items.length,
    " files (",
    names,
    ")"
  ] }) });
}

// extensions/console/src/tool-renderers/insert-code.tsx
import { jsx as jsx22, jsxs as jsxs20 } from "@opentui/react/jsx-runtime";
function InsertCodeRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  if (items.length === 0) {
    return /* @__PURE__ */ jsx22("text", { fg: "#888", children: /* @__PURE__ */ jsxs20("em", { children: [
      " \u21B3",
      " inserted 0 lines"
    ] }) });
  }
  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return /* @__PURE__ */ jsx22("text", { fg: "#ff0000", children: /* @__PURE__ */ jsxs20("em", { children: [
        " \u21B3",
        " failed (",
        item.error ?? item.path ?? "?",
        ")"
      ] }) });
    }
    const inserted = item.insertedLines ?? 0;
    const pos = item.line != null ? ` at L${item.line}` : "";
    return /* @__PURE__ */ jsx22("text", { fg: "#888", children: /* @__PURE__ */ jsxs20("em", { children: [
      " \u21B3",
      " ",
      /* @__PURE__ */ jsxs20("span", { fg: "#57ab5a", children: [
        "+",
        inserted
      ] }),
      " lines",
      pos,
      " (",
      item.path ?? "?",
      ")"
    ] }) });
  }
  const totalInserted = items.reduce((sum, i) => sum + (i.insertedLines ?? 0), 0);
  const names = items.map((i) => i.path ?? "?").join(", ");
  return /* @__PURE__ */ jsx22("text", { fg: failCount > 0 ? "#ffff00" : "#888", children: /* @__PURE__ */ jsxs20("em", { children: [
    " \u21B3",
    " ",
    /* @__PURE__ */ jsxs20("span", { fg: "#57ab5a", children: [
      "+",
      totalInserted
    ] }),
    " lines in ",
    items.length,
    " files (",
    names,
    ")"
  ] }) });
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
import { jsx as jsx23, jsxs as jsxs21 } from "@opentui/react/jsx-runtime";
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["success", "warning", "error"]);
var SPINNER_FRAMES2 = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
function getArgsSummary(toolName, args) {
  switch (toolName) {
    case "shell": {
      const cmd = String(args.command || "");
      return cmd.length > 30 ? `"${cmd.slice(0, 30)}\u2026"` : `"${cmd}"`;
    }
    case "read_file": {
      const files = Array.isArray(args.files) ? args.files : [];
      const filePaths = files.map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        return String(entry.path ?? "").trim();
      }).filter(Boolean);
      if (filePaths.length > 1) return `${filePaths[0]} +${filePaths.length - 1}`;
      if (filePaths.length === 1) return filePaths[0];
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
      const head = q.length > 20 ? `"${q.slice(0, 20)}\u2026"` : `"${q}"`;
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
  const progressTokens = typeof progress?.tokens === "number" ? progress.tokens : void 0;
  const progressFrame = typeof progress?.frame === "number" ? progress.frame : void 0;
  const hasProgress = progress != null;
  const isFinal = TERMINAL_STATUSES.has(status);
  const isExecuting = status === "executing";
  const isAwaitingApproval = status === "awaiting_approval";
  const argsSummary2 = getArgsSummary(toolName, args);
  const Renderer = isFinal && result != null ? getToolRenderer(toolName) : null;
  const durationSec = (updatedAt - createdAt) / 1e3;
  const duration = isFinal && durationSec > 0 ? durationSec.toFixed(1) + "s" : "";
  const nameBg = status === "error" ? C.error : isAwaitingApproval ? C.warn : C.accent;
  return /* @__PURE__ */ jsxs21("box", { flexDirection: "column", children: [
    /* @__PURE__ */ jsxs21("box", { flexDirection: "row", gap: 1, children: [
      /* @__PURE__ */ jsxs21("text", { children: [
        /* @__PURE__ */ jsxs21("span", { bg: nameBg, fg: C.cursorFg, children: [
          " ",
          toolName,
          " "
        ] }),
        argsSummary2.length > 0 && /* @__PURE__ */ jsxs21("span", { fg: C.dim, children: [
          " ",
          argsSummary2
        ] }),
        status === "success" ? /* @__PURE__ */ jsxs21("span", { fg: C.accent, children: [
          " ",
          "\u2713"
        ] }) : null,
        status === "warning" ? /* @__PURE__ */ jsx23("span", { fg: C.warn, children: " !" }) : null,
        status === "error" ? /* @__PURE__ */ jsxs21("span", { fg: C.error, children: [
          " ",
          "\u2717"
        ] }) : null,
        isAwaitingApproval ? /* @__PURE__ */ jsx23("span", { fg: C.warn, children: " [\u5F85\u786E\u8BA4]" }) : null,
        !isFinal && !isExecuting && !isAwaitingApproval ? /* @__PURE__ */ jsxs21("span", { fg: C.dim, children: [
          " [",
          status,
          "]"
        ] }) : null,
        duration ? /* @__PURE__ */ jsxs21("span", { fg: C.dim, children: [
          " ",
          duration
        ] }) : null,
        isExecuting && progressTokens != null && progressTokens > 0 ? /* @__PURE__ */ jsxs21("span", { fg: C.dim, children: [
          " ",
          "\u2191",
          progressTokens.toLocaleString(),
          "tk"
        ] }) : null
      ] }),
      isExecuting && hasProgress ? /* @__PURE__ */ jsx23("text", { children: /* @__PURE__ */ jsx23("span", { fg: C.accent, children: SPINNER_FRAMES2[(progressFrame ?? 0) % SPINNER_FRAMES2.length] }) }) : isExecuting ? /* @__PURE__ */ jsx23("text", { children: /* @__PURE__ */ jsx23(Spinner, {}) }) : null
    ] }),
    status === "error" && error && /* @__PURE__ */ jsx23("text", { fg: C.error, children: /* @__PURE__ */ jsxs21("em", { children: [
      "  ",
      error
    ] }) }),
    Renderer && result != null && /* @__PURE__ */ jsx23("box", { paddingLeft: 2, children: Renderer({ toolName, args, result }) })
  ] });
}

// extensions/console/src/components/MessageItem.tsx
import { jsx as jsx24, jsxs as jsxs22 } from "@opentui/react/jsx-runtime";
function truncateRight(line, maxChars) {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars - 1)}\u2026`;
}
function getThoughtTailPreview(text, maxChars, lineCount2 = 2) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const tail = lines.slice(-lineCount2);
  return tail.map((line) => truncateRight(line, maxChars));
}
function getSummaryPreview(text, maxChars) {
  const clean = text.replace(/^\[Context Summary\]\s*\n*/i, "").trim();
  const lines = clean.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  const first = lines[0];
  if (first.length <= maxChars) return first;
  return first.slice(0, maxChars - 1) + "\u2026";
}
function formatElapsedMs(ms) {
  return `${(ms / 1e3).toFixed(1)}s`;
}
function formatTokenSpeed(tokenOut, durationMs) {
  return `${(tokenOut / Math.max(durationMs / 1e3, 1e-3)).toFixed(1)} t/s`;
}
function formatTime(ms) {
  const d = new Date(ms);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = /* @__PURE__ */ new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hhmm;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (d.getFullYear() === now.getFullYear()) return `${mm}/${dd} ${hhmm}`;
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
        } else if (p.type === "text" && !p.text.trim()) {
        } else {
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
  const icon = payload.status === "completed" ? "\u2713" : payload.status === "failed" ? "\u2717" : "\u2298";
  const iconColor = payload.status === "completed" ? C.accent : C.error;
  const content = payload.result || payload.error || "";
  const firstLine2 = content.split("\n").filter((l) => l.trim())[0] || "";
  const preview = firstLine2.length > 60 ? firstLine2.slice(0, 57) + "..." : firstLine2;
  return /* @__PURE__ */ jsx24("box", { children: /* @__PURE__ */ jsxs22("text", { children: [
    /* @__PURE__ */ jsx24("span", { fg: iconColor, children: icon }),
    /* @__PURE__ */ jsxs22("span", { fg: C.text, children: [
      " ",
      payload.description
    ] }),
    preview ? /* @__PURE__ */ jsxs22("span", { fg: C.dim, children: [
      " \u2014 ",
      preview
    ] }) : null
  ] }) });
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
    const headerText2 = `\xB7 context `;
    const separatorLen2 = Math.max(2, termWidth - headerText2.length - 2);
    const preview = getSummaryPreview(
      msg.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"),
      Math.max(30, termWidth - 20)
    );
    return /* @__PURE__ */ jsxs22("box", { flexDirection: "column", width: "100%", children: [
      /* @__PURE__ */ jsx24("box", { marginBottom: 1, children: /* @__PURE__ */ jsxs22("text", { children: [
        /* @__PURE__ */ jsx24("span", { fg: C.warn, children: /* @__PURE__ */ jsx24("strong", { children: headerText2 }) }),
        /* @__PURE__ */ jsx24("span", { fg: C.warn, children: "\u2500".repeat(separatorLen2) })
      ] }) }),
      /* @__PURE__ */ jsx24("text", { fg: C.dim, children: preview }),
      /* @__PURE__ */ jsx24("box", { marginTop: 1, children: /* @__PURE__ */ jsxs22("text", { fg: C.dim, children: [
        msg.createdAt != null ? formatTime(msg.createdAt) : "",
        msg.tokenIn != null ? `  \u2191${msg.tokenIn.toLocaleString()}` : ""
      ] }) })
    ] });
  }
  if (msg.isNotificationSummary && msg.notificationPayloads && msg.notificationPayloads.length > 0) {
    const headerText2 = `\xB7 bg-tasks completed `;
    const separatorLen2 = Math.max(2, termWidth - headerText2.length - 2);
    return /* @__PURE__ */ jsxs22("box", { flexDirection: "column", width: "100%", children: [
      /* @__PURE__ */ jsx24("box", { marginBottom: 1, children: /* @__PURE__ */ jsxs22("text", { children: [
        /* @__PURE__ */ jsx24("span", { fg: C.warn, children: /* @__PURE__ */ jsx24("strong", { children: headerText2 }) }),
        /* @__PURE__ */ jsx24("span", { fg: C.warn, children: "\u2500".repeat(separatorLen2) })
      ] }) }),
      /* @__PURE__ */ jsx24("box", { flexDirection: "column", backgroundColor: C.toolPendingBg, paddingLeft: 1, children: msg.notificationPayloads.map((p, i) => /* @__PURE__ */ jsx24("box", { children: /* @__PURE__ */ jsx24(NotificationPayloadBlock, { payload: p }) }, `notif-${p.taskId || i}`)) }),
      msg.createdAt != null && /* @__PURE__ */ jsx24("box", { marginTop: 1, children: /* @__PURE__ */ jsx24("text", { fg: C.dim, children: formatTime(msg.createdAt) }) })
    ] });
  }
  const isNotification = msg.isNotification === true;
  const labelName = isSummary ? "context" : isUser ? "you" : msg.isCommand ? "shell" : isNotification ? "bg-task" : (msg.modelName || modelName || "iris").toLowerCase();
  const labelColor = isSummary ? C.warn : isUser ? C.roleUser : msg.isError ? C.error : msg.isCommand ? C.command : isNotification ? C.warn : C.roleAssistant;
  const headerText = `\xB7 ${labelName} `;
  const displayParts = [...msg.parts];
  if (liveParts && liveParts.length > 0) displayParts.push(...liveParts);
  if (liveTools && liveTools.length > 0) displayParts.push({ type: "tool_use", tools: liveTools });
  const hasAnyContent = displayParts.length > 0;
  const separatorLen = Math.max(2, termWidth - headerText.length - 2);
  const groups = groupParts(displayParts);
  return /* @__PURE__ */ jsxs22("box", { flexDirection: "column", width: "100%", children: [
    /* @__PURE__ */ jsx24("box", { marginBottom: 1, children: /* @__PURE__ */ jsxs22("text", { children: [
      /* @__PURE__ */ jsx24("span", { fg: labelColor, children: /* @__PURE__ */ jsx24("strong", { children: headerText }) }),
      /* @__PURE__ */ jsx24("span", { fg: labelColor, children: "\u2500".repeat(separatorLen) })
    ] }) }),
    /* @__PURE__ */ jsxs22("box", { flexDirection: "column", width: "100%", children: [
      groups.map((group, gi) => {
        if (group.kind === "text" && group.part.text.length > 0) {
          const isLastGroup = gi === groups.length - 1;
          return /* @__PURE__ */ jsx24("box", { marginTop: gi > 0 ? 1 : 0, children: isUser ? /* @__PURE__ */ jsx24("text", { fg: C.text, children: group.part.text }) : msg.isError ? /* @__PURE__ */ jsx24("text", { fg: C.error, children: group.part.text }) : msg.isCommand ? /* @__PURE__ */ jsx24("text", { fg: C.textSec, children: group.part.text }) : /* @__PURE__ */ jsx24(MarkdownText, { text: group.part.text, showCursor: isLastGroup && isStreaming }) }, group.index);
        }
        if (group.kind === "thought") {
          const maxChars = Math.max(24, termWidth - 20);
          const allLines = group.part.text.replace(/\r\n/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
          const totalLines = allLines.length;
          const isLastGroup = gi === groups.length - 1;
          const prevGroup = gi > 0 ? groups[gi - 1] : void 0;
          const isAfterTools = prevGroup?.kind === "tools";
          const prefix = group.part.durationMs != null ? `thinking   ${formatElapsedMs(group.part.durationMs)}` : "thinking";
          const hiddenLines = Math.max(0, totalLines - 2);
          const showFull = thoughtsExpanded && hiddenLines > 0;
          const displayLines = showFull ? allLines : getThoughtTailPreview(group.part.text, maxChars);
          return /* @__PURE__ */ jsxs22(
            "box",
            {
              marginTop: isAfterTools ? 0 : gi > 0 ? 1 : 0,
              flexDirection: "column",
              backgroundColor: C.thinkingBg,
              paddingLeft: 1,
              children: [
                /* @__PURE__ */ jsx24("text", { fg: C.primaryLight, children: /* @__PURE__ */ jsx24("em", { children: "\xB7 " + prefix }) }),
                /* @__PURE__ */ jsx24("box", { flexDirection: "column", children: displayLines.length > 0 ? displayLines.map((line, li) => /* @__PURE__ */ jsx24("text", { fg: C.dim, children: /* @__PURE__ */ jsxs22("em", { children: [
                  "    ",
                  line,
                  li === displayLines.length - 1 && isLastGroup && isStreaming ? /* @__PURE__ */ jsx24("span", { bg: C.accent, children: " " }) : null
                ] }) }, li)) : /* @__PURE__ */ jsx24("text", { fg: C.dim, children: /* @__PURE__ */ jsxs22("em", { children: [
                  "    ",
                  "..."
                ] }) }) }),
                hiddenLines > 0 ? /* @__PURE__ */ jsx24("text", { fg: C.dim, children: /* @__PURE__ */ jsxs22("em", { children: [
                  "    \u2026 +",
                  hiddenLines,
                  " lines (ctrl+o to ",
                  showFull ? "collapse" : "expand",
                  ")"
                ] }) }) : null
              ]
            },
            group.index
          );
        }
        if (group.kind === "tools") {
          const prevGroup = gi > 0 ? groups[gi - 1] : void 0;
          const isConsecutiveTools = prevGroup?.kind === "tools";
          const isAfterThought = prevGroup?.kind === "thought";
          return /* @__PURE__ */ jsx24("box", { flexDirection: "column", width: "100%", marginTop: isConsecutiveTools || isAfterThought ? 0 : gi > 0 ? 1 : 0, children: /* @__PURE__ */ jsxs22("box", { flexDirection: "column", backgroundColor: C.toolPendingBg, paddingLeft: 1, children: [
            /* @__PURE__ */ jsx24("text", { fg: C.accent, children: /* @__PURE__ */ jsx24("strong", { children: "\xB7 tools" }) }),
            group.tools.map((inv) => /* @__PURE__ */ jsx24(ToolCall, { invocation: inv }, inv.id))
          ] }) }, `tools-${group.startIndex}`);
        }
        return null;
      }),
      isUser && (msg.createdAt != null || msg.tokenIn != null) && /* @__PURE__ */ jsx24("box", { marginTop: hasAnyContent ? 1 : 0, children: /* @__PURE__ */ jsxs22("text", { fg: C.dim, children: [
        msg.createdAt != null ? formatTime(msg.createdAt) : "",
        msg.tokenIn != null ? `  \u2191${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ""}` : ""
      ] }) }),
      !isUser && !isStreaming && (msg.createdAt != null || msg.durationMs != null || msg.tokenIn != null) && /* @__PURE__ */ jsx24("box", { marginTop: hasAnyContent ? 1 : 0, children: /* @__PURE__ */ jsxs22("text", { fg: C.dim, children: [
        msg.createdAt != null ? formatTime(msg.createdAt) : "",
        msg.durationMs != null ? `  ${(msg.durationMs / 1e3).toFixed(1)}s` : "",
        msg.tokenIn != null ? `  \u2191${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ""}` : "",
        msg.tokenOut != null ? `  \u2193${msg.tokenOut.toLocaleString()}` : "",
        msg.tokenOut != null && msg.streamOutputDurationMs != null ? `   ${formatTokenSpeed(msg.tokenOut, msg.streamOutputDurationMs)}` : ""
      ] }) }),
      !hasAnyContent && isStreaming && /* @__PURE__ */ jsx24("box", { children: /* @__PURE__ */ jsx24(GeneratingTimer, { isGenerating: true }) }),
      !hasAnyContent && !isStreaming && /* @__PURE__ */ jsx24("text", { children: " " })
    ] })
  ] });
});

// extensions/console/src/components/ChatMessageList.tsx
import { jsx as jsx25, jsxs as jsxs23 } from "@opentui/react/jsx-runtime";
function ChatMessageList({
  messages,
  streamingParts,
  isStreaming,
  isGenerating,
  retryInfo,
  modelName,
  generatingLabel,
  thoughtsToggleSignal
}) {
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = lastMessage?.role === "assistant" && (isStreaming || isGenerating && lastMessage.parts.length === 0);
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  return /* @__PURE__ */ jsxs23("scrollbox", { flexGrow: 1, stickyScroll: true, stickyStart: "bottom", paddingRight: 1, children: [
    messages.map((message, index) => {
      const isLastActive = lastIsActiveAssistant && index === messages.length - 1;
      const liveParts = isLastActive && streamingParts.length > 0 ? streamingParts : void 0;
      const hasVisibleContent = message.parts.length > 0 || !!liveParts;
      if (isLastActive && !hasVisibleContent) {
        return /* @__PURE__ */ jsx25("box", { flexDirection: "column", paddingBottom: 1, children: /* @__PURE__ */ jsx25(GeneratingTimer, { isGenerating, retryInfo, label: generatingLabel }) }, message.id);
      }
      return /* @__PURE__ */ jsxs23("box", { flexDirection: "column", paddingBottom: 1, children: [
        /* @__PURE__ */ jsx25(
          MessageItem,
          {
            msg: message,
            liveParts,
            isStreaming: isLastActive ? isStreaming : void 0,
            modelName,
            thoughtsToggleSignal: index === lastAssistantIndex ? thoughtsToggleSignal : void 0
          }
        ),
        isLastActive && isStreaming && streamingParts.length === 0 ? /* @__PURE__ */ jsx25(GeneratingTimer, { isGenerating, retryInfo, label: generatingLabel }) : null
      ] }, message.id);
    }),
    isGenerating && !lastIsActiveAssistant && streamingParts.length === 0 ? /* @__PURE__ */ jsx25("box", { flexDirection: "column", paddingBottom: 1, children: /* @__PURE__ */ jsx25(GeneratingTimer, { isGenerating, retryInfo, label: generatingLabel }) }) : null
  ] });
}

// extensions/console/src/components/DiffApprovalView.tsx
import { useMemo as useMemo3 } from "react";
import * as fs2 from "fs";
import * as path2 from "path";

// packages/extension-sdk/dist/tool-utils.js
import * as fs from "node:fs";
import * as path from "node:path";
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function sanitizeUnifiedDiffPatch(patch) {
  const normalized = normalizeLineEndings(patch);
  const lines = normalized.split("\n");
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
  return out.join("\n");
}
function parseUnifiedDiff(patch) {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split("\n");
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
      oldFile = line.slice(4).trim().split("	")[0]?.trim() || "";
      i++;
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (newFile && hunks.length > 0) {
        throw new Error("Multi-file patch is not supported.");
      }
      newFile = line.slice(4).trim().split("	")[0]?.trim() || "";
      i++;
      continue;
    }
    if (line.startsWith("@@")) {
      const header = line;
      const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m) {
        throw new Error(`Invalid hunk header: ${header}. Expected format: @@ -oldStart,oldCount +newStart,newCount @@`);
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
var DEFAULT_IGNORED_DIRS = /* @__PURE__ */ new Set([
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
  for (let i = 0; i < g.length; i++) {
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
  for (let i = 0; i < n; i++) {
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
  for (let i = 0; i < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}
function decodeText(buf) {
  const hasCRLF = buf.includes(Buffer.from("\r\n"));
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
    throw new Error("query \u4E0D\u80FD\u4E3A\u7A7A");
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
    return normalized.length === arrayValue.length ? normalized : void 0;
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
  return void 0;
}
function resolveProjectPath(inputPath) {
  const resolved = path.resolve(inputPath);
  const cwd = process.cwd();
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    throw new Error(`\u8DEF\u5F84\u8D85\u51FA\u9879\u76EE\u76EE\u5F55: ${inputPath}`);
  }
  return resolved;
}
function isWriteEntry(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string" && typeof value.content === "string";
}
function normalizeWriteArgs(args) {
  if (Array.isArray(args.files) && args.files.length > 0) {
    const normalized = args.files.filter(isWriteEntry);
    return normalized.length === args.files.length ? normalized : void 0;
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
  return void 0;
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
import { jsx as jsx26, jsxs as jsxs24 } from "@opentui/react/jsx-runtime";
var DEFAULT_SEARCH_PATTERN = "**/*";
var DEFAULT_SEARCH_MAX_FILES = 50;
var DEFAULT_SEARCH_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
function normalizeLineEndings2(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function sanitizePatchText(patch) {
  const lines = normalizeLineEndings2(patch).split("\n");
  const out = [];
  for (const line of lines) {
    if (line.startsWith("```")) continue;
    if (line === "***" || line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch") || line.startsWith("*** Update File:") || line.startsWith("*** Add File:") || line.startsWith("*** Delete File:") || line.startsWith("*** End of File")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
function getSafePatch(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function toDiffLinePrefix(type) {
  if (type === "add") return "+";
  if (type === "del") return "-";
  return " ";
}
function buildDisplayDiff(filePath, patch) {
  const cleaned = sanitizePatchText(patch);
  if (!cleaned) return "";
  try {
    const parsed = parseUnifiedDiff(cleaned);
    const fallbackOld = `a/${filePath || "file"}`;
    const fallbackNew = `b/${filePath || "file"}`;
    const body = parsed.hunks.map((hunk) => {
      const lines = hunk.lines.map((line) => `${toDiffLinePrefix(line.type)}${line.content}`);
      const oldCount = hunk.lines.filter((l) => l.type === "context" || l.type === "del").length;
      const newCount = hunk.lines.filter((l) => l.type === "context" || l.type === "add").length;
      const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
      return [header, ...lines].join("\n");
    }).join("\n");
    return [`--- ${parsed.oldFile ?? fallbackOld}`, `+++ ${parsed.newFile ?? fallbackNew}`, body].filter(Boolean).join("\n");
  } catch {
    if (/^(diff --git |--- |\+\+\+ )/m.test(cleaned)) return cleaned;
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
  if (!text) return [];
  const lines = normalizeLineEndings2(text).split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function buildWholeFileDiff(filePath, before, after, existed) {
  if (before === after) return "";
  const beforeLines = toWholeFileDiffLines(before);
  const afterLines = toWholeFileDiffLines(after);
  const bodyLines = [
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ];
  if (bodyLines.length === 0) return "";
  const oldFile = existed ? `a/${filePath}` : "/dev/null";
  return [
    `--- ${oldFile}`,
    `+++ b/${filePath}`,
    `@@ -${beforeLines.length > 0 ? 1 : 0},${beforeLines.length} +${afterLines.length > 0 ? 1 : 0},${afterLines.length} @@`,
    ...bodyLines
  ].join("\n");
}
function createMsg(id, filePath, label, message) {
  return { id, filePath, label, filetype: inferFiletype(filePath), message };
}
function buildApplyDiffPreview(inv) {
  const filePath = typeof inv.args.path === "string" ? inv.args.path : "";
  const rawPatch = getSafePatch(inv.args.patch);
  const displayDiff = buildDisplayDiff(filePath, rawPatch);
  return {
    title: "Diff \u5BA1\u6279",
    toolLabel: "apply_diff",
    summary: [filePath ? `\u76EE\u6807\u6587\u4EF6\uFF1A${filePath}` : "\u76EE\u6807\u6587\u4EF6\uFF1A\u672A\u63D0\u4F9B"],
    items: [displayDiff ? { id: `${inv.id}:apply_diff`, filePath, label: filePath || "\u8865\u4E01\u9884\u89C8", diff: displayDiff, filetype: inferFiletype(filePath) } : createMsg(`${inv.id}:apply_diff.empty`, filePath, filePath || "\u8865\u4E01\u9884\u89C8", "\u5F53\u524D\u8865\u4E01\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u663E\u793A diff\u3002")]
  };
}
function buildWriteFilePreview(inv) {
  const fileList = normalizeWriteArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: "Diff \u5BA1\u6279",
      toolLabel: "write_file",
      summary: ["\u53C2\u6570\u4E0D\u5B8C\u6574\uFF0C\u65E0\u6CD5\u751F\u6210 write_file \u9884\u89C8\u3002"],
      items: [createMsg(`${inv.id}:write_file.invalid`, "", "write_file", "files \u53C2\u6570\u65E0\u6548\u3002")]
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
      const action = existed ? "\u4FEE\u6539" : "\u65B0\u589E";
      items.push(diff ? { id: `${inv.id}:write_file:${i}`, filePath: entry.path, label: `${entry.path} \xB7 ${action}`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} \xB7 ${action}`, existed ? "\u5185\u5BB9\u53D8\u5316\u7279\u6B8A\uFF0C\u65E0\u6CD5\u663E\u793A diff\u3002" : "\u5C06\u521B\u5EFA\u7A7A\u6587\u4EF6\u3002"));
      if (existed) modified++;
      else created++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} \xB7 \u9884\u89C8\u5931\u8D25`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`\u5171 ${fileList.length} \u4E2A\u6587\u4EF6`, `\u65B0\u589E ${created}\uFF0C\u4FEE\u6539 ${modified}\uFF0C\u672A\u53D8\u5316 ${unchanged}`];
  if (errored > 0) summary.push(`${errored} \u4E2A\u6587\u4EF6\u65E0\u6CD5\u751F\u6210\u9884\u89C8`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:write_file.empty`, "", "write_file", "\u672C\u6B21 write_file \u4E0D\u4F1A\u4EA7\u751F\u5B9E\u9645\u53D8\u66F4\u3002"));
  return { title: "Diff \u5BA1\u6279", toolLabel: "write_file", summary, items };
}
function buildInsertCodePreview(inv) {
  const fileList = normalizeInsertArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: "Diff \u5BA1\u6279",
      toolLabel: "insert_code",
      summary: ["\u53C2\u6570\u4E0D\u5B8C\u6574\uFF0C\u65E0\u6CD5\u751F\u6210 insert_code \u9884\u89C8\u3002"],
      items: [createMsg(`${inv.id}:insert_code.invalid`, "", "insert_code", "files \u53C2\u6570\u65E0\u6548\u3002")]
    };
  }
  const items = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry, i) => {
    try {
      const resolved = resolveProjectPath(entry.path);
      const before = fs2.readFileSync(resolved, "utf-8");
      const lines = before.split("\n");
      const insertLines = entry.content.split("\n");
      const idx = entry.line - 1;
      const after = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join("\n");
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? { id: `${inv.id}:insert_code:${i}`, filePath: entry.path, label: `${entry.path} \xB7 \u7B2C ${entry.line} \u884C\u524D\u63D2\u5165 ${insertLines.length} \u884C`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} \xB7 \u63D2\u5165`, "\u65E0\u6CD5\u663E\u793A diff\u3002"));
      successCount++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} \xB7 \u9884\u89C8\u5931\u8D25`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`\u5171 ${fileList.length} \u4E2A\u64CD\u4F5C`, `\u53EF\u9884\u89C8 ${successCount} \u4E2A`];
  if (errored > 0) summary.push(`${errored} \u4E2A\u64CD\u4F5C\u65E0\u6CD5\u751F\u6210\u9884\u89C8`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:insert_code.empty`, "", "insert_code", "\u65E0\u53EF\u9884\u89C8\u7684\u53D8\u66F4\u3002"));
  return { title: "Diff \u5BA1\u6279", toolLabel: "insert_code", summary, items };
}
function buildDeleteCodePreview(inv) {
  const fileList = normalizeDeleteCodeArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: "Diff \u5BA1\u6279",
      toolLabel: "delete_code",
      summary: ["\u53C2\u6570\u4E0D\u5B8C\u6574\uFF0C\u65E0\u6CD5\u751F\u6210 delete_code \u9884\u89C8\u3002"],
      items: [createMsg(`${inv.id}:delete_code.invalid`, "", "delete_code", "files \u53C2\u6570\u65E0\u6548\u3002")]
    };
  }
  const items = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry, i) => {
    try {
      const resolved = resolveProjectPath(entry.path);
      const before = fs2.readFileSync(resolved, "utf-8");
      const lines = before.split("\n");
      const after = [...lines.slice(0, entry.start_line - 1), ...lines.slice(entry.end_line)].join("\n");
      const deletedCount = entry.end_line - entry.start_line + 1;
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? { id: `${inv.id}:delete_code:${i}`, filePath: entry.path, label: `${entry.path} \xB7 \u5220\u9664\u7B2C ${entry.start_line}-${entry.end_line} \u884C\uFF08${deletedCount} \u884C\uFF09`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} \xB7 \u5220\u9664`, "\u65E0\u6CD5\u663E\u793A diff\u3002"));
      successCount++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} \xB7 \u9884\u89C8\u5931\u8D25`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`\u5171 ${fileList.length} \u4E2A\u64CD\u4F5C`, `\u53EF\u9884\u89C8 ${successCount} \u4E2A`];
  if (errored > 0) summary.push(`${errored} \u4E2A\u64CD\u4F5C\u65E0\u6CD5\u751F\u6210\u9884\u89C8`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:delete_code.empty`, "", "delete_code", "\u65E0\u53EF\u9884\u89C8\u7684\u53D8\u66F4\u3002"));
  return { title: "Diff \u5BA1\u6279", toolLabel: "delete_code", summary, items };
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
      title: "Diff \u5BA1\u6279",
      toolLabel: "search_in_files.replace",
      summary: ["replace \u53C2\u6570\u7F3A\u5931\u3002"],
      items: [createMsg(`${inv.id}:search_replace.invalid`, inputPath, "search_in_files.replace", "replace \u6A21\u5F0F\u4E0B\u5FC5\u987B\u63D0\u4F9B replace \u53C2\u6570\u3002")]
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
      if (shouldStop()) return;
      if (stat.isDirectory() && !patternRe.test(relPosix)) return;
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
      for (; ; ) {
        const m = countRegex.exec(decoded.text);
        if (!m) break;
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
      items.push(diff ? { id: `${inv.id}:search_replace:${displayPath}`, filePath: displayPath, label: `${displayPath} \xB7 ${replacements} \u5904\u66FF\u6362`, diff, filetype: inferFiletype(displayPath) } : createMsg(`${inv.id}:search_replace:${displayPath}`, displayPath, `${displayPath} \xB7 ${replacements} \u5904\u66FF\u6362`, "\u6587\u4EF6\u5C06\u53D8\u5316\uFF0C\u4F46\u65E0\u6CD5\u663E\u793A diff\u3002"));
      changedFiles++;
      totalReplacements += replacements;
    };
    if (stat.isFile()) processFile(rootAbs, toPosix(path2.basename(rootAbs)));
    else {
      walkFiles(rootAbs, processFile, shouldStop);
      if (processedFiles >= maxFiles) truncated = true;
    }
    const summary = [
      `\u8DEF\u5F84 ${inputPath} \xB7 pattern ${pattern}`,
      `\u5DF2\u5904\u7406 ${processedFiles} \u4E2A\u6587\u4EF6 \xB7 \u5C06\u53D8\u66F4 ${changedFiles} \u4E2A\u6587\u4EF6 \xB7 \u5171 ${totalReplacements} \u5904\u66FF\u6362`
    ];
    if (unchangedFiles > 0) summary.push(`\u65E0\u5B9E\u9645\u53D8\u5316 ${unchangedFiles} \u4E2A\u6587\u4EF6`);
    if (skippedBinary > 0 || skippedTooLarge > 0) summary.push(`\u8DF3\u8FC7\u4E8C\u8FDB\u5236 ${skippedBinary} \u4E2A \xB7 \u8DF3\u8FC7\u8FC7\u5927\u6587\u4EF6 ${skippedTooLarge} \u4E2A`);
    if (truncated) summary.push(`\u5DF2\u8FBE\u5230 maxFiles=${maxFiles}\uFF0C\u9884\u89C8\u5DF2\u622A\u65AD`);
    if (items.length === 0) items.push(createMsg(`${inv.id}:search_replace.empty`, inputPath, "search_in_files.replace", "\u5F53\u524D replace \u4E0D\u4F1A\u4FEE\u6539\u4EFB\u4F55\u6587\u4EF6\u3002"));
    return { title: "Diff \u5BA1\u6279", toolLabel: "search_in_files.replace", summary, items };
  } catch (err) {
    return {
      title: "Diff \u5BA1\u6279",
      toolLabel: "search_in_files.replace",
      summary: ["\u751F\u6210\u9884\u89C8\u65F6\u53D1\u751F\u9519\u8BEF\u3002"],
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
    title: "Diff \u5BA1\u6279",
    toolLabel: invocation.toolName,
    summary: ["\u5F53\u524D\u5DE5\u5177\u4E0D\u652F\u6301 diff \u5BA1\u6279\u9884\u89C8\u3002"],
    items: [createMsg(`${invocation.id}:unsupported`, "", invocation.toolName, "\u5F53\u524D\u5DE5\u5177\u4E0D\u652F\u6301 diff \u5BA1\u6279\u9884\u89C8\u3002")]
  };
}
function DiffApprovalView({ invocation, pendingCount, choice, view, showLineNumbers, wrapMode, previewIndex = 0 }) {
  const preview = useMemo3(() => buildPreview(invocation), [invocation]);
  const normalizedPreviewIndex = preview.items.length > 0 ? (previewIndex % preview.items.length + preview.items.length) % preview.items.length : 0;
  const currentItem = preview.items[normalizedPreviewIndex];
  return /* @__PURE__ */ jsxs24("box", { flexDirection: "column", width: "100%", height: "100%", padding: 1, backgroundColor: "#0d1117", children: [
    /* @__PURE__ */ jsxs24("box", { flexDirection: "column", borderStyle: "double", borderColor: C.warn, paddingX: 1, paddingY: 0, flexShrink: 0, children: [
      /* @__PURE__ */ jsxs24("text", { children: [
        /* @__PURE__ */ jsx26("span", { fg: C.warn, children: /* @__PURE__ */ jsx26("strong", { children: preview.title }) }),
        /* @__PURE__ */ jsx26("span", { fg: C.dim, children: `  ${preview.toolLabel}` }),
        pendingCount > 1 ? /* @__PURE__ */ jsx26("span", { fg: C.dim, children: `  (\u5269\u4F59 ${pendingCount - 1} \u4E2A)` }) : null,
        preview.items.length > 1 ? /* @__PURE__ */ jsx26("span", { fg: C.dim, children: `  (\u9884\u89C8 ${normalizedPreviewIndex + 1}/${preview.items.length})` }) : null
      ] }),
      /* @__PURE__ */ jsxs24("text", { children: [
        /* @__PURE__ */ jsx26("span", { fg: C.text, children: "\u6587\u4EF6 " }),
        /* @__PURE__ */ jsx26("span", { fg: C.primaryLight, children: currentItem?.filePath || "(\u672A\u63D0\u4F9B\u8DEF\u5F84)" }),
        /* @__PURE__ */ jsx26("span", { fg: C.dim, children: `  \u89C6\u56FE:${view === "split" ? "\u5206\u680F" : "\u7EDF\u4E00"}  \u884C\u53F7:${showLineNumbers ? "\u5F00" : "\u5173"}  \u6362\u884C:${wrapMode === "word" ? "\u5F00" : "\u5173"}` })
      ] }),
      currentItem?.label ? /* @__PURE__ */ jsx26("text", { fg: C.dim, children: currentItem.label }) : null,
      preview.summary.map((line, index) => /* @__PURE__ */ jsx26("text", { fg: C.dim, children: line }, `${preview.toolLabel}.summary.${index}`))
    ] }),
    /* @__PURE__ */ jsx26(
      "scrollbox",
      {
        flexGrow: 1,
        flexShrink: 1,
        marginTop: 1,
        borderStyle: "single",
        borderColor: C.border,
        verticalScrollbarOptions: { visible: true },
        horizontalScrollbarOptions: { visible: false },
        children: currentItem?.diff ? /* @__PURE__ */ jsx26(
          "diff",
          {
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
          }
        ) : /* @__PURE__ */ jsx26("text", { fg: currentItem?.message ? C.textSec : C.dim, paddingX: 1, paddingY: 1, children: currentItem?.message ?? "\u5F53\u524D\u8865\u4E01\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u663E\u793A diff\u3002" })
      }
    ),
    /* @__PURE__ */ jsxs24("box", { flexDirection: "column", marginTop: 1, borderStyle: "single", borderColor: choice === "approve" ? C.accent : C.error, paddingX: 1, paddingY: 0, flexShrink: 0, children: [
      /* @__PURE__ */ jsxs24("text", { children: [
        /* @__PURE__ */ jsx26("span", { fg: C.text, children: "\u5BA1\u6279\u7ED3\u679C " }),
        /* @__PURE__ */ jsx26("span", { fg: choice === "approve" ? C.accent : C.textSec, children: choice === "approve" ? "[\u6279\u51C6]" : " \u6279\u51C6 " }),
        /* @__PURE__ */ jsx26("span", { fg: C.dim, children: " " }),
        /* @__PURE__ */ jsx26("span", { fg: choice === "reject" ? C.error : C.textSec, children: choice === "reject" ? "[\u62D2\u7EDD]" : " \u62D2\u7EDD " })
      ] }),
      /* @__PURE__ */ jsxs24("text", { fg: C.dim, children: [
        preview.items.length > 1 ? "\u2191 / \u2193 \u5207\u6362\u6587\u4EF6\u3000" : "",
        "Tab / \u2190 / \u2192 \u5207\u6362\u3000Enter \u786E\u8BA4\u3000Y \u6279\u51C6\u3000N \u62D2\u7EDD\u3000V \u5207\u6362\u89C6\u56FE\u3000L \u5207\u6362\u884C\u53F7\u3000W \u5207\u6362\u6362\u884C\u3000Esc \u4E2D\u65AD\u672C\u6B21\u751F\u6210"
      ] })
    ] })
  ] });
}

// extensions/console/src/components/InitWarnings.tsx
import { jsx as jsx27, jsxs as jsxs25 } from "@opentui/react/jsx-runtime";
var MAX_VISIBLE_LINES = 3;
function InitWarnings({ warnings, color, icon }) {
  if (warnings.length === 0) return null;
  const fg = color ?? C.warn;
  const prefix = icon ?? "\u26A0";
  return /* @__PURE__ */ jsx27("box", { flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingBottom: 1, maxHeight: MAX_VISIBLE_LINES + 1, children: warnings.map((msg, i) => /* @__PURE__ */ jsx27("box", { children: /* @__PURE__ */ jsxs25("text", { children: [
    /* @__PURE__ */ jsxs25("span", { fg, children: [
      prefix,
      " "
    ] }),
    /* @__PURE__ */ jsx27("span", { fg, children: msg })
  ] }) }, i)) });
}

// extensions/console/src/components/LogoScreen.tsx
import { jsx as jsx28, jsxs as jsxs26 } from "@opentui/react/jsx-runtime";
function LogoScreen() {
  return /* @__PURE__ */ jsx28("box", { flexDirection: "column", flexGrow: 1, padding: 1, alignItems: "center", justifyContent: "center", children: /* @__PURE__ */ jsxs26("box", { flexDirection: "column", border: false, padding: 2, alignItems: "center", children: [
    /* @__PURE__ */ jsx28("text", { fg: C.primary, children: /* @__PURE__ */ jsx28("strong", { children: "\u2580\u2588\u2580 \u2588\u2580\u2588 \u2580\u2588\u2580 \u2588\u2580\u2580" }) }),
    /* @__PURE__ */ jsx28("text", { fg: C.primary, children: /* @__PURE__ */ jsx28("strong", { children: " \u2588  \u2588\u2580\u2584  \u2588  \u2580\u2580\u2588" }) }),
    /* @__PURE__ */ jsx28("text", { fg: C.primary, children: /* @__PURE__ */ jsx28("strong", { children: "\u2580\u2580\u2580 \u2580 \u2580 \u2580\u2580\u2580 \u2580\u2580\u2580" }) }),
    /* @__PURE__ */ jsx28("text", { children: " " }),
    /* @__PURE__ */ jsx28("text", { fg: C.dim, children: "\u6A21\u5757\u5316 AI \u667A\u80FD\u4EE3\u7406\u6846\u67B6" })
  ] }) });
}

// extensions/console/src/components/ToolDetailView.tsx
import { useState as useState7, useCallback as useCallback3 } from "react";
import { useKeyboard as useKeyboard2 } from "@opentui/react";
import { jsx as jsx29, jsxs as jsxs27 } from "@opentui/react/jsx-runtime";
var TERMINAL_STATUSES2 = /* @__PURE__ */ new Set(["success", "warning", "error"]);
var STATUS_ICON = {
  streaming: "\u{1F4E1}",
  queued: "\u23F3",
  awaiting_approval: "\u{1F510}",
  executing: "\u{1F527}",
  awaiting_apply: "\u{1F4CB}",
  success: "\u2705",
  warning: "\u26A0\uFE0F",
  error: "\u274C"
};
var STATUS_LABEL = {
  streaming: "\u8F93\u51FA\u4E2D",
  queued: "\u7B49\u5F85\u4E2D",
  awaiting_approval: "\u7B49\u5F85\u5BA1\u6279",
  executing: "\u6267\u884C\u4E2D",
  awaiting_apply: "\u7B49\u5F85\u5E94\u7528",
  success: "\u6210\u529F",
  warning: "\u8B66\u544A",
  error: "\u5931\u8D25"
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
  const s = (endMs - startMs) / 1e3;
  if (s < 0.05) return "";
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}
function truncate(text, max) {
  const oneLine = text.replace(/\n/g, "\u21B5 ");
  return oneLine.length > max ? oneLine.slice(0, max) + "\u2026" : oneLine;
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
        const path4 = typeof first === "object" && first ? String(first.path || "") : "";
        return args.files.length > 1 ? `${path4} +${args.files.length - 1}` : path4;
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
    return /* @__PURE__ */ jsxs27("text", { children: [
      /* @__PURE__ */ jsx29("span", { fg: C.dim, children: "\u2500\u2500\u2500 " }),
      /* @__PURE__ */ jsx29("span", { fg: C.accent, children: /* @__PURE__ */ jsx29("strong", { children: label }) }),
      /* @__PURE__ */ jsx29("span", { fg: C.dim, children: " " + "\u2500".repeat(50) })
    ] });
  }
  return /* @__PURE__ */ jsx29("text", { children: /* @__PURE__ */ jsx29("span", { fg: C.dim, children: "\u2500".repeat(60) }) });
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
        if (c) onNavigateChild(c.id);
      }
    }
  }, [onClose, onAbort, isFinal, invocation.id, children, selectedIdx, onNavigateChild]));
  if (DetailRenderer) {
    return /* @__PURE__ */ jsxs27("box", { flexDirection: "column", width: "100%", children: [
      /* @__PURE__ */ jsx29(BreadcrumbBar, { breadcrumb, toolName }),
      DetailRenderer({ invocation, output, children, onNavigateChild }),
      /* @__PURE__ */ jsx29(FooterBar, { isFinal, hasAbort: !!onAbort, hasChildren: children.length > 0 })
    ] });
  }
  return /* @__PURE__ */ jsxs27("box", { flexDirection: "column", width: "100%", children: [
    /* @__PURE__ */ jsx29(BreadcrumbBar, { breadcrumb, toolName }),
    /* @__PURE__ */ jsxs27("box", { children: [
      /* @__PURE__ */ jsxs27("text", { children: [
        /* @__PURE__ */ jsx29("span", { bg: status === "error" ? C.error : C.accent, fg: C.cursorFg, children: /* @__PURE__ */ jsxs27("strong", { children: [
          " ",
          toolName,
          " "
        ] }) }),
        "  ",
        /* @__PURE__ */ jsxs27("span", { fg: isFinal ? status === "error" ? C.error : C.accent : C.dim, children: [
          STATUS_ICON[status] || "\u23F3",
          " ",
          STATUS_LABEL[status] || status
        ] }),
        dur(createdAt, updatedAt) ? /* @__PURE__ */ jsxs27("span", { fg: C.dim, children: [
          "  ",
          dur(createdAt, updatedAt)
        ] }) : null,
        "  "
      ] }),
      isExecuting && /* @__PURE__ */ jsx29(Spinner, {})
    ] }),
    /* @__PURE__ */ jsx29("box", { marginTop: 0, children: /* @__PURE__ */ jsxs27("text", { children: [
      /* @__PURE__ */ jsxs27("span", { fg: C.dim, children: [
        "  \u23F1 ",
        ts(createdAt)
      ] }),
      isFinal ? /* @__PURE__ */ jsxs27("span", { fg: C.dim, children: [
        " \u2192 ",
        ts(updatedAt)
      ] }) : /* @__PURE__ */ jsx29("span", { fg: C.dim, children: " \u2192 \u2026" })
    ] }) }),
    /* @__PURE__ */ jsx29(Divider, { label: "\u53C2\u6570" }),
    /* @__PURE__ */ jsx29(ArgsSection, { args }),
    output.length > 0 && /* @__PURE__ */ jsxs27("box", { flexDirection: "column", children: [
      /* @__PURE__ */ jsx29(Divider, { label: `\u8F93\u51FA (${output.length})` }),
      /* @__PURE__ */ jsx29(OutputSection, { output })
    ] }),
    children.length > 0 && /* @__PURE__ */ jsxs27("box", { flexDirection: "column", children: [
      /* @__PURE__ */ jsx29(Divider, { label: `\u5B50\u5DE5\u5177 (${children.length})` }),
      /* @__PURE__ */ jsx29(ChildrenSection, { children, selectedIdx })
    ] }),
    isFinal && /* @__PURE__ */ jsxs27("box", { flexDirection: "column", children: [
      /* @__PURE__ */ jsx29(Divider, { label: "\u7ED3\u679C" }),
      /* @__PURE__ */ jsx29(ResultSection, { status, error, result, toolName, args, Renderer: ResultRenderer })
    ] }),
    /* @__PURE__ */ jsx29(Divider, {}),
    /* @__PURE__ */ jsx29(FooterBar, { isFinal, hasAbort: !!onAbort, hasChildren: children.length > 0 })
  ] });
}
function BreadcrumbBar({ breadcrumb, toolName }) {
  return /* @__PURE__ */ jsx29("box", { marginBottom: 0, children: /* @__PURE__ */ jsxs27("text", { children: [
    /* @__PURE__ */ jsx29("span", { fg: C.dim, children: "\u2190 [Esc] " }),
    breadcrumb.map((b) => /* @__PURE__ */ jsxs27("span", { children: [
      /* @__PURE__ */ jsx29("span", { fg: C.dim, children: b.toolName }),
      /* @__PURE__ */ jsx29("span", { fg: C.dim, children: " \u203A " })
    ] }, b.toolId)),
    /* @__PURE__ */ jsx29("span", { fg: C.accent, children: /* @__PURE__ */ jsx29("strong", { children: toolName }) })
  ] }) });
}
function ArgsSection({ args }) {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return /* @__PURE__ */ jsx29("text", { fg: C.dim, children: "  (\u65E0\u53C2\u6570)" });
  }
  return /* @__PURE__ */ jsxs27("box", { flexDirection: "column", children: [
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
      return /* @__PURE__ */ jsxs27("text", { children: [
        /* @__PURE__ */ jsxs27("span", { fg: C.accent, children: [
          "  ",
          key
        ] }),
        /* @__PURE__ */ jsx29("span", { fg: C.dim, children: " = " }),
        /* @__PURE__ */ jsx29("span", { children: display })
      ] }, key);
    }),
    entries.length > 8 && /* @__PURE__ */ jsxs27("text", { fg: C.dim, children: [
      "  \u2026 +",
      entries.length - 8,
      " \u66F4\u591A\u53C2\u6570"
    ] })
  ] });
}
function OutputSection({ output }) {
  const visible = output.length > 20 ? output.slice(-20) : output;
  const skipped = output.length - visible.length;
  return /* @__PURE__ */ jsxs27("box", { flexDirection: "column", children: [
    skipped > 0 && /* @__PURE__ */ jsxs27("text", { fg: C.dim, children: [
      "  \u2026 \u7701\u7565 ",
      skipped,
      " \u6761"
    ] }),
    visible.map((entry, i) => /* @__PURE__ */ jsxs27("text", { children: [
      /* @__PURE__ */ jsxs27("span", { fg: C.dim, children: [
        "  ",
        ts(entry.timestamp),
        " "
      ] }),
      /* @__PURE__ */ jsxs27("span", { fg: OUTPUT_COLOR[entry.type] || C.dim, children: [
        "[",
        OUTPUT_LABEL[entry.type] || entry.type,
        "]"
      ] }),
      /* @__PURE__ */ jsxs27("span", { children: [
        " ",
        truncate(entry.content, 100)
      ] })
    ] }, i))
  ] });
}
function ChildrenSection({ children, selectedIdx }) {
  return /* @__PURE__ */ jsx29("box", { flexDirection: "column", children: children.map((child, i) => {
    const sel = i === selectedIdx;
    const icon = STATUS_ICON[child.status] || "\u23F3";
    const d = dur(child.createdAt, child.updatedAt);
    const summary = childArgsSummary(child.toolName, child.args);
    return /* @__PURE__ */ jsxs27("text", { children: [
      /* @__PURE__ */ jsx29("span", { fg: sel ? C.accent : C.dim, children: sel ? " \u25B8 " : "   " }),
      /* @__PURE__ */ jsxs27("span", { bg: child.status === "error" ? C.error : C.accent, fg: C.cursorFg, children: [
        " ",
        child.toolName,
        " "
      ] }),
      summary ? /* @__PURE__ */ jsxs27("span", { fg: C.dim, children: [
        " ",
        summary
      ] }) : null,
      /* @__PURE__ */ jsxs27("span", { children: [
        " ",
        icon
      ] }),
      d ? /* @__PURE__ */ jsxs27("span", { fg: C.dim, children: [
        " ",
        d
      ] }) : null
    ] }, child.id);
  }) });
}
function ResultSection({ status, error, result, toolName, args, Renderer }) {
  if (status === "error" && error) {
    return /* @__PURE__ */ jsxs27("text", { fg: C.error, children: [
      "  ",
      error
    ] });
  }
  if (Renderer && result != null) {
    return /* @__PURE__ */ jsx29("box", { paddingLeft: 2, children: Renderer({ toolName, args, result }) });
  }
  if (result != null) {
    const text_content = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    const lines = text_content.split("\n");
    const visible = lines.length > 10 ? lines.slice(0, 10) : lines;
    return /* @__PURE__ */ jsxs27("box", { flexDirection: "column", children: [
      visible.map((line, i) => /* @__PURE__ */ jsxs27("text", { fg: C.dim, children: [
        "  ",
        line
      ] }, i)),
      lines.length > 10 && /* @__PURE__ */ jsxs27("text", { fg: C.dim, children: [
        "  \u2026 +",
        lines.length - 10,
        " \u884C"
      ] })
    ] });
  }
  return /* @__PURE__ */ jsx29("text", { fg: C.dim, children: "  (\u65E0\u7ED3\u679C)" });
}
function FooterBar({ isFinal, hasAbort, hasChildren }) {
  return /* @__PURE__ */ jsx29("box", { children: /* @__PURE__ */ jsxs27("text", { children: [
    /* @__PURE__ */ jsx29("span", { fg: C.dim, children: " [Esc/q] \u8FD4\u56DE" }),
    !isFinal && hasAbort ? /* @__PURE__ */ jsx29("span", { fg: C.dim, children: "  [a] \u7EC8\u6B62" }) : null,
    hasChildren ? /* @__PURE__ */ jsx29("span", { fg: C.dim, children: "  [\u2191\u2193] \u9009\u62E9\u5B50\u5DE5\u5177  [Enter] \u67E5\u770B\u8BE6\u60C5" }) : null
  ] }) });
}

// extensions/console/src/components/ModelListView.tsx
import { jsx as jsx30, jsxs as jsxs28 } from "@opentui/react/jsx-runtime";
function ModelListView({ models, selectedIndex }) {
  return /* @__PURE__ */ jsxs28("box", { flexDirection: "column", width: "100%", height: "100%", children: [
    /* @__PURE__ */ jsxs28("box", { padding: 1, children: [
      /* @__PURE__ */ jsx30("text", { fg: C.primary, children: "\u5207\u6362\u6A21\u578B" }),
      /* @__PURE__ */ jsx30("text", { fg: C.dim, children: "  \u2191\u2193 \u9009\u62E9  Enter \u5207\u6362  Esc \u8FD4\u56DE" })
    ] }),
    /* @__PURE__ */ jsx30("scrollbox", { flexGrow: 1, children: models.map((info, index) => {
      const isSelected = index === selectedIndex;
      const currentMarker = info.current ? "\u2022" : " ";
      return /* @__PURE__ */ jsx30("box", { paddingLeft: 1, children: /* @__PURE__ */ jsxs28("text", { children: [
        /* @__PURE__ */ jsx30("span", { fg: isSelected ? C.accent : C.dim, children: isSelected ? "\u276F " : "  " }),
        /* @__PURE__ */ jsxs28("span", { fg: info.current ? C.accent : C.dim, children: [
          currentMarker,
          " "
        ] }),
        isSelected ? /* @__PURE__ */ jsx30("strong", { children: /* @__PURE__ */ jsx30("span", { fg: C.text, children: info.modelName }) }) : /* @__PURE__ */ jsx30("span", { fg: C.textSec, children: info.modelName }),
        /* @__PURE__ */ jsxs28("span", { fg: C.dim, children: [
          "  ",
          info.modelId,
          "  ",
          info.provider
        ] })
      ] }) }, info.modelName);
    }) })
  ] });
}

// extensions/console/src/components/QueueListView.tsx
import { jsx as jsx31, jsxs as jsxs29 } from "@opentui/react/jsx-runtime";
function formatQueueTime(timestamp) {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function truncatePreview(text, maxLen) {
  const single = text.replace(/\r\n/g, "\n").replace(/\n/g, " \u21B5 ").trim();
  if (single.length <= maxLen) return single;
  return single.slice(0, maxLen - 1) + "\u2026";
}
function countNewlines(text) {
  let count = 0;
  for (const ch of text) if (ch === "\n") count++;
  return count;
}
function QueueListView({ queue, selectedIndex, editingId, editingValue, editingCursor }) {
  const isEditing = editingId != null;
  const cursorVisible = useCursorBlink();
  return /* @__PURE__ */ jsxs29("box", { flexDirection: "column", width: "100%", height: "100%", children: [
    /* @__PURE__ */ jsxs29("box", { padding: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsxs29("box", { children: [
        /* @__PURE__ */ jsx31("text", { fg: C.primary, children: "\u6D88\u606F\u961F\u5217" }),
        /* @__PURE__ */ jsx31("text", { fg: C.dim, children: `  (${queue.length} \u6761\u5F85\u53D1\u9001)` })
      ] }),
      /* @__PURE__ */ jsx31("box", { paddingTop: 0, children: isEditing ? /* @__PURE__ */ jsx31("text", { fg: C.dim, children: "  Ctrl+J \u6362\u884C  Enter \u786E\u8BA4  Ctrl+U \u6E05\u7A7A  Esc \u53D6\u6D88" }) : /* @__PURE__ */ jsx31("text", { fg: C.dim, children: "  \u2191\u2193 \u9009\u62E9  Ctrl/Shift+\u2191\u2193 \u79FB\u52A8  e \u7F16\u8F91  d \u5220\u9664  c \u6E05\u7A7A\u961F\u5217  Esc \u8FD4\u56DE" }) })
    ] }),
    /* @__PURE__ */ jsxs29("scrollbox", { flexGrow: 1, children: [
      queue.length === 0 && /* @__PURE__ */ jsx31("text", { fg: C.dim, paddingLeft: 2, children: "\u961F\u5217\u4E3A\u7A7A" }),
      queue.map((msg, index) => {
        const isSelected = index === selectedIndex;
        const isMsgEditing = msg.id === editingId;
        const time = formatQueueTime(msg.createdAt);
        if (isMsgEditing) {
          const nlCount = countNewlines(editingValue);
          return /* @__PURE__ */ jsxs29("box", { paddingLeft: 1, flexDirection: "column", children: [
            /* @__PURE__ */ jsxs29("text", { children: [
              /* @__PURE__ */ jsx31("span", { fg: C.accent, children: "\u276F " }),
              /* @__PURE__ */ jsx31("span", { fg: C.dim, children: `${index + 1}. ` }),
              /* @__PURE__ */ jsx31("span", { fg: C.warn, children: "[\u7F16\u8F91\u4E2D]" }),
              nlCount > 0 ? /* @__PURE__ */ jsx31("span", { fg: C.dim, children: ` (${nlCount + 1} \u884C)` }) : null,
              /* @__PURE__ */ jsx31("span", { fg: C.dim, children: `  ${time}` })
            ] }),
            /* @__PURE__ */ jsx31("box", { paddingLeft: 4, children: /* @__PURE__ */ jsx31(
              InputDisplay,
              {
                value: editingValue,
                cursor: editingCursor,
                isActive: true,
                cursorVisible
              }
            ) })
          ] }, msg.id);
        }
        const preview = truncatePreview(msg.text, 60);
        return /* @__PURE__ */ jsx31("box", { paddingLeft: 1, children: /* @__PURE__ */ jsxs29("text", { children: [
          /* @__PURE__ */ jsx31("span", { fg: isSelected ? C.accent : C.dim, children: isSelected ? "\u276F " : "  " }),
          /* @__PURE__ */ jsx31("span", { fg: C.dim, children: `${index + 1}. ` }),
          isSelected ? /* @__PURE__ */ jsx31("strong", { children: /* @__PURE__ */ jsx31("span", { fg: C.text, children: preview }) }) : /* @__PURE__ */ jsx31("span", { fg: C.textSec, children: preview }),
          /* @__PURE__ */ jsx31("span", { fg: C.dim, children: `  ${time}` })
        ] }) }, msg.id);
      })
    ] })
  ] });
}

// extensions/console/src/components/ToolListView.tsx
import { jsx as jsx32, jsxs as jsxs30 } from "@opentui/react/jsx-runtime";
var STATUS_ICON2 = {
  streaming: "\u{1F4E1}",
  queued: "\u23F3",
  awaiting_approval: "\u{1F510}",
  executing: "\u{1F527}",
  awaiting_apply: "\u{1F4CB}",
  success: "\u2705",
  warning: "\u26A0\uFE0F",
  error: "\u274C"
};
function formatDuration(startMs, endMs) {
  const s = (endMs - startMs) / 1e3;
  if (s < 0.05) return "";
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}
function argsSummary(toolName, args) {
  switch (toolName) {
    case "shell":
    case "bash": {
      const cmd = String(args.command || "");
      return cmd.length > 40 ? `"${cmd.slice(0, 40)}\u2026"` : `"${cmd}"`;
    }
    case "read_file":
    case "write_file":
    case "apply_diff":
    case "delete_code":
    case "insert_code": {
      if (Array.isArray(args.files) && args.files.length > 0) {
        const first = args.files[0];
        const path4 = typeof first === "object" && first ? String(first.path || "") : "";
        return args.files.length > 1 ? `${path4} +${args.files.length - 1}` : path4;
      }
      return String(args.path || "");
    }
    case "search_in_files": {
      const q = String(args.query || "");
      const head = q.length > 20 ? `"${q.slice(0, 20)}\u2026"` : `"${q}"`;
      return args.path ? `${head} in ${args.path}` : head;
    }
    case "find_files":
      return Array.isArray(args.patterns) ? String(args.patterns[0] || "") : "";
    case "sub_agent": {
      const prompt = String(args.prompt || "");
      return prompt.length > 50 ? `"${prompt.slice(0, 50)}\u2026"` : `"${prompt}"`;
    }
    default:
      return "";
  }
}
function ToolListView({ tools, selectedIndex }) {
  if (tools.length === 0) {
    return /* @__PURE__ */ jsxs30("box", { flexDirection: "column", paddingX: 1, children: [
      /* @__PURE__ */ jsx32("text", { fg: C.dim, children: "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u5177\u6267\u884C\u8BB0\u5F55\u3002" }),
      /* @__PURE__ */ jsx32("text", { fg: C.dim, children: " " }),
      /* @__PURE__ */ jsx32("text", { fg: C.dim, children: "Esc \u8FD4\u56DE" })
    ] });
  }
  return /* @__PURE__ */ jsxs30("box", { flexDirection: "column", paddingX: 1, children: [
    /* @__PURE__ */ jsxs30("text", { children: [
      /* @__PURE__ */ jsx32("span", { fg: C.accent, children: /* @__PURE__ */ jsx32("strong", { children: " \u5DE5\u5177\u6267\u884C\u8BB0\u5F55 " }) }),
      /* @__PURE__ */ jsxs30("span", { fg: C.dim, children: [
        "(",
        tools.length,
        ")"
      ] })
    ] }),
    /* @__PURE__ */ jsx32("text", { fg: C.dim, children: "\u2500".repeat(60) }),
    /* @__PURE__ */ jsx32("scrollbox", { flexGrow: 1, children: tools.map((inv, i) => {
      const sel = i === selectedIndex;
      const icon = STATUS_ICON2[inv.status] || "\u23F3";
      const d = formatDuration(inv.createdAt, inv.updatedAt);
      const summary = argsSummary(inv.toolName, inv.args);
      const time = new Date(inv.createdAt);
      const timeStr = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;
      return /* @__PURE__ */ jsxs30("text", { children: [
        /* @__PURE__ */ jsx32("span", { fg: sel ? C.accent : C.dim, children: sel ? " \u276F " : "   " }),
        /* @__PURE__ */ jsxs30("span", { fg: C.dim, children: [
          timeStr,
          " "
        ] }),
        /* @__PURE__ */ jsxs30("span", { bg: inv.status === "error" ? C.error : C.accent, fg: C.cursorFg, children: [
          " ",
          inv.toolName,
          " "
        ] }),
        summary ? /* @__PURE__ */ jsxs30("span", { fg: sel ? void 0 : C.dim, children: [
          " ",
          summary
        ] }) : null,
        /* @__PURE__ */ jsxs30("span", { children: [
          " ",
          icon
        ] }),
        d ? /* @__PURE__ */ jsxs30("span", { fg: C.dim, children: [
          " ",
          d
        ] }) : null
      ] }, inv.id);
    }) }),
    /* @__PURE__ */ jsx32("text", { fg: C.dim, children: "\u2500".repeat(60) }),
    /* @__PURE__ */ jsx32("text", { fg: C.dim, children: " \u2191\u2193 \u9009\u62E9  Enter \u67E5\u770B\u8BE6\u60C5  Esc \u8FD4\u56DE" })
  ] });
}

// extensions/console/src/components/SessionListView.tsx
import { jsx as jsx33, jsxs as jsxs31 } from "@opentui/react/jsx-runtime";
function SessionListView({ sessions, selectedIndex }) {
  return /* @__PURE__ */ jsxs31("box", { flexDirection: "column", width: "100%", height: "100%", children: [
    /* @__PURE__ */ jsxs31("box", { padding: 1, children: [
      /* @__PURE__ */ jsx33("text", { fg: C.primary, children: "\u5386\u53F2\u5BF9\u8BDD" }),
      /* @__PURE__ */ jsx33("text", { fg: C.dim, children: "  \u2191\u2193 \u9009\u62E9  Enter \u52A0\u8F7D  Esc \u8FD4\u56DE" })
    ] }),
    /* @__PURE__ */ jsxs31("scrollbox", { flexGrow: 1, children: [
      sessions.length === 0 && /* @__PURE__ */ jsx33("text", { fg: C.dim, paddingLeft: 2, children: "\u6682\u65E0\u5386\u53F2\u5BF9\u8BDD" }),
      sessions.map((meta, index) => {
        const isSelected = index === selectedIndex;
        const time = new Date(meta.updatedAt ?? 0).toLocaleString("zh-CN");
        return /* @__PURE__ */ jsx33("box", { paddingLeft: 1, children: /* @__PURE__ */ jsxs31("text", { children: [
          /* @__PURE__ */ jsx33("span", { fg: isSelected ? C.accent : C.dim, children: isSelected ? "\u276F " : "  " }),
          isSelected ? /* @__PURE__ */ jsx33("strong", { children: /* @__PURE__ */ jsx33("span", { fg: C.text, children: meta.title }) }) : /* @__PURE__ */ jsx33("span", { fg: C.textSec, children: meta.title }),
          /* @__PURE__ */ jsxs31("span", { fg: C.dim, children: [
            "  ",
            meta.cwd,
            "  ",
            time
          ] })
        ] }) }, meta.id);
      })
    ] })
  ] });
}

// extensions/console/src/components/SettingsView.tsx
import { useCallback as useCallback4, useEffect as useEffect7, useMemo as useMemo4, useState as useState8 } from "react";
import { useKeyboard as useKeyboard3, useTerminalDimensions as useTerminalDimensions3 } from "@opentui/react";

// extensions/console/src/diff-approval.ts
var CONSOLE_DIFF_APPROVAL_VIEW_TOOLS = /* @__PURE__ */ new Set([
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
      return "\u7A7A\u683C\u5207\u6362\u3002\u4EC5\u5728 replace \u6A21\u5F0F\u9700\u8981\u624B\u52A8\u786E\u8BA4\u65F6\u751F\u6548\u3002";
    case "insert_code":
      return "\u7A7A\u683C\u5207\u6362\u3002insert_code \u9700\u8981\u624B\u52A8\u786E\u8BA4\u65F6\uFF0C\u6253\u5F00 diff \u5BA1\u6279\u9875\u3002";
    case "delete_code":
      return "\u7A7A\u683C\u5207\u6362\u3002delete_code \u9700\u8981\u624B\u52A8\u786E\u8BA4\u65F6\uFF0C\u6253\u5F00 diff \u5BA1\u6279\u9875\u3002";
    case "write_file":
      return "\u7A7A\u683C\u5207\u6362\u3002write_file \u9700\u8981\u624B\u52A8\u786E\u8BA4\u65F6\uFF0C\u6253\u5F00 diff \u5BA1\u6279\u9875\u3002";
    case "apply_diff":
      return "\u7A7A\u683C\u5207\u6362\u3002apply_diff \u9700\u8981\u624B\u52A8\u786E\u8BA4\u65F6\uFF0C\u6253\u5F00 diff \u5BA1\u6279\u9875\u3002";
    default:
      return "\u7A7A\u683C\u5207\u6362\u3002\u9700\u8981\u624B\u52A8\u786E\u8BA4\u65F6\uFF0C\u6253\u5F00 diff \u5BA1\u6279\u9875\u3002";
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
  if (value === "sse" || value === "streamable-http") return value;
  if (value === "http") return "streamable-http";
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
    timeout: 3e4,
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
  if (!Number.isFinite(snapshot.system.maxToolRounds) || snapshot.system.maxToolRounds < 1 || snapshot.system.maxToolRounds > 2e3) {
    return "\u5DE5\u5177\u6700\u5927\u8F6E\u6B21\u5FC5\u987B\u5728 1 \u5230 2000 \u4E4B\u95F4";
  }
  if (!Number.isFinite(snapshot.system.maxRetries) || snapshot.system.maxRetries < 0 || snapshot.system.maxRetries > 20) {
    return "\u6700\u5927\u91CD\u8BD5\u6B21\u6570\u5FC5\u987B\u5728 0 \u5230 20 \u4E4B\u95F4";
  }
  if (!Number.isFinite(snapshot.system.maxAgentDepth) || snapshot.system.maxAgentDepth < 1 || snapshot.system.maxAgentDepth > 20) {
    return "\u6700\u5927\u4EE3\u7406\u6DF1\u5EA6\u5FC5\u987B\u5728 1 \u5230 20 \u4E4B\u95F4";
  }
  if (!Array.isArray(snapshot.models) || snapshot.models.length === 0) {
    return "\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u6A21\u578B";
  }
  const modelNames = /* @__PURE__ */ new Set();
  for (const model of snapshot.models) {
    const modelName = model.modelName.trim();
    if (!modelName) {
      return "\u6A21\u578B\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A";
    }
    if (modelNames.has(modelName)) {
      return `\u6A21\u578B\u540D\u79F0 "${modelName}" \u91CD\u590D`;
    }
    if (!model.modelId.trim()) {
      return `\u6A21\u578B "${modelName}" \u7F3A\u5C11\u6A21\u578B ID`;
    }
    modelNames.add(modelName);
  }
  if (!snapshot.defaultModelName.trim()) {
    return "\u9ED8\u8BA4\u6A21\u578B\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A";
  }
  if (!modelNames.has(snapshot.defaultModelName.trim())) {
    return `\u9ED8\u8BA4\u6A21\u578B "${snapshot.defaultModelName}" \u4E0D\u5B58\u5728`;
  }
  const names = /* @__PURE__ */ new Set();
  for (const server of snapshot.mcpServers) {
    const trimmedName = server.name.trim();
    const safeName = sanitizeServerName(trimmedName);
    if (!trimmedName) {
      return "MCP \u670D\u52A1\u5668\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A";
    }
    if (safeName !== trimmedName) {
      return `MCP \u670D\u52A1\u5668\u540D\u79F0 "${trimmedName}" \u4EC5\u652F\u6301\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u4E0B\u5212\u7EBF`;
    }
    if (names.has(trimmedName)) {
      return `MCP \u670D\u52A1\u5668\u540D\u79F0 "${trimmedName}" \u91CD\u590D`;
    }
    names.add(trimmedName);
    if (!Number.isFinite(server.timeout) || server.timeout < 1e3 || server.timeout > 12e4) {
      return `MCP \u670D\u52A1\u5668 "${trimmedName}" \u7684\u8D85\u65F6\u5FC5\u987B\u5728 1000 \u5230 120000 \u6BEB\u79D2\u4E4B\u95F4`;
    }
    if (server.transport === "stdio" && !server.command.trim()) {
      return `MCP \u670D\u52A1\u5668 "${trimmedName}" \u7F3A\u5C11 command`;
    }
    if (server.transport !== "stdio" && !server.url.trim()) {
      return `MCP \u670D\u52A1\u5668 "${trimmedName}" \u7F3A\u5C11 url`;
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
    if (!modelName) continue;
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
    if (!name) continue;
    if (server.originalName && server.originalName !== name) {
      servers[server.originalName] = null;
    }
    const entry = {
      transport: server.transport,
      enabled: server.enabled,
      timeout: server.timeout || 3e4
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
var ConsoleSettingsController = class {
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
    const allToolNames = Array.from(/* @__PURE__ */ new Set([...registeredToolNames, ...configuredToolNames])).sort((a, b) => a.localeCompare(b, "zh-CN"));
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
        args: Array.isArray(cfg?.args) ? cfg.args.map((arg) => String(arg)).join("\n") : "",
        cwd: cfg?.cwd ? String(cfg.cwd) : "",
        url: cfg?.url ? String(cfg.url) : "",
        authHeader: cfg?.headers?.Authorization ? String(cfg.headers.Authorization) : "",
        timeout: typeof cfg?.timeout === "number" ? cfg.timeout : 3e4,
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
          if (typeof tool.showApprovalView === "boolean") entry.showApprovalView = tool.showApprovalView;
          if (tool.allowPatterns?.length) entry.allowPatterns = tool.allowPatterns;
          if (tool.denyPatterns?.length) entry.denyPatterns = tool.denyPatterns;
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
    let message = "\u5DF2\u4FDD\u5B58\u5E76\u751F\u6548";
    try {
      const result = await this.configManager?.applyRuntimeConfigReload(mergedRaw);
      if (result && !result.success) {
        restartRequired = true;
        message = `\u5DF2\u4FDD\u5B58\uFF0C\u9700\u8981\u91CD\u542F\u751F\u6548\uFF1A${result.error ?? "\u672A\u77E5\u9519\u8BEF"}`;
      }
    } catch (err) {
      restartRequired = true;
      const detail = err instanceof Error ? err.message : String(err);
      message = `\u5DF2\u4FDD\u5B58\uFF0C\u9700\u8981\u91CD\u542F\u751F\u6548\uFF1A${detail}`;
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
        message: `\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u5237\u65B0\u8BBE\u7F6E\u89C6\u56FE\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
};

// extensions/console/src/components/SettingsView.tsx
import { jsx as jsx34, jsxs as jsxs32 } from "@opentui/react/jsx-runtime";
function getToolPolicyMode(configured2, autoApprove) {
  if (!configured2) return "disabled";
  return autoApprove ? "auto" : "manual";
}
function formatToolPolicyMode(mode) {
  if (mode === "auto") return "\u81EA\u52A8\u6267\u884C";
  if (mode === "manual") return "\u624B\u52A8\u786E\u8BA4";
  return "\u4E0D\u5141\u8BB8";
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
  return value ? "\u5F00\u542F" : "\u5173\u95ED";
}
function transportLabel(value) {
  if (value === "stdio") return "stdio\uFF08\u672C\u5730\u8FDB\u7A0B\uFF09";
  if (value === "sse") return "sse\uFF08\u8FDC\u7A0B\u4E8B\u4EF6\u6D41\uFF09";
  return "streamable-http\uFF08\u8FDC\u7A0B HTTP\uFF09";
}
function previewText(value, maxLength) {
  if (!value) return "(\u7A7A)";
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n").filter(Boolean);
  const firstLine2 = lines[0] ?? "";
  const compact = firstLine2.length > maxLength ? `${firstLine2.slice(0, Math.max(1, maxLength - 1))}\u2026` : firstLine2;
  if (lines.length <= 1) {
    return compact || "(\u7A7A)";
  }
  return `${lines.length} \u884C \xB7 ${compact}`;
}
function getEditableFingerprint(snapshot) {
  if (!snapshot) return "";
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
  return value.replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
}
function restoreMultilineFromInput(value) {
  return value.replace(/\\n/g, "\n");
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
  const statusMap = /* @__PURE__ */ new Map();
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
    label: "\u6A21\u578B\u4E0E\u7CFB\u7EDF",
    description: "\u7BA1\u7406 LLM \u6A21\u578B\u6C60\u3001\u9ED8\u8BA4\u6A21\u578B\u3001\u7CFB\u7EDF\u63D0\u793A\u8BCD\u3001\u5DE5\u5177\u8F6E\u6B21\u4E0E\u6D41\u5F0F\u8F93\u51FA\u3002"
  });
  rows.push({
    id: "model.add",
    kind: "action",
    section: "general",
    label: "\u65B0\u589E\u6A21\u578B",
    value: "Enter / A",
    target: { kind: "action", action: "addModel" },
    description: "\u521B\u5EFA\u65B0\u7684\u6A21\u578B\u8349\u7A3F\u3002",
    indent: 2
  });
  snapshot.models.forEach((model, index) => {
    const displayName = model.modelName || `model_${index + 1}`;
    rows.push({
      id: `model.${index}.summary`,
      kind: "info",
      section: "general",
      label: `${displayName} \xB7 ${model.provider} \xB7 ${model.modelId || "(\u7A7A\u6A21\u578B ID)"}`,
      indent: 4
    });
    pushField(
      `model.${index}.default`,
      "general",
      "\u8BBE\u4E3A\u9ED8\u8BA4",
      boolText(snapshot.defaultModelName === model.modelName && !!model.modelName),
      { kind: "modelDefault", modelIndex: index },
      "Space \u6216 Enter \u8BBE\u4E3A\u9ED8\u8BA4\u6A21\u578B\u3002",
      6
    );
    pushField(
      `model.${index}.provider`,
      "general",
      "Provider",
      model.provider,
      { kind: "modelProvider", modelIndex: index },
      "\u5DE6\u53F3\u65B9\u5411\u952E\u5207\u6362 Provider\u3002",
      6
    );
    pushField(`model.${index}.modelName`, "general", "\u540D\u79F0", model.modelName || "(\u7A7A)", { kind: "modelField", modelIndex: index, field: "modelName" }, "\u56DE\u8F66\u7F16\u8F91\u3002", 6);
    pushField(`model.${index}.modelId`, "general", "\u6A21\u578B ID", model.modelId || "(\u7A7A)", { kind: "modelField", modelIndex: index, field: "modelId" }, "\u56DE\u8F66\u7F16\u8F91\u3002", 6);
    pushField(`model.${index}.apiKey`, "general", "API Key", model.apiKey || "\u672A\u914D\u7F6E", { kind: "modelField", modelIndex: index, field: "apiKey" }, void 0, 6);
    pushField(`model.${index}.baseUrl`, "general", "Base URL", model.baseUrl || "(\u7A7A)", { kind: "modelField", modelIndex: index, field: "baseUrl" }, "\u56DE\u8F66\u7F16\u8F91\u3002", 6);
  });
  pushField("system.systemPrompt", "general", "System / Prompt", previewText(snapshot.system.systemPrompt, maxPreview), { kind: "systemField", field: "systemPrompt" }, "\u56DE\u8F66\u7F16\u8F91\uFF1B\\n \u8868\u793A\u6362\u884C\u3002");
  pushField("system.maxToolRounds", "general", "System / Max Tool Rounds", String(snapshot.system.maxToolRounds), { kind: "systemField", field: "maxToolRounds" });
  pushField("system.stream", "general", "System / Stream Output", boolText(snapshot.system.stream), { kind: "systemField", field: "stream" }, "\u7A7A\u683C\u5207\u6362\u3002");
  pushField("system.retryOnError", "general", "System / \u62A5\u9519\u81EA\u52A8\u91CD\u8BD5", boolText(snapshot.system.retryOnError), { kind: "systemField", field: "retryOnError" }, "LLM \u8C03\u7528\u5931\u8D25\u65F6\u81EA\u52A8\u91CD\u8BD5\uFF0C\u7A7A\u683C\u5207\u6362\u3002");
  pushField("system.maxRetries", "general", "System / \u6700\u5927\u91CD\u8BD5\u6B21\u6570", String(snapshot.system.maxRetries), { kind: "systemField", field: "maxRetries" }, "\u62A5\u9519\u91CD\u8BD5\u7684\u6700\u5927\u6B21\u6570\uFF080-20\uFF09\uFF0C\u56DE\u8F66\u7F16\u8F91\u3002");
  pushField("system.logRequests", "general", "System / \u8BB0\u5F55\u8BF7\u6C42\u65E5\u5FD7", boolText(snapshot.system.logRequests), { kind: "systemField", field: "logRequests" }, "\u5C06 LLM \u8BF7\u6C42/\u54CD\u5E94\u8BB0\u5F55\u5230\u65E5\u5FD7\u6587\u4EF6\uFF0C\u7A7A\u683C\u5207\u6362\u3002");
  pushField("system.maxAgentDepth", "general", "System / \u6700\u5927\u4EE3\u7406\u6DF1\u5EA6", String(snapshot.system.maxAgentDepth), { kind: "systemField", field: "maxAgentDepth" }, "\u5B50\u4EE3\u7406\u6700\u5927\u5D4C\u5957\u6DF1\u5EA6\uFF081-20\uFF09\uFF0C\u56DE\u8F66\u7F16\u8F91\u3002");
  pushField("system.defaultMode", "general", "System / \u9ED8\u8BA4\u6A21\u5F0F", snapshot.system.defaultMode || "(\u672A\u8BBE\u7F6E)", { kind: "systemField", field: "defaultMode" }, "\u542F\u52A8\u65F6\u9ED8\u8BA4\u4F7F\u7528\u7684\u6A21\u5F0F\uFF08\u5982 code\uFF09\uFF0C\u56DE\u8F66\u7F16\u8F91\u3002");
  pushField("system.asyncSubAgents", "general", "System / \u5F02\u6B65\u5B50\u4EE3\u7406", boolText(snapshot.system.asyncSubAgents), { kind: "systemField", field: "asyncSubAgents" }, "\u542F\u7528\u540E\u5B50\u4EE3\u7406\u53EF\u5728\u540E\u53F0\u5F02\u6B65\u6267\u884C\uFF0C\u4E3B\u5BF9\u8BDD\u4E0D\u963B\u585E\u3002\u9700\u5728 sub_agents.yaml \u4E2D\u5B9A\u4E49\u5B50\u4EE3\u7406\u7C7B\u578B\u3002\u7A7A\u683C\u5207\u6362\u3002");
  rows.push({ id: "section.tools", kind: "section", section: "tools", label: `\u5DE5\u5177\u6267\u884C\u7B56\u7565\uFF08${snapshot.toolPolicies.length}\uFF09` });
  pushField("tools.autoApproveAll", "tools", "\u5168\u90E8\u81EA\u52A8\u6279\u51C6", boolText(snapshot.autoApproveAll), { kind: "toolGlobalToggle", field: "autoApproveAll" }, "\u8DF3\u8FC7\u6240\u6709\u5BA1\u6279\uFF08\u4E00\u7C7B\u786E\u8BA4 + \u4E8C\u7C7B diff \u9884\u89C8\uFF09\uFF0C\u6700\u9AD8\u4F18\u5148\u7EA7\u3002\u7A7A\u683C\u5207\u6362\u3002");
  pushField("tools.autoApproveConfirmation", "tools", "\u8DF3\u8FC7\u786E\u8BA4\u5BA1\u6279", boolText(snapshot.autoApproveConfirmation), { kind: "toolGlobalToggle", field: "autoApproveConfirmation" }, "\u4EC5\u8DF3\u8FC7\u4E00\u7C7B\u5BA1\u6279\uFF08Y/N \u786E\u8BA4\uFF09\uFF0C\u4E8C\u7C7B\u5BA1\u6279\uFF08diff \u9884\u89C8\uFF09\u4ECD\u751F\u6548\u3002\u7A7A\u683C\u5207\u6362\u3002");
  pushField("tools.autoApproveDiff", "tools", "\u8DF3\u8FC7 Diff \u5BA1\u6279", boolText(snapshot.autoApproveDiff), { kind: "toolGlobalToggle", field: "autoApproveDiff" }, "\u4EC5\u8DF3\u8FC7\u4E8C\u7C7B\u5BA1\u6279\uFF08diff \u9884\u89C8\uFF09\uFF0C\u4E00\u7C7B\u5BA1\u6279\uFF08Y/N \u786E\u8BA4\uFF09\u4ECD\u751F\u6548\u3002\u7A7A\u683C\u5207\u6362\u3002");
  snapshot.toolPolicies.forEach((tool, index) => {
    const mode = getToolPolicyMode(tool.configured, tool.autoApprove);
    rows.push({
      id: `tool.${tool.name}`,
      kind: "field",
      section: "tools",
      label: `Tool / ${tool.name}${tool.registered ? "" : "\uFF08\u5F53\u524D\u672A\u6CE8\u518C\uFF09"}`,
      value: formatToolPolicyMode(mode),
      target: { kind: "toolPolicy", toolIndex: index },
      description: "\u7A7A\u683C\u6216\u5DE6\u53F3\u65B9\u5411\u952E\u5207\u6362\u3002",
      indent: 2
    });
    if (supportsConsoleDiffApprovalViewSetting(tool.name)) {
      pushField(
        `tool.${tool.name}.approvalView`,
        "tools",
        "\u5BA1\u6279\u89C6\u56FE",
        boolText(tool.showApprovalView !== false),
        { kind: "toolApprovalView", toolIndex: index },
        getConsoleDiffApprovalViewDescription(tool.name),
        6
      );
    }
  });
  rows.push({ id: "section.mcp", kind: "section", section: "mcp", label: `MCP \u670D\u52A1\u5668\uFF08${snapshot.mcpServers.length}\uFF09` });
  rows.push({
    id: "mcp.add",
    kind: "action",
    section: "mcp",
    label: "\u65B0\u589E MCP \u670D\u52A1\u5668",
    value: "Enter / A",
    target: { kind: "action", action: "addMcp" },
    indent: 2
  });
  if (snapshot.mcpServers.length === 0) {
    rows.push({ id: "mcp.empty", kind: "info", section: "mcp", label: "\u6682\u65E0 MCP \u670D\u52A1\u5668\uFF0C\u6309 Enter \u6216 A \u65B0\u5EFA\u3002", indent: 4 });
  }
  snapshot.mcpServers.forEach((server, index) => {
    const status = server.enabled === false ? { name: server.name, status: "disabled", toolCount: 0, error: void 0 } : statusMap.get(server.originalName ?? server.name) ?? statusMap.get(server.name);
    const errorText = status && "error" in status ? status.error : void 0;
    const summary = status ? `${server.name || `server_${index + 1}`} \xB7 ${server.enabled ? "\u542F\u7528" : "\u7981\u7528"} \xB7 ${transportLabel(server.transport)} \xB7 ${status.status}${errorText ? ` \xB7 ${errorText}` : ` \xB7 ${status.toolCount} tools`}` : `${server.name || `server_${index + 1}`} \xB7 ${server.enabled ? "\u672A\u5E94\u7528" : "\u7981\u7528"} \xB7 ${transportLabel(server.transport)}`;
    rows.push({ id: `mcp.${index}.summary`, kind: "info", section: "mcp", label: summary, indent: 4 });
    pushField(`mcp.${index}.name`, "mcp", "\u540D\u79F0", server.name || "(\u7A7A)", { kind: "mcpField", serverIndex: index, field: "name" }, "\u6309 D \u5220\u9664\u3002", 6);
    pushField(`mcp.${index}.enabled`, "mcp", "\u542F\u7528", boolText(server.enabled), { kind: "mcpField", serverIndex: index, field: "enabled" }, "\u7A7A\u683C\u5207\u6362\u3002", 6);
    pushField(`mcp.${index}.transport`, "mcp", "\u4F20\u8F93", transportLabel(server.transport), { kind: "mcpField", serverIndex: index, field: "transport" }, "\u5DE6\u53F3\u65B9\u5411\u952E\u5207\u6362\u3002", 6);
    if (server.transport === "stdio") {
      pushField(`mcp.${index}.command`, "mcp", "\u547D\u4EE4", server.command || "(\u7A7A)", { kind: "mcpField", serverIndex: index, field: "command" }, void 0, 6);
      pushField(`mcp.${index}.cwd`, "mcp", "\u5DE5\u4F5C\u76EE\u5F55", server.cwd || "(\u7A7A)", { kind: "mcpField", serverIndex: index, field: "cwd" }, void 0, 6);
      pushField(`mcp.${index}.args`, "mcp", "\u53C2\u6570", previewText(server.args, maxPreview), { kind: "mcpField", serverIndex: index, field: "args" }, "\\n \u8868\u793A\u591A\u884C\u3002", 6);
    } else {
      pushField(`mcp.${index}.url`, "mcp", "URL", server.url || "(\u7A7A)", { kind: "mcpField", serverIndex: index, field: "url" }, void 0, 6);
      pushField(`mcp.${index}.authHeader`, "mcp", "Authorization", server.authHeader || "(\u7A7A)", { kind: "mcpField", serverIndex: index, field: "authHeader" }, void 0, 6);
    }
    pushField(`mcp.${index}.timeout`, "mcp", "\u8D85\u65F6\uFF08ms\uFF09", String(server.timeout), { kind: "mcpField", serverIndex: index, field: "timeout" }, void 0, 6);
  });
  return rows;
}
var BUILTIN_SECTIONS = [
  { id: "general", label: "\u6A21\u578B\u4E0E\u7CFB\u7EDF", icon: "01" },
  { id: "tools", label: "\u5DE5\u5177\u7B56\u7565", icon: "02" },
  { id: "mcp", label: "MCP \u670D\u52A1", icon: "03" }
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
    if (!draft) return [];
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
            label: `\u2500\u2500 ${field.group} \u2500\u2500`
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
          displayValue = rawValue ? "\u5F00\u542F" : "\u5173\u95ED";
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
  useEffect7(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await onLoad();
        if (cancelled) return;
        const cloned = cloneConsoleSettingsSnapshot(snapshot);
        setDraft(cloned);
        setBaseline(cloneConsoleSettingsSnapshot(snapshot));
        setStatus("\u5DF2\u52A0\u8F7D\u5F53\u524D\u914D\u7F6E", "success");
        setPendingLeaveConfirm(false);
        if (pluginTabs && pluginTabs.length > 0) {
          const entries = await Promise.all(
            pluginTabs.map(async (tab) => {
              try {
                return [tab.id, await tab.onLoad()];
              } catch {
                return [tab.id, {}];
              }
            })
          );
          const data = Object.fromEntries(entries);
          if (!cancelled) {
            setPluginDraft(structuredClone(data));
            setPluginBaseline(structuredClone(data));
          }
        }
      } catch (err) {
        if (cancelled) return;
        setStatus(`\u52A0\u8F7D\u914D\u7F6E\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [onLoad, setStatus, pluginTabs]);
  useEffect7(() => {
    if (rows.length === 0) return;
    if (selectedRowId && rows.some((row) => row.id === selectedRowId && row.target)) return;
    const preferred = rows.find((row) => row.section === initialSection && row.target) ?? rows.find((row) => row.target);
    if (preferred) setSelectedRowId(preferred.id);
  }, [rows, selectedRowId, initialSection]);
  const updateDraft = useCallback4((updater) => {
    setDraft((prev) => {
      if (!prev) return prev;
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
      setStatus("\u5DF2\u4ECE\u78C1\u76D8\u91CD\u65B0\u52A0\u8F7D\u914D\u7F6E", "success");
      setPendingLeaveConfirm(false);
    } catch (err) {
      setStatus(`\u91CD\u65B0\u52A0\u8F7D\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}`, "error");
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
    setStatus("\u5DF2\u65B0\u589E\u6A21\u578B\u8349\u7A3F\uFF0C\u8BF7\u5148\u586B\u5199\u540D\u79F0\u540E\u4FDD\u5B58", "info");
  }, [setStatus, updateDraft]);
  const handleAddMcpServer = useCallback4(() => {
    let nextIndex = 0;
    updateDraft((snapshot) => {
      nextIndex = snapshot.mcpServers.length;
      snapshot.mcpServers.push(createDefaultMCPServerEntry());
    });
    setSelectedRowId(`mcp.${nextIndex}.name`);
    setStatus("\u5DF2\u65B0\u589E MCP \u670D\u52A1\u5668\u8349\u7A3F\uFF0C\u8BF7\u5148\u586B\u5199\u540D\u79F0\u540E\u4FDD\u5B58", "info");
  }, [setStatus, updateDraft]);
  const startEdit = useCallback4((target) => {
    if (!draft) return;
    if (target.kind === "modelField") {
      const model = draft.models[target.modelIndex];
      if (!model) return;
      const value2 = model[target.field];
      setEditor({ target, label: `${model.modelName || `model_${target.modelIndex + 1}`}.${target.field}`, value: value2 });
      setEditorValue(String(value2 ?? ""));
      return;
    }
    if (target.kind === "systemField") {
      const rawValue2 = target.field === "maxToolRounds" ? String(draft.system.maxToolRounds) : target.field === "maxRetries" ? String(draft.system.maxRetries) : target.field === "maxAgentDepth" ? String(draft.system.maxAgentDepth) : target.field === "defaultMode" ? draft.system.defaultMode ?? "" : target.field === "stream" ? String(draft.system.stream) : draft.system.systemPrompt;
      const value2 = target.field === "systemPrompt" ? escapeMultilineForInput(rawValue2) : rawValue2;
      setEditor({ target, label: `system.${target.field}`, value: value2, hint: target.field === "systemPrompt" ? "\\n \u8868\u793A\u6362\u884C" : void 0 });
      setEditorValue(value2);
      return;
    }
    const server = draft.mcpServers[target.serverIndex];
    if (!server) return;
    const rawValue = String(server[target.field] ?? "");
    const value = target.field === "args" ? escapeMultilineForInput(rawValue) : rawValue;
    setEditor({ target, label: `mcp.${server.name || `server_${target.serverIndex + 1}`}.${target.field}`, value, hint: target.field === "args" ? "\\n \u8868\u793A\u591A\u884C\u53C2\u6570" : void 0 });
    setEditorValue(value);
  }, [draft]);
  const applyCycle = useCallback4((target, direction) => {
    updateDraft((snapshot) => {
      if (target.kind === "modelProvider") {
        const model = snapshot.models[target.modelIndex];
        if (!model) return;
        const next = cycleValue(CONSOLE_LLM_PROVIDER_OPTIONS, model.provider, direction);
        snapshot.models[target.modelIndex] = applyModelProviderChange(model, next);
        return;
      }
      if (target.kind === "mcpField" && target.field === "transport") {
        const current = snapshot.mcpServers[target.serverIndex]?.transport;
        if (!current) return;
        snapshot.mcpServers[target.serverIndex].transport = cycleValue(CONSOLE_MCP_TRANSPORT_OPTIONS, current, direction);
      }
      if (target.kind === "toolPolicy") {
        const tool = snapshot.toolPolicies[target.toolIndex];
        if (!tool) return;
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
        if (!model || !model.modelName.trim()) return;
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
        if (tool) tool.showApprovalView = tool.showApprovalView === false;
        return;
      }
      if (target.kind === "mcpField" && target.field === "enabled") {
        const server = snapshot.mcpServers[target.serverIndex];
        if (server) server.enabled = !server.enabled;
      }
    });
  }, [updateDraft]);
  const submitEditor = useCallback4(() => {
    if (!editor) return;
    if (editor.target.kind === "pluginField") {
      const { tabId, fieldKey, fieldType } = editor.target;
      let finalValue = editorValue;
      if (fieldType === "number") {
        const parsed = Number(editorValue.trim());
        if (!Number.isFinite(parsed)) {
          setStatus("\u8BF7\u8F93\u5165\u6709\u6548\u6570\u5B57", "error");
          return;
        }
        finalValue = parsed;
      }
      setPluginDraft((prev) => {
        const next = structuredClone(prev);
        (next[tabId] ??= {})[fieldKey] = finalValue;
        return next;
      });
      setStatus("\u5B57\u6BB5\u5DF2\u66F4\u65B0\uFF0C\u6309 S \u4FDD\u5B58\u5E76\u70ED\u91CD\u8F7D", "success");
      setEditor(null);
      setEditorValue("");
      return;
    }
    const value = editor.target.kind === "systemField" && editor.target.field === "systemPrompt" ? restoreMultilineFromInput(editorValue) : editor.target.kind === "mcpField" && editor.target.field === "args" ? restoreMultilineFromInput(editorValue) : editorValue;
    if (editor.target.kind === "systemField" && editor.target.field === "maxToolRounds") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1) {
        setStatus("\u8BF7\u8F93\u5165\u5927\u4E8E\u7B49\u4E8E 1 \u7684\u6709\u6548\u6570\u5B57", "error");
        return;
      }
    }
    if (editor.target.kind === "systemField" && editor.target.field === "maxRetries") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20) {
        setStatus("\u6700\u5927\u91CD\u8BD5\u6B21\u6570\u5FC5\u987B\u5728 0 \u5230 20 \u4E4B\u95F4", "error");
        return;
      }
    }
    if (editor.target.kind === "systemField" && editor.target.field === "maxAgentDepth") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
        setStatus("\u6700\u5927\u4EE3\u7406\u6DF1\u5EA6\u5FC5\u987B\u5728 1 \u5230 20 \u4E4B\u95F4", "error");
        return;
      }
    }
    if (editor.target.kind === "mcpField" && editor.target.field === "timeout") {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1e3) {
        setStatus("MCP \u8D85\u65F6\u5FC5\u987B\u662F\u5927\u4E8E\u7B49\u4E8E 1000 \u7684\u6570\u5B57", "error");
        return;
      }
    }
    updateDraft((snapshot) => {
      if (editor.target.kind === "modelField") {
        const model = snapshot.models[editor.target.modelIndex];
        if (!model) return;
        if (editor.target.field === "modelName") {
          const previousName = model.modelName;
          model.modelName = value.trim();
          if (snapshot.defaultModelName === previousName) snapshot.defaultModelName = model.modelName;
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
        if (editor.target.field === "systemPrompt") snapshot.system.systemPrompt = value;
        else if (editor.target.field === "maxToolRounds") snapshot.system.maxToolRounds = Number(value.trim());
        else if (editor.target.field === "maxRetries") snapshot.system.maxRetries = Number(value.trim());
        else if (editor.target.field === "maxAgentDepth") snapshot.system.maxAgentDepth = Number(value.trim());
        else if (editor.target.field === "defaultMode") snapshot.system.defaultMode = value.trim();
        return;
      }
      if (editor.target.kind !== "mcpField") return;
      const mcpTarget = editor.target;
      const server = snapshot.mcpServers[mcpTarget.serverIndex];
      if (!server) return;
      const field = mcpTarget.field;
      if (field === "name") server.name = value.replace(/[^a-zA-Z0-9_]/g, "_");
      else if (field === "timeout") server.timeout = Number(value.trim());
      else if (field === "command") server.command = value;
      else if (field === "args") server.args = value;
      else if (field === "cwd") server.cwd = value;
      else if (field === "url") server.url = value;
      else if (field === "authHeader") server.authHeader = value;
      else server.transport = value;
    });
    setStatus("\u5B57\u6BB5\u5DF2\u66F4\u65B0\uFF0C\u6309 S \u4FDD\u5B58\u5E76\u70ED\u91CD\u8F7D", "success");
    setEditor(null);
    setEditorValue("");
  }, [editor, editorValue, setStatus, updateDraft]);
  const handleSave = useCallback4(async () => {
    if (!draft || saving) return;
    setSaving(true);
    setStatus("\u6B63\u5728\u4FDD\u5B58\u5E76\u5C1D\u8BD5\u70ED\u91CD\u8F7D...", "info");
    try {
      const result = await onSave(draft);
      if (!result.ok) {
        setStatus(`\u4FDD\u5B58\u5931\u8D25\uFF1A${result.message}`, "error");
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
            if (!r.success) pluginErrors.push(`${tab.label}: ${r.error ?? "\u672A\u77E5\u9519\u8BEF"}`);
          } catch (e) {
            pluginErrors.push(`${tab.label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (pluginErrors.length > 0) {
          setStatus(`\u90E8\u5206\u63D2\u4EF6\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF1A${pluginErrors.join("; ")}`, "warning");
        } else {
          setPluginBaseline(structuredClone(pluginDraft));
        }
      }
    } catch (err) {
      setStatus(`\u4FDD\u5B58\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, saving, setStatus, pluginTabs, pluginDraft]);
  const handleDeleteCurrentModel = useCallback4(() => {
    if (!selectedRow?.target || !draft) {
      setStatus("\u8BF7\u5148\u9009\u4E2D\u67D0\u4E2A\u6A21\u578B\u5B57\u6BB5\u540E\u518D\u5220\u9664", "warning");
      return;
    }
    if (selectedRow.target.kind !== "modelField" && selectedRow.target.kind !== "modelProvider" && selectedRow.target.kind !== "modelDefault") {
      setStatus("\u8BF7\u5148\u9009\u4E2D\u67D0\u4E2A\u6A21\u578B\u5B57\u6BB5\u540E\u518D\u5220\u9664", "warning");
      return;
    }
    if (draft.models.length <= 1) {
      setStatus("\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u6A21\u578B", "warning");
      return;
    }
    const index = selectedRow.target.modelIndex;
    const model = draft.models[index];
    if (!model) return;
    updateDraft((snapshot) => {
      snapshot.models.splice(index, 1);
      if (snapshot.defaultModelName === model.modelName) snapshot.defaultModelName = snapshot.models[0]?.modelName ?? "";
    });
    setStatus(`\u5DF2\u5220\u9664\u6A21\u578B\u8349\u7A3F\uFF1A${model.modelName || `model_${index + 1}`}\uFF08\u672A\u4FDD\u5B58\uFF09`, "warning");
  }, [draft, selectedRow, setStatus, updateDraft]);
  const handleDeleteCurrentServer = useCallback4(() => {
    if (!selectedRow?.target || selectedRow.target.kind !== "mcpField" || !draft) {
      setStatus("\u8BF7\u5148\u9009\u4E2D\u67D0\u4E2A MCP \u670D\u52A1\u5668\u5B57\u6BB5\u540E\u518D\u5220\u9664", "warning");
      return;
    }
    const index = selectedRow.target.serverIndex;
    const server = draft.mcpServers[index];
    if (!server) return;
    updateDraft((snapshot) => {
      snapshot.mcpServers.splice(index, 1);
    });
    setStatus(`\u5DF2\u5220\u9664 MCP \u8349\u7A3F\uFF1A${server.name || `server_${index + 1}`}\uFF08\u672A\u4FDD\u5B58\uFF09`, "warning");
  }, [draft, selectedRow, setStatus, updateDraft]);
  useKeyboard3((key) => {
    if (editor) {
      if (key.name === "escape") {
        setEditor(null);
        setEditorValue("");
        setStatus("\u5DF2\u53D6\u6D88\u7F16\u8F91", "warning");
        key.preventDefault();
      }
      if (key.name === "enter" || key.name === "return") {
        submitEditor();
        key.preventDefault();
      }
      return;
    }
    if (loading || saving) {
      if (key.name === "escape") onBack();
      return;
    }
    const currentIndex = selectedSelectableIndex >= 0 ? selectedSelectableIndex : 0;
    if (key.name === "up") {
      const prev = selectableRows[Math.max(0, currentIndex - 1)];
      if (prev) setSelectedRowId(prev.id);
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === "down") {
      const next = selectableRows[Math.min(selectableRows.length - 1, currentIndex + 1)];
      if (next) setSelectedRowId(next.id);
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
        setStatus("\u5F53\u524D\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\uFF0C\u518D\u6309\u4E00\u6B21 Esc \u5C06\u76F4\u63A5\u8FD4\u56DE", "warning");
        return;
      }
      onBack();
      return;
    }
    if (key.name === "s") {
      void handleSave();
      return;
    }
    const numKey = parseInt(key.name ?? "", 10);
    if (numKey >= 1 && numKey <= sections.length) {
      const targetSection = sections[numKey - 1];
      if (targetSection) {
        const firstInSection = selectableRows.find((r) => r.section === targetSection.id);
        if (firstInSection) setSelectedRowId(firstInSection.id);
      }
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === "r") {
      void reloadSnapshot();
      return;
    }
    if (key.name === "a") {
      if (selectedRow?.section === "mcp") handleAddMcpServer();
      else handleAddModel();
      return;
    }
    if (key.name === "d") {
      if (selectedRow?.target?.kind === "mcpField") handleDeleteCurrentServer();
      else handleDeleteCurrentModel();
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
        if (selectedRow.target.action === "addMcp") handleAddMcpServer();
        else handleAddModel();
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
    return /* @__PURE__ */ jsx34("box", { width: "100%", height: "100%", justifyContent: "center", alignItems: "center", children: /* @__PURE__ */ jsx34("text", { fg: "#888", children: "\u6B63\u5728\u52A0\u8F7D\u914D\u7F6E..." }) });
  }
  return /* @__PURE__ */ jsxs32("box", { flexDirection: "column", width: "100%", height: "100%", children: [
    /* @__PURE__ */ jsxs32("box", { flexDirection: "row", flexGrow: 1, children: [
      /* @__PURE__ */ jsxs32("box", { width: 24, flexDirection: "column", paddingTop: 1, paddingLeft: 2, paddingRight: 1, children: [
        /* @__PURE__ */ jsx34("text", { fg: C.primary, children: /* @__PURE__ */ jsx34("strong", { children: "IRIS" }) }),
        /* @__PURE__ */ jsx34("box", { marginTop: 1, flexDirection: "column", children: sections.map((sec) => /* @__PURE__ */ jsxs32("text", { fg: currentSection === sec.id ? C.accent : "#555", children: [
          currentSection === sec.id ? "\u25CF" : "\u25CB",
          " ",
          sec.icon,
          " ",
          sec.label
        ] }, sec.id)) })
      ] }),
      /* @__PURE__ */ jsxs32("box", { flexGrow: 1, flexDirection: "column", paddingTop: 1, paddingLeft: 2, children: [
        /* @__PURE__ */ jsx34("box", { alignItems: "center", paddingBottom: 1, flexShrink: 0, children: /* @__PURE__ */ jsx34("ascii-font", { text: "IRIS", font: "block", color: C.primary }) }),
        /* @__PURE__ */ jsxs32("box", { flexDirection: "column", marginBottom: 1, flexShrink: 0, children: [
          /* @__PURE__ */ jsx34("text", { fg: "#888", children: "\u5728\u7EC8\u7AEF\u5185\u7BA1\u7406\u6A21\u578B\u6C60\u3001\u7CFB\u7EDF\u53C2\u6570\u3001\u5DE5\u5177\u7B56\u7565\u4E0E MCP \u670D\u52A1\u5668\u3002" }),
          /* @__PURE__ */ jsxs32("text", { fg: isDirty ? C.warn : C.accent, children: [
            isDirty ? "\u25CF \u6709\u672A\u4FDD\u5B58\u4FEE\u6539" : "\u2713 \u5F53\u524D\u8349\u7A3F\u5DF2\u540C\u6B65",
            saving ? "  \xB7  \u4FDD\u5B58\u4E2D..." : ""
          ] })
        ] }),
        /* @__PURE__ */ jsxs32("scrollbox", { flexGrow: 1, children: [
          windowStart > 0 && /* @__PURE__ */ jsx34("text", { fg: "#888", children: "\u2026" }),
          visibleRows.map((row) => {
            const isSelected = row.id === selectedRowId && !!row.target;
            const prefix = row.kind === "action" ? isSelected ? "\u276F" : "\u2022" : row.kind === "field" ? isSelected ? "\u276F" : " " : " ";
            return /* @__PURE__ */ jsx34("box", { paddingLeft: row.indent ?? 0, children: /* @__PURE__ */ jsxs32("text", { children: [
              /* @__PURE__ */ jsx34("span", { fg: isSelected ? "#00ffff" : C.dim, children: prefix }),
              /* @__PURE__ */ jsx34("span", { children: " " }),
              isSelected && row.kind !== "info" ? /* @__PURE__ */ jsx34("span", { fg: C.accent, children: /* @__PURE__ */ jsx34("strong", { children: row.label }) }) : /* @__PURE__ */ jsx34("span", { fg: isSelected ? "#00ffff" : void 0, children: row.label }),
              row.value != null && /* @__PURE__ */ jsx34("span", { fg: isSelected ? "#00ffff" : C.dim, children: `  ${row.value}` })
            ] }) }, row.id);
          }),
          windowEnd < sectionRows.length && /* @__PURE__ */ jsx34("text", { fg: "#888", children: "\u2026" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs32("box", { flexDirection: "column", marginTop: 1, paddingX: 2, children: [
      /* @__PURE__ */ jsx34("text", { fg: C.dim, children: "\u2500".repeat(Math.max(3, termWidth - 4)) }),
      /* @__PURE__ */ jsxs32("box", { flexDirection: "column", minHeight: 4, children: [
        selectedRow?.description && !editor && /* @__PURE__ */ jsx34("text", { fg: "#888", children: selectedRow.description }),
        statusText && /* @__PURE__ */ jsx34("text", { fg: getStatusColor(statusKind), children: statusText }),
        editor ? /* @__PURE__ */ jsxs32("box", { flexDirection: "column", children: [
          /* @__PURE__ */ jsx34("text", { fg: C.accent, children: /* @__PURE__ */ jsxs32("strong", { children: [
            "\u7F16\u8F91\uFF1A",
            editor.label
          ] }) }),
          editor.hint && /* @__PURE__ */ jsx34("text", { fg: "#888", children: editor.hint }),
          /* @__PURE__ */ jsxs32("box", { children: [
            /* @__PURE__ */ jsx34("text", { fg: C.accent, children: "\u276F " }),
            /* @__PURE__ */ jsx34("input", { value: editorValue, onInput: setEditorValue, focused: true })
          ] }),
          /* @__PURE__ */ jsx34("text", { fg: "#888", children: "Enter \u4FDD\u5B58 \xB7 Esc \u53D6\u6D88" })
        ] }) : /* @__PURE__ */ jsx34("text", { fg: "#888", children: `\u2191\u2193 \u9009\u62E9  \u2190\u2192 \u5207\u6362  1~${sections.length} \u5206\u680F  Space \u5E03\u5C14  Enter \u7F16\u8F91  A \u65B0\u589E  D \u5220\u9664  S \u4FDD\u5B58  R \u91CD\u8F7D  Esc \u8FD4\u56DE` })
      ] })
    ] })
  ] });
}

// extensions/console/src/hooks/use-app-handle.ts
import { useCallback as useCallback5, useEffect as useEffect8, useRef as useRef6, useState as useState9 } from "react";

// extensions/console/src/message-utils.ts
var msgIdCounter = 0;
function nextMsgId() {
  return `msg-${++msgIdCounter}`;
}
function appendMergedMessagePart(parts, nextPart) {
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : void 0;
  if (lastPart && lastPart.type === "text" && nextPart.type === "text") {
    lastPart.text += nextPart.text;
    return;
  }
  if (lastPart && lastPart.type === "thought" && nextPart.type === "thought") {
    lastPart.text += nextPart.text;
    if (nextPart.durationMs != null) lastPart.durationMs = nextPart.durationMs;
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
  if (appendLeftover && cursor < invocations.length) nextParts.push({ type: "tool_use", tools: invocations.slice(cursor) });
  return nextParts;
}
function appendAssistantParts(prev, partsToAppend, meta) {
  const normalizedParts = mergeMessageParts(partsToAppend);
  if (normalizedParts.length === 0) return prev;
  if (prev.length > 0 && prev[prev.length - 1].role === "assistant") {
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
  if (messages.length === 0) return null;
  const removed = messages[messages.length - 1];
  const next = messages.slice(0, -1);
  stack.redoStack.push(removed);
  if (stack.redoStack.length > MAX_STACK_SIZE) {
    stack.redoStack.splice(0, stack.redoStack.length - MAX_STACK_SIZE);
  }
  return { messages: next, removed };
}
function performRedo(messages, stack) {
  if (stack.redoStack.length === 0) return null;
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
  const backgroundTaskTokenMapRef = useRef6(/* @__PURE__ */ new Map());
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
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
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
        if (normalizedParts.length === 0) return;
        if (role === "assistant") {
          setMessages((prev) => appendAssistantParts(prev, normalizedParts, meta));
          return;
        }
        setMessages((prev) => [...prev, { id: nextMsgId(), role, parts: normalizedParts, ...meta }]);
      },
      startStream() {
        if (toolInvocationsRef.current.length > 0) commitTools();
        setIsStreaming(true);
        uncommittedStreamPartsRef.current = [];
        streamPartsRef.current = [];
        setStreamingParts([]);
        const isNotif = notificationContextRef.current.active;
        const notifDesc = notificationContextRef.current.description;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !isNotif) return prev;
          return [...prev, {
            id: nextMsgId(),
            role: "assistant",
            parts: [],
            ...isNotif ? { isNotification: true, notificationDescription: notifDesc } : {}
          }];
        });
      },
      pushStreamParts(parts) {
        for (const part of parts) appendMergedMessagePart(streamPartsRef.current, { ...part });
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
          if (normalizedParts.length === 0 && !meta) return prev;
          const last = prev[prev.length - 1];
          if (normalizedParts.length === 0) {
            if (!last || last.role !== "assistant") return prev;
            const copy2 = [...prev];
            copy2[copy2.length - 1] = { ...last, ...meta, ...notifMeta };
            return copy2;
          }
          if (prev.length === 0) return [{ id: nextMsgId(), role: "assistant", parts: normalizedParts, ...meta, ...notifMeta }];
          if (last.role !== "assistant") return [...prev, { id: nextMsgId(), role: "assistant", parts: normalizedParts, ...meta, ...notifMeta }];
          if (isNotif && !last.isNotification) {
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
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== "assistant") return prev;
          if (last.parts.length === 0) return prev;
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
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.role === "assistant" && last.parts.length === 0) return prev.slice(0, -1);
            return prev;
          });
        }
        setIsGenerating(generating);
        if (!generating) setGeneratingLabelState(void 0);
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
          for (let i = prev.length - 1; i >= 0; i--) {
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
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== "assistant") return prev;
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
        for (const v of backgroundTaskTokenMapRef.current.values()) total += v;
        setBackgroundTaskTokens(total);
      },
      removeBackgroundTaskTokens(taskId) {
        backgroundTaskTokenMapRef.current.delete(taskId);
        let total = 0;
        for (const v of backgroundTaskTokenMapRef.current.values()) total += v;
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
          if (prev.length > 1) return prev;
          return [];
        });
        setToolDetailData(null);
      },
      drainQueue() {
        return drainCallbackRef.current?.() ?? void 0;
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
  onSelectAgent
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
    if (viewMode === "settings") return;
    if (viewMode === "tool-detail") return;
    if (viewMode === "tool-list") {
      if (key.name === "escape") {
        setViewMode("chat");
      } else if (key.name === "up") setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down") setSelectedIndex((prev) => Math.min(toolListItems.length - 1, prev + 1));
      else if (key.name === "return") {
        const selected = toolListItems[selectedIndex];
        if (selected) {
          onOpenToolDetail(selected.id);
        }
      }
      return;
    }
    if (viewMode === "agent-list") {
      if (key.name === "escape") {
        setViewMode("chat");
      } else if (key.name === "up") setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down") setSelectedIndex((prev) => Math.min(agentList.length - 1, prev + 1));
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
          queueEditActions.insert("\n");
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
        appendCommandMessage(setMessages, "\u961F\u5217\u5DF2\u6E05\u7A7A\u3002");
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
        if (confirmChoice === "confirm") pendingConfirm.action();
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
      if (key.name === "up") setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down") setSelectedIndex((prev) => Math.min(sessionList.length - 1, prev + 1));
      else if (key.name === "enter" || key.name === "return") {
        const selected = sessionList[selectedIndex];
        if (selected) {
          clearRedo(undoRedoRef.current);
          onClearRedoStack();
          setMessages([]);
          commitTools();
          setViewMode("chat");
          onLoadSession(selected.id).catch(() => {
          });
        }
      }
      return;
    }
    if (viewMode === "model-list") {
      if (key.name === "up") setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === "down") setSelectedIndex((prev) => Math.min(modelList.length - 1, prev + 1));
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
      appendCommandMessage(
        setMessages,
        "\u5F53\u524D\u53EA\u6709\u4E00\u4E2A Agent\uFF0C\u65E0\u9700\u5207\u6362\u3002"
      );
      return;
    }
    if (text === "/disconnect" || text === "/remote disconnect") {
      if (!isRemote) {
        appendCommandMessage(setMessages, "\u5F53\u524D\u672A\u8FDE\u63A5\u8FDC\u7A0B\u5B9E\u4F8B\u3002");
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
        appendCommandMessage(
          setMessages,
          `\u5F53\u524D\u5DF2\u8FDE\u63A5\u8FDC\u7A0B\u5B9E\u4F8B: ${remoteHost}
\u8F93\u5165 /disconnect \u65AD\u5F00\u8FDE\u63A5\u3002`
        );
        return;
      }
      if (onRemoteConnect) {
        onRemoteConnect();
        return;
      }
      appendCommandMessage(setMessages, "\u8FDC\u7A0B\u8FDE\u63A5\u529F\u80FD\u4E0D\u53EF\u7528\u3002");
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
      void onUndo().then((ok) => {
        if (!ok) return;
        setMessages((prev) => {
          const result = performUndo(prev, undoRedoRef.current);
          if (!result) return prev;
          return result.messages;
        });
      }).catch(() => {
      });
      return;
    }
    if (text === "/redo") {
      void onRedo().then((ok) => {
        if (!ok) return;
        setMessages((prev) => {
          const result = performRedo(prev, undoRedoRef.current);
          if (!result) return prev;
          return result.messages;
        });
      }).catch(() => {
      });
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
        message: "\u786E\u8BA4\u91CD\u7F6E\u6240\u6709\u914D\u7F6E\u4E3A\u9ED8\u8BA4\u503C\uFF1F\u5F53\u524D\u914D\u7F6E\u5C06\u88AB\u8986\u76D6\u3002",
        action: async () => {
          const result = await onResetConfig();
          appendCommandMessage(
            setMessages,
            result.message + (result.success ? "\n\u91CD\u542F\u5E94\u7528\u540E\u751F\u6548\u3002" : "")
          );
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
    if (text === "/queue") {
      if (queueSize === 0) {
        appendCommandMessage(setMessages, "\u961F\u5217\u4E3A\u7A7A\uFF0C\u65E0\u5F85\u53D1\u9001\u6D88\u606F\u3002");
        return;
      }
      setSelectedIndex(0);
      setViewMode("queue-list");
      return;
    }
    if (text === "/queue clear") {
      const count = queueSize;
      queueClear();
      appendCommandMessage(setMessages, count > 0 ? `\u5DF2\u6E05\u7A7A ${count} \u6761\u6392\u961F\u6D88\u606F\u3002` : "\u961F\u5217\u5DF2\u4E3A\u7A7A\u3002");
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
      if (!cmd) return;
      resetRedo(undoRedoRef, onClearRedoStack);
      try {
        const result = onRunCommand(cmd);
        appendCommandMessage(setMessages, result.output || "(\u65E0\u8F93\u51FA)");
      } catch (error) {
        appendCommandMessage(setMessages, `\u6267\u884C\u5931\u8D25: ${error.message}`, { isError: true });
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
    if (exitConfirmTimerRef.current) clearTimeout(exitConfirmTimerRef.current);
    setExitConfirmArmed(true);
    exitConfirmTimerRef.current = setTimeout(() => {
      exitConfirmTimerRef.current = null;
      setExitConfirmArmed(false);
    }, timeoutMs);
  }, [timeoutMs]);
  useEffect10(() => {
    return () => {
      if (exitConfirmTimerRef.current) clearTimeout(exitConfirmTimerRef.current);
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
    if (current.length === 0) return void 0;
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
    if (index < 0) return false;
    const next = [...current];
    next[index] = { ...next[index], text: newText };
    sync(next);
    return true;
  }, [sync]);
  const remove = useCallback9((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0) return false;
    const next = current.filter((m) => m.id !== id);
    sync(next);
    return true;
  }, [sync]);
  const moveUp = useCallback9((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index <= 0) return false;
    const next = [...current];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    sync(next);
    return true;
  }, [sync]);
  const moveDown = useCallback9((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0 || index >= current.length - 1) return false;
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
    if (result.modelId) setCurrentModelId(result.modelId);
    if (result.modelName) setCurrentModelName(result.modelName);
    if ("contextWindow" in result) setCurrentContextWindow(result.contextWindow);
  }, []);
  return {
    currentModelId,
    currentModelName,
    currentContextWindow,
    updateModel
  };
}

// extensions/console/src/App.tsx
import { jsx as jsx35, jsxs as jsxs33 } from "@opentui/react/jsx-runtime";
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
  const [queueEditingId, setQueueEditingId] = useState14(null);
  const [queueEditState, queueEditActions] = useTextInput("");
  const renderer = useRenderer();
  const undoRedoRef = useRef9(createUndoRedoStack());
  const messageQueue = useMessageQueue();
  const drainCallbackRef = useRef9(null);
  drainCallbackRef.current = () => {
    if (viewMode === "queue-list") return void 0;
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
      if (next < 0 || next >= levels.length) return prev;
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
    if (!renderer) return;
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
    onSelectAgent
  });
  const currentApply = appState.isGenerating ? appState.pendingApplies[0] : void 0;
  const hasMessages = appState.messages.length > 0 || appState.isGenerating;
  if (viewMode === "settings") {
    return /* @__PURE__ */ jsx35(
      SettingsView,
      {
        initialSection: settingsInitialSection,
        onBack: () => setViewMode("chat"),
        onLoad: onLoadSettings,
        onSave: onSaveSettings,
        pluginTabs: pluginSettingsTabs
      }
    );
  }
  if (viewMode === "session-list") {
    return /* @__PURE__ */ jsx35(SessionListView, { sessions: sessionList, selectedIndex });
  }
  if (viewMode === "model-list") {
    return /* @__PURE__ */ jsx35(ModelListView, { models: modelList, selectedIndex });
  }
  if (viewMode === "agent-list") {
    return /* @__PURE__ */ jsx35(AgentListView, { agents: agentList, selectedIndex, currentAgentName: agentName });
  }
  if (viewMode === "queue-list") {
    return /* @__PURE__ */ jsx35(
      QueueListView,
      {
        queue: messageQueue.queue,
        selectedIndex,
        editingId: queueEditingId,
        editingValue: queueEditState.value,
        editingCursor: queueEditState.cursor
      }
    );
  }
  if (currentApply) {
    return /* @__PURE__ */ jsx35(
      DiffApprovalView,
      {
        invocation: currentApply,
        pendingCount: appState.pendingApplies.length,
        choice: approval.approvalChoice,
        view: approval.diffView,
        showLineNumbers: approval.showLineNumbers,
        wrapMode: approval.wrapMode,
        previewIndex: approval.previewIndex
      }
    );
  }
  if (viewMode === "tool-list") {
    return /* @__PURE__ */ jsx35(ToolListView, { tools: appState.toolListItems, selectedIndex });
  }
  if (viewMode === "tool-detail" && appState.toolDetailData) {
    return /* @__PURE__ */ jsx35("box", { flexDirection: "column", width: "100%", height: "100%", children: /* @__PURE__ */ jsx35(
      ToolDetailView,
      {
        data: appState.toolDetailData,
        breadcrumb: appState.toolDetailStack,
        onNavigateChild: onNavigateToolDetail,
        onClose: onCloseToolDetail,
        onAbort: (toolId) => {
          onOpenToolDetail(toolId);
        }
      }
    ) });
  }
  return /* @__PURE__ */ jsxs33("box", { flexDirection: "column", width: "100%", height: "100%", children: [
    !hasMessages ? /* @__PURE__ */ jsx35(LogoScreen, {}) : null,
    !hasMessages && initWarnings && initWarnings.length > 0 ? /* @__PURE__ */ jsx35(InitWarnings, { warnings: initWarnings, color: initWarningsColor, icon: initWarningsIcon }) : null,
    hasMessages ? /* @__PURE__ */ jsx35(
      ChatMessageList,
      {
        messages: appState.messages,
        streamingParts: appState.streamingParts,
        isStreaming: appState.isStreaming,
        isGenerating: appState.isGenerating,
        retryInfo: appState.retryInfo,
        modelName: modelState.currentModelName,
        generatingLabel: appState.generatingLabel,
        thoughtsToggleSignal
      }
    ) : null,
    /* @__PURE__ */ jsx35(
      BottomPanel,
      {
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
      }
    )
  ] });
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
  if (warned) return;
  warned = true;
  console.warn(`[ConsolePlatform] ${message}`);
}
function resolveBundledRuntimeDir(isCompiledBinary) {
  if (!isCompiledBinary) return null;
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
  } catch {
  }
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
  if (configured) return;
  const runtimeDir = resolveBundledRuntimeDir(isCompiledBinary);
  const workerPath = process.env.OTUI_TREE_SITTER_WORKER_PATH?.trim() || (runtimeDir ? path3.join(runtimeDir, "parser.worker.js") : "");
  if (!workerPath) {
    if (isCompiledBinary) {
      warnRuntimeIssue("\u672A\u627E\u5230 OpenTUI tree-sitter worker\uFF0CMarkdown \u6807\u9898\u548C\u52A0\u7C97\u9AD8\u4EAE\u53EF\u80FD\u4E0D\u53EF\u7528\u3002");
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
      warnRuntimeIssue("\u672A\u627E\u5230\u5B8C\u6574\u7684 OpenTUI tree-sitter \u8D44\u6E90\u76EE\u5F55\uFF0CMarkdown \u4EE3\u7801\u9AD8\u4EAE\u53EF\u80FD\u4E0D\u53EF\u7528\u3002");
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
    return () => {
    };
  }
  const internalRenderer = renderer;
  let { width: lastWidth, height: lastHeight } = getTerminalSize(internalRenderer);
  let disposed = false;
  const syncResize = () => {
    if (disposed) return;
    const { width, height } = getTerminalSize(internalRenderer);
    if (width <= 0 || height <= 0) return;
    if (width === lastWidth && height === lastHeight) return;
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
    if (disposed) return;
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
function generateCommandPattern(command) {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) return "*";
  if (tokens.length <= 1) return tokens[0] + " *";
  if (tokens[1].startsWith("-")) return tokens[0] + " *";
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
  const responseByCallId = /* @__PURE__ */ new Map();
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
      const last = result.length > 0 ? result[result.length - 1] : void 0;
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
  if (content.usageMetadata?.promptTokenCount != null) meta.tokenIn = content.usageMetadata.promptTokenCount;
  if (content.usageMetadata?.candidatesTokenCount != null) meta.tokenOut = content.usageMetadata.candidatesTokenCount;
  if (content.createdAt != null) meta.createdAt = content.createdAt;
  if (content.isSummary) meta.isSummary = true;
  if (content.durationMs != null) meta.durationMs = content.durationMs;
  if (content.streamOutputDurationMs != null) meta.streamOutputDurationMs = content.streamOutputDurationMs;
  if (content.modelName) meta.modelName = content.modelName;
  return Object.keys(meta).length > 0 ? meta : void 0;
}
function generateSessionId() {
  const now = /* @__PURE__ */ new Date();
  const ts2 = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "_" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts2}_${rand}`;
}
var ConsolePlatform = class extends PlatformAdapter {
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
  /** waitForExit() 的 resolve 函数 */
  exitResolve;
  renderer;
  appHandle;
  disposeResizeWatcher;
  api;
  _activeHandles = /* @__PURE__ */ new Map();
  isCompiledBinary;
  /** 当前响应周期内的工具调用 ID 集合 */
  currentToolIds = /* @__PURE__ */ new Set();
  /** 当前思考强度层级（用于模型切换后重新应用） */
  currentThinkingEffort = "none";
  /** 当前正在查看详情的工具 ID 栈 */
  _toolDetailStack = [];
  /** 串行化 undo/redo 持久化操作，防止并发写入。 */
  historyMutationQueue = Promise.resolve();
  // ── 远程连接状态 ──
  /** 远程连接前保存的原始 backend，断开时恢复 */
  originalBackend = null;
  /** 远程 WS IPC 客户端 */
  remoteClient = null;
  /** 当前是否处于远程连接状态 */
  _isRemote = false;
  /** 远程连接的主机地址（用于 StatusBar 显示） */
  _remoteHost = "";
  /** 远程连接前保存的原始 API（断开时恢复） */
  originalApi = null;
  /** 远程连接前保存的原始 settingsController */
  originalSettingsController = null;
  /** 远程连接前保存的原始 agentName */
  originalAgentName;
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
  /**
   * 将一个异步操作排入持久化队列，保证串行执行。
   * 前一个操作失败不会阻塞后续操作。
   */
  enqueueHistoryMutation(task) {
    const next = this.historyMutationQueue.then(task, task);
    this.historyMutationQueue = next.then(() => void 0, () => void 0);
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
      if (sid === this.sessionId) {
      }
    });
    this.backend.on("stream:end", (sid) => {
      if (sid === this.sessionId) {
        this.appHandle?.endStream();
      }
    });
    this.backend.on("tool:execute", (sid, handle) => {
      if (sid !== this.sessionId) return;
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
      if (sid !== this.sessionId) return;
      if (!silent) return;
      let text;
      if (status === "completed") {
        const preview = (result ?? "").slice(0, 200);
        text = `\u23F0 ${description} \u5B8C\u6210\uFF1A${preview}`;
      } else if (status === "killed") {
        text = `\u23F0 ${description} \u88AB\u4E2D\u6B62`;
      } else {
        text = `\u23F0 ${description} \u5931\u8D25\uFF1A${result ?? "\u672A\u77E5\u9519\u8BEF"}`;
      }
      this.appHandle?.addMessage("assistant", text);
    });
    this.backend.on("auto-compact", (sid, summaryText) => {
      if (sid === this.sessionId) {
        const fullText = `[Context Summary]

${summaryText}`;
        const tokenCount = estimateTokenCount(fullText);
        this.appHandle?.addSummaryMessage(fullText, tokenCount > 0 ? tokenCount : void 0);
      }
    });
    return new Promise(async (resolve3, reject) => {
      try {
        this.renderer = await createCliRenderer({
          exitOnCtrlC: false,
          // 由应用自行处理 Ctrl+C
          useMouse: true,
          // 默认开启鼠标，支持滚轮滚动；复制时由应用内复制模式临时关闭
          enableMouseMovement: false
        });
      } catch (err) {
        if (err instanceof Error && err.message?.includes("Raw mode")) {
          console.error("[ConsolePlatform] Fatal: \u5F53\u524D\u7EC8\u7AEF\u4E0D\u652F\u6301 Raw mode\u3002");
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
            console.warn("[ConsolePlatform] onUndo \u6301\u4E45\u5316\u5931\u8D25:", err);
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
            console.warn("[ConsolePlatform] onRedo \u6301\u4E45\u5316\u5931\u8D25:", err);
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
          this.stop();
          this.exitResolve?.("exit");
        },
        onSummarize: () => this.handleSummarize(),
        onListAgents: () => this.handleListAgents(),
        onSelectAgent: (name) => this.handleSelectAgent(name),
        onRemoteConnect: (name) => this.handleRemoteConnect(name),
        onRemoteDisconnect: () => this.handleRemoteDisconnect(),
        remoteHost: this._remoteHost || void 0,
        onThinkingEffortChange: (level) => this.applyThinkingEffort(level),
        agentName: this.agentName,
        modeName: this.modeName,
        modelId: this.modelId,
        modelName: this.modelName,
        contextWindow: this.contextWindow,
        initWarnings: this.initWarnings,
        initWarningsColor: this.initWarningsColor,
        initWarningsIcon: this.initWarningsIcon,
        // 插件注册的 Settings Tab：从 IrisAPI 获取所有已注册的 tab 定义
        pluginSettingsTabs: this.api?.getConsoleSettingsTabs?.() ?? []
      });
      createRoot(this.renderer).render(element);
    });
  }
  async stop() {
    this.disposeResizeWatcher?.();
    this.renderer?.destroy();
  }
  /**
   * ForegroundPlatform 接口实现。
   * 返回的 Promise 在用户选择退出或切换 Agent 时 resolve。
   */
  waitForExit() {
    return new Promise((resolve3) => {
      this.exitResolve = resolve3;
    });
  }
  /**
   * 获取可用 Agent 列表（/agent 命令触发）。
   *
   * 修改方式：不再直接操作 stdin/stdout 显示 ANSI 选择器，
   * 而是返回 agent 列表交给 React viewMode 渲染，避免 stdin 争夺和日志泄漏。
   */
  handleListAgents() {
    return this.api?.listAgents?.() ?? [];
  }
  /**
   * 用户在 agent-list 视图中选择后，执行实际的 Agent 切换。
   *
   * 修改方式：由 OpenTUI React 键盘事件触发（Enter 键），
   * 不再需要 suspend/destroy renderer 来显示选择器。
   * 选中当前 agent 时直接返回，选中其他 agent 时 stop → 切换 backend → start。
   */
  async handleSelectAgent(targetName) {
    const network = this.api?.agentNetwork;
    if (!network) return;
    if (targetName === network.selfName) return;
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
  // ============ 远程连接 ============
  /**
   * 核心远程连接逻辑：WsIPCClient 创建 → 握手 → backend/api swap。
   * 被向导流程和快捷连接共用。调用前 TUI 必须已停止。
   */
  async doRemoteConnect(url, token) {
    const { showConnectingStatus: showConnectingStatus2, showConnectSuccess: showConnectSuccess2, showConnectError: showConnectError2 } = await Promise.resolve().then(() => (init_remote_wizard(), remote_wizard_exports));
    showConnectingStatus2(url);
    try {
      const { WsIPCClient } = await import("../../src/net/client");
      const { RemoteBackendHandle } = await import("../../src/ipc/remote-backend-handle");
      const wsClient = new WsIPCClient();
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
        mcpManager: void 0,
        extensions: void 0
      });
      this._isRemote = true;
      this.agentName = handshake.agentName === "__global__" ? void 0 : handshake.agentName;
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
      this.initWarnings = [`\u5DF2\u8FDE\u63A5\u5230\u8FDC\u7A0B Iris \u2014 ${this._remoteHost} (agent=${handshake.agentName}, model=${this.modelName})
\u8F93\u5165 /disconnect \u65AD\u5F00\u8FDE\u63A5`];
      this.initWarningsColor = "#00cec9";
      this.initWarningsIcon = "\u25CF";
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      showConnectError2(err.message);
      await new Promise((r) => setTimeout(r, 2e3));
      throw err;
    }
  }
  /** 读取本地配置中的已保存连接列表 */
  readSavedRemotes() {
    try {
      const config = this.api?.configManager?.readEditableConfig?.();
      const remotes = config?.net?.remotes;
      if (remotes && typeof remotes === "object") return remotes;
    } catch {
    }
    return {};
  }
  /** lastRemote → remotes 迁移 */
  migrateLastRemote() {
    try {
      const config = this.api?.configManager?.readEditableConfig?.();
      const lastRemote = config?.net?.lastRemote;
      if (!lastRemote?.url) return;
      const remotes = config?.net?.remotes ?? {};
      const alreadyExists = Object.values(remotes).some(
        (r) => r?.url === lastRemote.url
      );
      if (!alreadyExists) {
        this.api?.configManager?.updateEditableConfig?.({
          net: { remotes: { _last: { url: lastRemote.url, token: lastRemote.token } } }
        });
      }
      this.api?.configManager?.updateEditableConfig?.({
        net: { lastRemote: null }
      });
    } catch {
    }
  }
  /** 保存连接到 remotes（用 originalApi 写本地配置） */
  saveRemote(name, url, token) {
    try {
      const api = this.originalApi ?? this.api;
      api?.configManager?.updateEditableConfig?.({
        net: { remotes: { [name]: { url, token } } }
      });
    } catch {
    }
  }
  /** 删除已保存的连接 */
  deleteSavedRemote(name) {
    try {
      this.api?.configManager?.updateEditableConfig?.({
        net: { remotes: { [name]: null } }
      });
    } catch {
    }
  }
  /**
   * 处理 /remote 命令 — 交互式连接远程 Iris。
   * @param quickName 快捷连接名称（/remote <name>），不传则显示向导。
   */
  async handleRemoteConnect(quickName) {
    await this.stop();
    this.migrateLastRemote();
    const remotes = this.readSavedRemotes();
    if (quickName) {
      const entry = remotes[quickName];
      if (!entry) {
        const { showConnectError: showConnectError2 } = await Promise.resolve().then(() => (init_remote_wizard(), remote_wizard_exports));
        showConnectError2(`\u672A\u627E\u5230\u5DF2\u4FDD\u5B58\u7684\u8FDE\u63A5: ${quickName}`);
        await new Promise((r) => setTimeout(r, 1500));
        await this.start();
        return;
      }
      if (entry.token) {
        try {
          await this.doRemoteConnect(entry.url, entry.token);
        } catch {
        }
        await this.start();
        return;
      }
      const { showInputPhase: showInputPhase2 } = await Promise.resolve().then(() => (init_remote_wizard(), remote_wizard_exports));
      const result2 = await showInputPhase2({ prefillUrl: entry.url, urlLocked: true });
      if (!result2) {
        await this.start();
        return;
      }
      try {
        await this.doRemoteConnect(entry.url, result2.token);
        this.saveRemote(quickName, entry.url, result2.token);
      } catch {
      }
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
    } catch {
    }
    const { showRemoteConnectWizard: showRemoteConnectWizard2, showSavePrompt: showSavePrompt2 } = await Promise.resolve().then(() => (init_remote_wizard(), remote_wizard_exports));
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
      if (entry?.token) connectToken = entry.token;
    }
    try {
      await this.doRemoteConnect(connectUrl, connectToken);
      if (result.source !== "saved") {
        const saveName = await showSavePrompt2();
        if (saveName) {
          this.saveRemote(saveName, connectUrl, connectToken);
        }
      }
    } catch {
    }
    await this.start();
  }
  /**
   * 处理 /remote disconnect — 断开远程连接，恢复本地 backend。
   * 与 handleSwitchAgent 相同模式：stop → swap → start，无返回值。
   */
  async handleRemoteDisconnect() {
    if (!this._isRemote || !this.originalBackend) return;
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
    this.originalAgentName = void 0;
    this._isRemote = false;
    this._remoteHost = "";
    this.initWarnings = [`\u5DF2\u65AD\u5F00\u8FDC\u7A0B\u8FDE\u63A5 (${disconnectedHost})\uFF0C\u5DF2\u56DE\u5230\u672C\u5730`];
    this.initWarningsColor = "#74b9ff";
    this.initWarningsIcon = "\u25CB";
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
  // ============ 内部逻辑 ============
  /** 从历史 ToolInvocation 创建轻量 Handle 对象（与实时 Handle 接口兼容） */
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
      abort: () => {
      },
      approve: () => {
      },
      apply: () => {
      },
      send: () => {
      },
      on: () => {
      },
      off: () => {
      },
      emit: () => false
    };
  }
  handleNewSession() {
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
    this._activeHandles.clear();
  }
  /** 打开工具详情 */
  openToolDetail(toolId) {
    if (!toolId) {
      const all = Array.from(this._activeHandles.values());
      if (all.length === 0) {
        this.appHandle?.addErrorMessage("\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u5177\u6267\u884C\u8BB0\u5F55\u3002");
        return;
      }
      const tools = all.map((h) => h.getSnapshot()).sort((a, b) => a.createdAt - b.createdAt);
      this.appHandle?.openToolList(tools);
      return;
    }
    const handle = this._activeHandles.get(toolId);
    if (!handle) {
      this.appHandle?.addErrorMessage("\u672A\u627E\u5230\u6307\u5B9A\u7684\u5DE5\u5177\u6267\u884C\u8BB0\u5F55\u3002");
      return;
    }
    this._toolDetailStack = [handle.id];
    this.pushToolDetailData(handle.id);
  }
  /** 导航到子工具详情 */
  navigateToolDetail(toolId) {
    const handle = this._activeHandles.get(toolId);
    if (!handle) return;
    this._toolDetailStack.push(toolId);
    this.pushToolDetailData(toolId);
  }
  /** 关闭/返回工具详情 */
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
  /**
   * 将命令模式添加到 shell/bash 的 allowPatterns 或 denyPatterns。
   * 内存立即生效 + 持久化到 tools.yaml。
   */
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
      if (!arr.includes(pattern)) arr.push(pattern);
    } else {
      policy[key] = [pattern];
    }
    const oppositeKey = type === "allow" ? "denyPatterns" : "allowPatterns";
    const oppositeArr = policy[oppositeKey];
    if (oppositeArr) {
      const idx = oppositeArr.indexOf(pattern);
      if (idx !== -1) oppositeArr.splice(idx, 1);
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
        if (oidx !== -1) opposite.splice(oidx, 1);
        const updates = { [key]: existing };
        if (oidx !== -1) updates[oppositeKey2] = opposite;
        configManager.updateEditableConfig({ tools: { [toolName]: updates } });
      } catch {
      }
    }
  }
  /** 推送工具详情数据到 UI */
  pushToolDetailData(toolId) {
    const handle = this._activeHandles.get(toolId);
    if (!handle) return;
    const invocation = handle.getSnapshot();
    const output = handle.getOutputHistory?.() ?? [];
    const childHandles = handle.getChildren?.() ?? [];
    const children = childHandles.map((ch) => ch.getSnapshot());
    const breadcrumb = this._toolDetailStack.map((id) => {
      const h = this._activeHandles.get(id);
      return { toolId: id, toolName: h?.toolName ?? id };
    });
    const breadcrumbForView = breadcrumb.slice(0, -1);
    this.appHandle?.openToolDetail(
      { invocation, output, children },
      breadcrumbForView
    );
  }
  /** 如果详情视图打开，刷新数据 */
  refreshToolDetailIfNeeded() {
    if (this._toolDetailStack.length === 0) return;
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
      if (!info) return { ok: false, message: "\u6A21\u578B\u5207\u6362\u529F\u80FD\u4E0D\u53EF\u7528" };
      this.modelName = info.modelName;
      this.modelId = info.modelId;
      this.contextWindow = info.contextWindow;
      if (this.currentThinkingEffort !== "none") {
        this.applyThinkingEffort(this.currentThinkingEffort);
      }
      return {
        ok: true,
        message: `\u5F53\u524D\u6A21\u578B\u5DF2\u5207\u6362\u4E3A\uFF1A${info.modelName}  ${info.modelId}`,
        modelName: info.modelName,
        modelId: info.modelId,
        contextWindow: info.contextWindow
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `\u5207\u6362\u6A21\u578B\u5931\u8D25\uFF1A${detail}` };
    }
  }
  applyThinkingEffort(level) {
    this.currentThinkingEffort = level;
    const router = this.api?.router;
    if (!router) return;
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
    const responseMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === "model" && msg.parts.some((p) => "functionCall" in p)) {
        const next = i + 1 < history.length ? history[i + 1] : void 0;
        if (next && next.role === "user") {
          const responses = next.parts.filter((p) => "functionResponse" in p);
          if (responses.length > 0) responseMap.set(i, responses);
        }
      }
    }
    for (let i = 0; i < history.length; i++) {
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
      return { success: true, message: "\u914D\u7F6E\u5DF2\u91CD\u7F6E" };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  }
  async handleSummarize() {
    this.appHandle?.setGeneratingLabel("compressing context...");
    this.appHandle?.setGenerating(true);
    try {
      const summaryText = await this.backend.summarize?.(this.sessionId) ?? "";
      const fullText = `[Context Summary]

${summaryText}`;
      const tokenCount = estimateTokenCount(fullText);
      this.appHandle?.addSummaryMessage(fullText, tokenCount > 0 ? tokenCount : void 0);
      return { ok: true, message: "Context compressed." };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.appHandle?.addErrorMessage(`Context compression failed: ${detail}`);
      return { ok: false, message: detail };
    } finally {
      this.appHandle?.setGenerating(false);
    }
  }
  /**
   * 处理用户输入：发送消息给 Backend，并在完成后自动排流队列中的下一条消息。
   *
   * 流程：
   * 1. 设置生成状态 → 发送消息 → 等待完成
   * 2. 检查队列：如果有下一条，重复步骤 1（abort 仅中断当前生成，不影响队列排流）
   * 3. 队列排空或被 abort 后，取消生成状态
   */
  async handleInput(text) {
    this.appHandle?.setGenerating(true);
    let currentText = text;
    while (currentText) {
      this.appHandle?.addMessage("user", currentText);
      this.currentToolIds.clear();
      try {
        await this.backend.chat(this.sessionId, currentText, void 0, void 0, "console");
      } finally {
        this.appHandle?.commitTools();
      }
      currentText = this.appHandle?.drainQueue();
    }
    this.appHandle?.setGenerating(false);
  }
};
async function consoleFactory(rawContext) {
  const context = rawContext;
  if (typeof globalThis.Bun === "undefined") {
    console.error(
      "[Iris] Console \u5E73\u53F0\u9700\u8981 Bun \u8FD0\u884C\u65F6\u3002\n  - \u8BF7\u4F18\u5148\u4F7F\u7528: bun run dev\n  - \u6216\u76F4\u63A5\u6267\u884C: bun src/index.ts\n  - \u6216\u5207\u6362\u5230\u5176\u4ED6\u5E73\u53F0\uFF08\u5982 web\uFF09"
    );
    process.exit(1);
  }
  const currentModel = context.router?.getCurrentModelInfo?.() ?? { modelName: "default", modelId: "" };
  return new ConsolePlatform(context.backend, {
    modeName: context.config?.system?.defaultMode ?? "default",
    modelName: currentModel.modelName ?? "default",
    modelId: currentModel.modelId ?? "",
    contextWindow: currentModel.contextWindow,
    configDir: context.configDir ?? "",
    getMCPManager: context.getMCPManager ?? (() => void 0),
    setMCPManager: context.setMCPManager ?? (() => {
    }),
    agentName: context.agentName,
    initWarnings: context.initWarnings,
    extensions: context.extensions,
    api: context.api,
    isCompiledBinary: context.isCompiledBinary ?? false
  });
}
export {
  ConsolePlatform,
  consoleFactory as default
};
//# sourceMappingURL=index.mjs.map
