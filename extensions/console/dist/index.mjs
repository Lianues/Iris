// src/index.ts
import React9 from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import {
  PlatformAdapter,
  LogLevel
} from "@irises/extension-sdk";
import { estimateTokenCount } from "tokenx";

// src/App.tsx
import { useCallback as useCallback10, useEffect as useEffect10, useRef as useRef8, useState as useState12 } from "react";
import { useRenderer } from "@opentui/react";

// src/theme.ts
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

// src/components/ApprovalBar.tsx
import { jsxDEV } from "@opentui/react/jsx-dev-runtime";
function ApprovalBar({ toolName, choice, remainingCount }) {
  return /* @__PURE__ */ jsxDEV("box", {
    flexDirection: "column",
    borderStyle: "single",
    borderColor: choice === "approve" ? C.accent : C.error,
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
          children: "确认执行 "
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
        }, undefined, false, undefined, this),
        remainingCount > 1 ? /* @__PURE__ */ jsxDEV("span", {
          fg: C.dim,
          children: `  (剩余 ${remainingCount - 1} 个)`
        }, undefined, false, undefined, this) : null
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/components/ConfirmBar.tsx
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
              children: "⚠ "
            }, undefined, false, undefined, this)
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

// src/text-layout.ts
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
  return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510 || codePoint >= 127744 && codePoint <= 129791 || codePoint >= 131072 && codePoint <= 262141);
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

// src/components/HintBar.tsx
import { jsxDEV as jsxDEV3, Fragment } from "@opentui/react/jsx-dev-runtime";
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
    const truncated = `${prefix}${head}${sep}…${sep}${tail}`;
    if (getTextWidth(truncated) <= maxWidth)
      return truncated;
  }
  const minimal = `…${sep}${parts[parts.length - 1]}`;
  if (getTextWidth(minimal) <= maxWidth)
    return minimal;
  return hardTruncate(fullPath, maxWidth);
}
function hardTruncate(text, maxWidth) {
  if (maxWidth <= 1)
    return "…";
  let result = "";
  let width = 0;
  for (const ch of text) {
    const cw = getTextWidth(ch);
    if (width + cw > maxWidth - 1)
      break;
    result += ch;
    width += cw;
  }
  return result + "…";
}
function HintBar({ isGenerating, queueSize, copyMode, exitConfirmArmed }) {
  const cwd = process.cwd();
  const hasQueue = (queueSize ?? 0) > 0;
  let hintStr;
  if (exitConfirmArmed) {
    hintStr = "再次按 ctrl+c 退出";
  } else {
    const parts = [];
    parts.push(isGenerating ? "esc 中断生成" : "ctrl+j 换行");
    if (isGenerating && hasQueue) {
      parts.push("/queue 管理队列");
    }
    parts.push(isGenerating ? "ctrl+s 立即发送" : copyMode ? "f6 返回滚动模式" : "f6 复制模式");
    hintStr = parts.join("  ·  ");
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
        children: /* @__PURE__ */ jsxDEV3("text", {
          fg: C.dim,
          children: displayCwd
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      exitConfirmArmed ? /* @__PURE__ */ jsxDEV3("text", {
        fg: C.warn,
        children: "再次按 ctrl+c 退出"
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV3("text", {
        fg: C.dim,
        children: [
          isGenerating ? "esc 中断生成" : "ctrl+j 换行",
          isGenerating && hasQueue ? /* @__PURE__ */ jsxDEV3(Fragment, {
            children: [
              "  ·  ",
              /* @__PURE__ */ jsxDEV3("span", {
                fg: C.warn,
                children: "/queue 管理队列"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this) : null,
          "  ·  ",
          isGenerating ? "ctrl+s 立即发送" : copyMode ? "f6 返回滚动模式" : "f6 复制模式"
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/components/InputBar.tsx
import { useEffect as useEffect3, useMemo, useRef as useRef2, useState as useState3 } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

// src/input-commands.ts
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
  { name: "/agent", description: "切换 Agent（多 Agent 模式）" },
  { name: "/queue", description: "查看/管理排队消息" },
  { name: "/exit", description: "退出应用" }
];
function getCommandInput(cmd) {
  return cmd.name === "/sh" || cmd.name === "/model" ? `${cmd.name} ` : cmd.name;
}
function isExactCommandValue(value, cmd) {
  return value === cmd.name || value === getCommandInput(cmd);
}

// src/hooks/use-text-input.ts
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

// src/hooks/use-cursor-blink.ts
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

// src/hooks/use-paste.ts
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

// src/components/InputDisplay.tsx
import { jsxDEV as jsxDEV4, Fragment as Fragment2 } from "@opentui/react/jsx-dev-runtime";
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
      cursorChar ? atNewline ? /* @__PURE__ */ jsxDEV4(Fragment2, {
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

// src/components/InputBar.tsx
import { jsxDEV as jsxDEV5 } from "@opentui/react/jsx-dev-runtime";
function InputBar({ disabled, isGenerating, queueSize, onSubmit, onPrioritySubmit }) {
  const [inputState, inputActions] = useTextInput("");
  const [selectedIndex, setSelectedIndex] = useState3(0);
  const cursorVisible = useCursorBlink();
  const { width: termWidth } = useTerminalDimensions();
  const visibleCommands = COMMANDS;
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
  const showCommands = commandQuery.length > 0;
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
    const cmd = filtered[normalizedIndex];
    setSelectedIndex(normalizedIndex);
    inputActions.setValue(getCommandInput(cmd));
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
          applySelection(isExactCommandValue(value, current) ? selectedIndex - 1 : selectedIndex);
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
      const text = value.trim();
      if (!text)
        return;
      onSubmit(text);
      inputActions.setValue("");
      setSelectedIndex(0);
      return;
    }
    if (key.name === "escape")
      return;
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
  const promptChar = isQueueMode ? "⏳ " : "❯ ";
  const placeholder = isQueueMode ? "输入消息（将排队发送）…" : "输入消息…";
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
                  children: isSelected ? "▸ " : "  "
                }, undefined, false, undefined, this),
                isSelected ? /* @__PURE__ */ jsxDEV5("strong", {
                  children: /* @__PURE__ */ jsxDEV5("span", {
                    fg: C.text,
                    children: padded
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV5("span", {
                  fg: C.textSec,
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

// src/components/StatusBar.tsx
import { jsxDEV as jsxDEV6, Fragment as Fragment3 } from "@opentui/react/jsx-dev-runtime";
var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function StatusBar({ agentName, modeName, modelName, contextTokens, contextWindow, queueSize, backgroundTaskCount, delegateTaskCount, backgroundTaskTokens, backgroundTaskSpinnerFrame }) {
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
              children: " · "
            }, undefined, false, undefined, this) : null,
            /* @__PURE__ */ jsxDEV6("span", {
              fg: C.primaryLight,
              children: /* @__PURE__ */ jsxDEV6("strong", {
                children: modeNameCapitalized
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV6("span", {
              fg: C.dim,
              children: " · "
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV6("span", {
              fg: C.textSec,
              children: modelName
            }, undefined, false, undefined, this),
            queueSize != null && queueSize > 0 ? /* @__PURE__ */ jsxDEV6(Fragment3, {
              children: [
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.dim,
                  children: " · "
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.warn,
                  children: [
                    queueSize,
                    " 条排队中"
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this) : null,
            hasBackgroundTasks ? /* @__PURE__ */ jsxDEV6(Fragment3, {
              children: [
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.dim,
                  children: " · "
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.accent,
                  children: [
                    spinner,
                    " ",
                    backgroundTaskCount,
                    " 个后台任务",
                    backgroundTaskTokens != null && backgroundTaskTokens > 0 ? ` ↑${backgroundTaskTokens.toLocaleString()}tk` : ""
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this) : null,
            hasDelegateTasks ? /* @__PURE__ */ jsxDEV6(Fragment3, {
              children: [
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.dim,
                  children: " · "
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV6("span", {
                  fg: C.warn,
                  children: [
                    "⇢ ",
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

// src/components/BottomPanel.tsx
import { jsxDEV as jsxDEV7 } from "@opentui/react/jsx-dev-runtime";
function BottomPanel({
  hasMessages,
  pendingConfirm,
  confirmChoice,
  pendingApprovals,
  approvalChoice,
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
  backgroundTaskSpinnerFrame
}) {
  const inputDisabled = !!(pendingConfirm || pendingApprovals.length > 0);
  return /* @__PURE__ */ jsxDEV7("box", {
    flexDirection: "column",
    flexShrink: 0,
    paddingX: 1,
    paddingBottom: 1,
    paddingTop: hasMessages ? 1 : 0,
    children: [
      pendingConfirm ? /* @__PURE__ */ jsxDEV7(ConfirmBar, {
        message: pendingConfirm.message,
        choice: confirmChoice
      }, undefined, false, undefined, this) : pendingApprovals.length > 0 ? /* @__PURE__ */ jsxDEV7(ApprovalBar, {
        toolName: pendingApprovals[0].toolName,
        choice: approvalChoice,
        remainingCount: pendingApprovals.length
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV7("box", {
        flexDirection: "column",
        borderStyle: "single",
        borderColor: isGenerating ? C.warn : C.border,
        padding: 1,
        paddingBottom: 0,
        children: [
          /* @__PURE__ */ jsxDEV7(InputBar, {
            disabled: inputDisabled,
            isGenerating,
            queueSize,
            onSubmit,
            onPrioritySubmit
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV7(StatusBar, {
            agentName,
            modeName,
            modelName,
            contextTokens,
            contextWindow,
            queueSize,
            backgroundTaskCount,
            delegateTaskCount,
            backgroundTaskTokens,
            backgroundTaskSpinnerFrame
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV7(HintBar, {
        isGenerating,
        queueSize,
        copyMode,
        exitConfirmArmed
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/components/GeneratingTimer.tsx
import { useState as useState5, useEffect as useEffect5, useRef as useRef4 } from "react";

// src/components/Spinner.tsx
import { useState as useState4, useEffect as useEffect4, useRef as useRef3 } from "react";
import { jsxDEV as jsxDEV8 } from "@opentui/react/jsx-dev-runtime";
var FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
  return /* @__PURE__ */ jsxDEV8("span", {
    fg: C.accent,
    children: FRAMES[frame]
  }, undefined, false, undefined, this);
}

// src/components/GeneratingTimer.tsx
import { jsxDEV as jsxDEV9 } from "@opentui/react/jsx-dev-runtime";
function GeneratingTimer({ isGenerating, retryInfo }) {
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
  if (!isGenerating)
    return null;
  if (retryInfo) {
    const briefError = (retryInfo.error || "").split(`
`)[0].slice(0, 60);
    return /* @__PURE__ */ jsxDEV9("box", {
      flexDirection: "column",
      children: [
        /* @__PURE__ */ jsxDEV9("text", {
          children: [
            /* @__PURE__ */ jsxDEV9(Spinner, {}, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV9("span", {
              fg: C.warn,
              children: /* @__PURE__ */ jsxDEV9("em", {
                children: ` retrying (${retryInfo.attempt}/${retryInfo.maxRetries})... (${time}s)`
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV9("text", {
          fg: C.dim,
          children: `  └ ${briefError}`
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV9("text", {
    children: [
      /* @__PURE__ */ jsxDEV9(Spinner, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV9("span", {
        fg: C.dim,
        children: /* @__PURE__ */ jsxDEV9("em", {
          children: ` generating... (${time}s)`
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/components/MessageItem.tsx
import React5 from "react";
import { useTerminalDimensions as useTerminalDimensions2 } from "@opentui/react";

// src/components/MarkdownText.tsx
import { useMemo as useMemo2 } from "react";
import { SyntaxStyle, parseColor } from "@opentui/core";
import { jsxDEV as jsxDEV10 } from "@opentui/react/jsx-dev-runtime";
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
function MarkdownText({ text, showCursor }) {
  const syntaxStyle = useMemo2(() => createSyntaxStyle(), []);
  if (!text) {
    return showCursor ? /* @__PURE__ */ jsxDEV10("text", {
      children: /* @__PURE__ */ jsxDEV10("span", {
        bg: C.accent,
        children: " "
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this) : null;
  }
  return /* @__PURE__ */ jsxDEV10("markdown", {
    content: text,
    syntaxStyle,
    streaming: showCursor
  }, undefined, false, undefined, this);
}

// src/tool-renderers/default.tsx
import { jsxDEV as jsxDEV11 } from "@opentui/react/jsx-dev-runtime";
function DefaultRenderer({ result }) {
  const text = typeof result === "string" ? result.replace(/\n/g, " ") : JSON.stringify(result).replace(/\n/g, " ");
  const truncated = text.length > 80 ? text.slice(0, 80) + "..." : text;
  return /* @__PURE__ */ jsxDEV11("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV11("em", {
      children: [
        " ↳ ",
        truncated
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tool-renderers/shell.tsx
import { jsxDEV as jsxDEV12 } from "@opentui/react/jsx-dev-runtime";
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
  return line.length > max ? line.slice(0, max) + "…" : line;
}
function ShellRenderer({ result }) {
  const r = result || {};
  const exitCode = r.exitCode ?? 0;
  const isError = exitCode !== 0;
  if (r.killed) {
    return /* @__PURE__ */ jsxDEV12("text", {
      fg: "#ff0000",
      children: /* @__PURE__ */ jsxDEV12("em", {
        children: [
          " ↳ ",
          "killed (timeout)"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (isError) {
    const reason = firstLine(r.stderr, 100) || `exit ${exitCode}`;
    return /* @__PURE__ */ jsxDEV12("text", {
      fg: "#ff0000",
      children: /* @__PURE__ */ jsxDEV12("em", {
        children: [
          " ↳ ",
          reason
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const lines = lineCount(r.stdout);
  const summary = lines > 0 ? `${lines} lines output` : "done (no output)";
  return /* @__PURE__ */ jsxDEV12("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV12("em", {
      children: [
        " ↳ ",
        summary
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tool-renderers/read-file.tsx
import { jsxDEV as jsxDEV13 } from "@opentui/react/jsx-dev-runtime";
function basename(p) {
  return p.split("/").pop() || p;
}
function ReadFileRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  if (items.length === 0) {
    return /* @__PURE__ */ jsxDEV13("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV13("em", {
        children: [
          " ↳",
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
    return /* @__PURE__ */ jsxDEV13("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV13("em", {
        children: [
          " ↳",
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
  return /* @__PURE__ */ jsxDEV13("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV13("em", {
      children: [
        " ↳",
        " read ",
        totalLines,
        " lines (",
        names,
        ")"
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tool-renderers/apply-diff.tsx
import { jsxDEV as jsxDEV14 } from "@opentui/react/jsx-dev-runtime";
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
  return /* @__PURE__ */ jsxDEV14("text", {
    fg: isError ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV14("em", {
      children: [
        " ↳ ",
        added > 0 && /* @__PURE__ */ jsxDEV14("span", {
          fg: "#57ab5a",
          children: [
            "+",
            added
          ]
        }, undefined, true, undefined, this),
        added > 0 && deleted > 0 && " ",
        deleted > 0 && /* @__PURE__ */ jsxDEV14("span", {
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

// src/tool-renderers/search-in-files.tsx
import { jsxDEV as jsxDEV15 } from "@opentui/react/jsx-dev-runtime";
function truncStr(s, max) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
function SearchInFilesRenderer({ args, result }) {
  const r = result || {};
  if (r.mode === "replace") {
    const total = r.totalReplacements ?? 0;
    const files = r.processedFiles ?? 0;
    const suffix2 = r.truncated ? " (truncated)" : "";
    const query = typeof args?.query === "string" ? truncStr(args.query, 16) : "";
    const replace = typeof args?.replace === "string" ? truncStr(args.replace, 16) : "";
    const transform = query ? ` "${query}" → "${replace}"` : "";
    const changedFiles = r.results ? r.results.filter((f) => f.changed).length : files;
    return /* @__PURE__ */ jsxDEV15("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV15("em", {
        children: [
          " ↳ ",
          /* @__PURE__ */ jsxDEV15("span", {
            fg: "#d2a8ff",
            children: total
          }, undefined, false, undefined, this),
          " replacements in",
          " ",
          /* @__PURE__ */ jsxDEV15("span", {
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
  return /* @__PURE__ */ jsxDEV15("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV15("em", {
      children: [
        " ↳ ",
        /* @__PURE__ */ jsxDEV15("span", {
          fg: "#d2a8ff",
          children: count
        }, undefined, false, undefined, this),
        " matches found",
        suffix
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tool-renderers/find-files.tsx
import { jsxDEV as jsxDEV16 } from "@opentui/react/jsx-dev-runtime";
function FindFilesRenderer({ result }) {
  const r = result || {};
  const count = r.count ?? 0;
  const suffix = r.truncated ? " (truncated)" : "";
  return /* @__PURE__ */ jsxDEV16("text", {
    fg: "#888",
    children: /* @__PURE__ */ jsxDEV16("em", {
      children: [
        " ↳ ",
        " ",
        count,
        " files found",
        suffix
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tool-renderers/list-files.tsx
import { jsxDEV as jsxDEV17 } from "@opentui/react/jsx-dev-runtime";
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
  return /* @__PURE__ */ jsxDEV17("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV17("em", {
      children: [
        " ↳ ",
        summary
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tool-renderers/write-file.tsx
import { jsxDEV as jsxDEV18 } from "@opentui/react/jsx-dev-runtime";
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
    return /* @__PURE__ */ jsxDEV18("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV18("em", {
        children: [
          " ↳",
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
    return /* @__PURE__ */ jsxDEV18("text", {
      fg,
      children: /* @__PURE__ */ jsxDEV18("em", {
        children: [
          " ↳ ",
          hasLines && (action === "created" ? /* @__PURE__ */ jsxDEV18("span", {
            fg: "#57ab5a",
            children: [
              "+",
              lines
            ]
          }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV18("span", {
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
  return /* @__PURE__ */ jsxDEV18("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV18("em", {
      children: [
        " ↳ ",
        totalLines > 0 && /* @__PURE__ */ jsxDEV18("span", {
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

// src/tool-renderers/delete-code.tsx
import { jsxDEV as jsxDEV19 } from "@opentui/react/jsx-dev-runtime";
function DeleteCodeRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  if (items.length === 0) {
    return /* @__PURE__ */ jsxDEV19("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV19("em", {
        children: [
          " ↳",
          " deleted 0 lines"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return /* @__PURE__ */ jsxDEV19("text", {
        fg: "#ff0000",
        children: /* @__PURE__ */ jsxDEV19("em", {
          children: [
            " ↳",
            " failed (",
            item.error ?? item.path ?? "?",
            ")"
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this);
    }
    const deleted = item.deletedLines ?? 0;
    const range = item.start_line != null && item.end_line != null ? `:${item.start_line}-${item.end_line}` : "";
    return /* @__PURE__ */ jsxDEV19("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV19("em", {
        children: [
          " ↳",
          " ",
          /* @__PURE__ */ jsxDEV19("span", {
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
  return /* @__PURE__ */ jsxDEV19("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV19("em", {
      children: [
        " ↳",
        " ",
        /* @__PURE__ */ jsxDEV19("span", {
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

// src/tool-renderers/insert-code.tsx
import { jsxDEV as jsxDEV20 } from "@opentui/react/jsx-dev-runtime";
function InsertCodeRenderer({ result }) {
  const r = result || {};
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  if (items.length === 0) {
    return /* @__PURE__ */ jsxDEV20("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV20("em", {
        children: [
          " ↳",
          " inserted 0 lines"
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return /* @__PURE__ */ jsxDEV20("text", {
        fg: "#ff0000",
        children: /* @__PURE__ */ jsxDEV20("em", {
          children: [
            " ↳",
            " failed (",
            item.error ?? item.path ?? "?",
            ")"
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this);
    }
    const inserted = item.insertedLines ?? 0;
    const pos = item.line != null ? ` at L${item.line}` : "";
    return /* @__PURE__ */ jsxDEV20("text", {
      fg: "#888",
      children: /* @__PURE__ */ jsxDEV20("em", {
        children: [
          " ↳",
          " ",
          /* @__PURE__ */ jsxDEV20("span", {
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
  return /* @__PURE__ */ jsxDEV20("text", {
    fg: failCount > 0 ? "#ffff00" : "#888",
    children: /* @__PURE__ */ jsxDEV20("em", {
      children: [
        " ↳",
        " ",
        /* @__PURE__ */ jsxDEV20("span", {
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

// src/tool-renderers/index.ts
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

// src/components/ToolCall.tsx
import { jsxDEV as jsxDEV21 } from "@opentui/react/jsx-dev-runtime";
var TERMINAL_STATUSES = new Set(["success", "warning", "error"]);
var SPINNER_FRAMES2 = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function getArgsSummary(toolName, args) {
  switch (toolName) {
    case "shell": {
      const cmd = String(args.command || "");
      return cmd.length > 30 ? `"${cmd.slice(0, 30)}…"` : `"${cmd}"`;
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
      const head = q.length > 20 ? `"${q.slice(0, 20)}…"` : `"${q}"`;
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
  const nameColor = isAwaitingApproval ? C.warn : C.dim;
  return /* @__PURE__ */ jsxDEV21("box", {
    flexDirection: "column",
    children: [
      /* @__PURE__ */ jsxDEV21("box", {
        flexDirection: "row",
        gap: 1,
        children: [
          /* @__PURE__ */ jsxDEV21("text", {
            children: [
              /* @__PURE__ */ jsxDEV21("span", {
                fg: nameColor,
                children: toolName
              }, undefined, false, undefined, this),
              argsSummary.length > 0 && /* @__PURE__ */ jsxDEV21("span", {
                fg: C.dim,
                children: [
                  " ",
                  argsSummary
                ]
              }, undefined, true, undefined, this),
              status === "success" ? /* @__PURE__ */ jsxDEV21("span", {
                fg: C.accent,
                children: [
                  " ",
                  "✓"
                ]
              }, undefined, true, undefined, this) : null,
              status === "warning" ? /* @__PURE__ */ jsxDEV21("span", {
                fg: C.warn,
                children: " !"
              }, undefined, false, undefined, this) : null,
              status === "error" ? /* @__PURE__ */ jsxDEV21("span", {
                fg: C.error,
                children: [
                  " ",
                  "✗"
                ]
              }, undefined, true, undefined, this) : null,
              isAwaitingApproval ? /* @__PURE__ */ jsxDEV21("span", {
                fg: C.warn,
                children: " [待确认]"
              }, undefined, false, undefined, this) : null,
              !isFinal && !isExecuting && !isAwaitingApproval ? /* @__PURE__ */ jsxDEV21("span", {
                fg: C.dim,
                children: [
                  " [",
                  status,
                  "]"
                ]
              }, undefined, true, undefined, this) : null,
              duration ? /* @__PURE__ */ jsxDEV21("span", {
                fg: C.dim,
                children: [
                  " ",
                  duration
                ]
              }, undefined, true, undefined, this) : null,
              isExecuting && progressTokens != null && progressTokens > 0 ? /* @__PURE__ */ jsxDEV21("span", {
                fg: C.dim,
                children: [
                  " ",
                  "↑",
                  progressTokens.toLocaleString(),
                  "tk"
                ]
              }, undefined, true, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          isExecuting && hasProgress ? /* @__PURE__ */ jsxDEV21("text", {
            children: /* @__PURE__ */ jsxDEV21("span", {
              fg: C.accent,
              children: SPINNER_FRAMES2[(progressFrame ?? 0) % SPINNER_FRAMES2.length]
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : isExecuting ? /* @__PURE__ */ jsxDEV21("text", {
            children: /* @__PURE__ */ jsxDEV21(Spinner, {}, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      status === "error" && error && /* @__PURE__ */ jsxDEV21("text", {
        fg: C.error,
        children: /* @__PURE__ */ jsxDEV21("em", {
          children: [
            "  ",
            error
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      Renderer && result != null && /* @__PURE__ */ jsxDEV21("box", {
        paddingLeft: 2,
        children: Renderer({ toolName, args, result })
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/components/MessageItem.tsx
import { jsxDEV as jsxDEV22 } from "@opentui/react/jsx-dev-runtime";
function getThoughtTailPreview(text, maxChars) {
  const lines = text.replace(/\r\n/g, `
`).split(`
`).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0)
    return "";
  const latestLine = lines[lines.length - 1];
  if (latestLine.length <= maxChars)
    return latestLine;
  return `…${latestLine.slice(-(maxChars - 1))}`;
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
  return first.slice(0, maxChars - 1) + "…";
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
  const icon = payload.status === "completed" ? "✓" : payload.status === "failed" ? "✗" : "⊘";
  const iconColor = payload.status === "completed" ? C.accent : C.error;
  const content = payload.result || payload.error || "";
  const firstLine2 = content.split(`
`).filter((l) => l.trim())[0] || "";
  const preview = firstLine2.length > 60 ? firstLine2.slice(0, 57) + "..." : firstLine2;
  return /* @__PURE__ */ jsxDEV22("box", {
    children: /* @__PURE__ */ jsxDEV22("text", {
      children: [
        /* @__PURE__ */ jsxDEV22("span", {
          fg: iconColor,
          children: icon
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV22("span", {
          fg: C.text,
          children: [
            " ",
            payload.description
          ]
        }, undefined, true, undefined, this),
        preview ? /* @__PURE__ */ jsxDEV22("span", {
          fg: C.dim,
          children: [
            " — ",
            preview
          ]
        }, undefined, true, undefined, this) : null
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
var MessageItem = React5.memo(function MessageItem2({ msg, liveTools, liveParts, isStreaming, modelName }) {
  const { width: termWidth } = useTerminalDimensions2();
  const isUser = msg.role === "user";
  const isSummary = msg.isSummary === true;
  if (isSummary) {
    const headerText2 = `· context `;
    const separatorLen2 = Math.max(2, termWidth - headerText2.length - 2);
    const preview = getSummaryPreview(msg.parts.filter((p) => p.type === "text").map((p) => p.text).join(`
`), Math.max(30, termWidth - 20));
    return /* @__PURE__ */ jsxDEV22("box", {
      flexDirection: "column",
      width: "100%",
      children: [
        /* @__PURE__ */ jsxDEV22("box", {
          marginBottom: 1,
          children: /* @__PURE__ */ jsxDEV22("text", {
            children: [
              /* @__PURE__ */ jsxDEV22("span", {
                fg: C.warn,
                children: /* @__PURE__ */ jsxDEV22("strong", {
                  children: headerText2
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV22("span", {
                fg: C.warn,
                children: "─".repeat(separatorLen2)
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV22("text", {
          fg: C.dim,
          children: preview
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV22("box", {
          marginTop: 1,
          children: /* @__PURE__ */ jsxDEV22("text", {
            fg: C.dim,
            children: [
              msg.createdAt != null ? formatTime(msg.createdAt) : "",
              msg.tokenIn != null ? `  ↑${msg.tokenIn.toLocaleString()}` : ""
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  if (msg.isNotificationSummary && msg.notificationPayloads && msg.notificationPayloads.length > 0) {
    const headerText2 = `· bg-tasks completed `;
    const separatorLen2 = Math.max(2, termWidth - headerText2.length - 2);
    return /* @__PURE__ */ jsxDEV22("box", {
      flexDirection: "column",
      width: "100%",
      children: [
        /* @__PURE__ */ jsxDEV22("box", {
          marginBottom: 1,
          children: /* @__PURE__ */ jsxDEV22("text", {
            children: [
              /* @__PURE__ */ jsxDEV22("span", {
                fg: C.warn,
                children: /* @__PURE__ */ jsxDEV22("strong", {
                  children: headerText2
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV22("span", {
                fg: C.warn,
                children: "─".repeat(separatorLen2)
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV22("box", {
          flexDirection: "column",
          backgroundColor: C.toolPendingBg,
          paddingLeft: 1,
          children: msg.notificationPayloads.map((p, i) => /* @__PURE__ */ jsxDEV22("box", {
            children: /* @__PURE__ */ jsxDEV22(NotificationPayloadBlock, {
              payload: p
            }, undefined, false, undefined, this)
          }, `notif-${p.taskId || i}`, false, undefined, this))
        }, undefined, false, undefined, this),
        msg.createdAt != null && /* @__PURE__ */ jsxDEV22("box", {
          marginTop: 1,
          children: /* @__PURE__ */ jsxDEV22("text", {
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
  const headerText = `· ${labelName} `;
  const displayParts = [...msg.parts];
  if (liveParts && liveParts.length > 0)
    displayParts.push(...liveParts);
  if (liveTools && liveTools.length > 0)
    displayParts.push({ type: "tool_use", tools: liveTools });
  const hasAnyContent = displayParts.length > 0;
  const separatorLen = Math.max(2, termWidth - headerText.length - 2);
  const groups = groupParts(displayParts);
  return /* @__PURE__ */ jsxDEV22("box", {
    flexDirection: "column",
    width: "100%",
    children: [
      /* @__PURE__ */ jsxDEV22("box", {
        marginBottom: 1,
        children: /* @__PURE__ */ jsxDEV22("text", {
          children: [
            /* @__PURE__ */ jsxDEV22("span", {
              fg: labelColor,
              children: /* @__PURE__ */ jsxDEV22("strong", {
                children: headerText
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV22("span", {
              fg: labelColor,
              children: "─".repeat(separatorLen)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV22("box", {
        flexDirection: "column",
        width: "100%",
        children: [
          groups.map((group, gi) => {
            if (group.kind === "text" && group.part.text.length > 0) {
              const isLastGroup = gi === groups.length - 1;
              return /* @__PURE__ */ jsxDEV22("box", {
                marginTop: gi > 0 ? 1 : 0,
                children: isUser ? /* @__PURE__ */ jsxDEV22("text", {
                  fg: C.text,
                  children: group.part.text
                }, undefined, false, undefined, this) : msg.isError ? /* @__PURE__ */ jsxDEV22("text", {
                  fg: C.error,
                  children: group.part.text
                }, undefined, false, undefined, this) : msg.isCommand ? /* @__PURE__ */ jsxDEV22("text", {
                  fg: C.textSec,
                  children: group.part.text
                }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV22(MarkdownText, {
                  text: group.part.text,
                  showCursor: isLastGroup && isStreaming
                }, undefined, false, undefined, this)
              }, group.index, false, undefined, this);
            }
            if (group.kind === "thought") {
              const previewText = getThoughtTailPreview(group.part.text, Math.max(24, termWidth - 20));
              const isLastGroup = gi === groups.length - 1;
              const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
              const isAfterTools = prevGroup?.kind === "tools";
              const prefix = group.part.durationMs != null ? `thinking   ${formatElapsedMs(group.part.durationMs)}` : "thinking";
              return /* @__PURE__ */ jsxDEV22("box", {
                marginTop: isAfterTools ? 0 : gi > 0 ? 1 : 0,
                flexDirection: "column",
                backgroundColor: C.thinkingBg,
                paddingLeft: 1,
                children: [
                  /* @__PURE__ */ jsxDEV22("text", {
                    fg: C.primaryLight,
                    children: /* @__PURE__ */ jsxDEV22("em", {
                      children: "· " + prefix
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV22("box", {
                    flexDirection: "column",
                    children: /* @__PURE__ */ jsxDEV22("text", {
                      fg: C.dim,
                      children: /* @__PURE__ */ jsxDEV22("em", {
                        children: [
                          "    ",
                          previewText ? previewText : "...",
                          isLastGroup && isStreaming ? /* @__PURE__ */ jsxDEV22("span", {
                            bg: C.accent,
                            children: " "
                          }, undefined, false, undefined, this) : null
                        ]
                      }, undefined, true, undefined, this)
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this)
                ]
              }, group.index, true, undefined, this);
            }
            if (group.kind === "tools") {
              const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
              const isConsecutiveTools = prevGroup?.kind === "tools";
              const isAfterThought = prevGroup?.kind === "thought";
              return /* @__PURE__ */ jsxDEV22("box", {
                flexDirection: "column",
                width: "100%",
                marginTop: isConsecutiveTools || isAfterThought ? 0 : gi > 0 ? 1 : 0,
                children: /* @__PURE__ */ jsxDEV22("box", {
                  flexDirection: "column",
                  backgroundColor: C.toolPendingBg,
                  paddingLeft: 1,
                  children: [
                    /* @__PURE__ */ jsxDEV22("text", {
                      fg: C.accent,
                      children: /* @__PURE__ */ jsxDEV22("strong", {
                        children: "· tools"
                      }, undefined, false, undefined, this)
                    }, undefined, false, undefined, this),
                    group.tools.map((inv) => /* @__PURE__ */ jsxDEV22(ToolCall, {
                      invocation: inv
                    }, inv.id, false, undefined, this))
                  ]
                }, undefined, true, undefined, this)
              }, `tools-${group.startIndex}`, false, undefined, this);
            }
            return null;
          }),
          isUser && (msg.createdAt != null || msg.tokenIn != null) && /* @__PURE__ */ jsxDEV22("box", {
            marginTop: hasAnyContent ? 1 : 0,
            children: /* @__PURE__ */ jsxDEV22("text", {
              fg: C.dim,
              children: [
                msg.createdAt != null ? formatTime(msg.createdAt) : "",
                msg.tokenIn != null ? `  ↑${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ""}` : ""
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          !isUser && !isStreaming && (msg.createdAt != null || msg.durationMs != null || msg.tokenIn != null) && /* @__PURE__ */ jsxDEV22("box", {
            marginTop: hasAnyContent ? 1 : 0,
            children: /* @__PURE__ */ jsxDEV22("text", {
              fg: C.dim,
              children: [
                msg.createdAt != null ? formatTime(msg.createdAt) : "",
                msg.durationMs != null ? `  ${(msg.durationMs / 1000).toFixed(1)}s` : "",
                msg.tokenIn != null ? `  ↑${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ""}` : "",
                msg.tokenOut != null ? `  ↓${msg.tokenOut.toLocaleString()}` : "",
                msg.tokenOut != null && msg.streamOutputDurationMs != null ? `   ${formatTokenSpeed(msg.tokenOut, msg.streamOutputDurationMs)}` : ""
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          !hasAnyContent && isStreaming && /* @__PURE__ */ jsxDEV22("box", {
            children: /* @__PURE__ */ jsxDEV22(GeneratingTimer, {
              isGenerating: true
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          !hasAnyContent && !isStreaming && /* @__PURE__ */ jsxDEV22("text", {
            children: " "
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
});

// src/components/ChatMessageList.tsx
import { jsxDEV as jsxDEV23 } from "@opentui/react/jsx-dev-runtime";
function ChatMessageList({
  messages,
  streamingParts,
  isStreaming,
  isGenerating,
  retryInfo,
  modelName
}) {
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = (isGenerating || isStreaming) && lastMessage?.role === "assistant";
  return /* @__PURE__ */ jsxDEV23("scrollbox", {
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    children: [
      messages.map((message, index) => {
        const isLastActive = lastIsActiveAssistant && index === messages.length - 1;
        const liveParts = isLastActive && streamingParts.length > 0 ? streamingParts : undefined;
        const hasVisibleContent = message.parts.length > 0 || !!liveParts;
        if (isLastActive && !hasVisibleContent) {
          return /* @__PURE__ */ jsxDEV23("box", {
            flexDirection: "column",
            paddingBottom: 1,
            children: /* @__PURE__ */ jsxDEV23(GeneratingTimer, {
              isGenerating,
              retryInfo
            }, undefined, false, undefined, this)
          }, message.id, false, undefined, this);
        }
        return /* @__PURE__ */ jsxDEV23("box", {
          flexDirection: "column",
          paddingBottom: 1,
          children: [
            /* @__PURE__ */ jsxDEV23(MessageItem, {
              msg: message,
              liveParts,
              isStreaming: isLastActive ? isStreaming : undefined,
              modelName
            }, undefined, false, undefined, this),
            isLastActive && isStreaming && streamingParts.length === 0 ? /* @__PURE__ */ jsxDEV23(GeneratingTimer, {
              isGenerating,
              retryInfo
            }, undefined, false, undefined, this) : null
          ]
        }, message.id, true, undefined, this);
      }),
      isGenerating && !lastIsActiveAssistant && streamingParts.length === 0 ? /* @__PURE__ */ jsxDEV23("box", {
        flexDirection: "column",
        paddingBottom: 1,
        children: /* @__PURE__ */ jsxDEV23(GeneratingTimer, {
          isGenerating,
          retryInfo
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}

// src/components/DiffApprovalView.tsx
import { useMemo as useMemo3 } from "react";
import * as fs from "fs";
import * as path from "path";
import {
  parseUnifiedDiff,
  normalizeWriteArgs,
  normalizeInsertArgs,
  normalizeDeleteCodeArgs,
  resolveProjectPath,
  walkFiles,
  buildSearchRegex,
  decodeText,
  globToRegExp,
  isLikelyBinary,
  toPosix
} from "@irises/extension-sdk/tool-utils";
import { jsxDEV as jsxDEV24 } from "@opentui/react/jsx-dev-runtime";
var DEFAULT_SEARCH_PATTERN = "**/*";
var DEFAULT_SEARCH_MAX_FILES = 50;
var DEFAULT_SEARCH_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, `
`).replace(/\r/g, `
`);
}
function sanitizePatchText(patch) {
  const lines = normalizeLineEndings(patch).split(`
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
  const lines = normalizeLineEndings(text).split(`
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
      if (fs.existsSync(resolved)) {
        before = fs.readFileSync(resolved, "utf-8");
        existed = true;
      }
      if (existed && before === entry.content) {
        unchanged++;
        return;
      }
      const diff = buildWholeFileDiff(entry.path, before, entry.content, existed);
      const action = existed ? "修改" : "新增";
      items.push(diff ? { id: `${inv.id}:write_file:${i}`, filePath: entry.path, label: `${entry.path} · ${action}`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} · ${action}`, existed ? "内容变化特殊，无法显示 diff。" : "将创建空文件。"));
      if (existed)
        modified++;
      else
        created++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
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
      const before = fs.readFileSync(resolved, "utf-8");
      const lines = before.split(`
`);
      const insertLines = entry.content.split(`
`);
      const idx = entry.line - 1;
      const after = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join(`
`);
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? { id: `${inv.id}:insert_code:${i}`, filePath: entry.path, label: `${entry.path} · 第 ${entry.line} 行前插入 ${insertLines.length} 行`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} · 插入`, "无法显示 diff。"));
      successCount++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
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
      const before = fs.readFileSync(resolved, "utf-8");
      const lines = before.split(`
`);
      const after = [...lines.slice(0, entry.start_line - 1), ...lines.slice(entry.end_line)].join(`
`);
      const deletedCount = entry.end_line - entry.start_line + 1;
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? { id: `${inv.id}:delete_code:${i}`, filePath: entry.path, label: `${entry.path} · 删除第 ${entry.start_line}-${entry.end_line} 行（${deletedCount} 行）`, diff, filetype: inferFiletype(entry.path) } : createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} · 删除`, "无法显示 diff。"));
      successCount++;
    } catch (err) {
      errored++;
      items.push(createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
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
    const stat = fs.statSync(rootAbs);
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
      const displayPath = stat.isDirectory() ? toPosix(path.join(inputPath, relPosix)) : toPosix(inputPath);
      const buf = fs.readFileSync(fileAbs);
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
      items.push(diff ? { id: `${inv.id}:search_replace:${displayPath}`, filePath: displayPath, label: `${displayPath} · ${replacements} 处替换`, diff, filetype: inferFiletype(displayPath) } : createMsg(`${inv.id}:search_replace:${displayPath}`, displayPath, `${displayPath} · ${replacements} 处替换`, "文件将变化，但无法显示 diff。"));
      changedFiles++;
      totalReplacements += replacements;
    };
    if (stat.isFile())
      processFile(rootAbs, toPosix(path.basename(rootAbs)));
    else {
      walkFiles(rootAbs, processFile, shouldStop);
      if (processedFiles >= maxFiles)
        truncated = true;
    }
    const summary = [
      `路径 ${inputPath} · pattern ${pattern}`,
      `已处理 ${processedFiles} 个文件 · 将变更 ${changedFiles} 个文件 · 共 ${totalReplacements} 处替换`
    ];
    if (unchangedFiles > 0)
      summary.push(`无实际变化 ${unchangedFiles} 个文件`);
    if (skippedBinary > 0 || skippedTooLarge > 0)
      summary.push(`跳过二进制 ${skippedBinary} 个 · 跳过过大文件 ${skippedTooLarge} 个`);
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
  return /* @__PURE__ */ jsxDEV24("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    backgroundColor: "#0d1117",
    children: [
      /* @__PURE__ */ jsxDEV24("box", {
        flexDirection: "column",
        borderStyle: "double",
        borderColor: C.warn,
        paddingX: 1,
        paddingY: 0,
        flexShrink: 0,
        children: [
          /* @__PURE__ */ jsxDEV24("text", {
            children: [
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.warn,
                children: /* @__PURE__ */ jsxDEV24("strong", {
                  children: preview.title
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.dim,
                children: `  ${preview.toolLabel}`
              }, undefined, false, undefined, this),
              pendingCount > 1 ? /* @__PURE__ */ jsxDEV24("span", {
                fg: C.dim,
                children: `  (剩余 ${pendingCount - 1} 个)`
              }, undefined, false, undefined, this) : null,
              preview.items.length > 1 ? /* @__PURE__ */ jsxDEV24("span", {
                fg: C.dim,
                children: `  (预览 ${normalizedPreviewIndex + 1}/${preview.items.length})`
              }, undefined, false, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV24("text", {
            children: [
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.text,
                children: "文件 "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.primaryLight,
                children: currentItem?.filePath || "(未提供路径)"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.dim,
                children: `  视图:${view === "split" ? "分栏" : "统一"}  行号:${showLineNumbers ? "开" : "关"}  换行:${wrapMode === "word" ? "开" : "关"}`
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          currentItem?.label ? /* @__PURE__ */ jsxDEV24("text", {
            fg: C.dim,
            children: currentItem.label
          }, undefined, false, undefined, this) : null,
          preview.summary.map((line, index) => /* @__PURE__ */ jsxDEV24("text", {
            fg: C.dim,
            children: line
          }, `${preview.toolLabel}.summary.${index}`, false, undefined, this))
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV24("scrollbox", {
        flexGrow: 1,
        flexShrink: 1,
        marginTop: 1,
        borderStyle: "single",
        borderColor: C.border,
        verticalScrollbarOptions: { visible: true },
        horizontalScrollbarOptions: { visible: false },
        children: currentItem?.diff ? /* @__PURE__ */ jsxDEV24("diff", {
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
        }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV24("text", {
          fg: currentItem?.message ? C.textSec : C.dim,
          paddingX: 1,
          paddingY: 1,
          children: currentItem?.message ?? "当前补丁为空，无法显示 diff。"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV24("box", {
        flexDirection: "column",
        marginTop: 1,
        borderStyle: "single",
        borderColor: choice === "approve" ? C.accent : C.error,
        paddingX: 1,
        paddingY: 0,
        flexShrink: 0,
        children: [
          /* @__PURE__ */ jsxDEV24("text", {
            children: [
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.text,
                children: "审批结果 "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: choice === "approve" ? C.accent : C.textSec,
                children: choice === "approve" ? "[批准]" : " 批准 "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: C.dim,
                children: " "
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV24("span", {
                fg: choice === "reject" ? C.error : C.textSec,
                children: choice === "reject" ? "[拒绝]" : " 拒绝 "
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV24("text", {
            fg: C.dim,
            children: [
              preview.items.length > 1 ? "↑ / ↓ 切换文件　" : "",
              "Tab / ← / → 切换　Enter 确认　Y 批准　N 拒绝　V 切换视图　L 切换行号　W 切换换行　Esc 中断本次生成"
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/components/InitWarnings.tsx
import { jsxDEV as jsxDEV25 } from "@opentui/react/jsx-dev-runtime";
var MAX_VISIBLE_LINES = 3;
function InitWarnings({ warnings }) {
  if (warnings.length === 0)
    return null;
  return /* @__PURE__ */ jsxDEV25("box", {
    flexDirection: "column",
    paddingLeft: 2,
    paddingRight: 2,
    paddingBottom: 1,
    maxHeight: MAX_VISIBLE_LINES + 1,
    children: warnings.map((msg, i) => /* @__PURE__ */ jsxDEV25("box", {
      children: /* @__PURE__ */ jsxDEV25("text", {
        children: [
          /* @__PURE__ */ jsxDEV25("span", {
            fg: C.warn,
            children: "⚠ "
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV25("span", {
            fg: C.warn,
            children: msg
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, i, false, undefined, this))
  }, undefined, false, undefined, this);
}

// src/components/LogoScreen.tsx
import { jsxDEV as jsxDEV26 } from "@opentui/react/jsx-dev-runtime";
function LogoScreen() {
  return /* @__PURE__ */ jsxDEV26("box", {
    flexDirection: "column",
    flexGrow: 1,
    padding: 1,
    alignItems: "center",
    justifyContent: "center",
    children: /* @__PURE__ */ jsxDEV26("box", {
      flexDirection: "column",
      border: false,
      padding: 2,
      alignItems: "center",
      children: [
        /* @__PURE__ */ jsxDEV26("text", {
          fg: C.primary,
          children: /* @__PURE__ */ jsxDEV26("strong", {
            children: "▀█▀ █▀█ ▀█▀ █▀▀"
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV26("text", {
          fg: C.primary,
          children: /* @__PURE__ */ jsxDEV26("strong", {
            children: " █  █▀▄  █  ▀▀█"
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV26("text", {
          fg: C.primary,
          children: /* @__PURE__ */ jsxDEV26("strong", {
            children: "▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀"
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV26("text", {
          children: " "
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV26("text", {
          fg: C.dim,
          children: "模块化 AI 智能代理框架"
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/components/ModelListView.tsx
import { jsxDEV as jsxDEV27 } from "@opentui/react/jsx-dev-runtime";
function ModelListView({ models, selectedIndex }) {
  return /* @__PURE__ */ jsxDEV27("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV27("box", {
        padding: 1,
        children: [
          /* @__PURE__ */ jsxDEV27("text", {
            fg: C.primary,
            children: "切换模型"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV27("text", {
            fg: C.dim,
            children: "  ↑↓ 选择  Enter 切换  Esc 返回"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV27("scrollbox", {
        flexGrow: 1,
        children: models.map((info, index) => {
          const isSelected = index === selectedIndex;
          const currentMarker = info.current ? "•" : " ";
          return /* @__PURE__ */ jsxDEV27("box", {
            paddingLeft: 1,
            children: /* @__PURE__ */ jsxDEV27("text", {
              children: [
                /* @__PURE__ */ jsxDEV27("span", {
                  fg: isSelected ? C.accent : C.dim,
                  children: isSelected ? "❯ " : "  "
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV27("span", {
                  fg: info.current ? C.accent : C.dim,
                  children: [
                    currentMarker,
                    " "
                  ]
                }, undefined, true, undefined, this),
                isSelected ? /* @__PURE__ */ jsxDEV27("strong", {
                  children: /* @__PURE__ */ jsxDEV27("span", {
                    fg: C.text,
                    children: info.modelName
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV27("span", {
                  fg: C.textSec,
                  children: info.modelName
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV27("span", {
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

// src/components/QueueListView.tsx
import { jsxDEV as jsxDEV28 } from "@opentui/react/jsx-dev-runtime";
function formatQueueTime(timestamp) {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function truncatePreview(text, maxLen) {
  const single = text.replace(/\r\n/g, `
`).replace(/\n/g, " ↵ ").trim();
  if (single.length <= maxLen)
    return single;
  return single.slice(0, maxLen - 1) + "…";
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
  return /* @__PURE__ */ jsxDEV28("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV28("box", {
        padding: 1,
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxDEV28("box", {
            children: [
              /* @__PURE__ */ jsxDEV28("text", {
                fg: C.primary,
                children: "消息队列"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV28("text", {
                fg: C.dim,
                children: `  (${queue.length} 条待发送)`
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV28("box", {
            paddingTop: 0,
            children: isEditing ? /* @__PURE__ */ jsxDEV28("text", {
              fg: C.dim,
              children: "  Ctrl+J 换行  Enter 确认  Ctrl+U 清空  Esc 取消"
            }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV28("text", {
              fg: C.dim,
              children: "  ↑↓ 选择  Ctrl/Shift+↑↓ 移动  e 编辑  d 删除  c 清空队列  Esc 返回"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV28("scrollbox", {
        flexGrow: 1,
        children: [
          queue.length === 0 && /* @__PURE__ */ jsxDEV28("text", {
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
              return /* @__PURE__ */ jsxDEV28("box", {
                paddingLeft: 1,
                flexDirection: "column",
                children: [
                  /* @__PURE__ */ jsxDEV28("text", {
                    children: [
                      /* @__PURE__ */ jsxDEV28("span", {
                        fg: C.accent,
                        children: "❯ "
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV28("span", {
                        fg: C.dim,
                        children: `${index + 1}. `
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV28("span", {
                        fg: C.warn,
                        children: "[编辑中]"
                      }, undefined, false, undefined, this),
                      nlCount > 0 ? /* @__PURE__ */ jsxDEV28("span", {
                        fg: C.dim,
                        children: ` (${nlCount + 1} 行)`
                      }, undefined, false, undefined, this) : null,
                      /* @__PURE__ */ jsxDEV28("span", {
                        fg: C.dim,
                        children: `  ${time}`
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  /* @__PURE__ */ jsxDEV28("box", {
                    paddingLeft: 4,
                    children: /* @__PURE__ */ jsxDEV28(InputDisplay, {
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
            return /* @__PURE__ */ jsxDEV28("box", {
              paddingLeft: 1,
              children: /* @__PURE__ */ jsxDEV28("text", {
                children: [
                  /* @__PURE__ */ jsxDEV28("span", {
                    fg: isSelected ? C.accent : C.dim,
                    children: isSelected ? "❯ " : "  "
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV28("span", {
                    fg: C.dim,
                    children: `${index + 1}. `
                  }, undefined, false, undefined, this),
                  isSelected ? /* @__PURE__ */ jsxDEV28("strong", {
                    children: /* @__PURE__ */ jsxDEV28("span", {
                      fg: C.text,
                      children: preview
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV28("span", {
                    fg: C.textSec,
                    children: preview
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV28("span", {
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

// src/components/SessionListView.tsx
import { jsxDEV as jsxDEV29 } from "@opentui/react/jsx-dev-runtime";
function SessionListView({ sessions, selectedIndex }) {
  return /* @__PURE__ */ jsxDEV29("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV29("box", {
        padding: 1,
        children: [
          /* @__PURE__ */ jsxDEV29("text", {
            fg: C.primary,
            children: "历史对话"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV29("text", {
            fg: C.dim,
            children: "  ↑↓ 选择  Enter 加载  Esc 返回"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV29("scrollbox", {
        flexGrow: 1,
        children: [
          sessions.length === 0 && /* @__PURE__ */ jsxDEV29("text", {
            fg: C.dim,
            paddingLeft: 2,
            children: "暂无历史对话"
          }, undefined, false, undefined, this),
          sessions.map((meta, index) => {
            const isSelected = index === selectedIndex;
            const time = new Date(meta.updatedAt ?? 0).toLocaleString("zh-CN");
            return /* @__PURE__ */ jsxDEV29("box", {
              paddingLeft: 1,
              children: /* @__PURE__ */ jsxDEV29("text", {
                children: [
                  /* @__PURE__ */ jsxDEV29("span", {
                    fg: isSelected ? C.accent : C.dim,
                    children: isSelected ? "❯ " : "  "
                  }, undefined, false, undefined, this),
                  isSelected ? /* @__PURE__ */ jsxDEV29("strong", {
                    children: /* @__PURE__ */ jsxDEV29("span", {
                      fg: C.text,
                      children: meta.title
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV29("span", {
                    fg: C.textSec,
                    children: meta.title
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV29("span", {
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

// src/components/SettingsView.tsx
import { useCallback as useCallback3, useEffect as useEffect6, useMemo as useMemo4, useState as useState6 } from "react";
import { useKeyboard as useKeyboard2, useTerminalDimensions as useTerminalDimensions3 } from "@opentui/react";

// src/diff-approval.ts
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

// src/settings.ts
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

// src/components/SettingsView.tsx
import { jsxDEV as jsxDEV30 } from "@opentui/react/jsx-dev-runtime";
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
  const compact = firstLine2.length > maxLength ? `${firstLine2.slice(0, Math.max(1, maxLength - 1))}…` : firstLine2;
  if (lines.length <= 1) {
    return compact || "(空)";
  }
  return `${lines.length} 行 · ${compact}`;
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
      label: `${displayName} · ${model.provider} · ${model.modelId || "(空模型 ID)"}`,
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
    const summary = status ? `${server.name || `server_${index + 1}`} · ${server.enabled ? "启用" : "禁用"} · ${transportLabel(server.transport)} · ${status.status}${errorText ? ` · ${errorText}` : ` · ${status.toolCount} tools`}` : `${server.name || `server_${index + 1}`} · ${server.enabled ? "未应用" : "禁用"} · ${transportLabel(server.transport)}`;
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
  const [loading, setLoading] = useState6(true);
  const [saving, setSaving] = useState6(false);
  const [draft, setDraft] = useState6(null);
  const [baseline, setBaseline] = useState6(null);
  const [selectedRowId, setSelectedRowId] = useState6("");
  const [editor, setEditor] = useState6(null);
  const [editorValue, setEditorValue] = useState6("");
  const [statusText, setStatusText] = useState6("");
  const [statusKind, setStatusKind] = useState6("info");
  const [pendingLeaveConfirm, setPendingLeaveConfirm] = useState6(false);
  const [pluginDraft, setPluginDraft] = useState6({});
  const [pluginBaseline, setPluginBaseline] = useState6({});
  const sections = useMemo4(() => {
    const pluginSections = (pluginTabs ?? []).map((tab, i) => ({
      id: tab.id,
      label: tab.label,
      icon: tab.icon ?? String(BUILTIN_SECTIONS.length + i + 1).padStart(2, "0")
    }));
    return [...BUILTIN_SECTIONS, ...pluginSections];
  }, [pluginTabs]);
  const setStatus = useCallback3((text, kind = "info") => {
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
  useEffect6(() => {
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
  useEffect6(() => {
    if (rows.length === 0)
      return;
    if (selectedRowId && rows.some((row) => row.id === selectedRowId && row.target))
      return;
    const preferred = rows.find((row) => row.section === initialSection && row.target) ?? rows.find((row) => row.target);
    if (preferred)
      setSelectedRowId(preferred.id);
  }, [rows, selectedRowId, initialSection]);
  const updateDraft = useCallback3((updater) => {
    setDraft((prev) => {
      if (!prev)
        return prev;
      const next = cloneConsoleSettingsSnapshot(prev);
      updater(next);
      return next;
    });
    setPendingLeaveConfirm(false);
  }, []);
  const reloadSnapshot = useCallback3(async () => {
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
  const handleAddModel = useCallback3(() => {
    let nextIndex = 0;
    updateDraft((snapshot) => {
      nextIndex = snapshot.models.length;
      snapshot.models.push(createEmptyModel());
    });
    setSelectedRowId(`model.${nextIndex}.modelName`);
    setStatus("已新增模型草稿，请先填写名称后保存", "info");
  }, [setStatus, updateDraft]);
  const handleAddMcpServer = useCallback3(() => {
    let nextIndex = 0;
    updateDraft((snapshot) => {
      nextIndex = snapshot.mcpServers.length;
      snapshot.mcpServers.push(createDefaultMCPServerEntry());
    });
    setSelectedRowId(`mcp.${nextIndex}.name`);
    setStatus("已新增 MCP 服务器草稿，请先填写名称后保存", "info");
  }, [setStatus, updateDraft]);
  const startEdit = useCallback3((target) => {
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
  const applyCycle = useCallback3((target, direction) => {
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
  const applyToggle = useCallback3((target) => {
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
  const submitEditor = useCallback3(() => {
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
      const server = snapshot.mcpServers[editor.target.serverIndex];
      if (!server)
        return;
      if (editor.target.field === "name")
        server.name = value.replace(/[^a-zA-Z0-9_]/g, "_");
      else if (editor.target.field === "timeout")
        server.timeout = Number(value.trim());
      else if (editor.target.field === "command")
        server.command = value;
      else if (editor.target.field === "args")
        server.args = value;
      else if (editor.target.field === "cwd")
        server.cwd = value;
      else if (editor.target.field === "url")
        server.url = value;
      else if (editor.target.field === "authHeader")
        server.authHeader = value;
      else
        server.transport = value;
    });
    setStatus("字段已更新，按 S 保存并热重载", "success");
    setEditor(null);
    setEditorValue("");
  }, [editor, editorValue, setStatus, updateDraft]);
  const handleSave = useCallback3(async () => {
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
  const handleDeleteCurrentModel = useCallback3(() => {
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
  const handleDeleteCurrentServer = useCallback3(() => {
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
  useKeyboard2((key) => {
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
    const currentIndex = selectedSelectableIndex >= 0 ? selectedSelectableIndex : 0;
    if (key.name === "up") {
      const prev = selectableRows[Math.max(0, currentIndex - 1)];
      if (prev)
        setSelectedRowId(prev.id);
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === "down") {
      const next = selectableRows[Math.min(selectableRows.length - 1, currentIndex + 1)];
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
    return /* @__PURE__ */ jsxDEV30("box", {
      width: "100%",
      height: "100%",
      justifyContent: "center",
      alignItems: "center",
      children: /* @__PURE__ */ jsxDEV30("text", {
        fg: "#888",
        children: "正在加载配置..."
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV30("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      /* @__PURE__ */ jsxDEV30("box", {
        flexDirection: "row",
        flexGrow: 1,
        children: [
          /* @__PURE__ */ jsxDEV30("box", {
            width: 24,
            flexDirection: "column",
            paddingTop: 1,
            paddingLeft: 2,
            paddingRight: 1,
            children: [
              /* @__PURE__ */ jsxDEV30("text", {
                fg: C.primary,
                children: /* @__PURE__ */ jsxDEV30("strong", {
                  children: "IRIS"
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV30("box", {
                marginTop: 1,
                flexDirection: "column",
                children: sections.map((sec) => /* @__PURE__ */ jsxDEV30("text", {
                  fg: currentSection === sec.id ? C.accent : "#555",
                  children: [
                    currentSection === sec.id ? "●" : "○",
                    " ",
                    sec.icon,
                    " ",
                    sec.label
                  ]
                }, sec.id, true, undefined, this))
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV30("box", {
            flexGrow: 1,
            flexDirection: "column",
            paddingTop: 1,
            paddingLeft: 2,
            children: [
              /* @__PURE__ */ jsxDEV30("box", {
                alignItems: "center",
                paddingBottom: 1,
                flexShrink: 0,
                children: /* @__PURE__ */ jsxDEV30("ascii-font", {
                  text: "IRIS",
                  font: "block",
                  color: C.primary
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV30("box", {
                flexDirection: "column",
                marginBottom: 1,
                flexShrink: 0,
                children: [
                  /* @__PURE__ */ jsxDEV30("text", {
                    fg: "#888",
                    children: "在终端内管理模型池、系统参数、工具策略与 MCP 服务器。"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV30("text", {
                    fg: isDirty ? C.warn : C.accent,
                    children: [
                      isDirty ? "● 有未保存修改" : "✓ 当前草稿已同步",
                      saving ? "  ·  保存中..." : ""
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ jsxDEV30("scrollbox", {
                flexGrow: 1,
                children: [
                  windowStart > 0 && /* @__PURE__ */ jsxDEV30("text", {
                    fg: "#888",
                    children: "…"
                  }, undefined, false, undefined, this),
                  visibleRows.map((row) => {
                    const isSelected = row.id === selectedRowId && !!row.target;
                    const prefix = row.kind === "action" ? isSelected ? "❯" : "•" : row.kind === "field" ? isSelected ? "❯" : " " : " ";
                    return /* @__PURE__ */ jsxDEV30("box", {
                      paddingLeft: row.indent ?? 0,
                      children: /* @__PURE__ */ jsxDEV30("text", {
                        children: [
                          /* @__PURE__ */ jsxDEV30("span", {
                            fg: isSelected ? "#00ffff" : C.dim,
                            children: prefix
                          }, undefined, false, undefined, this),
                          /* @__PURE__ */ jsxDEV30("span", {
                            children: " "
                          }, undefined, false, undefined, this),
                          isSelected && row.kind !== "info" ? /* @__PURE__ */ jsxDEV30("span", {
                            fg: C.accent,
                            children: /* @__PURE__ */ jsxDEV30("strong", {
                              children: row.label
                            }, undefined, false, undefined, this)
                          }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV30("span", {
                            fg: isSelected ? "#00ffff" : undefined,
                            children: row.label
                          }, undefined, false, undefined, this),
                          row.value != null && /* @__PURE__ */ jsxDEV30("span", {
                            fg: isSelected ? "#00ffff" : C.dim,
                            children: `  ${row.value}`
                          }, undefined, false, undefined, this)
                        ]
                      }, undefined, true, undefined, this)
                    }, row.id, false, undefined, this);
                  }),
                  windowEnd < sectionRows.length && /* @__PURE__ */ jsxDEV30("text", {
                    fg: "#888",
                    children: "…"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV30("box", {
        flexDirection: "column",
        marginTop: 1,
        paddingX: 2,
        children: [
          /* @__PURE__ */ jsxDEV30("text", {
            fg: C.dim,
            children: "─".repeat(Math.max(3, termWidth - 4))
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV30("box", {
            flexDirection: "column",
            minHeight: 4,
            children: [
              selectedRow?.description && !editor && /* @__PURE__ */ jsxDEV30("text", {
                fg: "#888",
                children: selectedRow.description
              }, undefined, false, undefined, this),
              statusText && /* @__PURE__ */ jsxDEV30("text", {
                fg: getStatusColor(statusKind),
                children: statusText
              }, undefined, false, undefined, this),
              editor ? /* @__PURE__ */ jsxDEV30("box", {
                flexDirection: "column",
                children: [
                  /* @__PURE__ */ jsxDEV30("text", {
                    fg: C.accent,
                    children: /* @__PURE__ */ jsxDEV30("strong", {
                      children: [
                        "编辑：",
                        editor.label
                      ]
                    }, undefined, true, undefined, this)
                  }, undefined, false, undefined, this),
                  editor.hint && /* @__PURE__ */ jsxDEV30("text", {
                    fg: "#888",
                    children: editor.hint
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV30("box", {
                    children: [
                      /* @__PURE__ */ jsxDEV30("text", {
                        fg: C.accent,
                        children: "❯ "
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV30("input", {
                        value: editorValue,
                        onInput: setEditorValue,
                        focused: true
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  /* @__PURE__ */ jsxDEV30("text", {
                    fg: "#888",
                    children: "Enter 保存 · Esc 取消"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV30("text", {
                fg: "#888",
                children: `↑↓ 选择  ←→ 切换  1~${sections.length} 分栏  Space 布尔  Enter 编辑  A 新增  D 删除  S 保存  R 重载  Esc 返回`
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/hooks/use-app-handle.ts
import { useCallback as useCallback4, useEffect as useEffect7, useRef as useRef5, useState as useState7 } from "react";

// src/message-utils.ts
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
  for (const part of parts)
    appendMergedMessagePart(merged, { ...part });
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

// src/undo-redo.ts
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

// src/hooks/use-app-handle.ts
function useAppHandle({ onReady, undoRedoRef, drainCallbackRef }) {
  const [messages, setMessages] = useState7([]);
  const [streamingParts, setStreamingParts] = useState7([]);
  const [isStreaming, setIsStreaming] = useState7(false);
  const [isGenerating, setIsGenerating] = useState7(false);
  const [contextTokens, setContextTokens] = useState7(0);
  const [retryInfo, setRetryInfo] = useState7(null);
  const [pendingApprovals, setPendingApprovals] = useState7([]);
  const [pendingApplies, setPendingApplies] = useState7([]);
  const [backgroundTaskCount, setBackgroundTaskCount] = useState7(0);
  const [delegateTaskCount, setDelegateTaskCount] = useState7(0);
  const backgroundTaskTokenMapRef = useRef5(new Map);
  const [backgroundTaskTokens, setBackgroundTaskTokens] = useState7(0);
  const spinnerFrameRef = useRef5(0);
  const [backgroundTaskSpinnerFrame, setBackgroundTaskSpinnerFrame] = useState7(0);
  const streamPartsRef = useRef5([]);
  const toolInvocationsRef = useRef5([]);
  const throttleTimerRef = useRef5(null);
  const uncommittedStreamPartsRef = useRef5([]);
  const lastUsageRef = useRef5(null);
  const notificationContextRef = useRef5({ active: false });
  const commitTools = useCallback4(() => {
    toolInvocationsRef.current = [];
    setPendingApprovals([]);
    setPendingApplies([]);
  }, []);
  useEffect7(() => {
    return () => {
      if (throttleTimerRef.current)
        clearTimeout(throttleTimerRef.current);
    };
  }, []);
  useEffect7(() => {
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
          if (last?.role === "assistant" && !isNotif)
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
          const uncommitted = uncommittedStreamPartsRef.current;
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
        setRetryInfo(null);
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
      drainQueue() {
        return drainCallbackRef.current?.() ?? undefined;
      }
    };
    onReady(handle);
  }, [commitTools, drainCallbackRef, onReady, undoRedoRef]);
  return {
    messages,
    streamingParts,
    isStreaming,
    isGenerating,
    contextTokens,
    retryInfo,
    pendingApprovals,
    pendingApplies,
    backgroundTaskCount,
    delegateTaskCount,
    backgroundTaskTokens,
    backgroundTaskSpinnerFrame,
    setMessages,
    commitTools
  };
}

// src/hooks/use-app-keyboard.ts
import { useKeyboard as useKeyboard3 } from "@opentui/react";
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
  approval,
  onExit,
  onAbort,
  onToolApply,
  onToolApproval,
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
  queueEditActions
}) {
  useKeyboard3((key) => {
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
    if (viewMode === "settings")
      return;
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
      if (key.name === "left" || key.name === "up" || key.name === "right" || key.name === "down") {
        approval.toggleChoice();
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        onToolApproval(pendingApprovals[0].id, approval.approvalChoice === "approve");
        approval.resetChoice();
        return;
      }
      if (key.name === "y") {
        onToolApproval(pendingApprovals[0].id, true);
        approval.resetChoice();
        return;
      }
      if (key.name === "n") {
        onToolApproval(pendingApprovals[0].id, false);
        approval.resetChoice();
        return;
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

// src/hooks/use-approval.ts
import { useCallback as useCallback5, useEffect as useEffect8, useState as useState8 } from "react";
function useApproval(pendingApprovals, pendingApplies) {
  const [approvalChoice, setApprovalChoice] = useState8("approve");
  const [diffView, setDiffView] = useState8("unified");
  const [showLineNumbers, setShowLineNumbers] = useState8(true);
  const [wrapMode, setWrapMode] = useState8("word");
  const [previewIndex, setPreviewIndex] = useState8(0);
  useEffect8(() => {
    setApprovalChoice("approve");
  }, [pendingApprovals[0]?.id]);
  useEffect8(() => {
    setApprovalChoice("approve");
    setDiffView("unified");
    setShowLineNumbers(true);
    setWrapMode("word");
    setPreviewIndex(0);
  }, [pendingApplies[0]?.id]);
  const resetChoice = useCallback5(() => {
    setApprovalChoice("approve");
  }, []);
  const toggleChoice = useCallback5(() => {
    setApprovalChoice((prev) => prev === "approve" ? "reject" : "approve");
  }, []);
  const toggleDiffView = useCallback5(() => {
    setDiffView((prev) => prev === "unified" ? "split" : "unified");
  }, []);
  const toggleLineNumbers = useCallback5(() => {
    setShowLineNumbers((prev) => !prev);
  }, []);
  const toggleWrapMode = useCallback5(() => {
    setWrapMode((prev) => prev === "none" ? "word" : "none");
  }, []);
  return {
    approvalChoice,
    diffView,
    showLineNumbers,
    wrapMode,
    previewIndex,
    setPreviewIndex,
    resetChoice,
    toggleChoice,
    toggleDiffView,
    toggleLineNumbers,
    toggleWrapMode
  };
}

// src/hooks/use-command-dispatch.ts
import { useCallback as useCallback6 } from "react";
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
  onSwitchAgent,
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
  return useCallback6((text) => {
    if (text === "/exit") {
      onExit();
      return;
    }
    if (text === "/agent") {
      if (onSwitchAgent) {
        onSwitchAgent();
        return;
      }
      appendCommandMessage(setMessages, "当前未启用多 Agent 模式。请在 ~/.iris/agents.yaml 中设置 enabled: true。");
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
    onResetConfig,
    onRunCommand,
    onSubmit,
    onSwitchAgent,
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

// src/hooks/use-exit-confirm.ts
import { useCallback as useCallback7, useEffect as useEffect9, useRef as useRef6, useState as useState9 } from "react";
function useExitConfirm({ timeoutMs = 1500 } = {}) {
  const [exitConfirmArmed, setExitConfirmArmed] = useState9(false);
  const exitConfirmTimerRef = useRef6(null);
  const clearExitConfirm = useCallback7(() => {
    if (exitConfirmTimerRef.current) {
      clearTimeout(exitConfirmTimerRef.current);
      exitConfirmTimerRef.current = null;
    }
    setExitConfirmArmed(false);
  }, []);
  const armExitConfirm = useCallback7(() => {
    if (exitConfirmTimerRef.current)
      clearTimeout(exitConfirmTimerRef.current);
    setExitConfirmArmed(true);
    exitConfirmTimerRef.current = setTimeout(() => {
      exitConfirmTimerRef.current = null;
      setExitConfirmArmed(false);
    }, timeoutMs);
  }, [timeoutMs]);
  useEffect9(() => {
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

// src/hooks/use-message-queue.ts
import { useCallback as useCallback8, useRef as useRef7, useState as useState10 } from "react";
var queueIdCounter = 0;
function useMessageQueue() {
  const [queue, setQueue] = useState10([]);
  const queueRef = useRef7([]);
  const sync = useCallback8((next) => {
    queueRef.current = next;
    setQueue(next);
  }, []);
  const prepend = useCallback8((text) => {
    const msg = {
      id: `queued-${++queueIdCounter}`,
      text,
      createdAt: Date.now()
    };
    const next = [msg, ...queueRef.current];
    sync(next);
    return msg;
  }, [sync]);
  const enqueue = useCallback8((text) => {
    const msg = {
      id: `queued-${++queueIdCounter}`,
      text,
      createdAt: Date.now()
    };
    const next = [...queueRef.current, msg];
    sync(next);
    return msg;
  }, [sync]);
  const dequeue = useCallback8(() => {
    const current = queueRef.current;
    if (current.length === 0)
      return;
    const [first, ...rest] = current;
    sync(rest);
    return first;
  }, [sync]);
  const peek = useCallback8(() => {
    return queueRef.current[0];
  }, []);
  const edit = useCallback8((id, newText) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0)
      return false;
    const next = [...current];
    next[index] = { ...next[index], text: newText };
    sync(next);
    return true;
  }, [sync]);
  const remove = useCallback8((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0)
      return false;
    const next = current.filter((m) => m.id !== id);
    sync(next);
    return true;
  }, [sync]);
  const moveUp = useCallback8((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index <= 0)
      return false;
    const next = [...current];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    sync(next);
    return true;
  }, [sync]);
  const moveDown = useCallback8((id) => {
    const current = queueRef.current;
    const index = current.findIndex((m) => m.id === id);
    if (index < 0 || index >= current.length - 1)
      return false;
    const next = [...current];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    sync(next);
    return true;
  }, [sync]);
  const clear = useCallback8(() => {
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

// src/hooks/use-model-state.ts
import { useCallback as useCallback9, useState as useState11 } from "react";
function useModelState({ modelId, modelName, contextWindow }) {
  const [currentModelId, setCurrentModelId] = useState11(modelId);
  const [currentModelName, setCurrentModelName] = useState11(modelName);
  const [currentContextWindow, setCurrentContextWindow] = useState11(contextWindow);
  const updateModel = useCallback9((result) => {
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

// src/App.tsx
import { jsxDEV as jsxDEV31 } from "@opentui/react/jsx-dev-runtime";
function App({
  onReady,
  onSubmit,
  onUndo,
  onRedo,
  onClearRedoStack,
  onToolApproval,
  onToolApply,
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
  onSwitchAgent,
  initWarnings,
  agentName,
  modeName,
  modelId,
  modelName,
  contextWindow,
  pluginSettingsTabs
}) {
  const [viewMode, setViewMode] = useState12("chat");
  const [sessionList, setSessionList] = useState12([]);
  const [selectedIndex, setSelectedIndex] = useState12(0);
  const [settingsInitialSection, setSettingsInitialSection] = useState12("general");
  const [modelList, setModelList] = useState12([]);
  const [copyMode, setCopyMode] = useState12(false);
  const [pendingConfirm, setPendingConfirm] = useState12(null);
  const [confirmChoice, setConfirmChoice] = useState12("confirm");
  const [queueEditingId, setQueueEditingId] = useState12(null);
  const [queueEditState, queueEditActions] = useTextInput("");
  const renderer = useRenderer();
  const undoRedoRef = useRef8(createUndoRedoStack());
  const messageQueue = useMessageQueue();
  const drainCallbackRef = useRef8(null);
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
  const queueAwareSubmit = useCallback10((text) => {
    if (appState.isGenerating) {
      messageQueue.enqueue(text);
    } else {
      onSubmit(text);
    }
  }, [appState.isGenerating, messageQueue, onSubmit]);
  const handlePrioritySubmit = useCallback10((text) => {
    messageQueue.prepend(text);
    onAbort();
  }, [messageQueue, onAbort]);
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
    onSwitchAgent,
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
  useEffect10(() => {
    if (!renderer)
      return;
    renderer.useMouse = !copyMode;
  }, [renderer, copyMode]);
  const prevViewModeRef = useRef8(viewMode);
  useEffect10(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (prev === "queue-list" && viewMode === "chat" && !appState.isGenerating && messageQueue.size > 0) {
      const next = messageQueue.dequeue();
      if (next) {
        onSubmit(next.text);
      }
    }
  }, [viewMode, appState.isGenerating, messageQueue, onSubmit]);
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
    approval,
    onExit,
    onAbort,
    onToolApply,
    onToolApproval,
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
    queueEditActions
  });
  const currentApply = appState.isGenerating ? appState.pendingApplies[0] : undefined;
  const hasMessages = appState.messages.length > 0 || appState.isGenerating;
  if (viewMode === "settings") {
    return /* @__PURE__ */ jsxDEV31(SettingsView, {
      initialSection: settingsInitialSection,
      onBack: () => setViewMode("chat"),
      onLoad: onLoadSettings,
      onSave: onSaveSettings,
      pluginTabs: pluginSettingsTabs
    }, undefined, false, undefined, this);
  }
  if (viewMode === "session-list") {
    return /* @__PURE__ */ jsxDEV31(SessionListView, {
      sessions: sessionList,
      selectedIndex
    }, undefined, false, undefined, this);
  }
  if (viewMode === "model-list") {
    return /* @__PURE__ */ jsxDEV31(ModelListView, {
      models: modelList,
      selectedIndex
    }, undefined, false, undefined, this);
  }
  if (viewMode === "queue-list") {
    return /* @__PURE__ */ jsxDEV31(QueueListView, {
      queue: messageQueue.queue,
      selectedIndex,
      editingId: queueEditingId,
      editingValue: queueEditState.value,
      editingCursor: queueEditState.cursor
    }, undefined, false, undefined, this);
  }
  if (currentApply) {
    return /* @__PURE__ */ jsxDEV31(DiffApprovalView, {
      invocation: currentApply,
      pendingCount: appState.pendingApplies.length,
      choice: approval.approvalChoice,
      view: approval.diffView,
      showLineNumbers: approval.showLineNumbers,
      wrapMode: approval.wrapMode,
      previewIndex: approval.previewIndex
    }, undefined, false, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV31("box", {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    children: [
      !hasMessages ? /* @__PURE__ */ jsxDEV31(LogoScreen, {}, undefined, false, undefined, this) : null,
      !hasMessages && initWarnings && initWarnings.length > 0 ? /* @__PURE__ */ jsxDEV31(InitWarnings, {
        warnings: initWarnings
      }, undefined, false, undefined, this) : null,
      hasMessages ? /* @__PURE__ */ jsxDEV31(ChatMessageList, {
        messages: appState.messages,
        streamingParts: appState.streamingParts,
        isStreaming: appState.isStreaming,
        isGenerating: appState.isGenerating,
        retryInfo: appState.retryInfo,
        modelName: modelState.currentModelName
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ jsxDEV31(BottomPanel, {
        hasMessages,
        pendingConfirm,
        confirmChoice,
        pendingApprovals: appState.pendingApprovals,
        approvalChoice: approval.approvalChoice,
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
        backgroundTaskSpinnerFrame: appState.backgroundTaskSpinnerFrame
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/opentui-runtime.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
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
    const execDir = path2.dirname(fs2.realpathSync(process.execPath));
    const candidates = [
      path2.join(execDir, OPENTUI_RUNTIME_DIR_NAME),
      path2.join(path2.resolve(execDir, ".."), OPENTUI_RUNTIME_DIR_NAME)
    ];
    for (const candidate of candidates) {
      if (fs2.existsSync(path2.join(candidate, "parser.worker.js"))) {
        return candidate;
      }
    }
  } catch {}
  return null;
}
function hasBundledAssets(assetsRoot) {
  return REQUIRED_ASSET_FILES.every((relativePath) => fs2.existsSync(path2.join(assetsRoot, relativePath)));
}
function createBundledParsers(assetsRoot) {
  const asset = (...segments) => path2.join(assetsRoot, ...segments);
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
  const workerPath = process.env.OTUI_TREE_SITTER_WORKER_PATH?.trim() || (runtimeDir ? path2.join(runtimeDir, "parser.worker.js") : "");
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
    const assetsRoot = path2.join(runtimeDir, "assets");
    if (hasBundledAssets(assetsRoot)) {
      addDefaultParsers(createBundledParsers(assetsRoot));
    } else {
      warnRuntimeIssue("未找到完整的 OpenTUI tree-sitter 资源目录，Markdown 代码高亮可能不可用。");
    }
  }
  configured = true;
}

// src/resize-watcher.ts
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

// src/index.ts
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
  const ts = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "_" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

class ConsolePlatform extends PlatformAdapter {
  sessionId;
  modeName;
  modelId;
  modelName;
  contextWindow;
  backend;
  agentName;
  onSwitchAgent;
  settingsController;
  initWarnings;
  renderer;
  appHandle;
  disposeResizeWatcher;
  api;
  isCompiledBinary;
  currentToolIds = new Set;
  historyMutationQueue = Promise.resolve();
  constructor(backend, options) {
    super();
    this.backend = backend;
    this.sessionId = generateSessionId();
    this.modeName = options.modeName;
    this.modelId = options.modelId;
    this.modelName = options.modelName;
    this.contextWindow = options.contextWindow;
    this.agentName = options.agentName;
    this.onSwitchAgent = options.onSwitchAgent;
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
    this.backend.on("tool:update", (sid, invocations) => {
      if (sid === this.sessionId) {
        this.appHandle?.setToolInvocations(invocations);
      }
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
        text = `⏰ ${description} 完成：${preview}`;
      } else if (status === "killed") {
        text = `⏰ ${description} 被中止`;
      } else {
        text = `⏰ ${description} 失败：${result ?? "未知错误"}`;
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
    return new Promise(async (resolve2, reject) => {
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
      const element = React9.createElement(App, {
        onReady: (handle) => {
          this.appHandle = handle;
          resolve2();
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
          this.backend.approveTool?.(toolId, approved);
        },
        onToolApply: (toolId, applied) => {
          this.backend.applyTool?.(toolId, applied);
        },
        onAbort: () => {
          this.backend.abortChat?.(this.sessionId);
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
        onExit: () => this.stop(),
        onSummarize: () => this.handleSummarize(),
        onSwitchAgent: this.onSwitchAgent,
        agentName: this.agentName,
        modeName: this.modeName,
        modelId: this.modelId,
        modelName: this.modelName,
        contextWindow: this.contextWindow,
        initWarnings: this.initWarnings,
        pluginSettingsTabs: this.api?.getConsoleSettingsTabs?.() ?? []
      });
      createRoot(this.renderer).render(element);
    });
  }
  async stop() {
    this.disposeResizeWatcher?.();
    this.renderer?.destroy();
  }
  handleNewSession() {
    this.sessionId = generateSessionId();
    this.currentToolIds.clear();
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
  async handleLoadSession(id) {
    this.sessionId = id;
    this.currentToolIds.clear();
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
  async handleSummarize() {
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
      this.appHandle?.setGenerating(false);
    }
  }
  async handleInput(text) {
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
    onSwitchAgent: context.onSwitchAgent,
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
