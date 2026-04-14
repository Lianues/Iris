/**
 * MCP 扩展入口
 *
 * 将 MCP 服务器连接管理从核心完全解耦为独立扩展。
 * 通过 ServiceRegistry 暴露 'mcp.manager' 服务，供其他扩展可选发现。
 *
 * 配置来源：用户配置目录的 mcp.yaml（分层合并：全局 + Agent 覆盖）
 */

import { definePlugin, createPluginLogger } from 'irises-extension-sdk';
import type { PluginContext } from 'irises-extension-sdk';
import { MCPManager } from './manager.js';
import { parseMCPConfig } from './config.js';
import { DEFAULT_MCP_CONFIG_TEMPLATE } from './config-template.js';

const logger = createPluginLogger('mcp');

/** 服务 ID 常量，消费者通过 services.get('mcp.manager') 发现 */
const SERVICE_ID = 'mcp.manager';

// 模块级状态
let manager: MCPManager | null = null;
let serviceDisposer: { dispose(): void } | null = null;

export default definePlugin({
  name: 'mcp',
  version: '0.1.0',
  description: 'MCP 服务器连接管理 — 将外部 MCP 工具注入到核心工具流水线',

  activate(ctx: PluginContext) {
    // 1. 首次运行时释放默认配置模板到用户配置目录（已存在则不覆盖）
    ctx.ensureConfigFile?.('mcp.yaml', DEFAULT_MCP_CONFIG_TEMPLATE);

    // 2. 读取配置（已经是 global + agent 分层合并后的结果）
    const raw = ctx.readConfigSection?.('mcp');
    const config = parseMCPConfig(raw);

    if (!config) {
      logger.info('未检测到 MCP 配置（mcp.yaml 不存在或无有效 servers），跳过');
      return;
    }

    // 热重载钩子：配置变更时重新连接
    ctx.addHook({
      name: 'mcp:config-reload',
      async onConfigReload({ rawMergedConfig }) {
        const newConfig = parseMCPConfig(rawMergedConfig.mcp);
        const reg = ctx.getToolRegistry();

        // 清理旧 mcp__ 工具
        for (const name of reg.listTools()) {
          if (name.startsWith('mcp__')) reg.unregister(name);
        }

        if (manager && newConfig) {
          // 配置变更：热重载
          await manager.reload(newConfig);
          ctx.registerTools(manager.getTools());
          logger.info('MCP 热重载完成');
        } else if (manager && !newConfig) {
          // 配置被删除：断开所有连接
          await manager.disconnectAll();
          manager = null;
          serviceDisposer?.dispose();
          serviceDisposer = null;
          logger.info('MCP 配置已移除，所有连接已断开');
        } else if (!manager && newConfig) {
          // 新增配置：创建并连接
          manager = new MCPManager(newConfig);
          await manager.connectAll();
          ctx.registerTools(manager.getTools());
          registerService(ctx);
          logger.info('MCP 新配置已加载并连接');
        }
      },
    });

    // 系统就绪后：连接并注册工具
    ctx.onReady(async () => {
      manager = new MCPManager(config);
      await manager.connectAll();
      ctx.registerTools(manager.getTools());

      // 通过 ServiceRegistry 暴露，消费者用 services.get('mcp.manager') 发现
      registerService(ctx);

      logger.info('MCP 扩展初始化完成');
    });
  },

  async deactivate() {
    serviceDisposer?.dispose();
    serviceDisposer = null;
    if (manager) {
      await manager.disconnectAll();
      manager = null;
    }
    logger.info('MCP 扩展已卸载');
  },
});

function registerService(ctx: PluginContext): void {
  serviceDisposer?.dispose();
  serviceDisposer = ctx.getServiceRegistry().register(SERVICE_ID, {
    listServers: () => manager?.listServers() ?? [],
    getServerInfo: () => manager?.getServerInfo() ?? [],
  }, { description: 'MCP 服务器管理', version: '1.0' });
}
