/** @jsxImportSource @opentui/react */

/**
 * 底部输入栏 (OpenTUI React)
 *
 * 使用自定义 useTextInput + InputDisplay 实现带光标的输入，
 * 与 onboard 风格一致。
 *
 * 当 AI 正在生成时，输入栏仍然可用：用户可以提前输入消息，
 * 提交后消息将被放入排队队列，待当前生成完成后自动发送。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { COMMANDS, type Command, getCommandInput, isExactCommandValue } from '../input-commands';
import { useTextInput } from '../hooks/use-text-input';
import { useCursorBlink } from '../hooks/use-cursor-blink';
import { usePaste } from '../hooks/use-paste';
import { InputDisplay } from './InputDisplay';
import { C } from '../theme';
import { getTextWidth } from '../text-layout';

interface InputBarProps {
  disabled: boolean;
  isGenerating: boolean;
  queueSize: number;
  onSubmit: (text: string) => void;
  /** 强制优先发送：中断当前生成，在队列最前面插入并立即发送 */
  onPrioritySubmit: (text: string) => void;
}

export function InputBar({ disabled, isGenerating, queueSize, onSubmit, onPrioritySubmit }: InputBarProps) {
  const [inputState, inputActions] = useTextInput('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const cursorVisible = useCursorBlink();
  const { width: termWidth } = useTerminalDimensions();

  const visibleCommands = COMMANDS;

  // ── 粘贴保护 ──────────────────────────────────────────────
  // 当 bracketed paste 事件触发时，框架可能同时发出对应的逐字符
  // key 事件；此标志在粘贴期间屏蔽 useKeyboard，避免换行符被当作
  // Enter 提交。
  const pasteGuardRef = useRef(false);

  // ── 快速输入检测（兜底：不支持 bracketed paste 的终端）────
  // 当连续按键间隔 < 15ms 且累计 ≥ 3 次时判定为粘贴行为；
  // 此时 Enter 被当作换行符插入而非触发提交，保留原始换行信息。
  // 间隔 > 80ms 时重置计数（正常手动输入不可能 < 15ms）。
  const lastKeyTimeRef = useRef(0);
  const rapidKeyCountRef = useRef(0);

  const value = inputState.value;

  // 输入是否完全被禁止（仅在审批/确认对话框等场景）
  const inputDisabled = disabled;
  // 输入是否可用但处于排队模式（生成中但无审批/确认阻断）
  const isQueueMode = !disabled && isGenerating;

  const exactMatchIndex = useMemo(() => {
    return visibleCommands.findIndex((cmd) => isExactCommandValue(value, cmd));
  }, [value, visibleCommands]);

  const commandQuery = useMemo(() => {
    if (inputDisabled) return '';
    if (!value.startsWith('/')) return '';
    if (/\s/.test(value) && exactMatchIndex < 0) return '';
    return value;
  }, [inputDisabled, value, exactMatchIndex]);

  const showCommands = commandQuery.length > 0;

  const filtered = useMemo(() => {
    if (!showCommands) return [];
    if (exactMatchIndex >= 0) return visibleCommands;
    return visibleCommands.filter((cmd) => cmd.name.startsWith(commandQuery.trim()));
  }, [showCommands, exactMatchIndex, commandQuery, visibleCommands]);

  useEffect(() => {
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

  const applySelection = (index: number) => {
    if (filtered.length === 0) return;
    const normalizedIndex = ((index % filtered.length) + filtered.length) % filtered.length;
    const cmd = filtered[normalizedIndex];
    setSelectedIndex(normalizedIndex);
    inputActions.setValue(getCommandInput(cmd));
  };

  useKeyboard((key) => {
    if (inputDisabled) return;

    // 粘贴保护：粘贴事件处理期间忽略所有键盘事件
    if (pasteGuardRef.current) return;

    // 快速输入检测：连续快速按键视为粘贴操作
    const now = Date.now();
    const delta = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;
    if (delta < 15) {
      rapidKeyCountRef.current++;
    } else if (delta > 80) {
      rapidKeyCountRef.current = 0;
    }

    // 指令面板导航
    if (showCommands && filtered.length > 0) {
      if (key.name === 'up') { applySelection(selectedIndex + 1); return; }
      if (key.name === 'down') { applySelection(selectedIndex - 1); return; }
      if (key.name === 'tab') {
        const current = filtered[selectedIndex];
        if (current) {
          applySelection(isExactCommandValue(value, current) ? selectedIndex - 1 : selectedIndex);
        }
        return;
      }
    }

    // Ctrl+S → 强制优先发送（中断当前生成，跳过队列立即发送）
    if (key.ctrl && key.name === 's') {
      if (!isQueueMode) return;
      const text = value.trim();
      if (!text) return;
      onPrioritySubmit(text);
      inputActions.setValue('');
      setSelectedIndex(0);
      return;
    }


    // Enter → 提交（生成中自动入队）/ 粘贴时插入换行
    if (key.name === 'enter' || key.name === 'return') {
      // 快速输入中（疑似粘贴）：将 Enter 当作换行符插入，保留原始换行
      if (rapidKeyCountRef.current >= 3) {
        inputActions.insert('\n');
        return;
      }
      const text = value.trim();
      if (!text) return;
      onSubmit(text);
      inputActions.setValue('');
      setSelectedIndex(0);
      return;
    }

    // 功能键不应作为文本输入（Esc 由 useAppKeyboard 处理 abort/视图切换，
    // 此处若不拦截，其单字节序列 0x1B 会被 useTextInput 当作可打印字符插入）
    if (key.name === 'escape') return;

    // 委托给 useTextInput 处理其余按键
    inputActions.handleKey(key);
  });

  // 处理粘贴事件：保留换行符，支持多行粘贴；
  // 同时设置 pasteGuard 屏蔽粘贴期间泄露的 key 事件。
  usePaste((text) => {
    if (inputDisabled) return;
    pasteGuardRef.current = true;
    const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (cleaned) {
      inputActions.insert(cleaned);
    }
    // 延迟清除保护标志，确保所有残留 key 事件都已被过滤
    setTimeout(() => { pasteGuardRef.current = false; }, 150);
  });

  const maxLen = filtered.length > 0
    ? Math.max(...filtered.map((cmd) => cmd.name.length))
    : 0;

  // ── 输入区域滚动判定 ──────────────────────────────────────
  // 根据终端宽度计算实际渲染行数（含自动换行），超过上限才启用 scrollbox。
  // 水平开销 = paddingX(2) + border(2) + innerPadding(2) + prompt(3) = 9
  const MAX_VISIBLE_INPUT_LINES = 8;
  const availableWidth = Math.max(1, termWidth - 9);

  const visualLineCount = useMemo(() => {
    if (!value) return 1;
    const lines = value.split('\n');
    let count = 0;
    for (const line of lines) {
      const w = getTextWidth(line);
      // 空行占 1 行；非空行按终端宽度折行
      count += w === 0 ? 1 : Math.ceil(w / availableWidth);
    }
    return count;
  }, [value, availableWidth]);

  const needsInputScroll = visualLineCount > MAX_VISIBLE_INPUT_LINES;

  // 提示符样式和 placeholder 根据状态变化
  const promptColor = inputDisabled ? C.dim : isQueueMode ? C.warn : C.accent;
  const promptChar = isQueueMode ? '\u23F3 ' : '\u276F ';
  const placeholder = isQueueMode ? '输入消息（将排队发送）…' : '输入消息…';

  const inputRow = (
    <box flexDirection="row" border={false}>
      <text fg={promptColor}><strong>{promptChar} </strong></text><InputDisplay
        value={value}
        cursor={inputState.cursor}
        availableWidth={availableWidth}
        isActive={!inputDisabled}
        cursorVisible={cursorVisible}
        placeholder={placeholder}
      />
    </box>
  );

  return (
    <box flexDirection="column">

      {/* 指令列表（向上展开，位于输入框上方） */}
      {filtered.length > 0 && (
        <box flexDirection="column" backgroundColor={C.panelBg} paddingX={1}>
          {[...filtered].reverse().map((cmd: Command, _i) => {
            const index = filtered.indexOf(cmd);
            const padded = cmd.name.padEnd(maxLen);
            const isSelected = index === selectedIndex;
            return (
              <box key={cmd.name} paddingLeft={1} backgroundColor={isSelected ? C.border : undefined}>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '▸ ' : '  '}</span>
                  {isSelected ? <strong><span fg={C.text}>{padded}</span></strong> : <span fg={C.textSec}>{padded}</span>}
                  <span fg={isSelected ? C.textSec : C.dim}>  {cmd.description}</span>
                </text>
              </box>
            );
          })}
        </box>
      )}

      {/* 输入区域：高度随内容增长，超出上限后固定并启用滚动 */}
      <scrollbox
        height={Math.min(visualLineCount, MAX_VISIBLE_INPUT_LINES)}
        stickyScroll
        stickyStart="bottom"
        verticalScrollbarOptions={{ visible: needsInputScroll }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        {inputRow}
      </scrollbox>
    </box>
  );
}
