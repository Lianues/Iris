/**
 * IPC 消息协议定义
 *
 * 基于 JSON-RPC 2.0 变体：
 *   - Request：客户端 → 服务端（带 id，期望响应）
 *   - Response：服务端 → 客户端（带 id，匹配 Request）
 *   - Notification：服务端 → 客户端（无 id，单向事件推送）
 */

// ============ 核心消息类型 ============

/** 客户端 → 服务端 请求 */
export interface IPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown[];
}

/** 服务端 → 客户端 响应 */
export interface IPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: IPCError;
}

/** 服务端 → 客户端 事件通知（无 id，单向） */
export interface IPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown[];
}

export interface IPCError {
  code: number;
  message: string;
  data?: unknown;
}

/** 所有 IPC 消息的联合类型 */
export type IPCMessage = IPCRequest | IPCResponse | IPCNotification;

// ============ 错误码 ============

export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** 服务端内部业务错误 */
  BACKEND_ERROR: -32000,
  /** 工具 handle 不存在或已过期 */
  HANDLE_NOT_FOUND: -32001,
} as const;

// ============ 方法名 ============

/**
 * IPC 方法名枚举。
 *
 * 命名规则：
 *   - Backend 方法：`backend.{methodName}`
 *   - 工具 handle 操作：`handle.{action}`
 *   - API 子集：`api.{namespace}.{method}`
 *   - 客户端控制：`client.{action}`
 */
export const Methods = {
  // ---- Backend 核心方法 ----
  CHAT: 'backend.chat',
  CLEAR_SESSION: 'backend.clearSession',
  SWITCH_MODEL: 'backend.switchModel',
  LIST_MODELS: 'backend.listModels',
  LIST_SESSION_METAS: 'backend.listSessionMetas',
  ABORT_CHAT: 'backend.abortChat',
  IS_STREAM_ENABLED: 'backend.isStreamEnabled',
  UNDO: 'backend.undo',
  REDO: 'backend.redo',
  CLEAR_REDO: 'backend.clearRedo',
  GET_HISTORY: 'backend.getHistory',
  LIST_SKILLS: 'backend.listSkills',
  LIST_MODES: 'backend.listModes',
  SWITCH_MODE: 'backend.switchMode',
  SUMMARIZE: 'backend.summarize',
  GET_TOOL_NAMES: 'backend.getToolNames',
  GET_CURRENT_MODEL_INFO: 'backend.getCurrentModelInfo',
  GET_DISABLED_TOOLS: 'backend.getDisabledTools',
  GET_ACTIVE_SESSION_ID: 'backend.getActiveSessionId',
  GET_TOOL_HANDLE: 'backend.getToolHandle',
  GET_TOOL_HANDLES: 'backend.getToolHandles',
  RUN_COMMAND: 'backend.runCommand',
  RESET_CONFIG: 'backend.resetConfigToDefaults',
  GET_AGENT_TASKS: 'backend.getAgentTasks',
  GET_RUNNING_AGENT_TASKS: 'backend.getRunningAgentTasks',
  GET_AGENT_TASK: 'backend.getAgentTask',
  GET_TOOL_POLICIES: 'backend.getToolPolicies',
  GET_CWD: 'backend.getCwd',
  SET_CWD: 'backend.setCwd',

  // ---- 服务端全局信息（attach 模式使用）----
  GET_CONFIG: 'server.getConfig',
  GET_CONFIG_DIR: 'server.getConfigDir',

  // ---- 工具 Handle 操作 ----
  HANDLE_APPROVE: 'handle.approve',
  HANDLE_REJECT: 'handle.reject',
  HANDLE_APPLY: 'handle.apply',
  HANDLE_ABORT: 'handle.abort',

  // ---- API 子集（Console 使用）----
  API_SET_LOG_LEVEL: 'api.setLogLevel',
  API_GET_CONSOLE_SETTINGS_TABS: 'api.getConsoleSettingsTabs',
  API_LIST_AGENTS: 'api.listAgents',
  API_AGENT_NETWORK_LIST_PEERS: 'api.agentNetwork.listPeers',
  API_AGENT_NETWORK_GET_PEER_DESCRIPTION: 'api.agentNetwork.getPeerDescription',
  API_AGENT_NETWORK_GET_PEER_BACKEND_HANDLE: 'api.agentNetwork.getPeerBackendHandle',
  API_CONFIG_MANAGER_READ: 'api.configManager.readEditableConfig',
  API_CONFIG_MANAGER_UPDATE: 'api.configManager.updateEditableConfig',
  API_ROUTER_REMOVE_REQUEST_BODY_KEYS: 'api.router.removeCurrentModelRequestBodyKeys',
  API_ROUTER_PATCH_REQUEST_BODY: 'api.router.patchCurrentModelRequestBody',

  // ---- 客户端控制 ----
  /** 客户端订阅指定 session 的事件（或 '*' 表示全部） */
  SUBSCRIBE: 'client.subscribe',
  /** 客户端取消订阅 */
  UNSUBSCRIBE: 'client.unsubscribe',
  /** 客户端初始化 session cwd */
  INIT_SESSION_CWD: 'client.initSessionCwd',
  /** 客户端握手信息 */
  HANDSHAKE: 'client.handshake',
} as const;

// ============ 事件通知名 ============

/**
 * IPC 事件通知名。
 *
 * 命名规则：`event:{backendEventName}`
 * 与 BackendEventMap 一一对应。
 */
export const Events = {
  RESPONSE: 'event:response',
  STREAM_START: 'event:stream:start',
  STREAM_CHUNK: 'event:stream:chunk',
  STREAM_END: 'event:stream:end',
  STREAM_PARTS: 'event:stream:parts',
  TOOL_EXECUTE: 'event:tool:execute',
  ERROR: 'event:error',
  USAGE: 'event:usage',
  DONE: 'event:done',
  TURN_START: 'event:turn:start',
  ASSISTANT_CONTENT: 'event:assistant:content',
  AUTO_COMPACT: 'event:auto-compact',
  ATTACHMENTS: 'event:attachments',
  RETRY: 'event:retry',
  USER_TOKEN: 'event:user:token',
  AGENT_NOTIFICATION: 'event:agent:notification',
  TASK_RESULT: 'event:task:result',
  NOTIFICATION_PAYLOADS: 'event:notification:payloads',
  MODELS_CHANGED: 'event:models:changed',
  // ---- 工具 Handle 事件 ----
  HANDLE_STATE: 'event:handle:state',
  HANDLE_OUTPUT: 'event:handle:output',
  HANDLE_PROGRESS: 'event:handle:progress',
  HANDLE_STREAM: 'event:handle:stream',
} as const;

/** Backend 事件名 → IPC 事件通知名 映射 */
export const BACKEND_EVENT_TO_IPC: Record<string, string> = {
  'response': Events.RESPONSE,
  'stream:start': Events.STREAM_START,
  'stream:chunk': Events.STREAM_CHUNK,
  'stream:end': Events.STREAM_END,
  'stream:parts': Events.STREAM_PARTS,
  'tool:execute': Events.TOOL_EXECUTE,
  'error': Events.ERROR,
  'usage': Events.USAGE,
  'done': Events.DONE,
  'turn:start': Events.TURN_START,
  'assistant:content': Events.ASSISTANT_CONTENT,
  'auto-compact': Events.AUTO_COMPACT,
  'attachments': Events.ATTACHMENTS,
  'retry': Events.RETRY,
  'user:token': Events.USER_TOKEN,
  'agent:notification': Events.AGENT_NOTIFICATION,
  'task:result': Events.TASK_RESULT,
  'notification:payloads': Events.NOTIFICATION_PAYLOADS,
  'models:changed': Events.MODELS_CHANGED,
};

/** IPC 事件通知名 → Backend 事件名 映射 */
export const IPC_TO_BACKEND_EVENT: Record<string, string> = Object.fromEntries(
  Object.entries(BACKEND_EVENT_TO_IPC).map(([k, v]) => [v, k])
);

// ============ 类型守卫 ============

export function isRequest(msg: IPCMessage): msg is IPCRequest {
  return 'id' in msg && 'method' in msg;
}

export function isResponse(msg: IPCMessage): msg is IPCResponse {
  return 'id' in msg && !('method' in msg);
}

export function isNotification(msg: IPCMessage): msg is IPCNotification {
  return !('id' in msg) && 'method' in msg;
}

// ============ Lock 文件 ============

export interface LockFileContent {
  pid: number;
  port: number;
  agentName: string;
  startedAt: string;
}

// ============ 工具 Handle 序列化 ============

/** ToolExecutionHandle 的可序列化形式（通过 IPC 传输） */
export interface SerializedToolHandle {
  handleId: string;
  toolName: string;
  toolId: string;
  args: Record<string, unknown>;
  state: string;
  preview?: string;
  /** 工具定义中的 approvalRequired */
  approvalRequired?: boolean;
}

/** Handshake 响应 */
export interface HandshakeResult {
  version: string;
  agentName: string;
  pid: number;
  streamEnabled: boolean;
}
