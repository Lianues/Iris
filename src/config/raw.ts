/**
 * 原始配置目录读写工具
 *
 * ~/.iris/configs/ 下每个一级 YAML 文件对应一个配置分区。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { atomicWriteTextFileSync, withFileLockSync } from './file-lock';

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
  'ide',
  'modes',
  'sub_agents',
  'summary',
  'plugins',
  'delivery',
  'virtual_lover',
  'net',
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

function lockConfigSectionFiles<T>(dir: string, index: number, fn: () => T): T {
  if (index >= CONFIG_SECTION_KEYS.length) return fn();
  const filePath = path.join(dir, `${CONFIG_SECTION_KEYS[index]}.yaml`);
  return withFileLockSync(filePath, () => lockConfigSectionFiles(dir, index + 1, fn));
}

/**
 * 在配置目录所有已知 section 文件锁下执行操作。
 *
 * 这用于覆盖“读取当前配置 → deepMerge → 写回”的完整临界区，避免 CLI、Web、Console
 * 多进程同时写同一个 YAML 时出现 stale read 覆盖。
 */
export function withRawConfigDirLockSync<T>(dir: string, fn: () => T): T {
  return lockConfigSectionFiles(dir, 0, fn);
}

export function writeRawConfigDirUnlocked(dir: string, data: Partial<Record<ConfigSectionKey, any>>): void {
  for (const key of CONFIG_SECTION_KEYS) {
    const filePath = path.join(dir, `${key}.yaml`);
    const value = data[key];

    if (value === undefined) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      continue;
    }

    atomicWriteTextFileSync(filePath, stringifyYAML(value, { indent: 2 }));
  }
}

export function writeRawConfigDir(dir: string, data: Partial<Record<ConfigSectionKey, any>>): void {
  withRawConfigDirLockSync(dir, () => writeRawConfigDirUnlocked(dir, data));
}
