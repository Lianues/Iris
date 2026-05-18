/**
 * 扩展 CLI 命令分发
 *
 * 扫描所有已安装/收录的扩展 manifest.json，
 * 查找 commands 字段中声明的 CLI 子命令并执行。
 *
 * 扩展在 manifest.json 中声明 CLI 命令：
 *   {
 *     "commands": {
 *       "relay": { "entry": "src/relay.ts", "export": "runRelay" },
 *       "net":   { "entry": "src/command.ts", "export": "runNetCommand" }
 *     }
 *   }
 *
 * main.ts 匹配不到内置命令时自动回退到此模块。
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { extensionsDir, workspaceExtensionsDir } from '../paths';

export async function tryExtensionCommand(command: string, args: string[]): Promise<boolean> {
  const searchDirs = [workspaceExtensionsDir, extensionsDir];

  for (const baseDir of searchDirs) {
    if (!baseDir || !fs.existsSync(baseDir)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(baseDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifestPath = path.join(baseDir, entry, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const cmdDef = manifest.commands?.[command];
        if (!cmdDef?.entry) continue;

        const modulePath = path.join(baseDir, entry, cmdDef.entry);
        const mod = await import(pathToFileURL(modulePath).href);
        const fn = mod[cmdDef.export || 'default'];
        if (typeof fn === 'function') {
          await fn(args);
          return true;
        }
      } catch {
        // 加载失败，继续尝试下一个扩展
      }
    }
  }

  return false;
}
