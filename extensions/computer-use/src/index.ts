/**
 * Computer Use 扩展插件入口
 *
 * 实现 IrisPlugin 接口，在 activate 阶段初始化 CU 环境并注册工具，
 * 通过 onConfigReload 钩子支持配置热重载，
 * 在 deactivate 时销毁环境。
 */

import { definePlugin, createPluginLogger, type PluginContext, type IrisAPI } from '@irises/extension-sdk';
import { parseComputerUseConfig } from './config.js';
import { DEFAULT_CONFIG_TEMPLATE } from './config-template.js';
import { BrowserEnvironment, setExtensionDir as setBrowserExtDir } from './browser-env.js';
import { ScreenEnvironment, setExtensionDir as setScreenExtDir } from './screen-env.js';
import {
  createComputerUseTools,
  COMPUTER_USE_FUNCTION_NAMES,
  resolveEnvironmentKey,
} from './tools.js';
import type { Computer, ComputerUseConfig } from './types.js';

const logger = createPluginLogger('computer-use');

/** 当前活跃的执行环境 */
let activeEnv: Computer | undefined;

/** 上次应用的配置快照，用于跳过无变化的重载 */
let lastConfigSnapshot = '';

/** 并发守卫 */
let reloading = false;
let pendingReload: { rawConfig: any; api: IrisAPI } | null = null;

/** 缓存的 API 引用 */
let cachedApi: IrisAPI | undefined;

export default definePlugin({
  name: 'computer-use',
  version: '0.1.0',
  description: 'Computer Use — 浏览器和桌面自动化',

  activate(ctx: PluginContext) {
    // 设置扩展根目录，供 sidecar 路径解析使用
    const extDir = ctx.getExtensionRootDir();
    setBrowserExtDir(extDir);
    setScreenExtDir(extDir);

    // 确保宿主配置目录中存在 computer_use.yaml 模板
    const created = ctx.ensureConfigFile('computer_use.yaml', DEFAULT_CONFIG_TEMPLATE);
    if (created) {
      logger.info('已在配置目录中安装 computer_use.yaml 默认模板');
    }

    // 注册 onReady 回调：在 Backend 创建完成后初始化 CU
    ctx.onReady(async (api) => {
      cachedApi = api;
      const pluginConfig = ctx.getPluginConfig<Record<string, unknown>>();

      // 配置来源：
      //   1. 宿主配置目录中的 computer_use.yaml（优先）
      //   2. 插件配置（plugins.yaml 中的 config 字段）
      //   3. 全局配置中的 computer_use / computerUse 字段（向后兼容）
      const rawConfig = ctx.readConfigSection('computer_use')
        ?? pluginConfig
        ?? (api.config as Record<string, unknown>).computer_use
        ?? (api.config as Record<string, unknown>).computerUse;

      const cuConfig = parseComputerUseConfig(rawConfig);
      if (!cuConfig?.enabled) {
        logger.info('Computer Use 未启用');
        return;
      }

      await initEnvironment(cuConfig, api);
      lastConfigSnapshot = JSON.stringify(rawConfig ?? null);
    });

    // 注册配置重载钩子
    ctx.addHook({
      name: 'computer-use:config-reload',
      async onConfigReload({ config, rawMergedConfig }) {
        if (!cachedApi) return;
        const rawConfig = (rawMergedConfig as Record<string, unknown>).computer_use;
        await safeReload(rawConfig, cachedApi);
      },
    });
  },

  async deactivate() {
    await destroyEnvironment();
  },
});

// ============ 内部逻辑 ============

async function initEnvironment(cuConfig: ComputerUseConfig, api: IrisAPI): Promise<void> {
  const env = cuConfig.environment ?? 'browser';
  const envKey = resolveEnvironmentKey(env, cuConfig.backgroundMode);

  let cuEnv: Computer;

  if (env === 'screen') {
    cuEnv = new ScreenEnvironment({
      searchEngineUrl: cuConfig.searchEngineUrl,
      targetWindow: cuConfig.targetWindow,
      backgroundMode: cuConfig.backgroundMode,
    });
  } else {
    cuEnv = new BrowserEnvironment({
      screenWidth: cuConfig.screenWidth ?? 1440,
      screenHeight: cuConfig.screenHeight ?? 900,
      headless: cuConfig.headless,
      initialUrl: cuConfig.initialUrl,
      searchEngineUrl: cuConfig.searchEngineUrl,
      highlightMouse: cuConfig.highlightMouse,
    });
  }

  try {
    await cuEnv.initialize();
  } catch (err) {
    logger.error('Computer Use 环境初始化失败:', err);
    return;
  }

  // 收集初始化警告
  if ('initWarnings' in cuEnv) {
    const warnings = (cuEnv as any).initWarnings as string[];
    for (const w of warnings) {
      logger.warn(w);
    }
  }

  // 注册工具
  const userPolicy = cuConfig.environmentTools?.[envKey as keyof typeof cuConfig.environmentTools];
  const tools = createComputerUseTools(cuEnv, envKey, userPolicy);
  api.tools.registerAll(tools);

  activeEnv = cuEnv;

  // 同步到 IrisAPI.computerEnv（宿主兼容）
  (api as any).computerEnv = cuEnv;

  logger.info(`Computer Use 已启用 [环境=${env}, 策略=${envKey}]`);
}

async function destroyEnvironment(): Promise<void> {
  if (activeEnv) {
    try {
      await activeEnv.dispose();
    } catch { /* sidecar 可能已退出 */ }
    activeEnv = undefined;
  }
}

async function safeReload(rawConfig: any, api: IrisAPI): Promise<void> {
  if (reloading) {
    pendingReload = { rawConfig, api };
    return;
  }
  reloading = true;
  try {
    await doReload(rawConfig, api);
  } finally {
    reloading = false;
    if (pendingReload) {
      const p = pendingReload;
      pendingReload = null;
      await safeReload(p.rawConfig, p.api);
    }
  }
}

async function doReload(rawConfig: any, api: IrisAPI): Promise<void> {
  const newSnapshot = JSON.stringify(rawConfig ?? null);
  if (newSnapshot === lastConfigSnapshot) return;
  lastConfigSnapshot = newSnapshot;

  // 注销旧工具
  const toolNames = api.tools as any;
  if (typeof toolNames.listTools === 'function') {
    for (const name of toolNames.listTools()) {
      if (COMPUTER_USE_FUNCTION_NAMES.has(name)) {
        toolNames.unregister(name);
      }
    }
  }

  // 销毁旧环境
  await destroyEnvironment();
  (api as any).computerEnv = undefined;

  // 重新初始化
  const cuConfig = parseComputerUseConfig(rawConfig);
  if (cuConfig?.enabled) {
    await initEnvironment(cuConfig, api);
  } else {
    logger.info('Computer Use 已禁用');
  }
}
