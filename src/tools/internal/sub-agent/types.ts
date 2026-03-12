/**
 * 子代理类型定义与注册表
 *
 * 定义可用的子代理类型（系统提示词、工具白/黑名单、模型名称等），
 * 主 LLM 通过 sub_agent 工具按类型派生子代理。
 */

/** 子代理类型配置 */
export interface SubAgentTypeConfig {
  /** 类型标识 */
  name: string;
  /** 面向父级 LLM 的用途说明（展示在 sub_agent 工具声明中） */
  description: string;
  /** 子代理的系统提示词 */
  systemPrompt: string;
  /** 工具白名单（与 excludedTools 互斥，优先） */
  allowedTools?: string[];
  /** 工具黑名单 */
  excludedTools?: string[];
  /** 固定使用的模型名称；不填时跟随当前活动模型 */
  modelName?: string;
  /** 当前类型的 sub_agent 调用是否可按 parallel 工具参与调度 */
  parallel: boolean;
  /** 最大工具轮次 */
  maxToolRounds: number;
}

/** 子代理类型注册表 */
export class SubAgentTypeRegistry {
  private types = new Map<string, SubAgentTypeConfig>();

  /** 注册子代理类型 */
  register(config: SubAgentTypeConfig): void {
    this.types.set(config.name, config);
  }

  /** 获取子代理类型配置 */
  get(name: string): SubAgentTypeConfig | undefined {
    return this.types.get(name);
  }

  /** 列出所有已注册的类型名称 */
  list(): string[] {
    return Array.from(this.types.keys());
  }

  /** 获取所有已注册的类型配置 */
  getAll(): SubAgentTypeConfig[] {
    return Array.from(this.types.values());
  }
}

/** 创建内置默认子代理类型 */
export function createDefaultSubAgentTypes(): SubAgentTypeConfig[] {
  return [
    {
      name: 'general-purpose',
      description: '执行需要多步工具操作的复杂子任务。适合承接相对独立的子任务。',
      systemPrompt: '你是一个通用子代理，负责独立完成委派给你的子任务。请专注于完成任务并返回清晰的结果。',
      excludedTools: ['sub_agent'],
      parallel: false,
      maxToolRounds: 200,
    },
    {
      name: 'explore',
      description: '只读搜索和阅读文件、执行查询命令。不做修改，只返回发现的信息。',
      systemPrompt: '你是一个只读探索代理，负责搜索和阅读信息。不要修改任何文件，只返回你发现的内容。',
      allowedTools: ['read_file', 'shell'],
      parallel: false,
      maxToolRounds: 200,
    },
    {
      name: 'recall',
      description: '从长期记忆中检索相关信息。当需要回忆用户偏好、历史事实或之前保存的内容时使用。',
      systemPrompt: '你是一个记忆召回代理。根据给定的查询，从长期记忆中尽可能全面地检索相关信息。\n\n策略：\n1. 先用原始查询搜索\n2. 如果结果不够，提取关键词重新搜索\n3. 尝试相关概念或同义词搜索\n\n将所有找到的记忆整理为清晰的摘要返回。如果没有找到任何相关记忆，明确说明。',
      allowedTools: ['memory_search'],
      parallel: false,
      maxToolRounds: 3,
    },
  ];
}

function formatTypeSuffix(type: SubAgentTypeConfig): string {
  const segments = [type.parallel ? '可并行调度' : '串行调度'];
  if (type.modelName) {
    segments.push(`模型名称=${type.modelName}`);
  }
  return segments.join('，');
}

/** 根据注册的类型动态生成协调指导文本，注入系统提示词引导主 LLM 自然委派 */
export function buildSubAgentGuidance(registry: SubAgentTypeRegistry, hasMemory: boolean): string {
  const typeList = registry.getAll()
    .map(t => `- **${t.name}**：${t.description}（${formatTypeSuffix(t)}）`)
    .join('\n');

  let guidance = `\n## 任务委派\n\n你可以使用 sub_agent 工具将子任务委派给专门的子代理。每个子代理拥有独立的上下文和工具，完成后返回结果。\n\n可用的子代理类型：\n${typeList}\n\n使用原则：\n- 简单问题直接回答，不需要子代理\n- 当子任务相对独立时，优先委派给子代理\n- 当需要拆分多个独立子任务时，可以连续调用多个标记为“可并行调度”的子代理类型`;

  if (hasMemory) {
    guidance += `\n- 需要检索长期记忆时，使用 recall 子代理\n- memory_add 和 memory_delete 请直接使用，不要委派`;
  }

  return guidance;
}
