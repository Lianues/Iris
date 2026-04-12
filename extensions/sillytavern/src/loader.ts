/**
 * ST 资源文件加载器
 *
 * 从 ctx.getDataDir() 的子目录中读取酒馆导出的 JSON 文件，
 * 并通过 fast-tavern 的转换函数转为引擎新格式。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  convertPresetFromSillyTavern,
  convertCharacterFromSillyTavern,
  convertWorldBookFromSillyTavern,
  convertRegexesFromSillyTavern,
  type PresetInfo,
  type CharacterCard,
  type WorldBook,
  type RegexScriptData,
} from 'fast-tavern';

/** 确保数据子目录存在 */
export function ensureDataDirs(dataDir: string): void {
  for (const sub of ['presets', 'characters', 'worldbooks', 'regex']) {
    const dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/** 安全读取 JSON 文件 */
function readJSON(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * 加载预设文件（ST 旧格式 JSON → PresetInfo）
 */
export function loadPreset(dataDir: string, filename: string): PresetInfo {
  const filePath = path.join(dataDir, 'presets', filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`预设文件不存在: ${filePath}`);
  }
  const raw = readJSON(filePath);
  return convertPresetFromSillyTavern(raw);
}

/**
 * 加载角色卡文件（ST 旧格式 JSON → CharacterCard）
 */
export function loadCharacter(dataDir: string, filename: string): CharacterCard {
  const filePath = path.join(dataDir, 'characters', filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`角色卡文件不存在: ${filePath}`);
  }
  const raw = readJSON(filePath);
  return convertCharacterFromSillyTavern(raw);
}

/**
 * 加载世界书文件列表（ST 旧格式 JSON → WorldBook[]）
 */
export function loadWorldbooks(dataDir: string, filenames: string[]): WorldBook[] {
  const books: WorldBook[] = [];
  for (const filename of filenames) {
    if (!filename || !filename.trim()) continue;
    const filePath = path.join(dataDir, 'worldbooks', filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`世界书文件不存在: ${filePath}`);
    }
    const raw = readJSON(filePath);
    books.push(convertWorldBookFromSillyTavern(raw));
  }
  return books;
}

/**
 * 加载正则脚本文件列表（ST 旧格式 JSON → RegexScriptData[]）
 *
 * 每个文件可以是：
 *   - { regex_scripts: [...] }  （ST 全局导出格式）
 *   - [...]                      （纯数组）
 */
export function loadRegexScripts(dataDir: string, filenames: string[]): RegexScriptData[] {
  const allScripts: RegexScriptData[] = [];
  for (const filename of filenames) {
    if (!filename || !filename.trim()) continue;
    const filePath = path.join(dataDir, 'regex', filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`正则脚本文件不存在: ${filePath}`);
    }
    const raw = readJSON(filePath);
    // convertRegexesFromSillyTavern 接受数组
    const arr = Array.isArray(raw) ? raw : (raw.regex_scripts ?? [raw]);
    allScripts.push(...convertRegexesFromSillyTavern(arr));
  }
  return allScripts;
}
