import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend';
import { ToolRegistry } from '../src/tools/registry';
import { ToolStateManager } from '../src/tools/state';
import { PromptAssembler } from '../src/prompt/assembler';
import { createInvokeSkillTool } from '../src/tools/internal/invoke_skill';
import { createReadSkillResourceTool } from '../src/tools/internal/read_skill_resource';
import { buildSkillResourceManifest, canonicalizeSkillRoot } from '../src/config/skill-resource-manifest';
import { agentContext } from '../src/logger';
import { planModePlugin } from '../src/plan-mode/plugin';
import type { PlanModeManager } from '../src/plan-mode/manager';
import { clearSessionCwd, initSessionCwd } from '../src/core/backend/session-context';
import type { Content, LLMRequest } from '../src/types';
import type { SkillDefinition } from '../src/config/types';

function createStorage() {
  const histories = new Map<string, Content[]>();
  return {
    getHistory: vi.fn(async (sessionId: string) => histories.get(sessionId) ?? []),
    addMessage: vi.fn(async (sessionId: string, content: Content) => {
      const history = histories.get(sessionId) ?? [];
      history.push(content);
      histories.set(sessionId, history);
    }),
    updateLastMessage: vi.fn(async () => undefined),
    truncateHistory: vi.fn(async () => undefined),
    clearHistory: vi.fn(async (sessionId: string) => { histories.delete(sessionId); }),
    getMeta: vi.fn(async () => undefined),
    updateMeta: vi.fn(async () => undefined),
    listSessionMetas: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
  };
}

function getRequestToolNames(request: LLMRequest): string[] {
  return request.tools?.flatMap(tool => tool.functionDeclarations.map(declaration => declaration.name)) ?? [];
}

describe('Backend direct Skill slash invocation', () => {
  it('expands /skill args before the first LLM call and permits user-only Skills', async () => {
    const requests: LLMRequest[] = [];
    const models: Array<string | undefined> = [];
    const router = {
      chat: vi.fn(async (request: LLMRequest, modelName?: string) => {
        requests.push(request);
        models.push(modelName);
        return {
          content: { role: 'model' as const, parts: [{ text: 'done' }] },
          usageMetadata: { totalTokenCount: 20 },
        };
      }),
      getCurrentModelName: vi.fn(() => 'default-model'),
      listModels: vi.fn(() => [{ modelName: 'skill-model' }]),
    } as any;
    const tools = new ToolRegistry();
    tools.register({
      declaration: { name: 'shell', description: 'disabled command tool' },
      handler: async () => ({ stdout: '', stderr: '', exitCode: 0, killed: false }),
    });
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test');
    const skill: SkillDefinition = {
      name: 'hidden-review',
      description: 'user-only review',
      content: 'Review target: $ARGUMENTS',
      path: 'inline:hidden-review',
      dialect: 'claude-code',
      userInvocable: true,
      disableModelInvocation: true,
      model: 'skill-model',
      contextModifier: { modelOverride: 'skill-model' },
    };
    const backend = new Backend(router, createStorage() as any, tools, new ToolStateManager(), prompt, {
      stream: false,
      maxToolRounds: 3,
      toolsConfig: { permissions: {}, disabledTools: ['shell'] },
      skills: [skill],
    });
    backend.on('error', () => undefined);
    const invokeSkill = createInvokeSkillTool({
      getBackend: () => backend,
      getRouter: () => router,
      tools,
      getToolsConfig: () => backend.getToolsConfig(),
    });
    let directInvocationContext: Record<string, unknown> | undefined;
    const originalHandler = invokeSkill.handler;
    invokeSkill.handler = async (args, context) => {
      directInvocationContext = context as unknown as Record<string, unknown>;
      return originalHandler(args, context);
    };
    tools.register(invokeSkill);

    await backend.chat('slash-session', '/hidden-review src/main.ts');

    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain('Review target: src/main.ts');
    expect(JSON.stringify(requests[0])).toContain('Resource base for this skill: skill://hidden-review/');
    expect(models).toEqual(['skill-model']);
    expect(backend.isSkillModelAccessible('hidden-review', 'slash-session')).toBe(true);
    expect(backend.isSkillModelAccessible('hidden-review', 'other-session')).toBe(false);
    expect(directInvocationContext?.directUserSkillInvocation).toBe(true);
    expect(directInvocationContext?.availableToolNames).not.toContain('shell');
  });

  it('lets an explicitly invoked user-only fork Skill read guarded resources in the same session', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-hidden-fork-'));
    try {
      const references = path.join(tmp, 'references');
      fs.mkdirSync(references, { recursive: true });
      fs.writeFileSync(path.join(tmp, 'SKILL.md'), 'Use references/guide.md', 'utf8');
      fs.writeFileSync(path.join(references, 'guide.md'), 'fork resource content', 'utf8');
      const canonicalBasePath = canonicalizeSkillRoot(tmp);
      const skill: SkillDefinition = {
        name: 'hidden-fork',
        description: 'user-only fork',
        content: 'Read references/guide.md and report it.',
        path: path.join(tmp, 'SKILL.md'),
        dialect: 'claude-code',
        mode: 'fork',
        userInvocable: true,
        disableModelInvocation: true,
        contextModifier: { autoApproveTools: ['read_skill_resource'] },
        canonicalBasePath,
        skillUri: 'skill://hidden-fork/',
        resources: buildSkillResourceManifest('hidden-fork', canonicalBasePath, 'references/guide.md'),
      };

      const requests: LLMRequest[] = [];
      const requestSignals: Array<AbortSignal | undefined> = [];
      const requestAgentContexts: Array<string | undefined> = [];
      const beforeLLMContexts: Array<string | undefined> = [];
      const beforeToolContexts: Array<[string, string | undefined]> = [];
      const afterToolContexts: Array<[string, string | undefined]> = [];
      let call = 0;
      const router = {
        chat: vi.fn(async (request: LLMRequest, _modelName?: string, signal?: AbortSignal) => {
          requests.push(request);
          requestSignals.push(signal);
          requestAgentContexts.push(agentContext.getStore());
          call++;
          if (call === 1) {
            return {
              content: {
                role: 'model' as const,
                parts: [{
                  functionCall: {
                    name: 'read_skill_resource',
                    args: { name: 'hidden-fork', relativePath: 'references/guide.md' },
                    callId: 'resource-1',
                  },
                }],
              },
            };
          }
          if (call === 2) {
            expect(JSON.stringify(request)).toContain('fork resource content');
            return { content: { role: 'model' as const, parts: [{ text: 'fork-complete' }] } };
          }
          return { content: { role: 'model' as const, parts: [{ text: 'main-complete' }] } };
        }),
        getCurrentModelName: vi.fn(() => 'default-model'),
        listModels: vi.fn(() => []),
      } as any;
      const tools = new ToolRegistry();
      const forbiddenForkTools = [
        'sub_agent',
        'EnterPlanMode',
        'write_plan',
        'AskQuestionFirst',
        'memory_add',
        'manage_scheduled_tasks',
        'delegate_to_agent',
        'query_delegated_task',
      ];
      for (const name of forbiddenForkTools) {
        tools.register({
          declaration: { name, description: `forbidden fork tool ${name}` },
          handler: async () => ({ unexpected: true }),
        });
      }
      const prompt = new PromptAssembler();
      prompt.setSystemPrompt('test');
      const backend = new Backend(router, createStorage() as any, tools, new ToolStateManager(), prompt, {
        stream: false,
        maxToolRounds: 4,
        toolsConfig: { permissions: { read_skill_resource: { autoApprove: false } } },
        skills: [skill],
      });
      backend.on('error', () => undefined);
      backend.setPluginHooks([{
        name: 'skill-fork-lifecycle-probe',
        onBeforeLLMCall() {
          beforeLLMContexts.push(agentContext.getStore());
          return undefined;
        },
        onBeforeToolExec({ toolName }) {
          beforeToolContexts.push([toolName, agentContext.getStore()]);
          return undefined;
        },
        onAfterToolExec({ toolName }) {
          afterToolContexts.push([toolName, agentContext.getStore()]);
          return undefined;
        },
      } as any]);
      tools.register(createReadSkillResourceTool({ getBackend: () => backend }));
      const invokeSkill = createInvokeSkillTool({
        getBackend: () => backend,
        getRouter: () => router,
        tools,
        getToolsConfig: () => backend.getToolsConfig(),
        runFork: request => backend.runSkillFork(request),
      });
      let forkParentSignal: AbortSignal | undefined;
      const invokeSkillHandler = invokeSkill.handler;
      invokeSkill.handler = async (args, context) => {
        forkParentSignal = context?.signal;
        return invokeSkillHandler(args, context);
      };
      tools.register(invokeSkill);

      await backend.chat('fork-session', '/hidden-fork');

      expect(requests).toHaveLength(3);
      expect(backend.isSkillModelAccessible('hidden-fork', 'fork-session')).toBe(true);
      expect(requestAgentContexts).toEqual([
        'skill-fork:hidden-fork',
        'skill-fork:hidden-fork',
        'main',
      ]);
      expect(beforeLLMContexts).toEqual(requestAgentContexts);
      expect(requestSignals[0]).toBeDefined();
      expect(requestSignals[0]).toBe(forkParentSignal);
      expect(requestSignals[1]).toBe(requestSignals[0]);
      expect(beforeToolContexts).toContainEqual(['read_skill_resource', 'skill-fork:hidden-fork']);
      expect(afterToolContexts).toContainEqual(['read_skill_resource', 'skill-fork:hidden-fork']);
      for (const request of requests.slice(0, 2)) {
        const names = getRequestToolNames(request);
        expect(names).toContain('read_skill_resource');
        for (const forbidden of forbiddenForkTools) expect(names).not.toContain(forbidden);
        expect(names).not.toContain('invoke_skill');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('routes a direct /skill through the Plan Mode before-tool guard', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-plan-skill-slash-'));
    const sessionId = `plan-skill-${Date.now()}`;
    initSessionCwd(sessionId, tmp);
    try {
      let manager: PlanModeManager | undefined;
      const hooks: any[] = [];
      planModePlugin.activate({
        registerTools() {},
        getServiceRegistry() {
          return {
            register(_id: string, value: PlanModeManager) {
              manager = value;
              return { dispose() {} };
            },
          };
        },
        addHook(hook: unknown) { hooks.push(hook); },
        trackDisposable() {},
        onReady() {},
      } as any);
      expect(manager).toBeDefined();
      manager!.enter(sessionId, 'manual');

      const router = {
        chat: vi.fn(async () => ({
          content: { role: 'model' as const, parts: [{ text: 'must-not-run' }] },
        })),
        getCurrentModelName: vi.fn(() => 'default-model'),
        listModels: vi.fn(() => []),
      } as any;
      const tools = new ToolRegistry();
      const prompt = new PromptAssembler();
      prompt.setSystemPrompt('test');
      const skill: SkillDefinition = {
        name: 'blocked-in-plan',
        description: 'must be guarded',
        content: 'Do a write operation.',
        path: 'inline:blocked-in-plan',
        userInvocable: true,
        disableModelInvocation: true,
      };
      const backend = new Backend(router, createStorage() as any, tools, new ToolStateManager(), prompt, {
        dataDir: tmp,
        stream: false,
        maxToolRounds: 2,
        toolsConfig: { permissions: {} },
        skills: [skill],
        isPlanModeActive: sid => manager!.isActive(sid),
      });
      const errors: string[] = [];
      backend.on('error', (_sid, error) => errors.push(error));
      backend.setPluginHooks(hooks);
      tools.register(createInvokeSkillTool({
        getBackend: () => backend,
        getRouter: () => router,
        tools,
        getToolsConfig: () => backend.getToolsConfig(),
        runFork: request => backend.runSkillFork(request),
      }));

      await backend.chat(sessionId, '/blocked-in-plan');

      expect(router.chat).not.toHaveBeenCalled();
      expect(errors.join('\n')).toMatch(/Plan Mode|禁止/);
      expect(backend.isSkillModelAccessible('blocked-in-plan', sessionId)).toBe(false);
    } finally {
      clearSessionCwd(sessionId);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
