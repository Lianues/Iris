/**
 * 底部输入栏 (OpenTUI React)
 *
 * 使用自定义 useTextInput + InputDisplay 实现带光标的输入，
 * 与 onboard 风格一致。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { COMMANDS, type Command, getCommandInput, isExactCommandValue } from '../input-commands';
import { useTextInput } from '../hooks/use-text-input';
import { useCursorBlink } from '../hooks/use-cursor-blink';
import { InputDisplay } from './InputDisplay';
import { C } from '../theme';

interface InputBarProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

export function InputBar({ disabled, onSubmit }: InputBarProps) {
  const [inputState, inputActions] = useTextInput('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const cursorVisible = useCursorBlink();

  const value = inputState.value;

  const exactMatchIndex = useMemo(() => {
    return COMMANDS.findIndex((cmd) => isExactCommandValue(value, cmd));
  }, [value]);

  const commandQuery = useMemo(() => {
    if (disabled) return '';
    if (!value.startsWith('/')) return '';
    if (/\s/.test(value) && exactMatchIndex < 0) return '';
    return value;
  }, [disabled, value, exactMatchIndex]);

  const showCommands = commandQuery.length > 0;

  const filtered = useMemo(() => {
    if (!showCommands) return [];
    if (exactMatchIndex >= 0) return COMMANDS;
    return COMMANDS.filter((cmd) => cmd.name.startsWith(commandQuery.trim()));
  }, [showCommands, exactMatchIndex, commandQuery]);

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
    if (disabled) return;

    // 指令面板导航
    if (showCommands && filtered.length > 0) {
      if (key.name === 'up') { applySelection(selectedIndex - 1); return; }
      if (key.name === 'down') { applySelection(selectedIndex + 1); return; }
      if (key.name === 'tab') {
        const current = filtered[selectedIndex];
        if (current) {
          applySelection(isExactCommandValue(value, current) ? selectedIndex + 1 : selectedIndex);
        }
        return;
      }
    }

    // Enter → 提交
    if (key.name === 'enter' || key.name === 'return') {
      const text = value.trim();
      if (!text) return;
      onSubmit(text);
      inputActions.setValue('');
      setSelectedIndex(0);
      return;
    }

    // 委托给 useTextInput 处理其他按键
    inputActions.handleKey(key);
  });

  const maxLen = filtered.length > 0
    ? Math.max(...filtered.map((cmd) => cmd.name.length))
    : 0;

  return (
    <box flexDirection="column">
      {/* 输入区域 */}
      <box
        flexDirection="row"
        borderStyle="single"
        borderColor={disabled ? C.dim : C.borderActive}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={disabled ? C.dim : C.accent}><strong>{'\u276F '}</strong></text><InputDisplay
          value={value}
          cursor={inputState.cursor}
          isActive={!disabled}
          cursorVisible={cursorVisible}
          placeholder="输入消息…"
        />
      </box>

      {/* 指令列表 */}
      {filtered.length > 0 && (
        <box flexDirection="column" paddingLeft={2} marginTop={0}>
          {filtered.map((cmd: Command, index) => {
            const padded = cmd.name.padEnd(maxLen);
            const isSelected = index === selectedIndex;
            return (
              <box key={cmd.name} paddingLeft={1}>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '\u276F ' : '  '}</span>
                  {isSelected ? <strong><span fg={C.text}>{padded}</span></strong> : <span fg={C.textSec}>{padded}</span>}
                  <span fg={C.dim}>  {cmd.description}</span>
                </text>
              </box>
            );
          })}
        </box>
      )}
    </box>
  );
}
