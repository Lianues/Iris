/**
 * Variables extension
 *
 * Provides the manage_variables tool as an extension-owned capability.
 * Core keeps only the generic extension SDK/globalStore APIs and does not know
 * about this concrete tool.
 */

import {
  createPluginLogger,
  definePlugin,
  type ConfigContribution,
  type Disposable,
  type GlobalStoreLike,
  type IrisAPI,
  type PluginContext,
  type PreBootstrapContext,
  type ToolDefinition,
  type ToolExecutionContext,
} from 'irises-extension-sdk';
import { DEFAULT_CONFIG_TEMPLATE } from './config-template.js';
import {
  fromConfigContributionValues,
  resolveConfig,
  toConfigContributionValues,
  type VariablesPluginConfig,
} from './config.js';

const logger = createPluginLogger('variables');
const TOOL_NAME = 'manage_variables';
const CONFIG_SECTION = 'variables';
const CONFIG_FILE = 'variables.yaml';

type VariableAction = 'get' | 'set' | 'delete' | 'list';
type VariableScope = 'global' | 'agent' | 'session';

interface ManageVariablesToolDeps {
  getGlobalStore: () => GlobalStoreLike;
  getApi: () => IrisAPI | undefined;
}

interface VariablesExtensionState {
  currentConfig: VariablesPluginConfig;
  cachedApi?: IrisAPI;
  toolRegistered: boolean;
  configContributionDisposable?: Disposable;
}

const activeStates = new Set<VariablesExtensionState>();

function normalizeSourceAgent(sourceAgent: string | undefined): string | undefined {
  if (!sourceAgent) return undefined;
  const [agentName] = sourceAgent.split(':');
  return agentName || undefined;
}

function getContextString(context: ToolExecutionContext | undefined, key: string): string | undefined {
  const value = (context as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getCurrentSessionId(api: IrisAPI | undefined, context: ToolExecutionContext | undefined): string | undefined {
  return getContextString(context, 'sessionId')
    ?? api?.agentManager?.getActiveSessionId?.()
    ?? api?.backend.getActiveSessionId?.();
}

function getCurrentAgentName(api: IrisAPI | undefined, context: ToolExecutionContext | undefined): string {
  return api?.agentName
    ?? normalizeSourceAgent(getContextString(context, 'sourceAgent'))
    ?? 'master';
}

function resolveScopedStore(
  rootStore: GlobalStoreLike,
  scope: VariableScope,
  api: IrisAPI | undefined,
  context: ToolExecutionContext | undefined,
): { store: GlobalStoreLike } | { error: string } {
  switch (scope) {
    case 'agent':
      return { store: rootStore.agent(getCurrentAgentName(api, context)) };
    case 'session': {
      const sessionId = getCurrentSessionId(api, context);
      if (!sessionId) return { error: '当前没有活跃会话，无法使用 session 作用域' };
      return { store: rootStore.session(sessionId) };
    }
    case 'global':
      return { store: rootStore };
  }
}

function parseAction(value: unknown): VariableAction | undefined {
  return value === 'get' || value === 'set' || value === 'delete' || value === 'list'
    ? value
    : undefined;
}

function parseScope(value: unknown): VariableScope | undefined {
  if (value === undefined || value === null) return 'agent';
  return value === 'global' || value === 'agent' || value === 'session'
    ? value
    : undefined;
}

export function createManageVariablesTool(deps: ManageVariablesToolDeps): ToolDefinition {
  return {
    parallel: true,
    declaration: {
      name: TOOL_NAME,
      description:
        '读写全局变量存储。变量会自动持久化到磁盘，跨对话保留。\n' +
        '操作类型：\n' +
        '- get: 获取变量值\n' +
        '- set: 设置变量值\n' +
        '- delete: 删除变量\n' +
        '- list: 列出所有变量\n' +
        '作用域：\n' +
        '- global: 所有 agent、所有对话共享\n' +
        '- agent: 按 agent 隔离，跨对话持久保留（适合好感度、信任度等）\n' +
        '- session: 按对话隔离，仅当前对话有效',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'set', 'delete', 'list'],
            description: '操作类型',
          },
          key: {
            type: 'string',
            description: '变量名（list 时可省略）',
          },
          value: {
            description: '变量值（仅 set 时需要，支持任意可 JSON 序列化的值）',
          },
          scope: {
            type: 'string',
            enum: ['global', 'agent', 'session'],
            description:
              '作用域（默认 agent）。' +
              'global=所有共享；' +
              'agent=按 agent 隔离、跨对话保留；' +
              'session=仅当前对话',
          },
        },
        required: ['action'],
      },
    },

    handler: async (args, context) => {
      const action = parseAction(args.action);
      if (!action) {
        return { error: `不支持的操作: "${String(args.action)}"，可选: get / set / delete / list` };
      }

      const key = typeof args.key === 'string' ? args.key : undefined;
      const value = args.value;
      const scope = parseScope(args.scope);
      if (!scope) {
        return { error: `不支持的作用域: "${String(args.scope)}"，可选: global / agent / session` };
      }

      const scoped = resolveScopedStore(deps.getGlobalStore(), scope, deps.getApi(), context);
      if ('error' in scoped) return { error: scoped.error };
      const store = scoped.store;

      switch (action) {
        case 'get': {
          if (!key) return { error: 'get 操作需要 key 参数' };
          const storedValue = store.get(key);
          return { key, value: storedValue ?? null, exists: storedValue !== undefined, scope };
        }

        case 'set': {
          if (!key) return { error: 'set 操作需要 key 参数' };
          if (value === undefined) return { error: 'set 操作需要 value 参数' };
          store.set(key, value);
          return { success: true, key, value, scope };
        }

        case 'delete': {
          if (!key) return { error: 'delete 操作需要 key 参数' };
          const deleted = store.delete(key);
          return { success: deleted, key, scope, message: deleted ? '已删除' : '变量不存在' };
        }

        case 'list': {
          const entries = Object.entries(store.getAll());
          return {
            scope,
            count: entries.length,
            variables: Object.fromEntries(entries.slice(0, 50)),
            truncated: entries.length > 50,
          };
        }
      }
    },
  };
}

export default definePlugin({
  name: 'variables',
  version: '0.1.0',
  description: '全局/Agent/会话变量管理工具',

  preBootstrap(ctx: PreBootstrapContext) {
    ctx.ensureConfigFile(CONFIG_FILE, DEFAULT_CONFIG_TEMPLATE);
    const config = readVariablesConfig(ctx);
    if (config.enabled) {
      ensureDefaultToolPolicy(ctx);
    }
  },

  activate(ctx: PluginContext) {
    ctx.ensureConfigFile(CONFIG_FILE, DEFAULT_CONFIG_TEMPLATE);

    const state: VariablesExtensionState = {
      currentConfig: readVariablesConfig(ctx),
      toolRegistered: false,
    };
    activeStates.add(state);

    registerConfigContribution(ctx, state);

    if (state.currentConfig.enabled) {
      registerManageVariablesTool(ctx, state);
    } else {
      logger.info('变量管理未启用；manage_variables 工具不会注册');
    }

    ctx.onReady((readyApi) => {
      state.cachedApi = readyApi;
    });

    ctx.addHook({
      name: 'variables:config-reload',
      onConfigReload({ rawMergedConfig }) {
        const raw = isRecord(rawMergedConfig) && isRecord(rawMergedConfig[CONFIG_SECTION])
          ? rawMergedConfig[CONFIG_SECTION] as Record<string, unknown>
          : ctx.readConfigSection(CONFIG_SECTION);
        const nextConfig = resolveConfig(raw, ctx.getPluginConfig<Partial<VariablesPluginConfig>>());
        const wasEnabled = state.currentConfig.enabled;
        state.currentConfig = nextConfig;

        if (!nextConfig.enabled) {
          if (state.toolRegistered) unregisterManageVariablesTool(ctx, state);
          if (wasEnabled) logger.info('变量管理已禁用；manage_variables 工具已注销');
          return undefined;
        }

        registerManageVariablesTool(ctx, state);
        if (!wasEnabled) logger.info('变量管理已启用；manage_variables 工具已注册');
        return undefined;
      },
    });
  },

  deactivate() {
    for (const state of activeStates) {
      state.cachedApi = undefined;
      state.toolRegistered = false;
      state.configContributionDisposable?.dispose();
      state.configContributionDisposable = undefined;
    }
    activeStates.clear();
  },
});

function readVariablesConfig(ctx: Pick<PluginContext | PreBootstrapContext, 'readConfigSection' | 'getPluginConfig'>): VariablesPluginConfig {
  return resolveConfig(ctx.readConfigSection(CONFIG_SECTION), ctx.getPluginConfig<Partial<VariablesPluginConfig>>());
}

function registerManageVariablesTool(ctx: PluginContext, state: VariablesExtensionState): void {
  if (state.toolRegistered) return;
  ctx.registerTool(createManageVariablesTool({
    getGlobalStore: () => ctx.getGlobalStore(),
    getApi: () => state.cachedApi,
  }));
  state.toolRegistered = true;
}

function unregisterManageVariablesTool(ctx: PluginContext, state: VariablesExtensionState): void {
  if (!state.toolRegistered) return;
  ctx.getToolRegistry().unregister?.(TOOL_NAME);
  state.toolRegistered = false;
}

function registerConfigContribution(ctx: PluginContext, state: VariablesExtensionState): void {
  const contribution: ConfigContribution = {
    pluginName: 'variables',
    sectionId: CONFIG_SECTION,
    title: '变量管理',
    description: '控制 manage_variables 工具是否启用。关闭时不会向模型暴露该工具。',
    fields: [
      {
        key: 'enabled',
        type: 'boolean',
        label: '启用全局变量功能',
        default: false,
        group: '基础',
        description: '启用后注册 manage_variables 工具；关闭后工具不会启动，也不会出现在模型可用工具列表中。',
      },
    ],
    onLoad: () => toConfigContributionValues(readVariablesConfig(ctx)),
    onSave: async (values) => {
      if (!state.cachedApi?.configManager) throw new Error('configManager 不可用，无法保存 variables 配置');
      const raw = fromConfigContributionValues(values);
      const updates: Record<string, unknown> = { [CONFIG_SECTION]: raw };
      if (raw.enabled === true) {
        updates.tools = { [TOOL_NAME]: { autoApprove: true } };
      }
      const { mergedRaw } = state.cachedApi.configManager.updateEditableConfig(updates);
      await state.cachedApi.configManager.applyRuntimeConfigReload(mergedRaw);
    },
  };

  state.configContributionDisposable = ctx.getConfigContributions().register(contribution);
}

function ensureDefaultToolPolicy(ctx: PreBootstrapContext): void {
  ctx.mutateConfig((config) => {
    const root = config as Record<string, unknown>;
    let tools = root.tools;
    if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
      tools = {};
      root.tools = tools;
    }

    const toolsRecord = tools as Record<string, unknown>;
    let permissions = toolsRecord.permissions;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
      permissions = {};
      toolsRecord.permissions = permissions;
    }

    const permissionsRecord = permissions as Record<string, unknown>;
    if (!permissionsRecord[TOOL_NAME]) {
      permissionsRecord[TOOL_NAME] = { autoApprove: true };
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
