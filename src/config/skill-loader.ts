/**
 * Skill 文件系统加载器
 *
 * 扫描指定目录下的 SKILL.md 文件，解析 YAML frontmatter，
 * 转换为 SkillDefinition 数组。
 *
 * 遵循 Agent Skills 开放标准：
 *   - 每个 Skill 是一个目录，内含 SKILL.md 作为入口
 *   - SKILL.md 以 YAML frontmatter 开头（--- 包裹），后跟 Markdown 正文
 *   - frontmatter 中 name 和 description 为标准字段
 *   - Markdown 正文即为 Skill 的 content
 *
 * 扫描路径（按优先级从高到低）：
 *   1. ~/.iris/skills/<name>/SKILL.md       — 全局 Skill
 *   2. .agents/skills/<name>/SKILL.md       — 项目级 Skill（cwd 下）
 *
 * 与 system.yaml 中的 skills 配置合并时，YAML 配置优先（同名覆盖）。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SkillDefinition } from './types';

/** Skill 名称校验：仅允许 ASCII 字母、数字、下划线、连字符，1-64 字符 */
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * 解析单个 SKILL.md 文件。
 *
 * 格式：
 *   ---
 *   name: my-skill
 *   description: 做什么用的
 *   ---
 *   Markdown 正文（即 content）
 *
 * 如果 frontmatter 中没有 name，则使用目录名。
 * 如果解析失败，返回 undefined。
 */
function parseSkillMd(filePath: string, dirName: string): SkillDefinition | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');

    // 匹配 YAML frontmatter：以 --- 开头和结尾
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!fmMatch) {
      // 没有 frontmatter，整个文件作为 content，目录名作为 name
      const content = raw.trim();
      if (!content) return undefined;
      const name = dirName;
      if (!SKILL_NAME_RE.test(name)) {
        console.warn(`[Iris] Skill 目录名 "${name}" 不合法（需匹配 ${SKILL_NAME_RE}），已跳过: ${filePath}`);
        return undefined;
      }
      return { name, content, path: filePath };
    }

    const frontmatterText = fmMatch[1];
    const content = fmMatch[2].trim();
    if (!content) return undefined;

    // 简易 YAML 解析（不引入 yaml 依赖，仅处理简单键值对）
    const fields: Record<string, string> = {};
    for (const line of frontmatterText.split('\n')) {
      const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
      if (kv) {
        fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
      }
    }

    const name = fields.name || dirName;
    if (!SKILL_NAME_RE.test(name)) {
      console.warn(`[Iris] Skill "${name}" 名称不合法（需匹配 ${SKILL_NAME_RE}），已跳过: ${filePath}`);
      return undefined;
    }

    return {
      name,
      description: fields.description || undefined,
      content,
      path: filePath,
      enabled: fields.enabled === 'true',
    };
  } catch {
    // 读取或解析失败，静默跳过
    return undefined;
  }
}

/**
 * 扫描指定目录下的 Skill（一级子目录中的 SKILL.md）。
 *
 * 目录结构：
 *   skillsDir/
 *     my-skill/
 *       SKILL.md
 *     another-skill/
 *       SKILL.md
 */
function scanSkillsDir(skillsDir: string): SkillDefinition[] {
  if (!fs.existsSync(skillsDir)) return [];

  const results: SkillDefinition[] = [];
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const skill = parseSkillMd(skillMdPath, entry.name);
      if (skill) results.push(skill);
    }
  } catch {
    // 目录不可读，静默跳过
  }
  return results;
}

/**
 * 从文件系统加载 Skill 定义。
 *
 * 扫描路径：
 *   1. dataDir/skills/     — 全局 Skill（~/.iris/skills/）
 *   2. cwd/.agents/skills/ — 项目级 Skill
 *
 * @param dataDir  数据目录（默认 ~/.iris/）
 * @returns 扫描到的 SkillDefinition 数组（项目级优先于全局）
 */
export function loadSkillsFromFilesystem(dataDir: string): SkillDefinition[] {
  const globalDir = path.join(dataDir, 'skills');
  const projectDir = path.join(process.cwd(), '.agents', 'skills');

  // 全局 Skill 先加载，项目级后加载（同名时项目级覆盖全局）
  const globalSkills = scanSkillsDir(globalDir);
  const projectSkills = scanSkillsDir(projectDir);

  // 合并：项目级覆盖全局同名
  const merged = new Map<string, SkillDefinition>();
  for (const s of globalSkills) merged.set(s.name, s);
  for (const s of projectSkills) merged.set(s.name, s);

  return Array.from(merged.values());
}

/**
 * 获取需要监听的 Skill 目录列表。
 * 返回所有可能存放 SKILL.md 的根目录（全局 + 项目级）。
 */
export function getSkillWatchDirs(dataDir: string): string[] {
  const dirs: string[] = [];
  const globalDir = path.join(dataDir, 'skills');
  const projectDir = path.join(process.cwd(), '.agents', 'skills');
  if (fs.existsSync(globalDir)) dirs.push(globalDir);
  if (fs.existsSync(projectDir)) dirs.push(projectDir);
  return dirs;
}

/**
 * 创建 Skill 目录的文件系统监听器。
 * 监听 SKILL.md 的创建、修改、删除事件，触发回调。
 *
 * 使用 debounce 防抖（500ms），避免连续文件操作触发过多回调。
 * 不存在的目录会被跳过。
 *
 * @param dataDir   数据目录（用于定位全局 skills 目录）
 * @param onChange  变化回调
 * @returns 清理函数，调用后停止所有监听
 */
export function createSkillWatcher(
  dataDir: string,
  onChange: () => void,
): () => void {
  const dirs = getSkillWatchDirs(dataDir);
  const watchers: fs.FSWatcher[] = [];

  // 防抖定时器：500ms 内连续变化只触发一次回调
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedOnChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 500);
  };

  for (const dir of dirs) {
    try {
      // recursive: true 可监听子目录中的 SKILL.md 变化
      const watcher = fs.watch(dir, { recursive: true }, (_eventType, filename) => {
        const normalized = filename == null ? '' : String(filename);
        if (normalized.endsWith('SKILL.md') || normalized.endsWith('SKILL.md/')) {
          debouncedOnChange();
        }
      });
      watchers.push(watcher);
    } catch {
      // 目录不可监听（权限等问题），静默跳过
    }
  }

  // 返回清理函数
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const w of watchers) {
      try { w.close(); } catch { /* 忽略 */ }
    }
  };
}
