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
import type { SkillDefinition, SkillContextModifier, SkillDiagnostic, SkillSource } from './types';
import { buildSkillResourceManifest, canonicalizeSkillRoot, createSkillUri } from './skill-resource-manifest';

/** Skill 名称校验：仅允许 ASCII 字母、数字、下划线、连字符，1-64 字符 */
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export interface LoadedSkillsFromFilesystem {
  skills: SkillDefinition[];
  diagnostics: SkillDiagnostic[];
}

let lastFilesystemSkillDiagnostics: SkillDiagnostic[] = [];
let activeDiagnostics: SkillDiagnostic[] | undefined;

function recordSkillDiagnostic(diagnostic: SkillDiagnostic): void {
  const target = activeDiagnostics ?? lastFilesystemSkillDiagnostics;
  target.push(diagnostic);
}

export function getLastFilesystemSkillDiagnostics(): SkillDiagnostic[] {
  return [...lastFilesystemSkillDiagnostics];
}

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
  options: { source?: SkillSource } = {},
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
  const isInline = filePath.startsWith('inline:');
  const source = options.source ?? (isInline ? 'inline' : 'unknown');
  const basePath = isInline ? undefined : path.dirname(filePath);
  let canonicalBasePath: string | undefined;
  let resources = undefined as SkillDefinition['resources'];
  if (basePath) {
    try {
      canonicalBasePath = canonicalizeSkillRoot(basePath);
      resources = buildSkillResourceManifest(name, canonicalBasePath, content);
    } catch (error) {
      recordSkillDiagnostic({
        severity: 'warning',
        code: 'skill-resource-manifest-failed',
        message: error instanceof Error ? error.message : String(error),
        skillName: name,
        filePath,
        source,
      });
      resources = [];
    }
  }

  return {
    name,
    description: typeof fields.description === 'string' ? fields.description : undefined,
    content,
    path: filePath,
    source,
    basePath,
    canonicalBasePath,
   skillUri: createSkillUri(name),
    resources,
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
function parseSkillMd(filePath: string, dirName: string, source: SkillSource = 'unknown'): SkillDefinition | undefined {
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
        const message = `Skill 目录名 "${name}" 不合法（需匹配 ${SKILL_NAME_RE}），已跳过: ${filePath}`;
        console.warn(`[Iris] ${message}`);
        recordSkillDiagnostic({ severity: 'fatal', code: 'skill-invalid-directory-name', message, skillName: name, filePath, source });
        return undefined;
      }
      recordSkillDiagnostic({
        severity: 'warning',
        code: 'skill-missing-frontmatter',
        message: 'SKILL.md 缺少 YAML frontmatter，已兼容使用目录名作为 Skill name；建议补充 name/description。',
        skillName: name,
        filePath,
        source,
      });
      return buildSkillDefinition(name, {}, content, filePath, { source });
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
    } catch (error) {
      // YAML 解析失败，回退到空对象（仅使用目录名和 content），同时记录结构化诊断供 TUI 展示。
      recordSkillDiagnostic({
        severity: 'warning',
        code: 'skill-frontmatter-parse-failed',
        message: error instanceof Error ? error.message : String(error),
        skillName: dirName,
        filePath,
        source,
      });
    }

    const name = typeof fields.name === 'string' ? fields.name : dirName;
    if (!SKILL_NAME_RE.test(name)) {
      const message = `Skill "${name}" 名称不合法（需匹配 ${SKILL_NAME_RE}），已跳过: ${filePath}`;
      console.warn(`[Iris] ${message}`);
      recordSkillDiagnostic({ severity: 'fatal', code: 'skill-invalid-name', message, skillName: name, filePath, field: 'name', source });
      return undefined;
    }

    if (name !== dirName) {
      recordSkillDiagnostic({
        severity: 'warning',
        code: 'skill-name-directory-mismatch',
        message: `Frontmatter name "${name}" 与目录名 "${dirName}" 不一致；Iris 当前仍按 name 加载，但建议保持一致。`,
        skillName: name,
        filePath,
        field: 'name',
        source,
      });
    }
    if (typeof fields.description !== 'string' || !fields.description.trim()) {
      recordSkillDiagnostic({
        severity: 'warning',
        code: 'skill-missing-description',
        message: 'Skill 缺少 description；模型选择 Skill 时可能无法判断适用场景。',
        skillName: name,
        filePath,
        field: 'description',
        source,
      });
    }

    return buildSkillDefinition(name, fields, content, filePath, { source });
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
function scanSkillsDir(skillsDir: string, source: SkillSource): SkillDefinition[] {
  if (!fs.existsSync(skillsDir)) return [];

  const results: SkillDefinition[] = [];
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const skill = parseSkillMd(skillMdPath, entry.name, source);
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
export function loadSkillsFromFilesystemWithDiagnostics(dataDir: string): LoadedSkillsFromFilesystem {
  const diagnostics: SkillDiagnostic[] = [];
  const previousActiveDiagnostics = activeDiagnostics;
  activeDiagnostics = diagnostics;
  try {
    const globalDir = path.join(dataDir, 'skills');
    const projectDir = path.join(getSessionCwd(), '.agents', 'skills');

    // 全局 Skill 先加载，项目级后加载（同名时项目级覆盖全局）
    const globalSkills = scanSkillsDir(globalDir, 'global');
    const projectSkills = scanSkillsDir(projectDir, 'project');

    // 合并：项目级覆盖全局同名
    const merged = new Map<string, SkillDefinition>();
    for (const s of globalSkills) merged.set(s.name, s);
    for (const s of projectSkills) {
      if (merged.has(s.name)) {
        recordSkillDiagnostic({
          severity: 'warning',
          code: 'skill-duplicate-shadowed',
          message: `Project Skill "${s.name}" shadows a global Skill with the same name.`,
          skillName: s.name,
          filePath: s.path,
          source: 'project',
        });
      }
      merged.set(s.name, s);
    }

    const result = { skills: Array.from(merged.values()), diagnostics };
    lastFilesystemSkillDiagnostics = [...diagnostics];
    return result;
  } finally {
    activeDiagnostics = previousActiveDiagnostics;
  }
}

export function loadSkillsFromFilesystem(dataDir: string): SkillDefinition[] {
  return loadSkillsFromFilesystemWithDiagnostics(dataDir).skills;
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
      // recursive: true 可监听子目录中的 SKILL.md 以及 references/scripts/assets 资源变化。
      // 资源 manifest 带 sha256，任何资源变更都需要刷新 manifest，避免 read_skill_resource /
      // execute_skill_script 因旧 hash 拒绝读取/执行直到重启。
      const watcher = fs.watch(dir, { recursive: true }, () => {
        debouncedOnChange();
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
