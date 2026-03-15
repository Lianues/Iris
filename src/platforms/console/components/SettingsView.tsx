/**
 * TUI 设置中心 (OpenTUI React)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { C } from '../theme';
import type { MCPServerInfo } from '../../../mcp';
import {
  applyModelProviderChange,
  cloneConsoleSettingsSnapshot,
  CONSOLE_LLM_PROVIDER_OPTIONS,
  CONSOLE_MCP_TRANSPORT_OPTIONS,
  ConsoleLLMProvider,
  ConsoleMCPTransport,
  ConsoleSettingsSaveResult,
  ConsoleSettingsSnapshot,
  createDefaultMCPServerEntry,
  createEmptyModel,
} from '../settings';

type SettingsSection = 'general' | 'mcp' | 'tools';
type StatusKind = 'info' | 'success' | 'warning' | 'error';
type ToolPolicyMode = 'disabled' | 'manual' | 'auto';

type RowTarget =
  | { kind: 'modelProvider'; modelIndex: number }
  | { kind: 'modelField'; modelIndex: number; field: 'modelName' | 'modelId' | 'apiKey' | 'baseUrl' }
  | { kind: 'modelDefault'; modelIndex: number }
  | { kind: 'systemField'; field: 'systemPrompt' | 'maxToolRounds' | 'stream' }
  | { kind: 'toolPolicy'; toolIndex: number }
  | { kind: 'mcpField'; serverIndex: number; field: 'name' | 'enabled' | 'transport' | 'command' | 'args' | 'cwd' | 'url' | 'authHeader' | 'timeout' }
  | { kind: 'action'; action: 'addModel' | 'addMcp' };

function getToolPolicyMode(configured: boolean, autoApprove: boolean): ToolPolicyMode {
  if (!configured) return 'disabled';
  return autoApprove ? 'auto' : 'manual';
}

function formatToolPolicyMode(mode: ToolPolicyMode): string {
  if (mode === 'auto') return '自动执行';
  if (mode === 'manual') return '手动确认';
  return '不允许';
}

interface SettingsRow {
  id: string;
  kind: 'section' | 'field' | 'info' | 'action';
  section: SettingsSection;
  label: string;
  value?: string;
  description?: string;
  target?: RowTarget;
  indent?: number;
}

interface EditorState {
  target: Extract<RowTarget, { kind: 'modelField' | 'systemField' | 'mcpField' }>;
  label: string;
  value: string;
  hint?: string;
}

interface SettingsViewProps {
  initialSection?: 'general' | 'mcp';
  onBack: () => void;
  onLoad: () => Promise<ConsoleSettingsSnapshot>;
  onSave: (snapshot: ConsoleSettingsSnapshot) => Promise<ConsoleSettingsSaveResult>;
}

function getStatusColor(kind: StatusKind): string {
  switch (kind) {
    case 'success': return C.accent;
    case 'warning': return C.warn;
    case 'error': return C.error;
    default: return C.dim;
  }
}

function boolText(value: boolean): string {
  return value ? '开启' : '关闭';
}

function transportLabel(value: ConsoleMCPTransport): string {
  if (value === 'stdio') return 'stdio（本地进程）';
  if (value === 'sse') return 'sse（远程事件流）';
  return 'streamable-http（远程 HTTP）';
}

function previewText(value: string, maxLength: number): string {
  if (!value) return '(空)';
  const normalized = value.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').filter(Boolean);
  const firstLine = lines[0] ?? '';
  const compact = firstLine.length > maxLength
    ? `${firstLine.slice(0, Math.max(1, maxLength - 1))}…`
    : firstLine;

  if (lines.length <= 1) {
    return compact || '(空)';
  }

  return `${lines.length} 行 \u00b7 ${compact}`;
}

function getEditableFingerprint(snapshot: ConsoleSettingsSnapshot | null): string {
  if (!snapshot) return '';
  return JSON.stringify({
    models: snapshot.models,
    modelOriginalNames: snapshot.modelOriginalNames,
    defaultModelName: snapshot.defaultModelName,
    system: snapshot.system,
    toolPolicies: snapshot.toolPolicies,
    mcpServers: snapshot.mcpServers,
    mcpOriginalNames: snapshot.mcpOriginalNames,
  });
}

function escapeMultilineForInput(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
}

function restoreMultilineFromInput(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function cycleValue<T extends string>(values: readonly T[], current: T, direction: 1 | -1): T {
  const currentIndex = values.indexOf(current);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (normalizedIndex + direction + values.length) % values.length;
  return values[nextIndex];
}

function buildRows(snapshot: ConsoleSettingsSnapshot, termWidth: number): SettingsRow[] {
  const rows: SettingsRow[] = [];
  const maxPreview = Math.max(18, termWidth - 38);
  const statusMap = new Map<string, MCPServerInfo>();

  for (const info of snapshot.mcpStatus) {
    statusMap.set(info.name, info);
  }

  const pushField = (
    id: string,
    section: SettingsSection,
    label: string,
    value: string,
    target: RowTarget,
    description?: string,
    indent = 2,
  ) => {
    rows.push({ id, kind: 'field', section, label, value, target, description, indent });
  };

  rows.push({
    id: 'section.general',
    kind: 'section',
    section: 'general',
    label: '模型与系统',
    description: '管理 LLM 模型池、默认模型、系统提示词、工具轮次与流式输出。',
  });

  rows.push({
    id: 'model.add',
    kind: 'action',
    section: 'general',
    label: '新增模型',
    value: 'Enter / A',
    target: { kind: 'action', action: 'addModel' },
    description: '创建新的模型草稿。',
    indent: 2,
  });

  snapshot.models.forEach((model, index) => {
    const displayName = model.modelName || `model_${index + 1}`;
    rows.push({
      id: `model.${index}.summary`,
      kind: 'info',
      section: 'general',
      label: `${displayName} \u00b7 ${model.provider} \u00b7 ${model.modelId || '(空模型 ID)'}`,
      indent: 4,
    });

    pushField(
      `model.${index}.default`, 'general', '设为默认',
      boolText(snapshot.defaultModelName === model.modelName && !!model.modelName),
      { kind: 'modelDefault', modelIndex: index },
      'Space 或 Enter 设为默认模型。', 6,
    );
    pushField(
      `model.${index}.provider`, 'general', 'Provider',
      model.provider,
      { kind: 'modelProvider', modelIndex: index },
      '左右方向键切换 Provider。', 6,
    );
    pushField(`model.${index}.modelName`, 'general', '名称', model.modelName || '(空)', { kind: 'modelField', modelIndex: index, field: 'modelName' }, '回车编辑。', 6);
    pushField(`model.${index}.modelId`, 'general', '模型 ID', model.modelId || '(空)', { kind: 'modelField', modelIndex: index, field: 'modelId' }, '回车编辑。', 6);
    pushField(`model.${index}.apiKey`, 'general', 'API Key', model.apiKey || '未配置', { kind: 'modelField', modelIndex: index, field: 'apiKey' }, undefined, 6);
    pushField(`model.${index}.baseUrl`, 'general', 'Base URL', model.baseUrl || '(空)', { kind: 'modelField', modelIndex: index, field: 'baseUrl' }, '回车编辑。', 6);
  });

  pushField('system.systemPrompt', 'general', 'System / Prompt', previewText(snapshot.system.systemPrompt, maxPreview), { kind: 'systemField', field: 'systemPrompt' }, '回车编辑；\\n 表示换行。');
  pushField('system.maxToolRounds', 'general', 'System / Max Tool Rounds', String(snapshot.system.maxToolRounds), { kind: 'systemField', field: 'maxToolRounds' });
  pushField('system.stream', 'general', 'System / Stream Output', boolText(snapshot.system.stream), { kind: 'systemField', field: 'stream' }, '空格切换。');

  rows.push({ id: 'section.tools', kind: 'section', section: 'tools', label: `工具执行策略（${snapshot.toolPolicies.length}）` });

  snapshot.toolPolicies.forEach((tool, index) => {
    const mode = getToolPolicyMode(tool.configured, tool.autoApprove);
    rows.push({
      id: `tool.${tool.name}`, kind: 'field', section: 'tools',
      label: `Tool / ${tool.name}${tool.registered ? '' : '（当前未注册）'}`,
      value: formatToolPolicyMode(mode),
      target: { kind: 'toolPolicy', toolIndex: index },
      description: '空格或左右方向键切换。', indent: 2,
    });
  });

  rows.push({ id: 'section.mcp', kind: 'section', section: 'mcp', label: `MCP 服务器（${snapshot.mcpServers.length}）` });

  rows.push({
    id: 'mcp.add', kind: 'action', section: 'mcp', label: '新增 MCP 服务器',
    value: 'Enter / A', target: { kind: 'action', action: 'addMcp' }, indent: 2,
  });

  if (snapshot.mcpServers.length === 0) {
    rows.push({ id: 'mcp.empty', kind: 'info', section: 'mcp', label: '暂无 MCP 服务器，按 Enter 或 A 新建。', indent: 4 });
  }

  snapshot.mcpServers.forEach((server, index) => {
    const status = server.enabled === false
      ? { name: server.name, status: 'disabled', toolCount: 0, error: undefined as string | undefined }
      : statusMap.get(server.originalName ?? server.name) ?? statusMap.get(server.name);
    const errorText = status && 'error' in status ? status.error : undefined;

    const summary = status
      ? `${server.name || `server_${index + 1}`} \u00b7 ${server.enabled ? '启用' : '禁用'} \u00b7 ${transportLabel(server.transport)} \u00b7 ${status.status}${errorText ? ` \u00b7 ${errorText}` : ` \u00b7 ${status.toolCount} tools`}`
      : `${server.name || `server_${index + 1}`} \u00b7 ${server.enabled ? '未应用' : '禁用'} \u00b7 ${transportLabel(server.transport)}`;

    rows.push({ id: `mcp.${index}.summary`, kind: 'info', section: 'mcp', label: summary, indent: 4 });

    pushField(`mcp.${index}.name`, 'mcp', '名称', server.name || '(空)', { kind: 'mcpField', serverIndex: index, field: 'name' }, '按 D 删除。', 6);
    pushField(`mcp.${index}.enabled`, 'mcp', '启用', boolText(server.enabled), { kind: 'mcpField', serverIndex: index, field: 'enabled' }, '空格切换。', 6);
    pushField(`mcp.${index}.transport`, 'mcp', '传输', transportLabel(server.transport), { kind: 'mcpField', serverIndex: index, field: 'transport' }, '左右方向键切换。', 6);

    if (server.transport === 'stdio') {
      pushField(`mcp.${index}.command`, 'mcp', '命令', server.command || '(空)', { kind: 'mcpField', serverIndex: index, field: 'command' }, undefined, 6);
      pushField(`mcp.${index}.cwd`, 'mcp', '工作目录', server.cwd || '(空)', { kind: 'mcpField', serverIndex: index, field: 'cwd' }, undefined, 6);
      pushField(`mcp.${index}.args`, 'mcp', '参数', previewText(server.args, maxPreview), { kind: 'mcpField', serverIndex: index, field: 'args' }, '\\n 表示多行。', 6);
    } else {
      pushField(`mcp.${index}.url`, 'mcp', 'URL', server.url || '(空)', { kind: 'mcpField', serverIndex: index, field: 'url' }, undefined, 6);
      pushField(`mcp.${index}.authHeader`, 'mcp', 'Authorization', server.authHeader || '(空)', { kind: 'mcpField', serverIndex: index, field: 'authHeader' }, undefined, 6);
    }

    pushField(`mcp.${index}.timeout`, 'mcp', '超时（ms）', String(server.timeout), { kind: 'mcpField', serverIndex: index, field: 'timeout' }, undefined, 6);
  });

  return rows;
}

export function SettingsView({ initialSection = 'general', onBack, onLoad, onSave }: SettingsViewProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ConsoleSettingsSnapshot | null>(null);
  const [baseline, setBaseline] = useState<ConsoleSettingsSnapshot | null>(null);
  const [selectedRowId, setSelectedRowId] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [statusText, setStatusText] = useState('');
  const [statusKind, setStatusKind] = useState<StatusKind>('info');
  const [pendingLeaveConfirm, setPendingLeaveConfirm] = useState(false);

  const setStatus = useCallback((text: string, kind: StatusKind = 'info') => {
    setStatusText(text);
    setStatusKind(kind);
  }, []);

  const isDirty = useMemo(() => {
    return getEditableFingerprint(draft) !== getEditableFingerprint(baseline);
  }, [draft, baseline]);

  const rows = useMemo(() => {
    if (!draft) return [] as SettingsRow[];
    return buildRows(draft, termWidth);
  }, [draft, termWidth]);

  const selectableRows = useMemo(() => rows.filter((row: SettingsRow) => row.target), [rows]);
  const selectedRow = useMemo(() => rows.find((row: SettingsRow) => row.id === selectedRowId), [rows, selectedRowId]);
  const selectedSelectableIndex = useMemo(() => {
    return selectableRows.findIndex((row: SettingsRow) => row.id === selectedRowId);
  }, [selectableRows, selectedRowId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await onLoad();
        if (cancelled) return;
        const cloned = cloneConsoleSettingsSnapshot(snapshot);
        setDraft(cloned);
        setBaseline(cloneConsoleSettingsSnapshot(snapshot));
        setStatus('已加载当前配置', 'success');
        setPendingLeaveConfirm(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus(`加载配置失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [onLoad, setStatus]);

  useEffect(() => {
    if (rows.length === 0) return;
    if (selectedRowId && rows.some((row: SettingsRow) => row.id === selectedRowId && row.target)) return;
    const preferred = rows.find((row: SettingsRow) => row.section === initialSection && row.target)
      ?? rows.find((row: SettingsRow) => row.target);
    if (preferred) setSelectedRowId(preferred.id);
  }, [rows, selectedRowId, initialSection]);

  const updateDraft = useCallback((updater: (snapshot: ConsoleSettingsSnapshot) => void) => {
    setDraft((prev: ConsoleSettingsSnapshot | null) => {
      if (!prev) return prev;
      const next = cloneConsoleSettingsSnapshot(prev);
      updater(next);
      return next;
    });
    setPendingLeaveConfirm(false);
  }, []);

  const reloadSnapshot = useCallback(async () => {
    setLoading(true);
    setEditor(null);
    try {
      const snapshot = await onLoad();
      setDraft(cloneConsoleSettingsSnapshot(snapshot));
      setBaseline(cloneConsoleSettingsSnapshot(snapshot));
      setStatus('已从磁盘重新加载配置', 'success');
      setPendingLeaveConfirm(false);
    } catch (err: unknown) {
      setStatus(`重新加载失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [onLoad, setStatus]);

  const handleAddModel = useCallback(() => {
    let nextIndex = 0;
    updateDraft((snapshot: ConsoleSettingsSnapshot) => {
      nextIndex = snapshot.models.length;
      snapshot.models.push(createEmptyModel());
    });
    setSelectedRowId(`model.${nextIndex}.modelName`);
    setStatus('已新增模型草稿，请先填写名称后保存', 'info');
  }, [setStatus, updateDraft]);

  const handleAddMcpServer = useCallback(() => {
    let nextIndex = 0;
    updateDraft((snapshot: ConsoleSettingsSnapshot) => {
      nextIndex = snapshot.mcpServers.length;
      snapshot.mcpServers.push(createDefaultMCPServerEntry());
    });
    setSelectedRowId(`mcp.${nextIndex}.name`);
    setStatus('已新增 MCP 服务器草稿，请先填写名称后保存', 'info');
  }, [setStatus, updateDraft]);

  const startEdit = useCallback((target: Extract<RowTarget, { kind: 'modelField' | 'systemField' | 'mcpField' }>) => {
    if (!draft) return;
    if (target.kind === 'modelField') {
      const model = draft.models[target.modelIndex];
      if (!model) return;
      const value = model[target.field];
      setEditor({ target, label: `${model.modelName || `model_${target.modelIndex + 1}`}.${target.field}`, value });
      setEditorValue(String(value ?? ''));
      return;
    }
    if (target.kind === 'systemField') {
      const rawValue = target.field === 'maxToolRounds' ? String(draft.system.maxToolRounds) : target.field === 'stream' ? String(draft.system.stream) : draft.system.systemPrompt;
      const value = target.field === 'systemPrompt' ? escapeMultilineForInput(rawValue) : rawValue;
      setEditor({ target, label: `system.${target.field}`, value, hint: target.field === 'systemPrompt' ? '\\n 表示换行' : undefined });
      setEditorValue(value);
      return;
    }
    const server = draft.mcpServers[target.serverIndex];
    if (!server) return;
    const rawValue = String(server[target.field] ?? '');
    const value = target.field === 'args' ? escapeMultilineForInput(rawValue) : rawValue;
    setEditor({ target, label: `mcp.${server.name || `server_${target.serverIndex + 1}`}.${target.field}`, value, hint: target.field === 'args' ? '\\n 表示多行参数' : undefined });
    setEditorValue(value);
  }, [draft]);

  const applyCycle = useCallback((target: RowTarget, direction: 1 | -1) => {
    updateDraft((snapshot: ConsoleSettingsSnapshot) => {
      if (target.kind === 'modelProvider') {
        const model = snapshot.models[target.modelIndex];
        if (!model) return;
        const next = cycleValue(CONSOLE_LLM_PROVIDER_OPTIONS, model.provider, direction);
        snapshot.models[target.modelIndex] = applyModelProviderChange(model, next as ConsoleLLMProvider);
        return;
      }
      if (target.kind === 'mcpField' && target.field === 'transport') {
        const current = snapshot.mcpServers[target.serverIndex]?.transport;
        if (!current) return;
        snapshot.mcpServers[target.serverIndex].transport = cycleValue(CONSOLE_MCP_TRANSPORT_OPTIONS, current, direction) as ConsoleMCPTransport;
      }
      if (target.kind === 'toolPolicy') {
        const tool = snapshot.toolPolicies[target.toolIndex];
        if (!tool) return;
        const modes: ToolPolicyMode[] = ['disabled', 'manual', 'auto'];
        const current = getToolPolicyMode(tool.configured, tool.autoApprove);
        const next = cycleValue(modes, current, direction);
        tool.configured = next !== 'disabled';
        tool.autoApprove = next === 'auto';
      }
    });
  }, [updateDraft]);

  const applyToggle = useCallback((target: RowTarget) => {
    updateDraft((snapshot: ConsoleSettingsSnapshot) => {
      if (target.kind === 'modelDefault') {
        const model = snapshot.models[target.modelIndex];
        if (!model || !model.modelName.trim()) return;
        snapshot.defaultModelName = model.modelName.trim();
        return;
      }
      if (target.kind === 'systemField' && target.field === 'stream') {
        snapshot.system.stream = !snapshot.system.stream;
        return;
      }
      if (target.kind === 'mcpField' && target.field === 'enabled') {
        const server = snapshot.mcpServers[target.serverIndex];
        if (server) server.enabled = !server.enabled;
      }
    });
  }, [updateDraft]);

  const submitEditor = useCallback(() => {
    if (!editor) return;
    const value = (editor.target.kind === 'systemField' && editor.target.field === 'systemPrompt')
      ? restoreMultilineFromInput(editorValue)
      : (editor.target.kind === 'mcpField' && editor.target.field === 'args')
        ? restoreMultilineFromInput(editorValue)
        : editorValue;

    if (editor.target.kind === 'systemField' && editor.target.field === 'maxToolRounds') {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1) { setStatus('请输入大于等于 1 的有效数字', 'error'); return; }
    }
    if (editor.target.kind === 'mcpField' && editor.target.field === 'timeout') {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1000) { setStatus('MCP 超时必须是大于等于 1000 的数字', 'error'); return; }
    }

    updateDraft((snapshot: ConsoleSettingsSnapshot) => {
      if (editor.target.kind === 'modelField') {
        const model = snapshot.models[editor.target.modelIndex];
        if (!model) return;
        if (editor.target.field === 'modelName') {
          const previousName = model.modelName;
          model.modelName = value.trim();
          if (snapshot.defaultModelName === previousName) snapshot.defaultModelName = model.modelName;
        } else if (editor.target.field === 'modelId') { model.modelId = value; }
        else if (editor.target.field === 'apiKey') { model.apiKey = value; }
        else { model.baseUrl = value; }
        return;
      }
      if (editor.target.kind === 'systemField') {
        if (editor.target.field === 'systemPrompt') snapshot.system.systemPrompt = value;
        else if (editor.target.field === 'maxToolRounds') snapshot.system.maxToolRounds = Number(value.trim());
        return;
      }
      const server = snapshot.mcpServers[editor.target.serverIndex];
      if (!server) return;
      if (editor.target.field === 'name') server.name = value.replace(/[^a-zA-Z0-9_]/g, '_');
      else if (editor.target.field === 'timeout') server.timeout = Number(value.trim());
      else if (editor.target.field === 'command') server.command = value;
      else if (editor.target.field === 'args') server.args = value;
      else if (editor.target.field === 'cwd') server.cwd = value;
      else if (editor.target.field === 'url') server.url = value;
      else if (editor.target.field === 'authHeader') server.authHeader = value;
      else server.transport = value as ConsoleMCPTransport;
    });
    setStatus('字段已更新，按 S 保存并热重载', 'success');
    setEditor(null);
    setEditorValue('');
  }, [editor, editorValue, setStatus, updateDraft]);

  const handleSave = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    setStatus('正在保存并尝试热重载...', 'info');
    try {
      const result = await onSave(draft);
      if (!result.ok) { setStatus(`保存失败：${result.message}`, 'error'); return; }
      if (result.snapshot) {
        setDraft(cloneConsoleSettingsSnapshot(result.snapshot));
        setBaseline(cloneConsoleSettingsSnapshot(result.snapshot));
      } else {
        setBaseline(cloneConsoleSettingsSnapshot(draft));
      }
      setPendingLeaveConfirm(false);
      setStatus(result.message, result.restartRequired ? 'warning' : 'success');
    } catch (err: unknown) {
      setStatus(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, saving, setStatus]);

  const handleDeleteCurrentModel = useCallback(() => {
    if (!selectedRow?.target || !draft) { setStatus('请先选中某个模型字段后再删除', 'warning'); return; }
    if (selectedRow.target.kind !== 'modelField' && selectedRow.target.kind !== 'modelProvider' && selectedRow.target.kind !== 'modelDefault') { setStatus('请先选中某个模型字段后再删除', 'warning'); return; }
    if (draft.models.length <= 1) { setStatus('至少需要保留一个模型', 'warning'); return; }
    const index = selectedRow.target.modelIndex;
    const model = draft.models[index];
    if (!model) return;
    updateDraft((snapshot: ConsoleSettingsSnapshot) => {
      snapshot.models.splice(index, 1);
      if (snapshot.defaultModelName === model.modelName) snapshot.defaultModelName = snapshot.models[0]?.modelName ?? '';
    });
    setStatus(`已删除模型草稿：${model.modelName || `model_${index + 1}`}（未保存）`, 'warning');
  }, [draft, selectedRow, setStatus, updateDraft]);

  const handleDeleteCurrentServer = useCallback(() => {
    if (!selectedRow?.target || selectedRow.target.kind !== 'mcpField' || !draft) { setStatus('请先选中某个 MCP 服务器字段后再删除', 'warning'); return; }
    const index = selectedRow.target.serverIndex;
    const server = draft.mcpServers[index];
    if (!server) return;
    updateDraft((snapshot: ConsoleSettingsSnapshot) => { snapshot.mcpServers.splice(index, 1); });
    setStatus(`已删除 MCP 草稿：${server.name || `server_${index + 1}`}（未保存）`, 'warning');
  }, [draft, selectedRow, setStatus, updateDraft]);

  useKeyboard((key) => {
    // 编辑器活动时：仅处理 Esc 取消和 Enter 提交
    if (editor) {
      if (key.name === 'escape') {
        setEditor(null);
        setEditorValue('');
        setStatus('已取消编辑', 'warning');
      }
      if (key.name === 'enter') {
        submitEditor();
      }
      return;
    }

    if (loading || saving) {
      if (key.name === 'escape') onBack();
      return;
    }

    const currentIndex = selectedSelectableIndex >= 0 ? selectedSelectableIndex : 0;

    if (key.name === 'up') {
      const prev = selectableRows[Math.max(0, currentIndex - 1)];
      if (prev) setSelectedRowId(prev.id);
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === 'down') {
      const next = selectableRows[Math.min(selectableRows.length - 1, currentIndex + 1)];
      if (next) setSelectedRowId(next.id);
      setPendingLeaveConfirm(false);
      return;
    }
    if (selectedRow?.target && key.name === 'left') {
      if (selectedRow.target.kind === 'modelProvider' || selectedRow.target.kind === 'toolPolicy' || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'transport')) {
        applyCycle(selectedRow.target, -1);
      }
      setPendingLeaveConfirm(false);
      return;
    }
    if (selectedRow?.target && key.name === 'right') {
      if (selectedRow.target.kind === 'modelProvider' || selectedRow.target.kind === 'toolPolicy' || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'transport')) {
        applyCycle(selectedRow.target, 1);
      }
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === 'escape') {
      if (isDirty && !pendingLeaveConfirm) {
        setPendingLeaveConfirm(true);
        setStatus('当前有未保存修改，再按一次 Esc 将直接返回', 'warning');
        return;
      }
      onBack();
      return;
    }
    if (key.name === 's') { void handleSave(); return; }
    if (key.name === 'r') { void reloadSnapshot(); return; }
    if (key.name === 'a') {
      if (selectedRow?.section === 'mcp') handleAddMcpServer();
      else handleAddModel();
      return;
    }
    if (key.name === 'd') {
      if (selectedRow?.target?.kind === 'mcpField') handleDeleteCurrentServer();
      else handleDeleteCurrentModel();
      return;
    }
    if (key.name === 'space' && selectedRow?.target) {
      if (selectedRow.target.kind === 'modelDefault' || (selectedRow.target.kind === 'systemField' && selectedRow.target.field === 'stream') || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'enabled')) {
        applyToggle(selectedRow.target);
      } else if (selectedRow.target.kind === 'toolPolicy') {
        applyCycle(selectedRow.target, 1);
      }
      return;
    }
    if (key.name === 'enter' && selectedRow?.target) {
      if (selectedRow.target.kind === 'action') {
        if (selectedRow.target.action === 'addMcp') handleAddMcpServer();
        else handleAddModel();
        return;
      }
      if (selectedRow.target.kind === 'modelDefault' || (selectedRow.target.kind === 'systemField' && selectedRow.target.field === 'stream') || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'enabled')) {
        applyToggle(selectedRow.target);
        return;
      }
      if (selectedRow.target.kind === 'modelProvider' || selectedRow.target.kind === 'toolPolicy' || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'transport')) {
        applyCycle(selectedRow.target, 1);
        return;
      }
      if (selectedRow.target.kind === 'modelField' || (selectedRow.target.kind === 'systemField' && selectedRow.target.field !== 'stream') || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field !== 'enabled' && selectedRow.target.field !== 'transport')) {
        startEdit(selectedRow.target as Extract<RowTarget, { kind: 'modelField' | 'systemField' | 'mcpField' }>);
      }
    }
  });

  // 滚动窗口计算
  const listHeight = Math.max(10, termHeight - (editor ? 13 : 10));
  const selectedRowAbsoluteIndex = Math.max(0, rows.findIndex((row: SettingsRow) => row.id === selectedRowId));
  let windowStart = Math.max(0, selectedRowAbsoluteIndex - Math.floor(listHeight / 2));
  let windowEnd = Math.min(rows.length, windowStart + listHeight);
  if (windowEnd - windowStart < listHeight) {
    windowStart = Math.max(0, windowEnd - listHeight);
  }
  const visibleRows = rows.slice(windowStart, windowEnd);

  if (loading && !draft) {
    return (
      <box flexDirection="column" width="100%" height="100%">
        <box marginBottom={1} paddingX={1}>
          <text fg={C.primary}><strong><em>IRIS</em></strong></text>
        </box>
        <text><strong>设置中心</strong></text>
        <text fg="#888">正在加载配置...</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box marginBottom={1} paddingX={1}>
        <text fg={C.primary}><strong><em>IRIS</em></strong></text>
      </box>

      <text><strong>设置中心</strong></text>
      <text fg="#888">在终端内管理模型池、系统参数与 MCP 服务器。</text>
      <text fg={isDirty ? C.warn : C.accent}>
        {isDirty ? '\u25CF 有未保存修改' : '\u2713 当前草稿已同步'}
        {saving ? '  \u00b7  保存中...' : ''}
      </text>

      <scrollbox flexGrow={1} marginTop={1}>
        {windowStart > 0 && <text fg="#888">\u2026</text>}
        {visibleRows.map((row: SettingsRow) => {
          const isSelected = row.id === selectedRowId && !!row.target;
          const prefix = row.kind === 'section'
            ? '\u25A0'
            : row.kind === 'action'
              ? (isSelected ? '\u276F' : '\u2022')
              : row.kind === 'field'
                ? (isSelected ? '\u276F' : ' ')
                : ' ';

          if (row.kind === 'section') {
            return (
              <box key={row.id} marginTop={1}>
                <text fg={C.primary}><strong>{prefix} {row.label}</strong></text>
              </box>
            );
          }

          return (
            <box key={row.id} paddingLeft={row.indent ?? 0}>
              <text>
                <span fg={isSelected ? '#00ffff' : C.dim}>{prefix}</span>
                <span> </span>
                {isSelected && row.kind !== 'info'
                  ? <span fg={C.accent}><strong>{row.label}</strong></span>
                  : <span fg={isSelected ? '#00ffff' : undefined}>{row.label}</span>
                }
                {row.value != null && (
                  <span fg={isSelected ? '#00ffff' : C.dim}>{`  ${row.value}`}</span>
                )}
              </text>
            </box>
          );
        })}
        {windowEnd < rows.length && <text fg="#888">\u2026</text>}
      </scrollbox>

      <box marginTop={1} paddingX={1}>
        <text fg={C.dim}>{'\u2500'.repeat(Math.max(3, termWidth - 6))}</text>
      </box>

      {selectedRow?.description && !editor && (
        <text fg="#888">{selectedRow.description}</text>
      )}

      {statusText && (
        <text fg={getStatusColor(statusKind)}>{statusText}</text>
      )}

      {editor ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={C.accent}><strong>编辑：{editor.label}</strong></text>
          {editor.hint && <text fg="#888">{editor.hint}</text>}
          <box>
            <text fg={C.accent}>{'\u276F '}</text>
            <input
              value={editorValue}
              onChange={setEditorValue}
              focused
            />
          </box>
          <text fg="#888">Enter 保存 \u00b7 Esc 取消</text>
        </box>
      ) : (
        <text fg="#888">
          \u2191\u2193 选择  \u2190\u2192 切换枚举  Space 切换布尔  Enter 编辑  A 新增  D 删除  S 保存  R 重载  Esc 返回
        </text>
      )}
    </box>
  );
}
