/**
 * 子代理工具
 *
 * 主 LLM 通过此工具创建独立的子代理，
 * 每个子代理拥有独立上下文、独立工具集、独立工具循环。
 *
 * 子代理直接复用 ToolLoop（与 Orchestrator/CLI 相同的核心引擎），
 * 支持嵌套自我调用。
 */

import { ToolDefinition } from '../../../types';
import { ToolPolicyConfig } from '../../../config';
import { LLMRouter } from '../../../llm/router';
import { ToolRegistry } from '../../registry';
import { ToolLoop, LLMCaller } from '../../../core/tool-loop';
import { PromptAssembler } from '../../../prompt/assembler';
import { createLogger } from '../../../logger';
import { SubAgentTypeRegistry, SubAgentTypeConfig } from './types';

// 统一导出类型层
export type { SubAgentTypeConfig } from './types';
export {
  SubAgentTypeRegistry,
  createDefaultSubAgentTypes,
  buildSubAgentGuidance,
} from './types';

const logger = createLogger('SubAgent');

export interface SubAgentToolDeps {
  /** 动态获取 router（支持热重载后取到最新实例） */
  getRouter: () => LLMRouter;
  tools: ToolRegistry;
  subAgentTypes: SubAgentTypeRegistry;
  maxDepth: number;
  getToolPolicies: () => Record<string, ToolPolicyConfig>;
}

/** 工具名称常量 */
const TOOL_NAME = 'sub_agent';

function getSubAgentTypeName(args: Record<string, unknown>): string {
  const type = args.type;
  return typeof type === 'string' && type.trim() ? type : 'general-purpose';
}

function formatTypeSuffix(type: SubAgentTypeConfig): string {
  const segments = [type.parallel ? '可并行调度' : '串行调度'];
  if (type.modelName) {
    segments.push(`模型名称=${type.modelName}`);
  }
  return segments.join('，');
}

/**
 * 创建 sub_agent 工具
 *
 * @param deps         依赖注入
 * @param currentDepth 当前嵌套深度（0 = 顶层）
 */
export function createSubAgentTool(deps: SubAgentToolDeps, currentDepth: number = 0): ToolDefinition {
  const typeDescriptions = deps.subAgentTypes.getAll()
    .map(t => `  - ${t.name}: ${t.description}（${formatTypeSuffix(t)}）`)
    .join('\n');

  const toolDescription = `启动子代理执行子任务。子代理拥有独立上下文和工具循环，完成后返回结果。不同类型可分别配置是否参与并行调度，以及是否固定使用某个模型。\n\n可用类型：\n${typeDescriptions}`;

  return {
    declaration: {
      name: TOOL_NAME,
      description: toolDescription,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '交给子代理执行的任务描述，应尽量详细清晰',
          },
          type: {
            type: 'string',
            description: '子代理类型（默认 general-purpose）',
          },
        },
        required: ['prompt'],
      },
    },
    parallel: (args) => deps.subAgentTypes.get(getSubAgentTypeName(args))?.parallel === true,
    handler: async (args) => {
      const prompt = args.prompt as string;
      const typeName = getSubAgentTypeName(args);

      // 深度检查
      if (currentDepth >= deps.maxDepth) {
        logger.warn(`子代理嵌套深度超限 (${currentDepth}/${deps.maxDepth})`);
        return { error: `子代理嵌套深度超过上限（${deps.maxDepth}），拒绝创建` };
      }

      // 获取类型配置
      const typeConfig = deps.subAgentTypes.get(typeName);
      if (!typeConfig) {
        return { error: `未知的子代理类型: ${typeName}。可用类型: ${deps.subAgentTypes.list().join(', ')}` };
      }

      // 构建子工具集
      let subTools: ToolRegistry;
      if (typeConfig.allowedTools) {
        subTools = deps.tools.createSubset(typeConfig.allowedTools);
      } else if (typeConfig.excludedTools) {
        subTools = deps.tools.createFiltered(typeConfig.excludedTools);
      } else {
        subTools = deps.tools.createFiltered([]);
      }

      // 注入深度递增的 sub_agent 工具（实现嵌套自我调用）
      if (currentDepth + 1 < deps.maxDepth) {
        subTools.unregister(TOOL_NAME);
        subTools.register(createSubAgentTool(deps, currentDepth + 1));
      } else {
        subTools.unregister(TOOL_NAME);
      }

      logger.info(`创建子代理: type=${typeName} depth=${currentDepth + 1}/${deps.maxDepth} 工具数=${subTools.size}`);

      // 创建 ToolLoop（与 Orchestrator 复用同一引擎）
      const subPrompt = new PromptAssembler();
      subPrompt.setSystemPrompt(typeConfig.systemPrompt);

      const loop = new ToolLoop(subTools, subPrompt, {
        maxRounds: typeConfig.maxToolRounds,
        toolPolicies: deps.getToolPolicies(),
      });

      const callLLM: LLMCaller = async (request, modelName) => {
        const response = await deps.getRouter().chat(request, modelName);
        return response.content;
      };

      try {
        const result = await loop.run(
          [{ role: 'user', parts: [{ text: prompt }] }],
          callLLM,
          { modelName: typeConfig.modelName },
        );
        logger.info(`子代理完成: type=${typeName}`);
        return { result: result.text };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`子代理执行失败: ${errorMsg}`);
        return { error: `子代理执行失败: ${errorMsg}` };
      }
    },
  };
}
