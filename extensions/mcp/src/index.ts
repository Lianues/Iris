/**
 * MCP 扩展入口
 *
 * 将 MCP 服务器连接管理从核心完全解耦为独立扩展。
 * 通过 ServiceRegistry 暴露 'mcp.manager' 服务，供其他扩展可选发现。
 *
 * 配置来源：用户配置目录的 mcp.yaml（分层合并：全局 + Agent 覆盖）
 */

import { definePlugin, createPluginLogger } from 'irises-extension-sdk';
import type { IrisAPI, PluginContext } from 'irises-extension-sdk';
import { MCPManager } from './manager.js';
import { parseMCPConfig } from './config.js';
import { DEFAULT_MCP_CONFIG_TEMPLATE } from './config-template.js';
import type { MCPConfig } from './types.js';

const logger = createPluginLogger('mcp');

/** 服务 ID 常量，消费者通过 services.get('mcp.manager') 发现 */
const SERVICE_ID = 'mcp.manager';

interface RuntimeState {
  manager: MCPManager | null;
  serviceDisposer: { dispose(): void } | null;
  lastMcpConfigSignature: string;
}

// 同一个扩展模块会被多个 Agent 复用；运行态必须按 PluginContext 隔离，避免跨 Agent 覆盖/释放。
const runtimes = new Map<PluginContext, RuntimeState>();

export default definePlugin({
  name: 'mcp',
  version: '0.1.0',
  description: 'MCP 服务器连接管理 — 将外部 MCP 工具注入到核心工具流水线',

  activate(ctx: PluginContext) {
    const state: RuntimeState = {
      manager: null,
      serviceDisposer: null,
      lastMcpConfigSignature: '',
    };
    runtimes.set(ctx, state);

    // 1. 首次运行时释放默认配置模板到用户配置目录（已存在则不覆盖）
    ctx.ensureConfigFile?.('mcp.yaml', DEFAULT_MCP_CONFIG_TEMPLATE);

    // 2. 热重载钩子必须无条件注册：即使初始没有 MCP 配置，后续新增配置也能生效。
    ctx.addHook({
      name: 'mcp:config-reload',
      async onConfigReload({ rawMergedConfig }) {
        const nextRaw = rawMergedConfig.mcp;
        const nextSignature = stableStringify(nextRaw ?? null);
        if (nextSignature === state.lastMcpConfigSignature) return;
        state.lastMcpConfigSignature = nextSignature;

        await reloadMcpManager(ctx, state, parseMCPConfig(nextRaw));
      },
    });

    // 3. 系统就绪后读取初始配置。
    //    这里优先通过 configManager 读取 global + agent 分层合并后的 raw 配置；
    //    不再使用 ctx.readConfigSection('mcp') 作为主路径，因为它只读取当前 agent 配置目录。
    ctx.onReady(async (api) => {
      const raw = readInitialMcpRaw(ctx, api);
      const config = parseMCPConfig(raw);
      state.lastMcpConfigSignature = stableStringify(raw ?? null);

      if (!config) {
        logger.info('未检测到 MCP 配置（mcp.yaml 不存在或无有效 servers），跳过');
        return;
      }

      await startMcpManager(ctx, state, config, 'MCP 扩展初始化完成');
    });
  },

  async deactivate(ctx?: PluginContext) {
    const states = ctx ? [runtimes.get(ctx)].filter((state): state is RuntimeState => !!state) : [...runtimes.values()];

    if (ctx) {
      const reg = ctx.getToolRegistry();
      for (const name of reg.listTools?.() ?? []) {
        if (name.startsWith('mcp__')) reg.unregister?.(name);
      }
    }

    for (const state of states) {
      await disposeRuntimeState(state);
    }

    if (ctx) runtimes.delete(ctx);
    else runtimes.clear();
    logger.info('MCP 扩展已卸载');
  },
});

function readInitialMcpRaw(ctx: PluginContext, api: IrisAPI): unknown {
  try {
    const merged = api.configManager?.readEditableConfig?.();
    if (isRecord(merged)) {
      return merged.mcp;
    }
  } catch (err) {
    logger.warn('读取合并后的 MCP 配置失败，回退到当前配置目录:', err);
  }

  return ctx.readConfigSection?.('mcp');
}

async function reloadMcpManager(ctx: PluginContext, state: RuntimeState, newConfig: MCPConfig | undefined): Promise<void> {
  const reg = ctx.getToolRegistry();

  // 清理旧 mcp__ 工具
  for (const name of reg.listTools?.() ?? []) {
    if (name.startsWith('mcp__')) reg.unregister?.(name);
  }

  if (state.manager && newConfig) {
    // 配置变更：热重载
    await state.manager.reload(newConfig);
    ctx.registerTools(state.manager.getTools());
    logger.info('MCP 热重载完成');
    return;
  }

  if (state.manager && !newConfig) {
    // 配置被删除：断开所有连接
    await disposeRuntimeState(state);
    logger.info('MCP 配置已移除，所有连接已断开');
    return;
  }

  if (!state.manager && newConfig) {
    // 新增配置：创建并连接
    await startMcpManager(ctx, state, newConfig, 'MCP 新配置已加载并连接');
  }
}

async function startMcpManager(ctx: PluginContext, state: RuntimeState, config: MCPConfig, message: string): Promise<void> {
  state.manager = new MCPManager(config);
  await state.manager.connectAll();
  ctx.registerTools(state.manager.getTools());

  // 通过 ServiceRegistry 暴露，消费者用 services.get('mcp.manager') 发现
  registerService(ctx, state);

  logger.info(message);
}

async function disposeRuntimeState(state: RuntimeState): Promise<void> {
  state.serviceDisposer?.dispose();
  state.serviceDisposer = null;
  if (state.manager) {
    await state.manager.disconnectAll();
    state.manager = null;
  }
}

function registerService(ctx: PluginContext, state: RuntimeState): void {
  state.serviceDisposer?.dispose();
  state.serviceDisposer = ctx.getServiceRegistry().register(SERVICE_ID, {
    listServers: () => state.manager?.listServers() ?? [],
    getServerInfo: () => state.manager?.getServerInfo() ?? [],
  }, { description: 'MCP 服务器管理', version: '1.0' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}


function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortForStableStringify(v)]),
  );
}
