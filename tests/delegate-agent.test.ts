import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createDelegateToAgentTool } from '../src/tools/internal/delegate-agent/index.js';
import { CrossAgentTaskBoard } from '../src/core/cross-agent-task-board.js';
import { ToolRegistry } from '../src/tools/registry.js';

function createNetworkState(initialPeers: string[]) {
  let peers = [...initialPeers];
  const descriptions = new Map<string, string>();

  return {
    setPeers(next: string[]) {
      peers = [...next];
    },
    setDescription(name: string, description: string) {
      descriptions.set(name, description);
    },
    network: {
      selfName: 'master',
      listPeers: vi.fn(() => [...peers]),
      getPeerDescription: vi.fn((name: string) => descriptions.get(name)),
      getPeerBackend: vi.fn(() => undefined),
    },
  };
}

describe('delegate_to_agent 工具', () => {
  it('工具描述动态读取当前 peer Agent 列表，避免创建时快照过期', () => {
    const state = createNetworkState(['coder']);
    state.setDescription('coder', '编码助手');
    state.setDescription('reviewer', '审查助手');

    const tool = createDelegateToAgentTool({
      agentNetwork: state.network as any,
      taskBoard: new CrossAgentTaskBoard(),
      getSessionId: () => 'session-1',
    });

    expect(tool.declaration.description).toContain('coder: 编码助手');
    expect(tool.declaration.description).not.toContain('reviewer: 审查助手');

    state.setPeers(['reviewer']);

    expect(tool.declaration.description).toContain('reviewer: 审查助手');
    expect(tool.declaration.description).not.toContain('coder: 编码助手');
  });

  it('目标 Agent 不存在时错误提示使用最新 peer 列表', async () => {
    const state = createNetworkState(['coder']);
    const tool = createDelegateToAgentTool({
      agentNetwork: state.network as any,
      taskBoard: new CrossAgentTaskBoard(),
      getSessionId: () => 'session-1',
    });

    state.setPeers(['reviewer']);

    const result = await tool.handler({ agent: 'missing', prompt: '执行任务' }) as any;

    expect(result.error).toContain('目标 Agent "missing" 不存在');
    expect(result.error).toContain('reviewer');
    expect(result.error).not.toContain('coder');
  });

  it('通过 ToolRegistry.getDeclarations 获取并序列化声明时仍使用最新 peer 列表', () => {
    const state = createNetworkState(['coder']);
    state.setDescription('coder', '编码助手');
    state.setDescription('reviewer', '审查助手');

    const registry = new ToolRegistry();
    registry.register(createDelegateToAgentTool({
      agentNetwork: state.network as any,
      taskBoard: new CrossAgentTaskBoard(),
      getSessionId: () => 'session-1',
    }));

    const firstPayload = JSON.parse(JSON.stringify(registry.getDeclarations()));
    expect(firstPayload[0].description).toContain('coder: 编码助手');
    expect(firstPayload[0].description).not.toContain('reviewer: 审查助手');

    state.setPeers(['reviewer']);

    const secondPayload = JSON.parse(JSON.stringify(registry.getDeclarations()));
    expect(secondPayload[0].description).toContain('reviewer: 审查助手');
    expect(secondPayload[0].description).not.toContain('coder: 编码助手');
  });

  it('中止委派任务时会同步中止目标 Agent 的会话', async () => {
    const board = new CrossAgentTaskBoard();
    const targetBackend = Object.assign(new EventEmitter(), {
      chat: vi.fn(() => new Promise(() => {})),
      abortChat: vi.fn(),
      isStreamEnabled: vi.fn(() => false),
      clearSession: vi.fn(async () => {}),
      switchModel: vi.fn(() => ({ modelName: 'mock', modelId: 'mock' })),
      listModels: vi.fn(() => []),
      listSessionMetas: vi.fn(async () => []),
    });
    const state = createNetworkState(['worker']);
    state.network.getPeerBackend = vi.fn(() => targetBackend as any);

    const tool = createDelegateToAgentTool({
      agentNetwork: state.network as any,
      taskBoard: board,
      getSessionId: () => 'source-session',
    });

    const result = await tool.handler({ agent: 'worker', prompt: '执行长时间任务' }) as any;
    expect(result.status).toBe('dispatched');

    // runDelegatedTask 是 fire-and-forget；让它完成监听器注册和 chat 启动。
    await Promise.resolve();

    board.kill(result.taskId);

    expect(targetBackend.abortChat).toHaveBeenCalledWith(`cross-agent:master:${result.taskId}`);
    expect(board.get(result.taskId)?.status).toBe('killed');
  });
});
