import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Content, FunctionCallPart, ToolDiffPreviewResponseLike } from 'irises-extension-sdk';
import { sessionContext } from '../src/core/backend/session-context.js';
import { prepareHistoryForLLM } from '../src/core/backend/history.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { buildExecutionPlan, executePlan } from '../src/tools/scheduler.js';
import { applyDiff } from '../src/tools/internal/apply_diff/index.js';
import { writeFile } from '../src/tools/internal/write_file.js';

const cleanupDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-tool-diff-response-'));
  cleanupDirs.push(dir);
  return dir;
}

function fc(name: string, args: Record<string, unknown> = {}, callId?: string): FunctionCallPart {
  return { functionCall: { name, args, callId: callId ?? `call_${name}_${Date.now()}` } };
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('tool response diff preview persistence', () => {
  it('write_file 会把 diffPreview 持久化到 functionResponse 顶层元数据', async () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, 'demo.txt'), 'one\ntwo\nthree\n', 'utf-8');

    const registry = new ToolRegistry();
    registry.register(writeFile);

    const toolState = new ToolStateManager();
    const call = fc('write_file', { path: 'demo.txt', content: 'one\nTWO\nthree\n' });
    const invocation = toolState.create('write_file', call.functionCall.args, 'queued', 's1');
    const plan = buildExecutionPlan([call], registry);

    const responses = await sessionContext.run({ sessionId: 's1', cwd }, () => executePlan(
      [call],
      plan,
      registry,
      toolState,
      [invocation.id],
      { permissions: { write_file: { autoApprove: true, showApprovalView: false } } },
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: 's1', cwd },
    ));

    const response = responses[0].functionResponse;
    const preview = response.diffPreview as ToolDiffPreviewResponseLike | undefined;

    expect(preview).toBeDefined();
    expect(preview?.toolName).toBe('write_file');
    expect(preview?.items).toHaveLength(1);
    expect(preview?.items[0].filePath).toBe('demo.txt');
    expect(preview?.items[0].diff).toContain('-two');
    expect(preview?.items[0].diff).toContain('+TWO');
  });

  it('apply_diff 持久化的统一 diffPreview 会保留 patch 中的不变上下文行', async () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, 'demo.txt'), 'line1\nline2\nline3\n', 'utf-8');

    const registry = new ToolRegistry();
    registry.register(applyDiff);

    const toolState = new ToolStateManager();
    const call = fc('apply_diff', {
      path: 'demo.txt',
      patch: '@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3',
    });
    const invocation = toolState.create('apply_diff', call.functionCall.args, 'queued', 's1');
    const plan = buildExecutionPlan([call], registry);

    const responses = await sessionContext.run({ sessionId: 's1', cwd }, () => executePlan(
      [call],
      plan,
      registry,
      toolState,
      [invocation.id],
      { permissions: { apply_diff: { autoApprove: true, showApprovalView: false } } },
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: 's1', cwd },
    ));

    const preview = responses[0].functionResponse.diffPreview as ToolDiffPreviewResponseLike | undefined;

    expect(preview).toBeDefined();
    expect(preview?.toolName).toBe('apply_diff');
    expect(preview?.items[0].diff).toContain(' line1');
    expect(preview?.items[0].diff).toContain('-line2');
    expect(preview?.items[0].diff).toContain('+LINE2');
    expect(preview?.items[0].diff).toContain(' line3');
  });

  it('prepareHistoryForLLM 会剥离 functionResponse.diffPreview，不发送给模型', () => {
    const diffPreview: ToolDiffPreviewResponseLike = {
      toolName: 'write_file',
      title: 'Diff 审批',
      toolLabel: 'write_file',
      summary: [],
      items: [{
        filePath: 'demo.txt',
        label: 'demo.txt · 修改',
        diff: '@@ -1,1 +1,1 @@\n-old\n+new',
        added: 1,
        removed: 1,
      }],
    };

    const history: Content[] = [{
      role: 'user',
      parts: [{
        functionResponse: {
          name: 'write_file',
          response: { result: { path: 'demo.txt', success: true, action: 'modified' } },
          callId: 'call_1',
          durationMs: 12,
          diffPreview,
        },
      }],
    }];

    const prepared = prepareHistoryForLLM(history);
    const preparedPart = prepared[0].parts[0] as any;

    expect(preparedPart.functionResponse.response).toEqual({ result: { path: 'demo.txt', success: true, action: 'modified' } });
    expect(preparedPart.functionResponse.callId).toBe('call_1');
    expect(preparedPart.functionResponse.durationMs).toBeUndefined();
    expect(preparedPart.functionResponse.diffPreview).toBeUndefined();
  });
});
