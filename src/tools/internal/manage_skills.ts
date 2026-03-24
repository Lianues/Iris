/**
 * Skill 管理工具（toggle_skills 风格）
 *
 * 动态将每个已定义的 Skill 生成为工具声明中的 boolean 参数，
 * 参数的 description 即为 Skill 的 description，让 LLM 从工具声明就能看到
 * 所有可用 Skill 及其用途，无需额外调用 list 操作。
 *
 * 参考 Agent Skills 标准的渐进式披露（progressive disclosure）：
 *   - Tier 1（始终可见）：name + description 通过工具参数声明暴露给 LLM（~50-100 token/skill）
 *   - Tier 2（按需加载）：用户/LLM 启用 Skill 后，其完整 content 注入到后续对话
 *
 * 工具声明需要在 Skill 列表变化时重建（通过 rebuildDeclaration 方法）。
 */

import type { ToolDefinition, FunctionDeclaration } from '../../types';
import type { Backend } from '../../core/backend';

export interface ManageSkillsDeps {
  getBackend: () => Backend;
}

/**
 * 根据当前 Skill 列表动态构建工具的参数声明。
 *
 * 每个 Skill 映射为一个 boolean 参数：
 *   - 参数名 = Skill name
 *   - 参数 description = Skill description（若有）
 *   - 设为 true 表示启用，false 表示禁用
 *
 * 这样 LLM 在查看工具声明时就能看到所有可用 Skill 的列表和说明，
 * 无需额外调用 list 操作即可了解有什么 Skill。
 */
function buildDeclaration(
  skills: { name: string; description?: string; enabled: boolean }[],
): FunctionDeclaration {
  // 构建参数 properties：每个 Skill 一个 boolean 参数
  const properties: Record<string, { type: string; description: string }> = {};
  for (const s of skills) {
    properties[s.name] = {
      type: 'boolean',
      description: s.description || s.name,
    };
  }

  return {
    // 工具名称需满足 ^[a-zA-Z0-9_-]{1,64}$，以兼容 Claude 等模型
    name: 'toggle_skills',
    description:
      'Toggle whether to send skill content to the conversation. ' +
      'Skills are user-defined knowledge modules that provide specialized context and instructions. ' +
      'Each parameter is a skill name - set to true to send content, false to stop sending. ' +
      'The skill content will be included in subsequent messages. ' +
      'Enable a skill when you need its specific content for the current task; ' +
      'disable it when no longer needed to save conversation space.',
    parameters: {
      type: 'object',
      properties,
      required: [],
    },
  };
}

/**
 * 创建 Skill 管理工具。
 *
 * 返回的 ToolDefinition 会在 Skill 列表变化时通过重新注册来更新声明。
 * 调用方应在 Skill 列表变化（热重载等）后调用 createManageSkillsTool 并重新注册。
 */
export function createManageSkillsTool(deps: ManageSkillsDeps): ToolDefinition {
  const backend = deps.getBackend();
  const skills = backend.listSkills();

  return {
    declaration: buildDeclaration(skills),
    handler: async (args) => {
      const backend = deps.getBackend();
      const results: { name: string; success: boolean; enabled: boolean; message: string }[] = [];

      // 遍历所有传入的参数，每个都是一个 Skill 名称 → boolean
      for (const [name, value] of Object.entries(args)) {
        if (typeof value !== 'boolean') continue;

        if (value) {
          // 启用 Skill
          const ok = backend.enableSkill(name);
          if (ok) {
            results.push({ name, success: true, enabled: true, message: `Skill "${name}" 已启用。` });
          } else {
            results.push({ name, success: false, enabled: false, message: `Skill "${name}" 不存在。` });
          }
        } else {
          // 禁用 Skill
          const ok = backend.disableSkill(name);
          if (ok) {
            results.push({ name, success: true, enabled: false, message: `Skill "${name}" 已禁用。` });
          } else {
            results.push({ name, success: false, enabled: false, message: `Skill "${name}" 不存在。` });
          }
        }
      }

      // 如果没有传入任何有效参数，返回当前状态列表（兼容旧行为）
      if (results.length === 0) {
        const currentSkills = backend.listSkills();
        return {
          skills: currentSkills.map(s => ({
            name: s.name,
            description: s.description ?? '',
            enabled: s.enabled,
          })),
          message: '未指定任何 Skill 切换操作，已列出当前状态。',
        };
      }

      return { results };
    },
    parallel: false,
  };
}
