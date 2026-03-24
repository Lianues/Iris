/**
 * 系统级配置解析
 *
 * 支持两种 Skill 来源：
 *   1. system.yaml 中的 skills 字段（内联定义）
 *   2. 文件系统扫描（~/.iris/skills/ 和 .agents/skills/）
 *
 * 合并优先级：YAML 内联定义 > 项目级文件 > 全局文件
 */

import { SystemConfig, SkillDefinition } from './types';
import { loadSkillsFromFilesystem } from './skill-loader';

/** Skill 名称校验：仅允许 ASCII 字母、数字、下划线、连字符，1-64 字符 */
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function parseSystemConfig(raw: any = {}, dataDir?: string): SystemConfig {
  // 解析 system.yaml 中的内联 skills 定义
  let yamlSkills: SkillDefinition[] = [];
  if (raw.skills && typeof raw.skills === 'object' && !Array.isArray(raw.skills)) {
    yamlSkills = Object.entries(raw.skills)
      .filter(([, v]) => v && typeof v === 'object' && typeof (v as any).content === 'string')
      .filter(([name]) => {
        if (!SKILL_NAME_RE.test(name)) { console.warn(`[Iris] Skill "${name}" 名称不合法（需匹配 ${SKILL_NAME_RE}），已跳过`); return false; }
        return true;
      })
      .map(([name, v]) => ({
        name,
        description: typeof (v as any).description === 'string' ? (v as any).description : undefined,
        content: (v as any).content as string,
        enabled: (v as any).enabled === true,
      }));
  }

  // 从文件系统扫描 SKILL.md（仅在提供了 dataDir 时扫描）
  let fsSkills: SkillDefinition[] = [];
  if (dataDir) {
    fsSkills = loadSkillsFromFilesystem(dataDir);
  }

  // 合并：文件系统 Skill 打底，YAML 内联定义覆盖同名条目
  let skills: SkillDefinition[] | undefined;
  if (fsSkills.length > 0 || yamlSkills.length > 0) {
    const merged = new Map<string, SkillDefinition>();
    for (const s of fsSkills) merged.set(s.name, s);
    for (const s of yamlSkills) merged.set(s.name, s);  // YAML 覆盖同名
    skills = Array.from(merged.values());
    if (skills.length === 0) skills = undefined;
  }

  return {
    systemPrompt: raw.systemPrompt ?? '',
    maxToolRounds: raw.maxToolRounds ?? 200,
    stream: raw.stream ?? true,
    // skillPreamble: Skill 注入引导词模板，支持 {{SKILL}} 占位符。
    // 仅在用户显式配置时传入，undefined 表示使用内置默认引导词。
    skillPreamble: typeof raw.skillPreamble === 'string' ? raw.skillPreamble : undefined,
    retryOnError: raw.retryOnError ?? true,
    maxRetries: raw.maxRetries ?? 3,
    maxAgentDepth: raw.maxAgentDepth ?? 3,
    logRequests: raw.logRequests ?? false,
    skills,
  };
}
