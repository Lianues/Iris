/**
 * 插件配置解析
 *
 * 解析 plugins.yaml 文件内容。
 *
 * 配置格式：
 *   plugins:
 *     - name: my-tool
 *       type: local        # local | npm，默认 local
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
