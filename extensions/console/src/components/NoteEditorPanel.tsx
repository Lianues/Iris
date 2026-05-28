/** @jsxImportSource @opentui/react */

import React, { useEffect, useRef, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { C } from '../theme';
import { useCursorBlink } from '../hooks/use-cursor-blink';
import { usePaste } from '../hooks/use-paste';
import { useTextInput } from '../hooks/use-text-input';
import { InputDisplay } from './InputDisplay';

interface NoteEditorPanelProps {
  initialValue: string;
  onSave?: (content: string) => Promise<{ ok: boolean; message?: string }> | { ok: boolean; message?: string } | void;
  onCancel?: () => void;
  onDraftChange?: (content: string) => void;
}

export function NoteEditorPanel({ initialValue, onSave, onCancel, onDraftChange }: NoteEditorPanelProps) {
  const [state, actions] = useTextInput(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const cursorVisible = useCursorBlink();
  const { width, height } = useTerminalDimensions();
  const editorHeight = Math.max(3, Math.min(10, Math.floor(height * 0.25)));

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    onDraftChange?.(state.value);
  }, [state.value, onDraftChange]);

  usePaste((text) => {
    if (saving) return;
    actions.insert(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave?.(state.value);
      if (result && result.ok === false) {
        setError(result.message ?? '保存失败');
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  useKeyboard((key) => {
    if (saving) {
      key.preventDefault?.();
      key.stopPropagation?.();
      return;
    }
    if ((key.ctrl && key.name === 'c') || key.sequence === '\x03') {
      key.preventDefault?.();
      key.stopPropagation?.();
      actions.setValue('');
      setError(null);
      return;
    }
    if (key.name === 'escape') {
      key.preventDefault?.();
      key.stopPropagation?.();
      onCancel?.();
      return;
    }
    if ((key.ctrl && key.name === 's') || key.sequence === '\x13') {
      key.preventDefault?.();
      key.stopPropagation?.();
      void save();
      return;
    }
    if ((key.ctrl && key.name === 'j') || (key.ctrl && key.name === 'enter')) {
      key.preventDefault?.();
      key.stopPropagation?.();
      actions.insert('\n');
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault?.();
      key.stopPropagation?.();
      actions.insert('\n');
      return;
    }
    actions.handleKey(key as any);
  });

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={error ? C.error : C.accent}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <text>
        <span fg={C.accent}><strong>✎ Edit Note</strong></span>
        <span fg={C.dim}>  Ctrl+S 保存 · Ctrl+C 清空 · Enter 换行 · Esc 取消</span>
      </text>
      <scrollbox
        height={editorHeight}
        borderStyle="single"
        borderColor={C.border}
        paddingX={1}
        verticalScrollbarOptions={{ visible: state.value.split(/\r?\n/).length > editorHeight }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <InputDisplay
          value={state.value}
          cursor={state.cursor}
          availableWidth={Math.max(20, width - 8)}
          isActive={!saving}
          cursorVisible={cursorVisible}
          placeholder="输入当前 Agent 的长期 Note…"
        />
      </scrollbox>
      {error ? <text fg={C.error}>保存失败：{error}</text> : null}
      {saving ? <text fg={C.dim}>保存中…</text> : null}
    </box>
  );
}
