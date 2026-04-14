/** @jsxImportSource @opentui/react */

/**
 * TUI 设置中心 (OpenTUI React)
 *
 * TODO: settings 界面的 editable 功能尚未完成，待补充：
 *   - 各字段的行内编辑交互（Enter 进入编辑、Esc 取消）仍需逐项验证
 *   - 编辑模式下的输入校验与错误提示
 *   - 新增/删除后的焦点管理与状态同步
 *
 * 已修复：
 *   - Unicode 转义在 JSX 文本节点中未被解析的问题（改为 JS 表达式）
 *   - Enter 键名兼容：OpenTUI 中 key.name 可能为 'return'，需同时匹配 'enter' 和 'return'
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';
/** MCP 服务器状态信息（duck-typed，由 mcp 扩展通过 ServiceRegistry 提供） */
interface MCPServerInfo { name: string; status: string; toolCount: number; error?: string; }
import type { ConsoleSettingsTabDefinition } from 'irises-extension-sdk/plugin';
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
import { getConsoleDiffApprovalViewDescription, supportsConsoleDiffApprovalViewSetting } from '../diff-approval';

// 放宽为 string：插件可注册自定义 tab，section id 不再限于内置三个
type SettingsSection = string;
type StatusKind = 'info' | 'success' | 'warning' | 'error';
type ToolPolicyMode = 'disabled' | 'manual' | 'auto';

type RowTarget =
  | { kind: 'modelProvider'; modelIndex: number }
  | { kind: 'modelField'; modelIndex: number; field: 'modelName' | 'modelId' | 'apiKey' | 'baseUrl' }
  | { kind: 'modelDefault'; modelIndex: number }
  | { kind: 'systemField'; field: 'systemPrompt' | 'maxToolRounds' | 'stream' | 'retryOnError' | 'maxRetries' | 'logRequests' | 'maxAgentDepth' | 'defaultMode' | 'asyncSubAgents' }
  | { kind: 'toolPolicy'; toolIndex: number }
  | { kind: 'toolApprovalView'; toolIndex: number }
  | { kind: 'toolGlobalToggle'; field: 'autoApproveAll' | 'autoApproveConfirmation' | 'autoApproveDiff' }
  | { kind: 'mcpField'; serverIndex: number; field: 'name' | 'enabled' | 'transport' | 'command' | 'args' | 'cwd' | 'url' | 'authHeader' | 'timeout' }
  | { kind: 'action'; action: 'addModel' | 'addMcp' }
  | { kind: 'pluginField'; tabId: string; fieldKey: string; fieldType: 'toggle' | 'number' | 'text' | 'select' | 'readonly' };

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
  target: Extract<RowTarget, { kind: 'modelField' | 'systemField' | 'mcpField' }> | Extract<RowTarget, { kind: 'pluginField' }>;
  label: string;
  value: string;
  hint?: string;
}

interface SettingsViewProps {
  initialSection?: string;  // 放宽：插件 tab id 也可作为初始 section
  onBack: () => void;
  onLoad: () => Promise<ConsoleSettingsSnapshot>;
  onSave: (snapshot: ConsoleSettingsSnapshot) => Promise<ConsoleSettingsSaveResult>;
  /** 插件注册的 Settings Tab 列表 */
  pluginTabs?: ConsoleSettingsTabDefinition[];
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
    ? `${firstLine.slice(0, Math.max(1, maxLength - 1))}${ICONS.ellipsis}`
    : firstLine;

  if (lines.length <= 1) {
    return compact || '(空)';
  }

  return `${lines.length} 行 ${ICONS.separator} ${compact}`;
}

function getEditableFingerprint(snapshot: ConsoleSettingsSnapshot | null): string {
  if (!snapshot) return '';
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
      label: `${displayName} ${ICONS.separator} ${model.provider} ${ICONS.separator} ${model.modelId || '(空模型 ID)'}`,
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
  pushField('system.retryOnError', 'general', 'System / 报错自动重试', boolText(snapshot.system.retryOnError), { kind: 'systemField', field: 'retryOnError' }, 'LLM 调用失败时自动重试，空格切换。');
  pushField('system.maxRetries', 'general', 'System / 最大重试次数', String(snapshot.system.maxRetries), { kind: 'systemField', field: 'maxRetries' }, '报错重试的最大次数（0-20），回车编辑。');
  pushField('system.logRequests', 'general', 'System / 记录请求日志', boolText(snapshot.system.logRequests), { kind: 'systemField', field: 'logRequests' }, '将 LLM 请求/响应记录到日志文件，空格切换。');
  pushField('system.maxAgentDepth', 'general', 'System / 最大代理深度', String(snapshot.system.maxAgentDepth), { kind: 'systemField', field: 'maxAgentDepth' }, '子代理最大嵌套深度（1-20），回车编辑。');
  pushField('system.defaultMode', 'general', 'System / 默认模式', snapshot.system.defaultMode || '(未设置)', { kind: 'systemField', field: 'defaultMode' }, '启动时默认使用的模式（如 code），回车编辑。');
  pushField('system.asyncSubAgents', 'general', 'System / 异步子代理', boolText(snapshot.system.asyncSubAgents), { kind: 'systemField', field: 'asyncSubAgents' }, '启用后子代理可在后台异步执行，主对话不阻塞。需在 sub_agents.yaml 中定义子代理类型。空格切换。');

  rows.push({ id: 'section.tools', kind: 'section', section: 'tools', label: `工具执行策略（${snapshot.toolPolicies.length}）` });

  pushField('tools.autoApproveAll', 'tools', '全部自动批准', boolText(snapshot.autoApproveAll), { kind: 'toolGlobalToggle', field: 'autoApproveAll' }, '跳过所有审批（一类确认 + 二类 diff 预览），最高优先级。空格切换。');
  pushField('tools.autoApproveConfirmation', 'tools', '跳过确认审批', boolText(snapshot.autoApproveConfirmation), { kind: 'toolGlobalToggle', field: 'autoApproveConfirmation' }, '仅跳过一类审批（Y/N 确认），二类审批（diff 预览）仍生效。空格切换。');
  pushField('tools.autoApproveDiff', 'tools', '跳过 Diff 审批', boolText(snapshot.autoApproveDiff), { kind: 'toolGlobalToggle', field: 'autoApproveDiff' }, '仅跳过二类审批（diff 预览），一类审批（Y/N 确认）仍生效。空格切换。');

  snapshot.toolPolicies.forEach((tool, index) => {
    const mode = getToolPolicyMode(tool.configured, tool.autoApprove);
    rows.push({
      id: `tool.${tool.name}`, kind: 'field', section: 'tools',
      label: `Tool / ${tool.name}${tool.registered ? '' : '（当前未注册）'}`,
      value: formatToolPolicyMode(mode),
      target: { kind: 'toolPolicy', toolIndex: index },
      description: '空格或左右方向键切换。', indent: 2,
    });

    if (supportsConsoleDiffApprovalViewSetting(tool.name)) {
      pushField(
        `tool.${tool.name}.approvalView`, 'tools', '审批视图',
        boolText(tool.showApprovalView !== false),
        { kind: 'toolApprovalView', toolIndex: index },
        getConsoleDiffApprovalViewDescription(tool.name), 6,
      );
    }
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
      ? `${server.name || `server_${index + 1}`} ${ICONS.separator} ${server.enabled ? '启用' : '禁用'} ${ICONS.separator} ${transportLabel(server.transport)} ${ICONS.separator} ${status.status}${errorText ? ` ${ICONS.separator} ${errorText}` : ` ${ICONS.separator} ${status.toolCount} tools`}`
      : `${server.name || `server_${index + 1}`} ${ICONS.separator} ${server.enabled ? '未应用' : '禁用'} ${ICONS.separator} ${transportLabel(server.transport)}`;

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


/* 左栏导航分栏定义（内置部分）。
 * 插件 tab 在组件内部通过 useMemo 动态拼接到末尾。
 * 用户按数字键可直接切换分栏（参考 lazygit 的面板跳转交互）。 */
const BUILTIN_SECTIONS = [
  { id: 'general', label: '模型与系统', icon: '01' },
  { id: 'tools', label: '工具策略', icon: '02' },
  { id: 'mcp', label: 'MCP 服务', icon: '03' }
];




export function SettingsView({ initialSection = 'general', onBack, onLoad, onSave, pluginTabs }: SettingsViewProps) {
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

  // ── 插件 tab 数据 ──────────────────────────────────────
  // 插件 tab 的配置值独立于内置 ConsoleSettingsSnapshot，各插件自带 onLoad/onSave。
  const [pluginDraft, setPluginDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [pluginBaseline, setPluginBaseline] = useState<Record<string, Record<string, unknown>>>({});

  // 动态拼接 sections：内置 3 个 + 插件注册的 tab
  const sections = useMemo(() => {
    const pluginSections = (pluginTabs ?? []).map((tab, i) => ({
      id: tab.id,
      label: tab.label,
      icon: tab.icon ?? String(BUILTIN_SECTIONS.length + i + 1).padStart(2, '0'),
    }));
    return [...BUILTIN_SECTIONS, ...pluginSections];
  }, [pluginTabs]);

  const setStatus = useCallback((text: string, kind: StatusKind = 'info') => {
    setStatusText(text);
    setStatusKind(kind);
  }, []);

  const isDirty = useMemo(() => {
    const builtinDirty = getEditableFingerprint(draft) !== getEditableFingerprint(baseline);
    // 插件 tab 数据变更检测
    const pluginDirty = JSON.stringify(pluginDraft) !== JSON.stringify(pluginBaseline);
    return builtinDirty || pluginDirty;
  }, [draft, baseline, pluginDraft, pluginBaseline]);

  const rows = useMemo(() => {
    if (!draft) return [] as SettingsRow[];
    const builtinRows = buildRows(draft, termWidth);

    // 追加插件 tab 的 rows（section 头 + 分组头 + 字段行）
    for (const tab of (pluginTabs ?? [])) {
      builtinRows.push({
        id: `plugin-section-${tab.id}`,
        kind: 'section',
        section: tab.id,
        label: tab.label,
      });
      let lastGroup = '';
      for (const field of tab.fields) {
        // 分组标题行
        if (field.group && field.group !== lastGroup) {
          lastGroup = field.group;
          builtinRows.push({
            id: `plugin-group-${tab.id}-${field.group}`,
            kind: 'info',
            section: tab.id,
            label: `── ${field.group} ──`,
          });
        }
        // 字段说明行
        if (field.description) {
          builtinRows.push({
            id: `plugin-desc-${tab.id}-${field.key}`,
            kind: 'info',
            section: tab.id,
            label: '',
            description: field.description,
          });
        }
        // 字段值行
        const rawValue = pluginDraft[tab.id]?.[field.key] ?? field.defaultValue;
        let displayValue: string;
        if (field.type === 'toggle') {
          displayValue = rawValue ? '开启' : '关闭';
        } else if (field.type === 'select') {
          const opt = field.options?.find(o => o.value === String(rawValue));
          displayValue = opt?.label ?? String(rawValue ?? '');
        } else {
          displayValue = String(rawValue ?? '');
        }
        builtinRows.push({
          id: `plugin-${tab.id}-${field.key}`,
          kind: 'field',
          section: tab.id,
          label: field.label,
          value: displayValue,
          target: { kind: 'pluginField', tabId: tab.id, fieldKey: field.key, fieldType: field.type },
        });
      }
    }
    return builtinRows;
  }, [draft, termWidth, pluginTabs, pluginDraft]);

  const selectableRows = useMemo(() => rows.filter((row: SettingsRow) => row.target), [rows]);
  const selectedRow = useMemo(() => rows.find((row: SettingsRow) => row.id === selectedRowId), [rows, selectedRowId]);
  /* currentSection / sectionRows 必须在 rows 和 selectedRow 之后声明，
   * 否则会触发 "Cannot access before initialization" 的运行时错误。 */
  const currentSection = useMemo(() => selectedRow?.section ?? initialSection, [selectedRow, initialSection]);
  const sectionRows = useMemo(() => rows.filter((r: SettingsRow) => r.section === currentSection && r.kind !== 'section'), [rows, currentSection]);
  const selectedSelectableIndex = useMemo(() => {
    return selectableRows.findIndex((row: SettingsRow) => row.id === selectedRowId);
  }, [selectableRows, selectedRowId]);
  const sectionSelectableRows = useMemo(() => selectableRows.filter((row: SettingsRow) => row.section === currentSection), [selectableRows, currentSection]);
  const selectedSectionIndex = useMemo(() => sectionSelectableRows.findIndex((row: SettingsRow) => row.id === selectedRowId), [sectionSelectableRows, selectedRowId]);

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

        // 并行加载所有插件 tab 的配置数据
        if (pluginTabs && pluginTabs.length > 0) {
          const entries = await Promise.all(
            pluginTabs.map(async (tab) => {
              try { return [tab.id, await tab.onLoad()] as const; }
              catch { return [tab.id, {}] as const; }
            })
          );
          const data = Object.fromEntries(entries);
          if (!cancelled) {
            setPluginDraft(structuredClone(data));
            setPluginBaseline(structuredClone(data));
          }
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus(`加载配置失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [onLoad, setStatus, pluginTabs]);

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
      const rawValue = target.field === 'maxToolRounds' ? String(draft.system.maxToolRounds)
        : target.field === 'maxRetries' ? String(draft.system.maxRetries)
        : target.field === 'maxAgentDepth' ? String(draft.system.maxAgentDepth)
        : target.field === 'defaultMode' ? (draft.system.defaultMode ?? '')
        : target.field === 'stream' ? String(draft.system.stream)
        : draft.system.systemPrompt;


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
      if (target.kind === 'systemField' && target.field === 'retryOnError') {
        snapshot.system.retryOnError = !snapshot.system.retryOnError;
        return;
      }
      if (target.kind === 'systemField' && target.field === 'logRequests') {
        snapshot.system.logRequests = !snapshot.system.logRequests;
        return;
      }
      if (target.kind === 'systemField' && target.field === 'asyncSubAgents') {
        snapshot.system.asyncSubAgents = !snapshot.system.asyncSubAgents;
        return;
      }

      if (target.kind === 'toolGlobalToggle') {
        snapshot[target.field] = !snapshot[target.field];
        return;
      }

      if (target.kind === 'toolApprovalView') {
        const tool = snapshot.toolPolicies[target.toolIndex];
        if (tool) tool.showApprovalView = tool.showApprovalView === false;
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
    // 插件 tab 字段的编辑器提交
    if ((editor.target as any).kind === 'pluginField') {
      const { tabId, fieldKey, fieldType } = editor.target as Extract<RowTarget, { kind: 'pluginField' }>;
      let finalValue: unknown = editorValue;
      if (fieldType === 'number') {
        const parsed = Number(editorValue.trim());
        if (!Number.isFinite(parsed)) { setStatus('请输入有效数字', 'error'); return; }
        finalValue = parsed;
      }
      setPluginDraft(prev => {
        const next = structuredClone(prev);
        (next[tabId] ??= {})[fieldKey] = finalValue;
        return next;
      });
      setStatus('字段已更新，按 S 保存并热重载', 'success');
      setEditor(null);
      setEditorValue('');
      return;
    }

    const value = (editor.target.kind === 'systemField' && editor.target.field === 'systemPrompt')
      ? restoreMultilineFromInput(editorValue)
      : (editor.target.kind === 'mcpField' && editor.target.field === 'args')
        ? restoreMultilineFromInput(editorValue)
        : editorValue;

    if (editor.target.kind === 'systemField' && editor.target.field === 'maxToolRounds') {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1) { setStatus('请输入大于等于 1 的有效数字', 'error'); return; }
    }
    if (editor.target.kind === 'systemField' && editor.target.field === 'maxRetries') {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20) { setStatus('最大重试次数必须在 0 到 20 之间', 'error'); return; }
    }
    if (editor.target.kind === 'systemField' && editor.target.field === 'maxAgentDepth') {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) { setStatus('最大代理深度必须在 1 到 20 之间', 'error'); return; }
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
        else if (editor.target.field === 'maxRetries') snapshot.system.maxRetries = Number(value.trim());
        else if (editor.target.field === 'maxAgentDepth') snapshot.system.maxAgentDepth = Number(value.trim());
        else if (editor.target.field === 'defaultMode') snapshot.system.defaultMode = value.trim();

        return;
      }
      if (editor.target.kind !== 'mcpField') return;
      const mcpTarget = editor.target;
      const server = snapshot.mcpServers[mcpTarget.serverIndex];
      if (!server) return;
      const field = mcpTarget.field;
      if (field === 'name') server.name = value.replace(/[^a-zA-Z0-9_]/g, '_');
      else if (field === 'timeout') server.timeout = Number(value.trim());
      else if (field === 'command') server.command = value;
      else if (field === 'args') server.args = value;
      else if (field === 'cwd') server.cwd = value;
      else if (field === 'url') server.url = value;
      else if (field === 'authHeader') server.authHeader = value;
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

      // 保存插件 tab 的配置数据
      if (pluginTabs && pluginTabs.length > 0) {
        const pluginErrors: string[] = [];
        for (const tab of pluginTabs) {
          const tabData = pluginDraft[tab.id] ?? {};
          try {
            const r = await tab.onSave(tabData);
            if (!r.success) pluginErrors.push(`${tab.label}: ${r.error ?? '未知错误'}`);
          } catch (e: unknown) {
            pluginErrors.push(`${tab.label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (pluginErrors.length > 0) {
          setStatus(`部分插件配置保存失败：${pluginErrors.join('; ')}`, 'warning');
        } else {
          setPluginBaseline(structuredClone(pluginDraft));
        }
      }
    } catch (err: unknown) {
      setStatus(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, saving, setStatus, pluginTabs, pluginDraft]);

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
        key.preventDefault();
      }
      // 修复：OpenTUI 中 Enter 键的 key.name 可能是 'return'（取决于终端键盘协议），
      // 与 use-app-keyboard.ts / InputBar.tsx 保持一致，同时兼容两种名称。
      if (key.name === 'enter' || key.name === 'return') {
        submitEditor();
        // 阻止事件继续传播到 <input> 的 renderable handler，
        // 避免 <input>.submit() 再次触发 onChange 覆盖 editorValue。
        key.preventDefault();
      }
      return;
    }

    if (loading || saving) {
      if (key.name === 'escape') onBack();
      return;
    }

    const currentIndex = selectedSectionIndex >= 0 ? selectedSectionIndex : 0;

    if (key.name === 'up') {
      const prev = sectionSelectableRows[Math.max(0, currentIndex - 1)];
      if (prev) setSelectedRowId(prev.id);
      setPendingLeaveConfirm(false);
      return;
    }
    if (key.name === 'down') {
      const next = sectionSelectableRows[Math.min(sectionSelectableRows.length - 1, currentIndex + 1)];
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
    /* 数字键切换左栏分栏。
     * 支持任意数量的 tab（内置 + 插件），按数字跳转到对应 tab。 */
    const numKey = parseInt(key.name ?? '', 10);
    if (numKey >= 1 && numKey <= sections.length) {
      const targetSection = sections[numKey - 1];
      if (targetSection) {
        const firstInSection = selectableRows.find((r: SettingsRow) => r.section === targetSection.id);
        if (firstInSection) setSelectedRowId(firstInSection.id);
      }
      setPendingLeaveConfirm(false);
      return;
    }
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
      if (selectedRow.target.kind === 'modelDefault' || selectedRow.target.kind === 'toolApprovalView' || selectedRow.target.kind === 'toolGlobalToggle' || (selectedRow.target.kind === 'systemField' && (selectedRow.target.field === 'stream' || selectedRow.target.field === 'retryOnError' || selectedRow.target.field === 'logRequests' || selectedRow.target.field === 'asyncSubAgents')) || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'enabled')) {

        applyToggle(selectedRow.target);
      } else if (selectedRow.target.kind === 'pluginField' && selectedRow.target.fieldType === 'toggle') {
        // 插件 tab 的 toggle 字段：空格切换
        const { tabId, fieldKey } = selectedRow.target;
        setPluginDraft(prev => {
          const next = structuredClone(prev);
          (next[tabId] ??= {})[fieldKey] = !(next[tabId]?.[fieldKey]);
          return next;
        });
      } else if (selectedRow.target.kind === 'toolPolicy') {
        applyCycle(selectedRow.target, 1);
      }
      return;
    }
    // 修复：OpenTUI 中 Enter 键的 key.name 可能是 'return'（取决于终端键盘协议），
    // 与 use-app-keyboard.ts / InputBar.tsx 保持一致，同时兼容两种名称。
    if ((key.name === 'enter' || key.name === 'return') && selectedRow?.target) {
      if (selectedRow.target.kind === 'action') {
        if (selectedRow.target.action === 'addMcp') handleAddMcpServer();
        else handleAddModel();
        return;
      }
      if (selectedRow.target.kind === 'modelDefault' || selectedRow.target.kind === 'toolApprovalView' || selectedRow.target.kind === 'toolGlobalToggle' || (selectedRow.target.kind === 'systemField' && (selectedRow.target.field === 'stream' || selectedRow.target.field === 'retryOnError' || selectedRow.target.field === 'logRequests' || selectedRow.target.field === 'asyncSubAgents')) || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'enabled')) {
        applyToggle(selectedRow.target);
        return;
      }
      if (selectedRow.target.kind === 'modelProvider' || selectedRow.target.kind === 'toolPolicy' || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field === 'transport')) {
        applyCycle(selectedRow.target, 1);
        return;
      }
      // 插件 tab 字段的 Enter 键交互
      if (selectedRow.target.kind === 'pluginField') {
        const { tabId, fieldKey, fieldType } = selectedRow.target;
        if (fieldType === 'toggle') {
          setPluginDraft(prev => {
            const next = structuredClone(prev);
            (next[tabId] ??= {})[fieldKey] = !(next[tabId]?.[fieldKey]);
            return next;
          });
        } else if (fieldType === 'text' || fieldType === 'number') {
          const currentVal = pluginDraft[tabId]?.[fieldKey] ?? '';
          setEditor({
            target: selectedRow.target as any,
            label: `${tabId}.${fieldKey}`,
            value: String(currentVal),
          });
          setEditorValue(String(currentVal));
        } else if (fieldType === 'select') {
          const tab = pluginTabs?.find(t => t.id === tabId);
          const field = tab?.fields.find(f => f.key === fieldKey);
          if (field?.options && field.options.length > 0) {
            const currentVal = String(pluginDraft[tabId]?.[fieldKey] ?? '');
            const idx = field.options.findIndex(o => o.value === currentVal);
            const nextIdx = (idx + 1) % field.options.length;
            setPluginDraft(prev => {
              const next = structuredClone(prev);
              (next[tabId] ??= {})[fieldKey] = field.options![nextIdx].value;
              return next;
            });
          }
        }
        return;
      }
      if (selectedRow.target.kind === 'modelField' || (selectedRow.target.kind === 'systemField' && selectedRow.target.field !== 'stream' && selectedRow.target.field !== 'retryOnError' && selectedRow.target.field !== 'logRequests' && selectedRow.target.field !== 'asyncSubAgents') || (selectedRow.target.kind === 'mcpField' && selectedRow.target.field !== 'enabled' && selectedRow.target.field !== 'transport')) {
        startEdit(selectedRow.target as Extract<RowTarget, { kind: 'modelField' | 'systemField' | 'mcpField' }>);
      }

    }
  });

  // 滚动窗口计算。
  // 顶部 LOGO 区域占 5 行（3 行文字 + paddingTop=1 + marginTop=1），
  // 加上底部信息栏，需要从终端高度中减去这些固定占用。
  const listHeight = Math.max(10, termHeight - (editor ? 26 : 22));
  const selectedRowSectionIndex = Math.max(0, sectionRows.findIndex((row: SettingsRow) => row.id === selectedRowId));
  let windowStart = Math.max(0, selectedRowSectionIndex - Math.floor(listHeight / 2));
  let windowEnd = Math.min(sectionRows.length, windowStart + listHeight);
  if (windowEnd - windowStart < listHeight) {
    windowStart = Math.max(0, windowEnd - listHeight);
  }
  const visibleRows = sectionRows.slice(windowStart, windowEnd);

  if (loading && !draft) {
    return (
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <text fg="#888">正在加载配置...</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* 主体：左栏导航 + 右栏内容，LOGO 放在右栏顶部居中 */}
      <box flexDirection="row" flexGrow={1}>
        {/* 左栏导航：用 paddingRight + 竖线字符模拟分隔线，
         * 因为 OpenTUI 的 BoxProps 不支持 borderRight 属性。 */}
        <box width={24} flexShrink={0} flexDirection="column" paddingTop={1} paddingLeft={2} paddingRight={1}>
          <text fg={C.primary}><strong>IRIS</strong></text>
          <box marginTop={1} flexDirection="column">
            {sections.map((sec) => (
              <text key={sec.id} fg={currentSection === sec.id ? C.accent : '#555'}>
                {currentSection === sec.id ? ICONS.dotFilled : ICONS.dotEmpty} {sec.icon} {sec.label}
              </text>
            ))}
          </box>
        </box>
        <box flexGrow={1} flexDirection="column" paddingTop={1} paddingLeft={2}>
          {/* ================================================================
           * LOGO 渲染修复记录
           * ================================================================
           *
           * 原始实现：手动用 Unicode Block Elements（U+2580-259F）拼出
           *   ▀█▀ █▀█ ▀█▀ █▀▀ / █ █▀▄ █ ▀▀█ / ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀
           *
           * 问题：在 SettingsView 复杂布局（左栏+右栏+底栏）中 LOGO 渲染乱码，
           *       但首页 LogoScreen（全屏居中）显示正常。
           *
           * 根因：OpenTUI Zig native 渲染层对 Block Elements 字符的
           *       displayWidth 计算与终端实际渲染宽度不一致。native 层按
           *       char_offset（字符偏移）而非 col_offset（列偏移）写入
           *       渲染 buffer，导致方块字符后续的所有字符列位置整体偏移。
           *       首页不受影响是因为 LOGO 居中且周围全是空白，偏移不可见。
           *       SettingsView 有相邻内容，偏移导致字符互相覆盖产生乱码。
           *       参见 OpenTUI issue #255（CJK displayWidth 错误）、
           *       issue #609（lineStarts 返回 column offset 而非 byte offset）。
           *
           * 已尝试但失败的方案：
           *   1. wrapMode="none" — native 层仍按错误列宽写入 buffer
           *   2. minWidth={30} + height={3} — 容器够大但列号仍错位
           *   3. truncate={false} — 不影响 buffer 写入行为
           *   4. alignItems="center" — native 层用错误宽度算居中偏移
           *   5. alignItems="stretch" — 填充空格覆盖方块图形
           *   6. alignItems="flex-start" — buffer 列号本身就错，仍乱码
           *   7. padBlock() 补偿空格 — 假设终端把 Block Elements 渲染为
           *      2 列宽，但实际大多数终端渲染为 1 列宽，反而更乱
           *   8. padding={2} 复制首页布局 — 无效
           *
           * 最终方案：使用 OpenTUI 内置 <ascii-font> 组件。该组件内部
           *   自行管理 ASCII art 字符的宽度计算和 buffer 写入，
           *   绕过了 Zig native 层的 displayWidth 错误。
           *   LOGO 放在右栏顶部居中（flexShrink=0 固定不随列表滚动），
           *   font="block" 保持与首页一致的视觉风格。
           * ================================================================ */}
          <box alignItems="center" paddingBottom={1} flexShrink={0}>
            <ascii-font text="IRIS" font="block" color={C.primary} />
          </box>
          {/* 状态栏：固定不滚动 */}
          <box flexDirection="column" marginBottom={1} flexShrink={0}>
            <text fg="#888">在终端内管理模型池、系统参数、工具策略与 MCP 服务器。</text>
            <text fg={isDirty ? C.warn : C.accent}>
              {isDirty ? `${ICONS.dotFilled} 有未保存修改` : `${ICONS.checkmark} 当前草稿已同步`}
              {saving ? `  ${ICONS.separator}  保存中...` : ''}
            </text>
          </box>
          {/* 设置项列表：可滚动区域 */}
          <scrollbox flexGrow={1}>
            {windowStart > 0 && <text fg="#888">{ICONS.ellipsis}</text>}
            {visibleRows.map((row: SettingsRow) => {
              const isSelected = row.id === selectedRowId && !!row.target;
              const prefix = row.kind === 'action'
                  ? (isSelected ? '\u276F' : '\u2022')
                  : row.kind === 'field'
                    ? (isSelected ? '\u276F' : ' ')
                    : ' ';
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
            {windowEnd < sectionRows.length && <text fg="#888">{ICONS.ellipsis}</text>}
          </scrollbox>
        </box>
      </box>
      <box flexDirection="column" marginTop={1} paddingX={2}>
        <text fg={C.dim}>{'─'.repeat(Math.max(3, termWidth - 4))}</text>
        <box flexDirection="column" minHeight={4}>
          {selectedRow?.description && !editor && <text fg="#888">{selectedRow.description}</text>}
          {statusText && <text fg={getStatusColor(statusKind)}>{statusText}</text>}
          {editor ? (
            <box flexDirection="column">
              <text fg={C.accent}><strong>编辑：{editor.label}</strong></text>
              {editor.hint && <text fg="#888">{editor.hint}</text>}
              <box>
                <text fg={C.accent}>{'\u276F '}</text>
                <input value={editorValue} onInput={setEditorValue} focused />
              </box>
              <text fg="#888">{`Enter 保存 ${ICONS.separator} Esc 取消`}</text>
            </box>
          ) : (
            <text fg="#888">{`${ICONS.arrowUp}${ICONS.arrowDown} 选择  ${ICONS.arrowLeft}${ICONS.arrowRight} 切换  1~${sections.length} 分栏  Space 布尔  Enter 编辑  A 新增  D 删除  S 保存  R 重载  Esc 返回`}</text>
          )}
        </box>
      </box>
    </box>
  );
}
