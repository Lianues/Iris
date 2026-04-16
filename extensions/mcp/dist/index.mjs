import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);
// ../../packages/extension-sdk/dist/logger.js
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
var _logLevel = LogLevel.INFO;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= LogLevel.DEBUG)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= LogLevel.INFO)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= LogLevel.WARN)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= LogLevel.ERROR)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/dist/plugin/context.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/client.ts
var logger = createPluginLogger("mcp", "client");

class MCPClient {
  serverName;
  config;
  _status = "disconnected";
  _error;
  _tools = [];
  client = null;
  transport = null;
  constructor(serverName, config) {
    this.serverName = serverName;
    this.config = config;
  }
  get status() {
    return this._status;
  }
  get error() {
    return this._error;
  }
  get toolList() {
    return this._tools;
  }
  async connect() {
    this._status = "connecting";
    this._error = undefined;
    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      this.client = new Client({ name: "Iris", version: "1.0.0" }, { capabilities: {} });
      this.transport = await this.createTransport();
      const timeout = this.config.timeout ?? 30000;
      let timer;
      await Promise.race([
        this.client.connect(this.transport),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`连接超时（${timeout}ms）`)), timeout);
        })
      ]).finally(() => clearTimeout(timer));
      let timer2;
      const result = await Promise.race([
        this.client.listTools(),
        new Promise((_, reject) => {
          timer2 = setTimeout(() => reject(new Error(`listTools 超时（${timeout}ms）`)), timeout);
        })
      ]).finally(() => clearTimeout(timer2));
      this._tools = result.tools ?? [];
      this._status = "connected";
      logger.info(`MCP 服务器 "${this.serverName}" 已连接 (${this.config.transport})，工具数: ${this._tools.length}`);
    } catch (err) {
      this._status = "error";
      this._error = err instanceof Error ? err.message : String(err);
      this._tools = [];
      try {
        await this.client?.close?.();
      } catch {}
      try {
        await this.transport?.close?.();
      } catch {}
      this.client = null;
      this.transport = null;
      logger.warn(`MCP 服务器 "${this.serverName}" 连接失败: ${this._error}`);
    }
  }
  async createTransport() {
    switch (this.config.transport) {
      case "stdio": {
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        return new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env ? { ...process.env, ...this.config.env } : undefined,
          cwd: this.config.cwd
        });
      }
      case "sse": {
        const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
        const opts = {};
        if (this.config.headers) {
          opts.requestInit = { headers: this.config.headers };
        }
        return new SSEClientTransport(new URL(this.config.url), opts);
      }
      case "streamable-http": {
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        const opts = {};
        if (this.config.headers) {
          opts.requestInit = { headers: this.config.headers };
        }
        return new StreamableHTTPClientTransport(new URL(this.config.url), opts);
      }
    }
  }
  async callTool(name, args) {
    if (!this.client || this._status !== "connected") {
      throw new Error(`MCP 服务器 "${this.serverName}" 未连接`);
    }
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      const text = this.extractText(result.content);
      throw new Error(text || `MCP 工具 "${name}" 执行失败`);
    }
    return this.parseToolResult(result.content, name);
  }
  parseToolResult(content, toolName) {
    const texts = [];
    const attachments = [];
    logger.info(`[parseToolResult] 工具 "${toolName}" 返回 ${Array.isArray(content) ? content.length : 0} 个 content block，` + `类型: ${Array.isArray(content) ? content.map((b) => `${b.type}(keys=${Object.keys(b).join("+")})`).join(", ") : typeof content}`);
    if (!Array.isArray(content)) {
      return { text: String(content), attachments: [] };
    }
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        texts.push(block.text);
        continue;
      }
      if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
        logger.info(`[parseToolResult] 发现图片 block: mimeType=${block.mimeType}, data 长度=${block.data.length}`);
        attachments.push({
          type: "image",
          mimeType: block.mimeType,
          data: Buffer.from(block.data, "base64")
        });
      }
    }
    logger.info(`[parseToolResult] 解析完成: texts=${texts.length}, attachments=${attachments.length}`);
    if (attachments.length === 0 && Array.isArray(content) && content.length > 0) {
      logger.info(`[parseToolResult] 未发现图片附件。各 block 的 keys: ${content.map((b) => JSON.stringify(Object.keys(b))).join(" | ")}`);
    }
    const hasAttachmentHint = texts.some((text) => /图片|image/i.test(text));
    if (attachments.length > 0 && !hasAttachmentHint) {
      texts.push(`已生成 ${attachments.length} 张图片，并直接发送给用户。`);
    }
    return {
      text: texts.join(`
`).trim(),
      attachments
    };
  }
  extractText(content) {
    if (!Array.isArray(content))
      return String(content);
    return content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join(`
`);
  }
  async disconnect() {
    try {
      if (this.client) {
        await this.client.close?.();
      } else if (this.transport) {
        await this.transport.close?.();
      }
    } catch {} finally {
      this.client = null;
      this.transport = null;
      this._tools = [];
      this._status = "disconnected";
      this._error = undefined;
    }
  }
}

// src/manager.ts
import derefModule from "dereference-json-schema";
var { dereferenceSync } = derefModule;
var logger2 = createPluginLogger("mcp", "manager");

class MCPManager {
  clients = [];
  constructor(config) {
    for (const [name, serverCfg] of Object.entries(config.servers)) {
      if (serverCfg.enabled === false) {
        logger2.info(`MCP 服务器 "${name}" 已禁用，跳过`);
        continue;
      }
      this.clients.push(new MCPClient(name, serverCfg));
    }
  }
  async connectAll() {
    if (this.clients.length === 0)
      return;
    logger2.info(`正在连接 ${this.clients.length} 个 MCP 服务器...`);
    await Promise.allSettled(this.clients.map((c) => c.connect()));
    const connected = this.clients.filter((c) => c.status === "connected").length;
    logger2.info(`MCP 连接完成: ${connected}/${this.clients.length} 成功`);
  }
  getTools() {
    const tools = [];
    for (const client of this.clients) {
      if (client.status !== "connected")
        continue;
      for (const sdkTool of client.toolList) {
        const safeName = sanitizeName(client.serverName);
        const safeToolName = sanitizeName(sdkTool.name);
        const qualifiedName = `mcp__${safeName}__${safeToolName}`;
        const originalName = sdkTool.name;
        tools.push({
          declaration: {
            name: qualifiedName,
            description: sdkTool.description || `MCP tool: ${originalName}`,
            parameters: convertInputSchema(sdkTool.inputSchema)
          },
          handler: async (args) => {
            return client.callTool(originalName, args);
          }
        });
      }
    }
    return tools;
  }
  getServerInfo() {
    return this.clients.map((c) => ({
      name: c.serverName,
      status: c.status,
      toolCount: c.toolList.length,
      error: c.error
    }));
  }
  listServers() {
    return this.getServerInfo();
  }
  async reload(config) {
    await this.disconnectAll();
    this.clients = [];
    for (const [name, serverCfg] of Object.entries(config.servers)) {
      if (serverCfg.enabled === false) {
        logger2.info(`MCP 服务器 "${name}" 已禁用，跳过`);
        continue;
      }
      this.clients.push(new MCPClient(name, serverCfg));
    }
    await this.connectAll();
  }
  async disconnectAll() {
    await Promise.allSettled(this.clients.map((c) => c.disconnect()));
    logger2.info("所有 MCP 连接已断开");
  }
}
function convertInputSchema(schema) {
  let resolved;
  try {
    resolved = dereferenceSync(schema);
  } catch {
    resolved = schema;
  }
  const props = resolved.properties;
  if (!props || typeof props !== "object")
    return;
  const { $defs, definitions, ...clean } = resolved;
  return clean;
}
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// src/config.ts
var logger3 = createPluginLogger("mcp", "config");
function normalizeTransport(value) {
  if (value === "http")
    return "streamable-http";
  if (value === "stdio" || value === "sse" || value === "streamable-http")
    return value;
  return;
}
function parseMCPConfig(raw) {
  if (!raw || !raw.servers || typeof raw.servers !== "object")
    return;
  const servers = {};
  for (const [name, cfg] of Object.entries(raw.servers)) {
    const c = cfg;
    if (!c || typeof c !== "object")
      continue;
    const transport = normalizeTransport(c.transport);
    if (!transport) {
      logger3.warn(`MCP 服务器 "${name}" 的 transport 无效（需为 stdio、sse、streamable-http；http 会映射为 streamable-http），已跳过`);
      continue;
    }
    if (transport === "stdio" && !c.command) {
      logger3.warn(`MCP 服务器 "${name}" 缺少 command 字段，已跳过`);
      continue;
    }
    if ((transport === "sse" || transport === "streamable-http") && !c.url) {
      logger3.warn(`MCP 服务器 "${name}" 缺少 url 字段，已跳过`);
      continue;
    }
    servers[name] = {
      transport,
      command: c.command,
      args: Array.isArray(c.args) ? c.args.map(String) : undefined,
      env: c.env && typeof c.env === "object" ? c.env : undefined,
      cwd: c.cwd,
      url: c.url,
      headers: c.headers && typeof c.headers === "object" ? c.headers : undefined,
      timeout: typeof c.timeout === "number" ? c.timeout : undefined,
      enabled: typeof c.enabled === "boolean" ? c.enabled : undefined
    };
  }
  if (Object.keys(servers).length === 0)
    return;
  return { servers };
}

// src/config-template.ts
var DEFAULT_MCP_CONFIG_TEMPLATE = `# MCP 服务器配置
# 连接外部 MCP 服务器，自动将其工具注入 LLM 工具列表
# 启动时后台异步连接，不阻塞启动
#
# 每个服务器支持以下字段：
#   transport  - 传输方式: stdio | sse | streamable-http
#   enabled    - 是否启用（默认 true）
#   timeout    - 连接/listTools 超时，单位 ms（默认 30000）
#
# stdio 模式专用：
#   command    - 要执行的命令
#   args       - 命令参数数组
#   env        - 额外环境变量
#   cwd        - 工作目录
#
# sse / streamable-http 模式专用：
#   url        - MCP 服务器 URL
#   headers    - 自定义 HTTP 请求头

# servers:
#   # stdio 传输示例（本地进程）
#   filesystem:
#     transport: stdio
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
#     timeout: 30000
#     enabled: true
#
#   # HTTP 传输示例（远程服务器）
#   remote_tools:
#     transport: streamable-http
#     url: https://mcp.example.com/mcp
#     headers:
#       Authorization: Bearer your-token
#     timeout: 30000
#
#   # 企微官方文档 MCP（智能表格 + 文档 CRUD，8 个工具）
#   # 在企微管理后台创建智能机器人后，MCP 端点页面可获取 apikey
#   wecom-doc:
#     transport: streamable-http
#     url: "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=your-mcp-apikey"
`;

// src/index.ts
var logger4 = createPluginLogger("mcp");
var SERVICE_ID = "mcp.manager";
var manager = null;
var serviceDisposer = null;
var src_default = definePlugin({
  name: "mcp",
  version: "0.1.0",
  description: "MCP 服务器连接管理 — 将外部 MCP 工具注入到核心工具流水线",
  activate(ctx) {
    ctx.ensureConfigFile?.("mcp.yaml", DEFAULT_MCP_CONFIG_TEMPLATE);
    const raw = ctx.readConfigSection?.("mcp");
    const config = parseMCPConfig(raw);
    if (!config) {
      logger4.info("未检测到 MCP 配置（mcp.yaml 不存在或无有效 servers），跳过");
      return;
    }
    ctx.addHook({
      name: "mcp:config-reload",
      async onConfigReload({ rawMergedConfig }) {
        const newConfig = parseMCPConfig(rawMergedConfig.mcp);
        const reg = ctx.getToolRegistry();
        for (const name of reg.listTools()) {
          if (name.startsWith("mcp__"))
            reg.unregister(name);
        }
        if (manager && newConfig) {
          await manager.reload(newConfig);
          ctx.registerTools(manager.getTools());
          logger4.info("MCP 热重载完成");
        } else if (manager && !newConfig) {
          await manager.disconnectAll();
          manager = null;
          serviceDisposer?.dispose();
          serviceDisposer = null;
          logger4.info("MCP 配置已移除，所有连接已断开");
        } else if (!manager && newConfig) {
          manager = new MCPManager(newConfig);
          await manager.connectAll();
          ctx.registerTools(manager.getTools());
          registerService(ctx);
          logger4.info("MCP 新配置已加载并连接");
        }
      }
    });
    ctx.onReady(async () => {
      manager = new MCPManager(config);
      await manager.connectAll();
      ctx.registerTools(manager.getTools());
      registerService(ctx);
      logger4.info("MCP 扩展初始化完成");
    });
  },
  async deactivate() {
    serviceDisposer?.dispose();
    serviceDisposer = null;
    if (manager) {
      await manager.disconnectAll();
      manager = null;
    }
    logger4.info("MCP 扩展已卸载");
  }
});
function registerService(ctx) {
  serviceDisposer?.dispose();
  serviceDisposer = ctx.getServiceRegistry().register(SERVICE_ID, {
    listServers: () => manager?.listServers() ?? [],
    getServerInfo: () => manager?.getServerInfo() ?? []
  }, { description: "MCP 服务器管理", version: "1.0" });
}
export {
  src_default as default
};
