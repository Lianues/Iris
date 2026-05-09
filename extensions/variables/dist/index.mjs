// ../../node_modules/irises-extension-sdk/src/logger.ts
var _logLevel = 1 /* INFO */;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= 0 /* DEBUG */)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= 1 /* INFO */)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= 2 /* WARN */)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= 3 /* ERROR */)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../node_modules/irises-extension-sdk/src/plugin/context.ts
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/config-template.ts
var DEFAULT_CONFIG_TEMPLATE = `# 变量管理扩展配置
#
# 启用后，LLM 可通过 manage_variables 工具读写全局/Agent/会话变量。
# 变量存储复用 Iris extension SDK 的 globalStore，数据会自动持久化。
#
# 默认关闭：关闭时不会注册 manage_variables 工具，也不会暴露给模型。

# 是否启用全局变量功能
# true  = 注册 manage_variables 工具
# false = 不注册工具
enabled: false
`;

// src/config.ts
var DEFAULT_CONFIG = {
  enabled: false
};
function resolveConfig(rawSection, pluginConfig) {
  const source = rawSection ?? pluginConfig ?? {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled
  };
}
function toConfigContributionValues(config) {
  return {
    enabled: config.enabled
  };
}
function fromConfigContributionValues(values) {
  return {
    enabled: values.enabled === true
  };
}

// src/index.ts
var logger = createPluginLogger("variables");
var TOOL_NAME = "manage_variables";
var CONFIG_SECTION = "variables";
var CONFIG_FILE = "variables.yaml";
var activeStates = new Set;
function normalizeSourceAgent(sourceAgent) {
  if (!sourceAgent)
    return;
  const [agentName] = sourceAgent.split(":");
  return agentName || undefined;
}
function getContextString(context, key) {
  const value = context?.[key];
  return typeof value === "string" ? value : undefined;
}
function getCurrentSessionId(api, context) {
  return getContextString(context, "sessionId") ?? api?.agentManager?.getActiveSessionId?.() ?? api?.backend.getActiveSessionId?.();
}
function getCurrentAgentName(api, context) {
  return api?.agentName ?? normalizeSourceAgent(getContextString(context, "sourceAgent")) ?? "master";
}
function resolveScopedStore(rootStore, scope, api, context) {
  switch (scope) {
    case "agent":
      return { store: rootStore.agent(getCurrentAgentName(api, context)) };
    case "session": {
      const sessionId = getCurrentSessionId(api, context);
      if (!sessionId)
        return { error: "当前没有活跃会话，无法使用 session 作用域" };
      return { store: rootStore.session(sessionId) };
    }
    case "global":
      return { store: rootStore };
  }
}
function parseAction(value) {
  return value === "get" || value === "set" || value === "delete" || value === "list" ? value : undefined;
}
function parseScope(value) {
  if (value === undefined || value === null)
    return "agent";
  return value === "global" || value === "agent" || value === "session" ? value : undefined;
}
function createManageVariablesTool(deps) {
  return {
    parallel: true,
    declaration: {
      name: TOOL_NAME,
      description: `读写全局变量存储。变量会自动持久化到磁盘，跨对话保留。
` + `操作类型：
` + `- get: 获取变量值
` + `- set: 设置变量值
` + `- delete: 删除变量
` + `- list: 列出所有变量
` + `作用域：
` + `- global: 所有 agent、所有对话共享
` + `- agent: 按 agent 隔离，跨对话持久保留（适合好感度、信任度等）
` + "- session: 按对话隔离，仅当前对话有效",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["get", "set", "delete", "list"],
            description: "操作类型"
          },
          key: {
            type: "string",
            description: "变量名（list 时可省略）"
          },
          value: {
            description: "变量值（仅 set 时需要，支持任意可 JSON 序列化的值）"
          },
          scope: {
            type: "string",
            enum: ["global", "agent", "session"],
            description: "作用域（默认 agent）。" + "global=所有共享；" + "agent=按 agent 隔离、跨对话保留；" + "session=仅当前对话"
          }
        },
        required: ["action"]
      }
    },
    handler: async (args, context) => {
      const action = parseAction(args.action);
      if (!action) {
        return { error: `不支持的操作: "${String(args.action)}"，可选: get / set / delete / list` };
      }
      const key = typeof args.key === "string" ? args.key : undefined;
      const value = args.value;
      const scope = parseScope(args.scope);
      if (!scope) {
        return { error: `不支持的作用域: "${String(args.scope)}"，可选: global / agent / session` };
      }
      const scoped = resolveScopedStore(deps.getGlobalStore(), scope, deps.getApi(), context);
      if ("error" in scoped)
        return { error: scoped.error };
      const store = scoped.store;
      switch (action) {
        case "get": {
          if (!key)
            return { error: "get 操作需要 key 参数" };
          const storedValue = store.get(key);
          return { key, value: storedValue ?? null, exists: storedValue !== undefined, scope };
        }
        case "set": {
          if (!key)
            return { error: "set 操作需要 key 参数" };
          if (value === undefined)
            return { error: "set 操作需要 value 参数" };
          store.set(key, value);
          return { success: true, key, value, scope };
        }
        case "delete": {
          if (!key)
            return { error: "delete 操作需要 key 参数" };
          const deleted = store.delete(key);
          return { success: deleted, key, scope, message: deleted ? "已删除" : "变量不存在" };
        }
        case "list": {
          const entries = Object.entries(store.getAll());
          return {
            scope,
            count: entries.length,
            variables: Object.fromEntries(entries.slice(0, 50)),
            truncated: entries.length > 50
          };
        }
      }
    }
  };
}
var src_default = definePlugin({
  name: "variables",
  version: "0.1.0",
  description: "全局/Agent/会话变量管理工具",
  preBootstrap(ctx) {
    ctx.ensureConfigFile(CONFIG_FILE, DEFAULT_CONFIG_TEMPLATE);
    const config = readVariablesConfig(ctx);
    if (config.enabled) {
      ensureDefaultToolPolicy(ctx);
    }
  },
  activate(ctx) {
    ctx.ensureConfigFile(CONFIG_FILE, DEFAULT_CONFIG_TEMPLATE);
    const state = {
      currentConfig: readVariablesConfig(ctx),
      toolRegistered: false
    };
    activeStates.add(state);
    registerConfigContribution(ctx, state);
    if (state.currentConfig.enabled) {
      registerManageVariablesTool(ctx, state);
    } else {
      logger.info("变量管理未启用；manage_variables 工具不会注册");
    }
    ctx.onReady((readyApi) => {
      state.cachedApi = readyApi;
    });
    ctx.addHook({
      name: "variables:config-reload",
      onConfigReload({ rawMergedConfig }) {
        const raw = isRecord(rawMergedConfig) && isRecord(rawMergedConfig[CONFIG_SECTION]) ? rawMergedConfig[CONFIG_SECTION] : ctx.readConfigSection(CONFIG_SECTION);
        const nextConfig = resolveConfig(raw, ctx.getPluginConfig());
        const wasEnabled = state.currentConfig.enabled;
        state.currentConfig = nextConfig;
        if (!nextConfig.enabled) {
          if (state.toolRegistered)
            unregisterManageVariablesTool(ctx, state);
          if (wasEnabled)
            logger.info("变量管理已禁用；manage_variables 工具已注销");
          return;
        }
        registerManageVariablesTool(ctx, state);
        if (!wasEnabled)
          logger.info("变量管理已启用；manage_variables 工具已注册");
        return;
      }
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
  }
});
function readVariablesConfig(ctx) {
  return resolveConfig(ctx.readConfigSection(CONFIG_SECTION), ctx.getPluginConfig());
}
function registerManageVariablesTool(ctx, state) {
  if (state.toolRegistered)
    return;
  ctx.registerTool(createManageVariablesTool({
    getGlobalStore: () => ctx.getGlobalStore(),
    getApi: () => state.cachedApi
  }));
  state.toolRegistered = true;
}
function unregisterManageVariablesTool(ctx, state) {
  if (!state.toolRegistered)
    return;
  ctx.getToolRegistry().unregister?.(TOOL_NAME);
  state.toolRegistered = false;
}
function registerConfigContribution(ctx, state) {
  const contribution = {
    pluginName: "variables",
    sectionId: CONFIG_SECTION,
    title: "变量管理",
    description: "控制 manage_variables 工具是否启用。关闭时不会向模型暴露该工具。",
    fields: [
      {
        key: "enabled",
        type: "boolean",
        label: "启用全局变量功能",
        default: false,
        group: "基础",
        description: "启用后注册 manage_variables 工具；关闭后工具不会启动，也不会出现在模型可用工具列表中。"
      }
    ],
    onLoad: () => toConfigContributionValues(readVariablesConfig(ctx)),
    onSave: async (values) => {
      if (!state.cachedApi?.configManager)
        throw new Error("configManager 不可用，无法保存 variables 配置");
      const raw = fromConfigContributionValues(values);
      const updates = { [CONFIG_SECTION]: raw };
      if (raw.enabled === true) {
        updates.tools = { [TOOL_NAME]: { autoApprove: true } };
      }
      const { mergedRaw } = state.cachedApi.configManager.updateEditableConfig(updates);
      await state.cachedApi.configManager.applyRuntimeConfigReload(mergedRaw);
    }
  };
  state.configContributionDisposable = ctx.getConfigContributions().register(contribution);
}
function ensureDefaultToolPolicy(ctx) {
  ctx.mutateConfig((config) => {
    const root = config;
    let tools = root.tools;
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
      tools = {};
      root.tools = tools;
    }
    const toolsRecord = tools;
    let permissions = toolsRecord.permissions;
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
      permissions = {};
      toolsRecord.permissions = permissions;
    }
    const permissionsRecord = permissions;
    if (!permissionsRecord[TOOL_NAME]) {
      permissionsRecord[TOOL_NAME] = { autoApprove: true };
    }
  });
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export {
  src_default as default,
  createManageVariablesTool
};
