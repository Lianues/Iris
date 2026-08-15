import { describe, expect, it, vi } from 'vitest';
import { installToolWrappers } from '../extensions/remote-exec/src/wrap';

function createRemoteHarness(tool: any, transportOverrides: Record<string, unknown> = {}) {
  const registry = new Map<string, any>([[tool.declaration.name, tool]]);
  const toolsApi = {
    listTools: () => Array.from(registry.keys()),
    get: (name: string) => registry.get(name),
    register: (definition: any) => {
      registry.set(definition.declaration.name, definition);
      return definition;
    },
  };
  const transport = {
    execCommand: vi.fn(async () => ({
      stdout: 'remote-output',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    })),
    ...transportOverrides,
  };
  const installer = installToolWrappers({
    ctx: {} as any,
    api: { tools: toolsApi } as any,
    envMgr: {
      getActive: () => 'build-server',
      getActiveServer: () => ({ workdir: '/remote/work' }),
    } as any,
    getConfig: () => ({
      enabled: true,
      defaultEnvironment: 'build-server',
      exposeSwitchTool: true,
      remoteWorkdir: '/fallback/work',
      ssh: {
        reuseConnection: true,
        connectTimeoutMs: 1000,
        keepAliveSec: 30,
        commandTimeoutMs: 0,
        postExitDrainMs: 200,
      },
    }),
    getTransport: () => transport as any,
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  installer.applyToExistingTools();
  return { installer, tool, transport };
}

describe('remote-exec wrapper security boundary', () => {
  it('runs command preflight before translation and uses normalized arguments', async () => {
    const order: string[] = [];
    const localHandler = vi.fn(async () => ({ local: true }));
    const preflight = vi.fn(async () => {
      order.push('preflight');
      return { allowed: true as const, args: { command: 'normalized-command' } };
    });
    const tool = {
      declaration: { name: 'shell', description: 'test shell' },
      handler: localHandler,
      preflight,
      approvalMode: 'handler' as const,
    };
    const execCommand = vi.fn(async () => {
      order.push('transport');
      return { stdout: 'ok', stderr: '', exitCode: 0, timedOut: false };
    });
    const { installer, transport } = createRemoteHarness(tool, { execCommand });
    try {
      const result = await tool.handler({ command: 'raw-command' }, {}) as Record<string, unknown>;

      expect(order).toEqual(['preflight', 'transport']);
      expect(preflight).toHaveBeenCalledWith({ command: 'raw-command' }, {});
      expect(transport.execCommand).toHaveBeenCalledTimes(1);
      expect(String((transport.execCommand as any).mock.calls[0][1])).toContain('normalized-command');
      expect(String((transport.execCommand as any).mock.calls[0][1])).not.toContain('raw-command');
      expect(result.command).toBe('normalized-command');
      expect(localHandler).not.toHaveBeenCalled();
    } finally {
      installer.dispose();
    }
  });

  it('does not start transport when preflight rejects the command', async () => {
    const rejection = { command: 'blocked', stderr: 'security denied', exitCode: 1, killed: false };
    const tool = {
      declaration: { name: 'bash', description: 'test bash' },
      handler: vi.fn(async () => ({ local: true })),
      preflight: vi.fn(async () => ({ allowed: false as const, result: rejection })),
      approvalMode: 'handler' as const,
    };
    const { installer, transport } = createRemoteHarness(tool);
    try {
      await expect(tool.handler({ command: 'blocked' }, {})).resolves.toBe(rejection);
      expect(tool.preflight).toHaveBeenCalledTimes(1);
      expect(transport.execCommand).not.toHaveBeenCalled();
      expect(tool.handler).not.toBe(tool.preflight);
    } finally {
      installer.dispose();
    }
  });

  it('forceLocalExecution bypasses the alternate transport and calls the original handler', async () => {
    const localHandler = vi.fn(async (_args, context) => ({
      local: true,
      forceLocalExecution: context?.forceLocalExecution,
    }));
    const preflight = vi.fn(async () => ({ allowed: true as const }));
    const tool = {
      declaration: { name: 'shell', description: 'test local override' },
      handler: localHandler,
      preflight,
      approvalMode: 'handler' as const,
    };
    const { installer, transport } = createRemoteHarness(tool);
    try {
      const result = await tool.handler(
        { command: 'echo local' },
        { forceLocalExecution: true },
      ) as Record<string, unknown>;

      expect(result).toEqual({ local: true, forceLocalExecution: true });
      expect(localHandler).toHaveBeenCalledTimes(1);
      expect(preflight).not.toHaveBeenCalled();
      expect(transport.execCommand).not.toHaveBeenCalled();
    } finally {
      installer.dispose();
    }
  });

  it('rejects execute_skill_script explicitly in a remote environment', async () => {
    const localHandler = vi.fn(async () => ({ local: true }));
    const tool = {
      declaration: { name: 'execute_skill_script', description: 'local skill package runner' },
      handler: localHandler,
    };
    const { installer, transport } = createRemoteHarness(tool);
    try {
      await expect(tool.handler({ name: 'demo', relativePath: 'scripts/run.js' }, {}))
        .rejects.toThrow('cannot run in a remote environment');
      expect(localHandler).not.toHaveBeenCalled();
      expect(transport.execCommand).not.toHaveBeenCalled();
    } finally {
      installer.dispose();
    }
  });
});
