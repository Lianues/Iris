import type { IrisPlugin, LLMRequest, ToolDefinition } from 'irises-extension-sdk';
import { getActiveSessionId } from '../core/backend/session-context';
import { agentContext } from '../logger';
import { PlanModeManager } from './manager';
import { buildPlanModeAvailabilityInstructions, buildPlanModeExitReminder, buildPlanModeInstructions } from './prompts';
import { filterToolDeclarationsForPlanMode, isAllowedPlanModeTool } from './guard';
import { PLAN_MODE_SERVICE_ID, type PlanApprovalProgress } from './types';

const BACKGROUND_HIDDEN_TOOL_NAMES = new Set(['EnterPlanMode', 'ExitPlanMode', 'read_plan', 'write_plan', 'AskQuestionFirst']);

function ensureSystemParts(request: LLMRequest) {
  if (!request.systemInstruction) request.systemInstruction = { parts: [] };
  if (!Array.isArray(request.systemInstruction.parts)) request.systemInstruction.parts = [];
  return request.systemInstruction.parts;
}

function getSessionIdOrThrow(): string {
  const sessionId = getActiveSessionId();
  if (!sessionId) throw new Error('Plan Mode 工具只能在会话执行上下文中使用');
  return sessionId;
}

function assertMainAgentTurn(): void {
  const currentAgentContext = agentContext.getStore();
  if (currentAgentContext && currentAgentContext !== 'main') {
    throw new Error('Plan Mode 工具只能由当前 Agent 的主会话调用，不能在 sub_agent / 后台任务中调用。');
  }
}

function filterOutPlanTools(request: LLMRequest): void {
  if (!request.tools) return;
  request.tools = request.tools.map((tool) => ({
    ...tool,
    functionDeclarations: tool.functionDeclarations.filter((decl) => !BACKGROUND_HIDDEN_TOOL_NAMES.has(decl.name)),
  })).filter((tool) => tool.functionDeclarations.length > 0);
}

function createReadPlanTool(manager: PlanModeManager): ToolDefinition {
  return {
    approvalMode: 'handler',
    declaration: {
      name: 'read_plan',
      description: '读取当前 Agent 当前 session 的 Plan Mode Markdown 计划文件。Plan Mode 下请使用此工具查看计划。',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => {
      assertMainAgentTurn();
      const sessionId = getSessionIdOrThrow();
      const state = manager.getState(sessionId) ?? manager.enter(sessionId);
      const content = manager.readPlan(sessionId) ?? '';
      return { plan: content, planFilePath: state.planFilePath, active: state.active };
    },
  } as ToolDefinition;
}

function createWritePlanTool(manager: PlanModeManager): ToolDefinition {
  return {
    approvalMode: 'handler',
    declaration: {
      name: 'write_plan',
      description: '写入/覆盖当前 Agent 当前 session 的 Plan Mode Markdown 计划文件。Plan Mode 下唯一允许的写入目标就是该计划。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '完整 Markdown 计划内容' },
        },
        required: ['content'],
      },
    },
    handler: async (args) => {
      assertMainAgentTurn();
      const sessionId = getSessionIdOrThrow();
      if (!manager.isActive(sessionId)) {
        throw new Error('当前 session 未处于 Plan Mode，不能写入计划。请先调用 EnterPlanMode 或使用 /plan。');
      }
      const content = typeof args.content === 'string' ? args.content : '';
      const state = manager.writePlan(sessionId, content);
      return { success: true, planFilePath: state.planFilePath, bytes: Buffer.byteLength(content, 'utf-8') };
    },
  } as ToolDefinition;
}

function createEnterPlanModeTool(manager: PlanModeManager): ToolDefinition {
  return {
    // 进入 Plan Mode 只切换当前 session 的规划状态，不修改业务文件；无需弹出 Y/N 审批。
    approvalMode: 'handler',
    declaration: {
      name: 'EnterPlanMode',
      description: '进入 Iris Agent-local Plan Mode。适用于复杂、多文件或需求不明确的任务；简单明确的小改动不要调用。',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => {
      assertMainAgentTurn();
      const sessionId = getSessionIdOrThrow();
      const state = manager.enter(sessionId);
      return {
        entered: true,
        planFilePath: state.planFilePath,
        message: '已进入 Plan Mode。请先探索代码并使用 write_plan 写入计划，完成后调用 ExitPlanMode。',
      };
    },
  } as ToolDefinition;
}

function createExitPlanModeTool(manager: PlanModeManager): ToolDefinition {
  return {
    approvalMode: 'handler',
    declaration: {
      name: 'ExitPlanMode',
      description: '在 Plan Mode 中完成计划后调用。工具会读取当前计划文件并请求用户批准；不要把计划作为参数传入。',
      parameters: { type: 'object', properties: {} },
    },
    handler: async (_args, context) => {
      assertMainAgentTurn();
      const sessionId = getSessionIdOrThrow();
      const state = manager.getState(sessionId);
      if (!state?.active) {
        throw new Error('当前 session 未处于 Plan Mode，不能调用 ExitPlanMode。');
      }
      const plan = (manager.readPlan(sessionId) ?? '').trim();
      if (!plan) {
        throw new Error('当前计划文件为空。请先使用 write_plan 写入完整计划，再调用 ExitPlanMode。');
      }

      const progress: PlanApprovalProgress = {
        kind: 'plan_approval',
        plan,
        planFilePath: state.planFilePath,
      };
      (context as any)?.reportProgress?.(progress);

      const requestApproval = (context as any)?.requestApproval as undefined | (() => Promise<boolean>);
      if (!requestApproval) {
        return {
          approved: false,
          planFilePath: state.planFilePath,
          message: '当前执行上下文不支持交互式计划审批。请在 Console/Web 前台会话中批准计划，或使用 /plan 管理。',
        };
      }

      const approved = await requestApproval();
      if (!approved) {
        return {
          approved: false,
          planFilePath: state.planFilePath,
          message: '用户拒绝了计划。请继续保持 Plan Mode，读取反馈并使用 write_plan 修改计划后再次调用 ExitPlanMode。',
        };
      }

      manager.exit(sessionId);
      return {
        approved: true,
        planFilePath: state.planFilePath,
        message: '用户已批准计划。你已退出 Plan Mode，现在可以按计划开始实现。',
        approvedPlan: plan,
      };
    },
  } as ToolDefinition;
}

export const planModePlugin: IrisPlugin = {
  name: 'plan-mode',
  version: '0.1.0',
  description: 'Agent-local Plan Mode for Iris',
  activate(context) {
    const manager = new PlanModeManager();

    context.registerTools([
      createReadPlanTool(manager),
      createWritePlanTool(manager),
      createEnterPlanModeTool(manager),
      createExitPlanModeTool(manager),
    ]);

    const serviceDisposable = context.getServiceRegistry().register(PLAN_MODE_SERVICE_ID, manager, {
      description: 'Iris Agent-local Plan Mode service',
      version: '0.1.0',
    });
    (context as any).trackDisposable?.(serviceDisposable);

    context.addHook({
      name: 'plan-mode',
      priority: 10_000,
      onBeforeLLMCall({ request }) {
        const sessionId = getActiveSessionId();
        if (!sessionId) return undefined;

        // delegate_to_agent 创建的后台跨 Agent 会话没有前台审批 UI。
        // 为避免目标 Agent 误入 Plan Mode 后卡在无人审批状态，隐藏 Plan Mode 工具。
        if (sessionId.startsWith('cross-agent:')) {
          filterOutPlanTools(request);
          return { request };
        }

        const active = manager.getState(sessionId);
        if (active?.active) {
          const plan = manager.readPlan(sessionId);
          const parts = ensureSystemParts(request);
          parts.push({ text: buildPlanModeInstructions(active, !!plan?.trim()) });

          if (request.tools) {
            request.tools = request.tools.map((tool) => ({
              ...tool,
              functionDeclarations: filterToolDeclarationsForPlanMode(tool.functionDeclarations),
            })).filter((tool) => tool.functionDeclarations.length > 0);
          }
          return { request };
        }

        const reminderState = manager.consumeExitReminder(sessionId);
        if (reminderState) {
          const parts = ensureSystemParts(request);
          parts.push({ text: buildPlanModeExitReminder(reminderState) });
          return { request };
        }

        const parts = ensureSystemParts(request);
        parts.push({ text: buildPlanModeAvailabilityInstructions() });
        return { request };
      },
      onBeforeToolExec({ toolName, args }) {
        const sessionId = getActiveSessionId();
        if (!manager.isActive(sessionId)) return undefined;
        const decision = isAllowedPlanModeTool(toolName, args);
        if (decision.allowed) return undefined;
        return { blocked: true, reason: decision.reason ?? `Plan Mode 下禁止调用 ${toolName}` };
      },
    });
  },
};
