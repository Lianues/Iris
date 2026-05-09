import type { ToolDefinition } from '../../types';
import type { SessionMilestoneManager, MilestoneUpdateInput } from '../../core/session-milestones';
import { formatMilestoneSummary } from '../../core/session-milestones';
import { agentContext } from '../../logger';
import type { CrossAgentTaskBoard } from '../../core/cross-agent-task-board';

export interface MilestoneToolDeps {
  manager: SessionMilestoneManager;
  getSessionId: () => string | undefined;
  getAgentName?: () => string | undefined;
  taskBoard?: CrossAgentTaskBoard;
}

const ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: '会话内稳定 ID，例如 m1、tests、phase-2。省略时 Iris 会根据标题生成。',
    },
    title: {
      type: 'string',
      description: '面向用户展示的短标题，建议使用动宾短语。',
    },
    description: {
      type: 'string',
      description: '更完整的说明、验收条件或上下文。',
    },
    activeForm: {
      type: 'string',
      description: '当前进行中时用于 spinner/状态栏的现在进行时文案，例如「运行测试」。',
    },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'],
      description: '状态：pending 未开始，in_progress 正在做，completed 已完成，blocked 被阻塞，cancelled 已取消。',
    },
    owner: {
      type: 'string',
      description: '负责该项的 Agent 名称。未填时默认为当前 Agent。',
    },
    blockedBy: {
      type: 'array',
      items: { type: 'string' },
      description: '该项依赖的 milestone ID 列表。',
    },
    blocks: {
      type: 'array',
      items: { type: 'string' },
      description: '该项完成后会解除阻塞的 milestone ID 列表。',
    },
    metadata: {
      type: 'object',
      description: '可选结构化扩展字段。',
    },
    delete: {
      type: 'boolean',
      description: '设为 true 时删除该 ID 对应的 milestone。',
    },
    expectedVersion: {
      type: 'number',
      description: '可选乐观并发版本号。若提供，必须与当前 milestone.version 一致，否则更新会被拒绝。',
    },
    force: {
      type: 'boolean',
      description: '是否强制接管/覆盖 owner 保护。仅当前台 Agent 或无 routeAgent 的当前执行方可使用。',
    },
  },
};

function getActiveSessionIdOrThrow(deps: MilestoneToolDeps): string {
  const sessionId = deps.getSessionId();
  if (!sessionId) throw new Error('milestone 工具只能在会话执行上下文中使用');
  return sessionId;
}

function normalizeItems(raw: unknown): MilestoneUpdateInput[] {
  if (!Array.isArray(raw)) {
    throw new Error('items 必须是数组');
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`items[${index}] 必须是对象`);
    }
    return entry as MilestoneUpdateInput;
  });
}

interface MilestoneExecutionContext {
  sessionId: string;
  sourceAgent?: string;
  routeAgent?: string;
}

function resolveSourceAgentName(deps: MilestoneToolDeps): string | undefined {
  const base = deps.getAgentName?.();
  const current = agentContext.getStore();
  if (current && current !== 'main') {
    return base ? `${base}:${current}` : current;
  }
  return base;
}

function parseCrossAgentTaskId(sessionId: string): string | undefined {
  if (!sessionId.startsWith('cross-agent:')) return undefined;
  const parts = sessionId.split(':');
  if (parts.length < 3) return undefined;
  return parts.slice(2).join(':') || undefined;
}

function resolveExecutionContext(deps: MilestoneToolDeps): MilestoneExecutionContext {
  const rawSessionId = getActiveSessionIdOrThrow(deps);
  const baseAgent = deps.getAgentName?.();
  const sourceAgent = resolveSourceAgentName(deps);
  const crossAgentTaskId = parseCrossAgentTaskId(rawSessionId);

  if (crossAgentTaskId && deps.taskBoard) {
    const task = deps.taskBoard.get(crossAgentTaskId);
    if (task?.type === 'delegate') {
      return { sessionId: task.sourceSessionId, sourceAgent, routeAgent: task.sourceAgent };
    }
  }

  return { sessionId: rawSessionId, sourceAgent, routeAgent: baseAgent };
}

export function createUpdateMilestonesTool(deps: MilestoneToolDeps): ToolDefinition {
  return {
    approvalMode: 'handler',
    parallel: false,
    declaration: {
      name: 'update_milestones',
      description: `更新当前会话的结构化 milestone/task 清单，并驱动 Console/Web 中的 Iris 进度面板。

使用规则：
- 复杂、多步骤、跨文件或用户明确要求跟踪进度时，先创建 3-8 个 milestone。
- 开始某项工作前，把该项设为 in_progress；完成后立即设为 completed，不要批量拖到最后。
- 通常同一 Agent 同一时间只应有一个 in_progress；多 Agent 并行时可通过 owner 区分负责人。
- 当前前台 Agent 初次建立完整清单时可使用 replaceAll=true；子代理或委派 Agent 更新时请用增量 items，避免覆盖其他 Agent 的 owner/状态。
- list_milestones 会返回每项 version；并发敏感更新可带 expectedVersion，防止覆盖别人刚刚写入的状态。
- 这不是最终回复文本；调用后 UI 会自动显示进度清单。`,
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: ITEM_SCHEMA,
            description: '要创建、更新或删除的 milestone 项。默认按 id 增量合并。',
          },
          replaceAll: {
            type: 'boolean',
            description: '是否用 items 完整替换当前会话 milestone。仅当前台 Agent 初始化总清单时使用；子代理或委派 Agent 会被自动降级为增量更新。',
          },
        },
        required: ['items'],
      },
    },
    handler: async (args) => {
      const milestoneContext = resolveExecutionContext(deps);
      const items = normalizeItems(args.items);
      const mayReplaceAll = !milestoneContext.routeAgent
        || !milestoneContext.sourceAgent
        || milestoneContext.sourceAgent === milestoneContext.routeAgent;
      const replaceAll = args.replaceAll === true && mayReplaceAll;
      const snapshot = deps.manager.update(milestoneContext.sessionId, items, { sourceAgent: milestoneContext.sourceAgent, routeAgent: milestoneContext.routeAgent, replaceAll });
      return {
        ok: true,
        summary: formatMilestoneSummary(snapshot),
        snapshot,
      };
    },
  };
}

export function createListMilestonesTool(deps: MilestoneToolDeps): ToolDefinition {
  return {
    approvalMode: 'handler',
    parallel: true,
    declaration: {
      name: 'list_milestones',
      description: '读取当前会话的 milestone/task 清单，用于检查整体进度、避免重复创建或确认下一步。',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => {
      const milestoneContext = resolveExecutionContext(deps);
      const snapshot = deps.manager.getSnapshot(milestoneContext.sessionId, milestoneContext.sourceAgent);
      return {
        ok: true,
        summary: formatMilestoneSummary(snapshot),
        snapshot,
      };
    },
  };
}

export function createMilestoneTools(deps: MilestoneToolDeps): ToolDefinition[] {
  return [
    createUpdateMilestonesTool(deps),
    createListMilestonesTool(deps),
  ];
}

export function buildMilestoneSystemPrompt(): string {
  return `【Milestone 进度清单】

Iris 支持结构化 milestone/task 进度显示：pending 显示为淡色圆点，in_progress 显示为高亮星标，completed 显示为对勾。进度来自 update_milestones 工具，而不是从普通文本中解析。

使用原则：
1. 对复杂、多步骤、跨文件、需要验证或用户明确要求跟踪进度的任务，请主动使用 update_milestones 建立并维护清单。
2. 初始清单应短而可执行，通常 3-8 项；简单单步任务不要强行创建清单。
3. 开始执行某项前先把它标为 in_progress；完成后立即把它标为 completed；遇到阻塞则标为 blocked 并说明 blockedBy/description。
4. 多 Agent / sub_agent 并行时不要覆盖其他 Agent 的条目；用 owner 标记负责人，增量更新自己的条目。
5. 在最终回复前确认 milestone 状态与实际完成情况一致；不要把未验证或部分完成的项标为 completed。并发敏感场景请先 list_milestones 获取 version，再用 expectedVersion 更新。`;
}
