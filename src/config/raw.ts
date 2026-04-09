/**
 * 原始配置目录读写工具
 *
 * data/configs/ 下每个一级 YAML 文件对应一个配置分区。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';

export const CONFIG_SECTION_KEYS = [
  'llm',
  'ocr',
  'platform',
  'storage',
  'tools',
  'system',
  'memory',
  'cloudflare',
  'mcp',
  'modes',
  'sub_agents',
  'summary',
  'plugins',
  'net',
  'safety',
] as const;

export type ConfigSectionKey = typeof CONFIG_SECTION_KEYS[number];

function readYamlFile(filePath: string): any | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseYAML(raw) ?? undefined;
}

export function loadRawConfigDir(dir: string): Partial<Record<ConfigSectionKey, any>> {
  const result: Partial<Record<ConfigSectionKey, any>> = {};

  for (const key of CONFIG_SECTION_KEYS) {
    const value = readYamlFile(path.join(dir, `${key}.yaml`));
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

export function writeRawConfigDir(dir: string, data: Partial<Record<ConfigSectionKey, any>>): void {
  for (const key of CONFIG_SECTION_KEYS) {
    const filePath = path.join(dir, `${key}.yaml`);
    const value = data[key];

    if (value === undefined) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      continue;
    }

    fs.writeFileSync(filePath, stringifyYAML(value, { indent: 2 }), 'utf-8');
  }
}
