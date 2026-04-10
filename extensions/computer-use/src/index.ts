/**
 * Computer Use 扩展插件入口
 *
 * 实现 IrisPlugin 接口，在 activate 阶段初始化 CU 环境并注册工具，
 * 通过 onConfigReload 钩子支持配置热重载，
 * 在 deactivate 时销毁环境。
 */

import { definePlugin, createPluginLogger, type PluginContext, type IrisAPI } from 'irises-extension-sdk';
import type { LLMRequest, Content, FunctionResponsePart } from 'irises-extension-sdk';
import { parseComputerUseConfig } from './config.js';
import { DEFAULT_CONFIG_TEMPLATE } from './config-template.js';
import { buildPanelHTML } from './panel-html.js';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
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
/** 扩展根目录（用于自动安装依赖） */
let cachedExtDir: string | undefined;

export default definePlugin({
  name: 'computer-use',
  version: '0.1.0',
  description: 'Computer Use — 浏览器和桌面自动化',

  activate(ctx: PluginContext) {
    // 设置扩展根目录，供 sidecar 路径解析使用
    const extDir = ctx.getExtensionRootDir();
    cachedExtDir = extDir;
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

      // 注册扩展面板（Web UI 侧边栏会动态显示）
      api.registerWebPanel?.({
        id: 'computer-use',
        title: 'Computer Use',
        icon: 'mouse',
        contentPath: '/api/ext/computer-use/panel',
      });

      // 面板内容路由：返回完整配置 UI
      api.registerWebRoute?.('GET', '/api/ext/computer-use/panel', async (_req: any, res: any) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildPanelHTML());
      });

      // 配置读取路由
      api.registerWebRoute?.('GET', '/api/ext/computer-use/config', async (_req: any, res: any) => {
        try {
          const data = ctx.readConfigSection('computer_use') ?? {};
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || '读取配置失败' }));
        }
      });

      // 配置写入路由
      api.registerWebRoute?.('PUT', '/api/ext/computer-use/config', async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

          const configDir = ctx.getConfigDir();
          const fs = await import('fs');
          const path = await import('path');
          const filePath = path.join(configDir, 'computer_use.yaml');
          fs.writeFileSync(filePath, stringifyYAML(body, { indent: 2 }), 'utf-8');

          // 触发配置重载
          await safeReload(body, api);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, reloaded: true }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || '写入配置失败' }));
        }
      });

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

    // 截图剥离钩子：在 LLM 请求前剥离工具响应中的旧截图，节省 token。
    // 只保留最近 maxRecentScreenshots 轮含截图的工具响应。
    ctx.addHook({
      name: 'computer-use:strip-old-screenshots',
      onBeforeLLMCall({ request }) {
        if (!activeEnv) return undefined;

        // 从当前生效的配置读取保留轮次（默认 3）
        const rawCfg = ctx.readConfigSection('computer_use');
        const cuCfg = rawCfg ? parseComputerUseConfig(rawCfg) : undefined;
        const max = cuCfg?.maxRecentScreenshots ?? 3;
        if (max === Infinity) return undefined;

        let imageRounds = 0;
        for (let i = request.contents.length - 1; i >= 0; i--) {
          const content = request.contents[i];
          if (content.role !== 'user') continue;

          const hasScreenshot = content.parts.some(
            p => 'functionResponse' in p
              && (p as FunctionResponsePart).functionResponse.parts?.length
              && COMPUTER_USE_FUNCTION_NAMES.has((p as FunctionResponsePart).functionResponse.name),
          );
          if (!hasScreenshot) continue;

          imageRounds++;
          if (imageRounds > max) {
            for (const part of content.parts) {
              if ('functionResponse' in part
                && (part as FunctionResponsePart).functionResponse.parts?.length
                && COMPUTER_USE_FUNCTION_NAMES.has((part as FunctionResponsePart).functionResponse.name)) {
                (part as FunctionResponsePart).functionResponse.parts = undefined;
              }
            }
          }
        }
        return { request };
      },
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

  // browser 环境：检查 Playwright 是否已安装，未安装则自动安装
  if (env === 'browser' && cachedExtDir) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const playwrightDir = path.join(cachedExtDir, 'node_modules', 'playwright');
    if (!fs.existsSync(playwrightDir)) {
      logger.info('Playwright 未安装，正在自动安装（首次使用需要下载，请耐心等待）...');
      try {
        const { execSync } = await import('node:child_process');
        execSync('npm install playwright', { cwd: cachedExtDir, stdio: 'pipe', timeout: 120_000 });
        logger.info('Playwright 库安装完成，正在下载 Chromium 浏览器...');
        execSync('npx playwright install chromium', { cwd: cachedExtDir, stdio: 'pipe', timeout: 300_000 });
        logger.info('Chromium 下载完成');
      } catch (installErr: any) {
        logger.error('Playwright 自动安装失败，请手动执行：');
        logger.error(`  cd "${cachedExtDir}"`);
        logger.error('  npm install playwright && npx playwright install chromium');
        return;
      }
    }
  }

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
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes('playwright') || msg.includes('Cannot find package')) {
      logger.error('Playwright 安装异常，请手动执行：');
      logger.error(`  cd "${cachedExtDir}"`);
      logger.error('  npm install playwright && npx playwright install chromium');
    } else {
      logger.error('Computer Use 环境初始化失败:', msg);
    }
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

  // 重新初始化
  const cuConfig = parseComputerUseConfig(rawConfig);
  if (cuConfig?.enabled) {
    await initEnvironment(cuConfig, api);
  } else {
    logger.info('Computer Use 已禁用');
  }
}
