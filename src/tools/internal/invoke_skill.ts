/**
 * Skill 调用工具（invoke_skill）
 *
 * 替代 read_skill 的增强版 Skill 工具。支持：
 *   - 参数替换（$ARGUMENTS / $0 / $name）
 *   - 上下文修改（自动放行工具 / 切换模型 / 注入系统提示）
 *   - 双执行模式（inline 注入对话 / fork 独立子代理）
 *
 * 返回值使用 __response + __contextModifier 模式，
 * 由 ToolLoop 在写入历史前提取 modifier 并剥离。
 */

import type { ToolDefinition, FunctionDeclaration } from '../../types';
import { createSkillUri } from '../../config/skill-resource-manifest';
import type { SkillDefinition, SkillContextModifier, ToolsConfig } from '../../config/types';
import { parseSkillArguments, substituteSkillParams } from './skill-params';
import { ToolRegistry } from '../registry';
import { PromptAssembler } from '../../prompt/assembler';
import { ToolLoop } from '../../core/tool-loop';
import type { LLMRouter } from '../../llm/router';
import type { Content, Part, LLMRequest } from '../../types';

export interface InvokeSkillDeps {
  getBackend: () => {
    listSkills(): { name: string; path: string; description?: string; mode?: string; whenToUse?: string; argumentHint?: string; disableModelInvocation?: boolean }[];
    getSkillByName(name: string): SkillDefinition | undefined;
  };
  getRouter: () => LLMRouter;
  tools: ToolRegistry;
  getToolsConfig: () => ToolsConfig;
  retryOnError?: boolean;
  maxRetries?: number;
}

/**
 * 校验模型名是否在 router 中注册。
 * 无效时返回 undefined（回退到当前模型），避免后续 LLM 调用崩溃。
 */
function validateModel(router: LLMRouter, modelName?: string): string | undefined {
  if (!modelName) return undefined;
  try {
    const knownModels = router.listModels().map(m => m.modelName);
    if (knownModels.includes(modelName)) return modelName;
    return undefined;
  } catch {
    // router 不可用（如测试 mock 场景），保守地返回原值
    return modelName;
  }
}

/**
 * 将任意文本安全地编码为 YAML 双引号字符串。
 */
function toYamlQuoted(value: string): string {
  return JSON.stringify(value);
}

interface SkillListItem {
  name: string;
  description?: string;
  mode?: string;
  whenToUse?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
}

/**
 * 构建可嵌入工具描述中的 YAML Skill 列表。
 */
function buildYamlSkillList(skills: SkillListItem[]): string {
  if (skills.length === 0) return '[]';

  return skills.map((skill) => {
    const lines = [
      `- name: ${toYamlQuoted(skill.name)}`,
    ];
    if (skill.description) {
      lines.push(`  description: ${toYamlQuoted(skill.description)}`);
    }
    if (skill.mode && skill.mode !== 'inline') {
      lines.push(`  mode: ${skill.mode}`);
    }
    if (skill.whenToUse) {
      lines.push(`  when_to_use: ${toYamlQuoted(skill.whenToUse)}`);
    }
    if (skill.argumentHint) {
      lines.push(`  argument_hint: ${toYamlQuoted(skill.argumentHint)}`);
    }
    return lines.join('\n');
  }).join('\n');
}

/**
 * 构建 invoke_skill 工具声明。
 */
function buildDeclaration(skills: SkillListItem[]): FunctionDeclaration {
  // 排除禁止模型调用的 skill
  const invocableSkills = skills.filter(s => !s.disableModelInvocation);
  const yamlList = buildYamlSkillList(invocableSkills);

  return {
    name: 'invoke_skill',
    description:
      'Invoke a skill by name. Prefer this tool over read_skill — it supports arguments, context modification, and fork execution.\n\n' +
      'For inline skills: the skill content is returned and its context modifications (tool permissions, model override) are applied.\n' +
      'For fork skills: the skill runs in an isolated sub-agent and returns the result.\n\n' +
      'Available skills (YAML):\n' +
      `${yamlList}`,
    parameters: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Skill name. Use the exact name shown in the available skill list.',
        },
        args: {
          type: 'string',
          description: 'Optional arguments passed to the skill. Supports positional and named parameters.',
        },
      },
      required: ['skill'],
    },
  };
}

/**
 * 为 fork 模式创建 LLM 调用函数。
 */
function createForkLLMCaller(router: LLMRouter, modelName?: string) {
  return async (request: LLMRequest, requestModelName?: string, signal?: AbortSignal): Promise<Content> => {
    const effectiveModel = requestModelName ?? modelName;
    const response = await router.chat(request, effectiveModel, signal);
    return response.content;
  };
}

/** 创建 invoke_skill 工具。 */
export function createInvokeSkillTool(deps: InvokeSkillDeps): ToolDefinition {
  const backend = deps.getBackend();
  const skills = backend.listSkills();

  return {
    declaration: buildDeclaration(skills),
    handler: async (args) => {
      const skillName = typeof args.skill === 'string' ? args.skill.trim() : '';
      if (!skillName) {
        return { error: 'Missing required parameter: skill' };
      }

      const skill = deps.getBackend().getSkillByName(skillName);
      if (!skill) {
        return { error: `Skill not found: ${skillName}` };
      }
      if (skill.disableModelInvocation) {
        return { error: `Skill "${skill.name}" is not available for model invocation.` };
      }

      // 参数解析与替换
      const rawArgs = typeof args.args === 'string' ? args.args : '';
      const parsedArgs = parseSkillArguments(rawArgs, skill.arguments);
      const processedContent = substituteSkillParams(skill.content, parsedArgs, skill.arguments);

      // Fork 模式：在独立子代理中执行
      if (skill.mode === 'fork') {
        return await executeForkMode(deps, skill, processedContent, rawArgs);
      }

      // Inline 模式（默认）：返回内容 + 上下文修改器
      const contextModifier: SkillContextModifier | undefined = skill.contextModifier
        ? { ...skill.contextModifier }
        : undefined;

      // 校验模型名有效性，无效时回退（避免后续 LLM 调用崩溃）
      if (contextModifier?.modelOverride) {
        contextModifier.modelOverride = validateModel(deps.getRouter(), contextModifier.modelOverride);
      }

      return {
        __contextModifier: contextModifier,
        __response: {
          success: true,
          schemaVersion: 2,
          name: skill.name,
          skillName: skill.name,
          skillUri: skill.skillUri || createSkillUri(skill.name),
          content: processedContent,
          resources: skill.resources || [],
          resourceAccess: {
            readTextTool: 'read_skill_resource',
            note: 'Use manifest relativePath values only. Local Skill filesystem roots are intentionally not exposed.',
          },
        },
      };
    },
    // Skill 调用会修改运行时上下文，不适合与相邻工具并行执行。
    parallel: false,
  };
}

/**
 * Fork 模式执行：创建隔离的 ToolLoop 运行 skill。
 */
async function executeForkMode(
  deps: InvokeSkillDeps,
  skill: SkillDefinition,
  processedContent: string,
  rawArgs: string,
): Promise<unknown> {
  try {
    // 构建子工具集。
    //
    // 重要：deps.tools 是 bootstrap 时的全局 ToolRegistry，而非当前 ToolLoop 的 registry。
    // 如果 invoke_skill 在 sub-agent 中被调用，sub-agent 可能通过 allowedTools/excludedTools
    // 限制了可用工具集。但 deps.tools 仍是全局的，fork 子 agent 会绕过 sub-agent 的过滤。
    //
    // 安全策略：fork 模式下 **必须** 通过 skill 的 allowed-tools 显式声明可用工具。
    // 未声明 allowed-tools 时，fork 子 agent 仅获得空工具集（只能纯对话），
    // 避免意外继承全局工具导致权限逃逸。
    let subTools: ToolRegistry;
    if (skill.allowedTools && skill.allowedTools.length > 0) {
      subTools = deps.tools.createSubset(skill.allowedTools);
    } else {
      // 未指定 allowed-tools：创建空 registry，fork 子 agent 只能纯对话
      subTools = new ToolRegistry();
    }
    subTools.unregister('invoke_skill');
    subTools.unregister('read_skill');

    // 创建独立的 PromptAssembler
    const subPrompt = new PromptAssembler();
    subPrompt.setSystemPrompt(processedContent);

    // 创建独立的 ToolLoop（浅拷贝 toolsConfig，防止 fork 内的 skill 修改泄漏回父级）
    const parentConfig = deps.getToolsConfig();
    const loop = new ToolLoop(subTools, subPrompt, {
      maxRounds: 20,
      toolsConfig: {
        ...parentConfig,
        permissions: { ...parentConfig.permissions },
      },
      retryOnError: deps.retryOnError,
      maxRetries: deps.maxRetries,
    });

    // 创建 LLM 调用函数（校验模型名，无效时回退到当前模型）
    const validatedModel = validateModel(deps.getRouter(), skill.model);
    const callLLM = createForkLLMCaller(deps.getRouter(), validatedModel);

    // 用户参数作为 user 消息
    const userMessage = rawArgs || 'Execute the skill.';
    const result = await loop.run(
      [{ role: 'user', parts: [{ text: userMessage }] }],
      callLLM,
    );

    if (result.error) {
      return { error: `Skill fork 执行失败: ${result.error}` };
    }

    return { result: result.text };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Skill fork 执行异常: ${msg}` };
  }
}
