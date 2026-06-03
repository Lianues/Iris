/**
 * Skill 读取工具
 *
 * 工具声明中只暴露 Skill 摘要（name / path / description），
 * 模型需要完整 Skill 内容时，再调用本工具按需读取。
 * 这样可以避免把 Skill 全文持续拼接到每一轮用户消息，减少重复 token 消耗。
 */

import type { ToolDefinition, FunctionDeclaration } from '../../types';
import type { Backend } from '../../core/backend';
import { createSkillUri } from '../../config/skill-resource-manifest';

export interface ReadSkillDeps {
  getBackend: () => Backend;
}

interface ListedSkill {
  name: string;
  path?: string;
  description?: string;
  skillUri?: string;
  resources?: unknown[];
  source?: string;
  disableModelInvocation?: boolean;
}

/**
 * 将任意文本安全地编码为 YAML 双引号字符串。
 *
 * 说明：这里复用 JSON.stringify 的转义结果，因为 YAML 兼容 JSON 风格的双引号字符串，
 * 能避免 Windows 路径中的反斜杠、冒号和 description 中的特殊字符破坏 YAML 结构。
 */
function toYamlQuoted(value: string): string {
  return JSON.stringify(value);
}

/**
 * 构建可嵌入工具描述中的 YAML Skill 列表。
 *
 * 模型在查看工具描述时，只需要看到每个 Skill 的最小必要摘要，
 * 需要全文时再调用 read_skill(path) 获取。
 */
function buildYamlSkillList(skills: ListedSkill[]): string {
  if (skills.length === 0) return '[]';

  return skills.map((skill) => {
    const lines = [
      `- name: ${toYamlQuoted(skill.name)}`,
    ];

    if (skill.description) {
      lines.push(`  description: ${toYamlQuoted(skill.description)}`);
    }
    if (skill.source) {
      lines.push(`  source: ${toYamlQuoted(skill.source)}`);
    }
    if (Array.isArray(skill.resources) && skill.resources.length > 0) {
      lines.push(`  resources: ${skill.resources.length}`);
    }

    return lines.join('\n');
  }).join('\n');
}

/**
 * 根据当前 Skill 列表构建 read_skill 工具声明。
 *
 * 新声明优先使用 name 定位 Skill，不再把文件系统绝对路径暴露给模型。
 * path 仍作为兼容旧对话的 deprecated 参数被 handler 接受，但不再出现在工具描述中。
 */
function buildDeclaration(skills: ListedSkill[]): FunctionDeclaration {
  const yamlList = buildYamlSkillList(skills.filter(skill => !skill.disableModelInvocation));

  return {
    name: 'read_skill',
    description:
      'Read the full content of a skill by its name. ' +
      'Skills are user-defined knowledge modules that provide specialized instructions. ' +
      'Only load a skill when it is relevant to the current task.\n\n' +
      'Available skills (YAML):\n' +
      `${yamlList}\n\n` +
      'Security model: local Skill filesystem roots are intentionally not listed. ' +
      'Use read_skill_resource with manifest relativePath values for bundled text resources.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name from the available skill list.',
        },
           path: {
          type: 'string',
          description: 'Deprecated compatibility identifier. Prefer name; this parameter is only accepted for old conversations.',
        },
      },
      required: [],
    },
  };
}

/** 创建 read_skill 工具。 */
export function createReadSkillTool(deps: ReadSkillDeps): ToolDefinition {
  const backend = deps.getBackend();
  const skills = backend.listSkills();

  return {
    declaration: buildDeclaration(skills),
    handler: async (args) => {
      const skillName = typeof args.name === 'string' ? args.name.trim() : '';
      const legacyPath = typeof args.path === 'string' ? args.path.trim() : '';
      if (!skillName && !legacyPath) {
        return {
          success: false,
          error: 'Missing required parameter: name',
        };
      }

      const skill = skillName
        ? deps.getBackend().getSkillByName(skillName)
        : deps.getBackend().getSkillByPath(legacyPath);
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skillName || legacyPath}`,
        };
      }
      if (skill.disableModelInvocation) {
        return {
          success: false,
          error: `Skill "${skill.name}" is not available for model invocation.`,
        };
      }

      return {
        success: true,
        schemaVersion: 2,
        name: skill.name,
        skillName: skill.name,
        skillUri: skill.skillUri || createSkillUri(skill.name),
        description: skill.description,
        content: skill.content,
        resources: skill.resources || [],
        resourceAccess: {
          readTextTool: 'read_skill_resource',
          note: 'Use manifest relativePath values only. Local Skill filesystem roots are intentionally not exposed.',
        },
      };
    },
    // Skill 读取会向当前会话注入新的长文本上下文，不适合与相邻工具并行执行。
    parallel: false,
  };
}
