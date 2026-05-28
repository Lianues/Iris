import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta, ToolDiffPreviewResponseLike, Disposable } from 'irises-extension-sdk';
import type { MemoryItem } from './components/MemoryListView';
import type { ExtensionItem } from './components/ExtensionListView';
import type { AgentDefinitionLike } from 'irises-extension-sdk';
import type { ConsoleSettingsTabDefinition } from './settings-tab-service';
import type { RewindCheckpointLike, RewindOperationResultLike, RewindTargetMode, SwitchModelResult, ThinkingEffortLevel } from './app-types';
import type { AppHandle } from './hooks/use-app-handle';
import type { ConsoleSettingsSaveResult, ConsoleSettingsSnapshot } from './settings';
import type { ConsoleSlashCommandService } from './slash-command-service';
import type { ConsolePathDisplayService } from './path-display-service';
import type { ConsoleStatusSegmentService } from './status-segment-service';
import type { ConsoleToolDisplayService } from './tool-display-service';
import type { ConsoleInputServiceBinding } from './input-service';

export interface ProgressUiStateSnapshot {
  expanded: boolean;
  updatedAt?: number;
  snapshotUpdatedAt?: number;
}

export interface AppProps {
  onReady: (handle: AppHandle) => void;
  onSubmit: (text: string) => void;
  /** 附加文件到下一条消息（/file 命令） */
  onFileAttach?: (filePath: string) => void;
  /** 获取 Console 当前会话 ID（用于 /env 等扩展 slash command，不依赖 Backend turn 上下文） */
  getCurrentSessionId?: () => string;
  /** 读取/保存当前会话最新 Iris 进度面板展开状态。 */
  onLoadProgressUiState?: (sessionId: string) => Promise<ProgressUiStateSnapshot | undefined>;
  onSaveProgressUiState?: (sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }) => Promise<void> | void;
  /** 移除指定索引的待发送文件附件 */
  onRemoveFile?: (index: number) => void;
  /** 获取当前会话 cwd 下可用于 @ 文件补全的相对文件路径 */
  onListFileMentionFiles?: () => readonly string[] | Promise<readonly string[]>;
  /** 文件浏览器操作回调 */
  onFileBrowserSelect?: (dirPath: string, entry: any, showHidden: boolean) => void;
  onFileBrowserGoUp?: (dirPath: string, showHidden: boolean) => void;
  onFileBrowserToggleHidden?: (dirPath: string, showHidden: boolean) => void;
  onUndo: () => Promise<boolean>;
  onRedo: () => Promise<boolean>;
  onClearRedoStack: () => void;
  onListRewindCheckpoints: () => Promise<RewindCheckpointLike[]>;
  onRewind: (checkpointId: string, mode?: RewindTargetMode) => Promise<RewindOperationResultLike | null>;
  onToolApproval: (toolId: string, approved: boolean) => void;
  onToolApply: (toolId: string, applied: boolean) => void;
  /** 向交互式工具发送上行消息 */
  onToolMessage?: (toolId: string, type: string, data?: unknown) => void;
  /** 获取工具调用的后端统一 diff 预览 */
  onGetToolDiffPreview?: (toolId: string) => ToolDiffPreviewResponseLike | Promise<ToolDiffPreviewResponseLike>;
  /** shell/bash 审批中用户选择“允许此类命令”或“询问此类命令”时，持久化命令模式 */
  onAddCommandPattern?: (toolName: string, command: string, type: 'allow' | 'deny') => void;
  onAbort: () => void;
  /** 用户请求打开工具详情 */
  onOpenToolDetail: (toolId: string) => void;
  /** 用户请求终止指定工具 */
  onToolAbort: (toolId: string) => void;
  /** 用户在详情页请求查看子工具 */
  onNavigateToolDetail: (toolId: string) => void;
  /** 用户关闭工具详情（返回上一层或退出） */
  onCloseToolDetail: () => void;
  onNewSession: () => void;
  onLoadSession: (id: string) => Promise<void>;
  onDeleteSession?: (id: string) => Promise<{ ok: boolean; message: string; deletedCurrent?: boolean }>;
  onListSessions: () => Promise<SessionMeta[]>;
  onRunCommand: (cmd: string) => { output: string; cwd: string };
  onListModels: () => { models: LLMModelInfo[]; defaultModelName: string };
  onSwitchModel: (modelName: string) => SwitchModelResult;
  onSetDefaultModel?: (modelName: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateModelEntry?: (
    currentModelName: string,
    updates: { modelName?: string; contextWindow?: number | null },
  ) => Promise<{ ok: boolean; message: string; updatedModelName?: string }>;
  onLoadSettings: () => Promise<ConsoleSettingsSnapshot>;
  onSaveSettings: (snapshot: ConsoleSettingsSnapshot) => Promise<ConsoleSettingsSaveResult>;
  onResetConfig: () => Promise<{ success: boolean; message: string }>;
  onExit: () => void;
  /** 关闭当前 TUI，但请求宿主保留 Core / IPC 后台运行。 */
  onEnterHeadless?: () => void;
  /** 当前宿主是否支持 TUI 内 /headless 切换。attach 客户端不支持远程关闭宿主平台。 */
  supportsHeadlessTransition?: boolean;
  onSummarize: () => Promise<{ ok: boolean; message: string }>;
  /** Plan Mode 命令处理（/plan）。返回需要显示在聊天区的提示文本。 */
  onPlanCommand?: (arg: string) => Promise<{ ok: boolean; message: string; followupPrompt?: string }>;
  /** 自动编辑命令处理（/auto-edit）。 */
  onAutoEditCommand?: (arg: string) => Promise<{ ok: boolean; message: string }>;
  /** /callme：显式开启/关闭 git commit co-author 署名。 */
  onCallmeCommand?: (arg: string) => Promise<{ ok: boolean; message: string }>;
  /** /note：编辑当前 Agent 的长期 Note。 */
  onNoteCommand?: (arg: string) => Promise<{ ok: boolean; message?: string }>;
  /** Note 编辑器保存回调。 */
  onSaveNote?: (content: string) => Promise<{ ok: boolean; message?: string }>;
  /** 获取可切换的 Agent 列表（/agent 命令触发） */
  onListAgents?: () => AgentDefinitionLike[];
  /** 用户在 agent-list 视图中确认选择后，执行实际的 Agent 切换 */
  onSelectAgent?: (agentName: string) => void;
  onDream?: () => Promise<{ ok: boolean; message: string }>;
  onListMemories?: () => Promise<MemoryItem[]>;
  onDeleteMemory?: (id: number) => Promise<boolean>;
  onListExtensions?: () => Promise<ExtensionItem[]>;
  onToggleExtension?: (name: string, enabled?: boolean) => Promise<{ ok: boolean; message: string }>;
  onInstallGitExtension?: (target: string) => Promise<{ ok: boolean; message: string }>;
  onPreviewUpdateExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  onDeleteExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  /** 重新读取插件注册的 Settings Tab，用于 extension 热启用后刷新 /settings 与动态命令。 */
  onListPluginSettingsTabs?: () => ConsoleSettingsTabDefinition[];
  /** 监听插件注册的 Settings Tab 变化（本地服务变化或远程缓存刷新） */
  onPluginSettingsTabsChanged?: (listener: () => void) => Disposable;
  onRemoteConnect?: (name?: string) => void;
  onRemoteDisconnect?: () => void;
  /** 当前 Console slash command 服务实例 */
  slashCommandService?: ConsoleSlashCommandService;
  /** 当前 Console 左下角路径显示服务实例 */
  pathDisplayService?: ConsolePathDisplayService;
  /** 当前 Console 状态段服务实例 */
  statusSegmentService?: ConsoleStatusSegmentService;
  /** 当前 Console 工具显示服务实例 */
  toolDisplayService?: ConsoleToolDisplayService;
  /** 当前 Console 输入桥接服务实例 */
  inputService?: ConsoleInputServiceBinding;
  /** 远程连接的主机地址（非空时 StatusBar 显示远程标识） */
  remoteHost?: string;
  onThinkingEffortChange?: (level: ThinkingEffortLevel) => void;
  agentName?: string;
  /** 当前模型的 provider 类型（用于思考强度级别适配） */
  modelProvider?: string;
  /** 思考强度便捷控制是否启用（来自 LLMConfig.thinkingControl，默认 true） */
  thinkingControlEnabled?: boolean;
  /** 初始化过程中的提示信息（首屏展示） */
  initWarnings?: string[];
  /** initWarnings 的颜色（默认黄色警告） */
  initWarningsColor?: string;
  /** initWarnings 的图标（默认 ⚠） */
  initWarningsIcon?: string;
  modeName?: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
  /** 插件注册的 Console Settings Tab 列表（由 ConsolePlatform 从 IrisAPI 获取后注入） */
  pluginSettingsTabs?: ConsoleSettingsTabDefinition[];
}
