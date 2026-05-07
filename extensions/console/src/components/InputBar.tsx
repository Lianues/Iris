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
import { COMMANDS, type Command, type CommandArgSuggestion, getCommandInput, isExactCommandValue } from '../input-commands';
import { useTextInput } from '../hooks/use-text-input';
import { useCursorBlink } from '../hooks/use-cursor-blink';
import { usePaste } from '../hooks/use-paste';
import { InputDisplay } from './InputDisplay';
import { C } from '../theme';
import { getTextWidth } from '../text-layout';
import { HOURGLASS_SPINNER_FRAMES, HOURGLASS_SPINNER_INTERVAL_MS, ICONS } from '../terminal-compat';

/** 待发送的文件附件信息 */
export interface PendingFile {
  path: string;
  fileType: 'image' | 'document' | 'audio' | 'video';
  mimeType: string;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  image: '📷', document: '📄', audio: '🎵', video: '🎬',
};

function isPlanModeToggleShortcut(key: any): boolean {
  return (key.shift && key.name === 'tab')
    || key.name === 'backtab'
    || key.name === 'shift-tab'
    || key.sequence === '\x1b[Z';
}

interface InputBarProps {
  disabled: boolean;
  isGenerating: boolean;
  queueSize: number;
  onSubmit: (text: string) => void;
  /** 强制优先发送：中断当前生成，在队列最前面插入并立即发送 */
  onPrioritySubmit: (text: string) => void;
  /** Shift+Left/Right 切换思考强度 */
  onCycleThinkingEffort: (direction: 1 | -1) => void;
  /** 当前待发送的文件附件列表 */
  pendingFiles: PendingFile[];
  /** 移除指定索引的待发送文件 */
  onRemoveFile: (index: number) => void;
  /** 当前是否处于远程连接状态 */
  isRemote?: boolean;
  dynamicCommands?: Command[];
  supportsHeadlessTransition?: boolean;
}

export function InputBar({ disabled, isGenerating, queueSize, onSubmit, onPrioritySubmit, onCycleThinkingEffort, pendingFiles, onRemoveFile, isRemote, dynamicCommands = [], supportsHeadlessTransition }: InputBarProps) {
  const [inputState, inputActions] = useTextInput('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [queuePromptFrame, setQueuePromptFrame] = useState(0);
  const cursorVisible = useCursorBlink();
  const { width: termWidth } = useTerminalDimensions();

  const visibleCommands = useMemo(
    () => {
      const commands = [...COMMANDS, ...dynamicCommands];
      const seen = new Set<string>();
      return commands.filter((cmd) => (
        (!cmd.remoteOnly || isRemote)
        && (!cmd.requiresHeadlessSupport || supportsHeadlessTransition)
        && !seen.has(cmd.name)
        && seen.add(cmd.name)
      ));
    },
    [isRemote, supportsHeadlessTransition, dynamicCommands],
  );

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

  const activeArgCommand = useMemo(() => {
    if (inputDisabled || !value.startsWith('/')) return undefined;
    return visibleCommands
      .filter((cmd) => cmd.acceptsArgs && (value === cmd.name || value.startsWith(`${cmd.name} `)))
      .sort((a, b) => b.name.length - a.name.length)[0];
  }, [inputDisabled, value, visibleCommands]);

  const argQuery = useMemo(() => {
    if (!activeArgCommand) return '';
    if (value === activeArgCommand.name) return '';
    return value.slice(activeArgCommand.name.length).trimStart();
  }, [activeArgCommand, value]);

  const argSuggestions = useMemo<CommandArgSuggestion[]>(() => {
    if (!activeArgCommand?.getArgSuggestions) return [];
    const all = activeArgCommand.getArgSuggestions({ arg: argQuery, raw: value });
    const q = argQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item) => item.value.toLowerCase().includes(q));
  }, [activeArgCommand, argQuery, value]);

  const commandQuery = useMemo(() => {
    if (inputDisabled) return '';
    if (!value.startsWith('/')) return '';
    if (activeArgCommand && value.startsWith(`${activeArgCommand.name} `)) return '';
    if (/\s/.test(value) && exactMatchIndex < 0) return '';
    return value;
  }, [inputDisabled, value, exactMatchIndex, activeArgCommand]);

  const [commandsDismissed, setCommandsDismissed] = useState(false);

  // 输入内容变化时重新打开面板
  useEffect(() => { setCommandsDismissed(false); }, [commandQuery]);

  const showCommands = commandQuery.length > 0 && !commandsDismissed;
  const showArgSuggestions = !!activeArgCommand && argSuggestions.length > 0 && !commandsDismissed && value.startsWith(`${activeArgCommand.name} `);

  const filtered = useMemo(() => {
    if (!showCommands) return [];
    if (exactMatchIndex >= 0) return visibleCommands;
    return visibleCommands.filter((cmd) => cmd.name.startsWith(commandQuery.trim()));
  }, [showCommands, exactMatchIndex, commandQuery, visibleCommands]);

  useEffect(() => {
    if (showArgSuggestions) {
      setSelectedIndex((prev) => Math.min(prev, argSuggestions.length - 1));
      return;
    }
    if (!showCommands || filtered.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (exactMatchIndex >= 0) {
      setSelectedIndex(exactMatchIndex);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, filtered.length - 1));
  }, [showCommands, filtered.length, exactMatchIndex, showArgSuggestions, argSuggestions.length]);

  const applySelection = (index: number) => {
    const count = showArgSuggestions ? argSuggestions.length : filtered.length;
    if (count === 0) return;
    const normalizedIndex = ((index % count) + count) % count;
    setSelectedIndex(normalizedIndex);
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

    // Shift+Tab 是全局 Plan Mode 切换快捷键，输入框不应插入 Tab 或消费该按键。
    if (isPlanModeToggleShortcut(key)) {
      key.preventDefault?.();
      return;
    }

    // 指令面板导航
    if ((showCommands && filtered.length > 0) || (showArgSuggestions && argSuggestions.length > 0)) {
      if (key.name === 'up') { applySelection(selectedIndex + 1); return; }
      if (key.name === 'down') { applySelection(selectedIndex - 1); return; }
      if (key.name === 'tab') {
        if (showArgSuggestions && activeArgCommand) {
          const current = argSuggestions[selectedIndex];
          if (current) inputActions.setValue(`${activeArgCommand.name} ${current.value}`);
          return;
        }
        const current = filtered[selectedIndex];
        if (current) {
          if (isExactCommandValue(value, current)) {
            // 输入已匹配当前选中项，循环到下一个并补全
            const nextIndex = ((selectedIndex - 1) % filtered.length + filtered.length) % filtered.length;
            const nextCmd = filtered[nextIndex];
            if (nextCmd) {
              inputActions.setValue(getCommandInput(nextCmd));
              applySelection(nextIndex);
            }
          } else {
            // 补全当前选中项的文本到输入栏
            inputActions.setValue(getCommandInput(current));
          }
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
      // 命令面板打开时，Enter 先补全为选中的命令再提交
      let text = value.trim();
      if (showArgSuggestions && activeArgCommand && argSuggestions.length > 0) {
        const suggestion = argSuggestions[selectedIndex];
        if (suggestion) text = `${activeArgCommand.name} ${suggestion.value}`;
      } else if (showCommands && filtered.length > 0) {
        const cmd = filtered[selectedIndex];
        if (cmd) text = getCommandInput(cmd);
      }
      if (!text) return;
      onSubmit(text);
      inputActions.setValue('');
      setSelectedIndex(0);
      return;
    }

    // Shift+Left/Right → 切换思考强度
    if (key.shift && (key.name === 'left' || key.name === 'right')) {
      onCycleThinkingEffort(key.name === 'right' ? 1 : -1);
      return;
    }

    // Esc：命令面板打开时收起面板（保留输入内容）；否则交给 useAppKeyboard 处理
    if (key.name === 'escape') {
      if (showCommands) {
        setCommandsDismissed(true);
        setSelectedIndex(0);
      }
      return;
    }

    // Backspace + 输入框为空 + 有待发送附件 → 移除最后一个附件
    if (key.name === 'backspace' && !value && pendingFiles.length > 0) {
      onRemoveFile(pendingFiles.length - 1);
      return;
    }

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

  useEffect(() => {
    if (!isQueueMode) {
      setQueuePromptFrame(0);
      return;
    }
    const timer = setInterval(() => {
      setQueuePromptFrame(frame => (frame + 1) % HOURGLASS_SPINNER_FRAMES.length);
    }, HOURGLASS_SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isQueueMode]);

  const maxLen = filtered.length > 0
    ? Math.max(...filtered.map((cmd) => cmd.name.length))
    : 0;
  const maxArgLen = argSuggestions.length > 0
    ? Math.max(...argSuggestions.map((item) => item.value.length))
    : 0;

  // ── 输入区域滚动判定 ──────────────────────────────────────
  // 根据终端宽度计算实际渲染行数（含自动换行），超过上限才启用 scrollbox。
  // 水平开销 = paddingX(2) + border(2) + innerPadding(2) + promptVisualWidth（不含滚动条）。
  // 沙漏波浪帧比普通选择箭头更宽，需动态计算，否则长输入换行/滚动条会偏差。
  const MAX_VISIBLE_INPUT_LINES = 8;

  // 提示符样式和 placeholder 根据状态变化
  const promptColor = inputDisabled ? C.dim : isQueueMode ? C.warn : C.accent;
  const queuePromptChar = HOURGLASS_SPINNER_FRAMES[queuePromptFrame % HOURGLASS_SPINNER_FRAMES.length];
  const promptText = isQueueMode ? `${queuePromptChar}  ` : `${ICONS.selectorArrow}  `;
  const promptVisualWidth = getTextWidth(promptText);
  const placeholder = isQueueMode ? `输入消息（将排队发送）${ICONS.ellipsis}` : `输入消息${ICONS.ellipsis}`;
  const inputChromeWidth = 6 + promptVisualWidth;
  const baseAvailableWidth = Math.max(1, termWidth - inputChromeWidth);

  const visualLineCount = useMemo(() => {
    if (!value) return 1;
    const lines = value.split('\n');
    let count = 0;
    for (const line of lines) {
      const w = getTextWidth(line);
      // 空行占 1 行；非空行按终端宽度折行
      count += w === 0 ? 1 : Math.ceil(w / baseAvailableWidth);
    }
    return count;
  }, [value, baseAvailableWidth]);

  const needsInputScroll = visualLineCount > MAX_VISIBLE_INPUT_LINES;

  // 当滚动条可见时，减去滚动条宽度（1 列）以获得更准确的可用宽度
  const availableWidth = needsInputScroll ? Math.max(1, baseAvailableWidth - 1) : baseAvailableWidth;

  const inputRow = (
    <box flexDirection="row" border={false}>
      <text fg={promptColor}>
        <strong>{promptText}</strong>
      </text>
      {/* ── Work-around: OpenTUI TextBufferRenderable measureFunc bug ──
        * 在 row 布局中，Yoga 以 widthMode=AtMost 测量 <text> 元素，
        * measureFunc 会将高度截断为 Math.min(effectiveHeight=1, measuredHeight)，
        * 导致多行文本始终报告 height=1，ScrollBox 的 content.height 等于
        * viewport.height，滚动条无法工作。
        * 将 InputDisplay 包裹在 column 布局的 <box> 中，使 Yoga 以
        * widthMode=Exactly 测量文本，绕过 AtMost 分支的高度截断。 */}
      <box flexGrow={1} flexShrink={1}>
        <InputDisplay
          value={value}
          cursor={inputState.cursor}
          availableWidth={availableWidth}
          isActive={!inputDisabled}
          cursorVisible={cursorVisible}
          placeholder={placeholder}
        />
      </box>
    </box>
  );

  return (
    <box flexDirection="column">

      {/* 指令列表（向上展开，位于输入框上方） */}
      {showArgSuggestions && argSuggestions.length > 0 && (
        <box flexDirection="column" backgroundColor={C.panelBg} paddingX={1}>
          {[...argSuggestions].reverse().map((item: CommandArgSuggestion, _i) => {
            const index = argSuggestions.indexOf(item);
            const padded = item.value.padEnd(maxArgLen);
            const isSelected = index === selectedIndex;
            return (
              <box key={`${item.value}-${index}`} paddingLeft={1} backgroundColor={isSelected ? C.border : undefined}>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? `${ICONS.triangleRight} ` : '  '}</span>
                  {isSelected
                    ? <strong><span fg={item.color ?? C.text}>{padded}</span></strong>
                    : <span fg={item.color ?? C.textSec}>{padded}</span>}
                  {item.description ? <span fg={isSelected ? C.textSec : C.dim}>  {item.description}</span> : null}
                </text>
              </box>
            );
          })}
        </box>
      )}
      {!showArgSuggestions && filtered.length > 0 && (
        <box flexDirection="column" backgroundColor={C.panelBg} paddingX={1}>
          {[...filtered].reverse().map((cmd: Command, _i) => {
            const index = filtered.indexOf(cmd);
            const padded = cmd.name.padEnd(maxLen);
            const isSelected = index === selectedIndex;
            return (
              <box key={cmd.name} paddingLeft={1} backgroundColor={isSelected ? C.border : undefined}>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? `${ICONS.triangleRight} ` : '  '}</span>
                  {isSelected
                    ? <strong><span fg={cmd.color ?? C.text}>{padded}</span></strong>
                    : <span fg={cmd.color ?? C.textSec}>{padded}</span>}
                  <span fg={isSelected ? C.textSec : C.dim}>  {cmd.description}</span>
                </text>
              </box>
            );
          })}
        </box>
      )}

      {/* 待发送文件附件（位于指令面板和输入框之间） */}
      {pendingFiles.length > 0 && (
        <box flexDirection="column" backgroundColor={C.panelBg} paddingX={1}>
          {pendingFiles.map((file, i) => {
            const icon = FILE_TYPE_ICONS[file.fileType] || '📎';
            const maxNameLen = Math.max(20, termWidth - 20);
            const displayPath = file.path.length > maxNameLen
              ? `${file.path.slice(0, Math.floor((maxNameLen - 3) / 2))}${ICONS.ellipsis}${file.path.slice(file.path.length - Math.floor((maxNameLen - 3) / 2))}`
              : file.path;
            return (
              <box key={`file-${i}`} paddingLeft={1}>
                <text>
                  <span fg={C.primaryLight}>{icon} {displayPath}</span>
                  <span fg={C.dim}> ({file.mimeType})</span>
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
