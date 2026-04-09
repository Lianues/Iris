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
import { parse as parseYAML } from 'yaml';
import { getSessionCwd } from '../core/backend/session-context';
import type { SkillDefinition, SkillContextModifier } from './types';

/** Skill 名称校验：仅允许 ASCII 字母、数字、下划线、连字符，1-64 字符 */
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * 将 frontmatter 中的字段值解析为字符串数组。
 *
 * 支持格式：
 *   - YAML 数组：[a, b, c]
 *   - 逗号分隔字符串："a, b, c"
 *   - 单个字符串："a"
 */
/**
 * 将 frontmatter 中的字段值解析为字符串数组。
 *
 * 支持格式：
 *   - YAML 数组：[a, b, c]
 *   - 逗号分隔字符串："a, b, c"
 *   - 空格分隔字符串："a b c"（当不含逗号时）
 *   - 单个字符串："a"
 */
function parseStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const arr = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return arr.length > 0 ? arr : undefined;
  }
  if (typeof value === 'string') {
    // 含逗号时按逗号分割（"shell, read_file"），否则按空格分割（"file branch"）
    const sep = value.includes(',') ? ',' : /\s+/;
    const arr = value.split(sep).map(s => s.trim()).filter(s => s.length > 0);
    return arr.length > 0 ? arr : undefined;
  }
  return undefined;
}

/**
 * 取 kebab-case 或 camelCase 键值。
 *
 * SKILL.md frontmatter 使用 kebab-case（如 allowed-tools），
 * system.yaml 内联 skill 可能使用 camelCase（如 allowedTools）。
 * 优先取 kebab-case（SKILL.md 标准格式），回退到 camelCase。
 */
function getField(fields: Record<string, unknown>, kebab: string, camel: string): unknown {
  return fields[kebab] ?? fields[camel];
}

/**
 * 从解析后的 frontmatter 字段构建完整的 SkillDefinition。
 * 被 parseSkillMd（文件系统 Skill）和 parseSystemConfig（内联 Skill）共用。
 */
export function buildSkillDefinition(
  name: string,
  fields: Record<string, unknown>,
  content: string,
  filePath: string,
): SkillDefinition {
  const allowedTools = parseStringArray(getField(fields, 'allowed-tools', 'allowedTools'));
  const model = typeof fields.model === 'string' ? fields.model : undefined;
  const mode = fields.context === 'fork' ? 'fork' as const : 'inline' as const;

  // 预构建 contextModifier
  const contextModifier: SkillContextModifier | undefined =
    (allowedTools || model) ? {
      autoApproveTools: allowedTools,
      modelOverride: model,
    } : undefined;

  const argumentHintRaw = getField(fields, 'argument-hint', 'argumentHint');
  const whenToUseRaw = getField(fields, 'when-to-use', 'whenToUse');
  const userInvocableRaw = getField(fields, 'user-invocable', 'userInvocable');
  const disableModelInvocationRaw = getField(fields, 'disable-model-invocation', 'disableModelInvocation');

  return {
    name,
    description: typeof fields.description === 'string' ? fields.description : undefined,
    content,
    path: filePath,
    enabled: fields.enabled === true,
    allowedTools,
    model,
    mode,
    arguments: parseStringArray(fields.arguments),
    argumentHint: typeof argumentHintRaw === 'string' ? argumentHintRaw : undefined,
    whenToUse: typeof whenToUseRaw === 'string' ? whenToUseRaw : undefined,
    paths: parseStringArray(fields.paths),
    userInvocable: userInvocableRaw !== false,
    disableModelInvocation: disableModelInvocationRaw === true,
    contextModifier,
  };
}

/**
 * 解析单个 SKILL.md 文件。
 *
 * 格式：
 *   ---
 *   name: my-skill
 *   description: 做什么用的
 *   allowed-tools: shell, read_file
 *   model: opus
 *   context: inline
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

    // 使用 yaml 库解析 frontmatter（替换原有简易正则解析器）
    let fields: Record<string, unknown> = {};
    try {
      const parsed = parseYAML(frontmatterText);
      // YAML 可能解析为非对象（如 frontmatter 只写了 true / 123），回退到空对象
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fields = parsed as Record<string, unknown>;
      }
    } catch {
      // YAML 解析失败，回退到空对象（仅使用目录名和 content）
    }

    const name = typeof fields.name === 'string' ? fields.name : dirName;
    if (!SKILL_NAME_RE.test(name)) {
      console.warn(`[Iris] Skill "${name}" 名称不合法（需匹配 ${SKILL_NAME_RE}），已跳过: ${filePath}`);
      return undefined;
    }

    return buildSkillDefinition(name, fields, content, filePath);
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
 * 从文件系统加载 Skill 定义，并可选合并插件程序化注册的 Skill。
 *
 * 扫描路径：
 *   1. dataDir/skills/     — 全局 Skill（~/.iris/skills/）
 *   2. cwd/.agents/skills/ — 项目级 Skill
 *
 * 优先级（从高到低）：
 *   1. system.yaml 内联 Skill（由调用方在合并后覆盖）
 *   2. 项目级文件系统 Skill
 *   3. 全局文件系统 Skill
 *   4. 插件程序化 Skill（pluginSkills，优先级最低，用户可通过同名文件覆盖）
 *
 * @param dataDir  数据目录（默认 ~/.iris/）
 * @param pluginSkills  插件程序化注册的 Skill（可选）
 * @returns 扫描到的 SkillDefinition 数组（文件系统 Skill 优先于插件 Skill）
 */
export function loadSkillsFromFilesystem(dataDir: string, pluginSkills?: Map<string, SkillDefinition>): SkillDefinition[] {
  const globalDir = path.join(dataDir, 'skills');
  const projectDir = path.join(getSessionCwd(), '.agents', 'skills');

  // 插件 Skill 先加载（优先级最低）
  const merged = new Map<string, SkillDefinition>();
  if (pluginSkills) {
    for (const [name, skill] of pluginSkills) merged.set(name, skill);
  }

  // 全局 Skill 覆盖插件 Skill
  const globalSkills = scanSkillsDir(globalDir);
  for (const s of globalSkills) merged.set(s.name, s);

  // 项目级 Skill 覆盖全局 Skill
  const projectSkills = scanSkillsDir(projectDir);
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
  const projectDir = path.join(getSessionCwd(), '.agents', 'skills');
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
