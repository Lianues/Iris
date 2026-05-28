import type { IrisPlugin, LLMRequest, ToolDefinition } from 'irises-extension-sdk';
import { agentContext, createLogger } from '../logger';
import { getActiveSessionId } from '../core/backend/session-context';
import { NoteManager } from './manager';
import { buildNoteSystemPrompt } from './prompts';
import { NOTE_SERVICE_ID, type NoteUpdateApprovalProgress } from './types';

const logger = createLogger('Note');
const WRITE_NOTE_TOOL_NAMES = new Set(['propose_update_note']);

function ensureSystemParts(request: LLMRequest) {
  if (!request.systemInstruction) request.systemInstruction = { parts: [] };
  if (!Array.isArray(request.systemInstruction.parts)) request.systemInstruction.parts = [];
  return request.systemInstruction.parts;
}

function filterOutWriteNoteTools(request: LLMRequest): void {
  if (!request.tools) return;
  request.tools = request.tools.map((tool) => ({
    ...tool,
    functionDeclarations: tool.functionDeclarations.filter((decl) => !WRITE_NOTE_TOOL_NAMES.has(decl.name)),
  })).filter((tool) => tool.functionDeclarations.length > 0);
}

function isBackgroundOrSubAgentSession(sessionId: string | undefined): boolean {
  if (sessionId?.startsWith('cross-agent:')) return true;
  const currentAgentContext = agentContext.getStore();
  return !!currentAgentContext && currentAgentContext !== 'main';
}

function createReadNoteTool(manager: NoteManager): ToolDefinition {
  return {
    approvalMode: 'handler',
    declaration: {
      name: 'read_note',
      description: '读取当前 Agent 的 /note 长期备注。/note 是用户显式维护的 Agent-local standing instruction。',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => {
      const state = manager.getState();
      return {
        note: state.content,
        empty: !state.content.trim(),
        noteFilePath: state.noteFilePath,
        updatedAt: state.updatedAt,
        updatedBy: state.updatedBy,
      };
    },
  } as ToolDefinition;
}

function createProposeUpdateNoteTool(manager: NoteManager): ToolDefinition {
  return {
    approvalMode: 'handler',
    declaration: {
      name: 'propose_update_note',
      description: '请求用户批准后更新当前 Agent 的 /note 长期备注。模型不能静默修改 note；必须说明原因并等待用户审批。Plan Mode/后台任务中不要调用。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '拟写入的新 note 内容。mode=clear 时可为空。' },
          reason: { type: 'string', description: '为什么需要修改 note，展示给用户审批。' },
          mode: { type: 'string', enum: ['replace', 'clear'], description: 'replace=替换为 content；clear=清空 note。默认 replace。' },
        },
        required: ['content', 'reason'],
      },
    },
    handler: async (args, context) => {
      const sessionId = getActiveSessionId() ?? context?.sessionId;
      if (isBackgroundOrSubAgentSession(sessionId)) {
        return {
          approved: false,
          message: '当前为后台/子代理执行上下文，不能请求交互式 /note 修改审批。请在前台主会话中让用户使用 /note 修改。',
        };
      }

      const mode = args.mode === 'clear' ? 'clear' : 'replace';
      const content = mode === 'clear' ? '' : (typeof args.content === 'string' ? args.content : '');
      const reason = typeof args.reason === 'string' && args.reason.trim()
        ? args.reason.trim()
        : '模型请求更新 /note。';

      const current = manager.getState();
      const progress: NoteUpdateApprovalProgress = {
        kind: 'note_update_approval',
        currentNote: current.content,
        proposedNote: content,
        reason,
        mode,
        noteFilePath: current.noteFilePath,
      };
      context?.reportProgress?.(progress as unknown as Record<string, unknown>);

      const requestApproval = context?.requestApproval;
      if (!requestApproval) {
        return {
          approved: false,
          noteFilePath: current.noteFilePath,
          message: '当前执行上下文不支持交互式 /note 修改审批。请在 Console/Web 前台会话中批准，或让用户使用 /note 命令手动修改。',
        };
      }

      const approved = await requestApproval();
      if (!approved) {
        return {
          approved: false,
          noteFilePath: current.noteFilePath,
          message: '用户拒绝了 /note 修改请求。当前 note 未改变。',
        };
      }

      const next = mode === 'clear'
        ? manager.clearNote({ updatedBy: 'model-approved' })
        : manager.setNote(content, { updatedBy: 'model-approved' });

      return {
        approved: true,
        note: next.content,
        empty: !next.content.trim(),
        noteFilePath: next.noteFilePath,
        updatedAt: next.updatedAt,
        message: mode === 'clear' ? '用户已批准清空 /note。' : '用户已批准更新 /note。',
      };
    },
  } as ToolDefinition;
}

export const notePlugin: IrisPlugin = {
  name: 'note',
  version: '0.1.0',
  description: 'Agent-local /note standing instruction for Iris',
  activate(context) {
    const manager = new NoteManager(context.getDataDir());

    context.registerTools([
      createReadNoteTool(manager),
      createProposeUpdateNoteTool(manager),
    ]);

    const serviceDisposable = context.getServiceRegistry().register(NOTE_SERVICE_ID, manager, {
      description: 'Iris Agent-local note service',
      version: '0.1.0',
    });
    (context as any).trackDisposable?.(serviceDisposable);

    context.addHook({
      name: 'note',
      // 高于 Plan Mode hook（10000），使 note 先注入，Plan Mode 指令最后追加。
      priority: 11_000,
      onBeforeLLMCall({ request }) {
        const sessionId = getActiveSessionId();
        if (isBackgroundOrSubAgentSession(sessionId)) {
          filterOutWriteNoteTools(request);
        }

        const note = manager.getNote().trim();
        if (!note) return { request };

        const parts = ensureSystemParts(request);
        parts.push({ text: buildNoteSystemPrompt(note), cacheBehavior: 'dynamic' } as any);
        return { request };
      },
      onBeforeToolExec({ toolName }) {
        if (!WRITE_NOTE_TOOL_NAMES.has(toolName)) return undefined;
        const sessionId = getActiveSessionId();
        if (!isBackgroundOrSubAgentSession(sessionId)) return undefined;
        return {
          blocked: true,
          reason: '后台/子代理执行上下文不能修改 /note；请在前台主会话中请求用户审批或使用 /note 命令。',
        };
      },
    });

    logger.info(`Note service initialized: ${manager.getNoteFilePath()}`);
  },
};
