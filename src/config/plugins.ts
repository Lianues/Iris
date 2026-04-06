/**
 * 插件声明配置解析
 *
 * 解析 plugins.yaml 文件内容。
 *
 * ⚠️  关于 plugins 与 extensions 的关系：
 *
 * "Extension" 是打包与分发单位——extensions/ 下的一个目录加一份 manifest.json。
 * 每个 extension 可以向系统贡献两种能力：
 *   1. platform 贡献（manifest 的 "platforms" 字段）→ 由 registerExtensionPlatforms() 自动发现并注册
 *   2. plugin 贡献（manifest 的 "plugin" 字段）  → 不会自动加载，需要在 plugins.yaml 中显式声明
 *
 * 例如 console、web 是纯 platform extension，不需要写进 plugins.yaml。
 * 而 cron、memory 是 plugin extension，必须在 plugins.yaml 中声明才会被 PluginManager 激活。
 *
 * 两者不是并集、超集或子集的关系——extension 是载体，plugin 和 platform 是它可以贡献的两种角色。
 * plugins.yaml 只控制"哪些 extension 的 plugin 角色需要被激活"。
 *
 * plugins.yaml 属于全局独占配置，所有 agent 共享，agent 层不可覆盖。
 *
 * 配置格式：
 *   plugins:
 *     - name: my-tool
 *       type: local        # local | npm，默认 local（对应 extensions/ 下同名目录）
 *       enabled: true      # 默认 true
 *       priority: 100      # 可选，数值越大越先执行
 *       config:            # 可选，覆盖插件自身的 config.yaml
 *         apiKey: "xxx"
 */

import type { PluginEntry } from '@irises/extension-sdk';

export function parsePluginsConfig(raw: any): PluginEntry[] | undefined {
  if (!raw) return undefined;

  // 支持两种格式：
  // 1. { plugins: [...] }
  // 2. 直接是数组 [...]
  const list = raw.plugins ?? raw;
  if (!Array.isArray(list)) return undefined;

  const entries: PluginEntry[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') {
      continue;
    }

    entries.push({
      name: item.name,
      type: item.type === 'npm' ? 'npm' : 'local',
      enabled: item.enabled !== false,
      priority: typeof item.priority === 'number' ? item.priority : undefined,
      config: item.config && typeof item.config === 'object' ? item.config : undefined,
    });
  }

  return entries.length > 0 ? entries : undefined;
}
