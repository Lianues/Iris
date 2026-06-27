import { describe, expect, it } from 'vitest';
import {
  summarizeToolCall,
  summarizeToolProgress,
  summarizeToolResult,
} from '../packages/extension-sdk/src';

describe('tool summary formatter', () => {
  it('formats read_file calls and results without raw JSON', () => {
    const call = summarizeToolCall('read_file', {
      files: [{ path: 'src/index.ts', startLine: 1, endLine: 20 }],
    });
    expect(call?.text).toBe('src/index.ts:1-20');

    const result = summarizeToolResult('read_file', {}, {
      results: [{ path: 'src/index.ts', success: true, lineCount: 20, startLine: 1, endLine: 20 }],
      successCount: 1,
      failCount: 0,
      totalCount: 1,
    });
    expect(result?.text).toBe('20 lines | src/index.ts:1-20');
  });

  it('formats shell failures from the first stderr line', () => {
    const result = summarizeToolResult('bash', { command: 'npm test' }, {
      command: 'npm test',
      exitCode: 1,
      killed: false,
      stdout: '',
      stderr: 'AssertionError: expected 1 to equal 2\n    at test.ts:1',
    });

    expect(result?.text).toBe('failed: AssertionError: expected 1 to equal 2');
  });

  it('formats search replace summaries with counts and scope', () => {
    const call = summarizeToolCall('search_in_files', {
      mode: 'replace',
      query: 'needle',
      replace: 'thread',
      include: ['src/**/*', 'tests/**/*'],
    });
    expect(call?.text).toBe('"needle" -> "thread" in src/**/*, tests/**/*');

    const result = summarizeToolResult('search_in_files', {
      query: 'needle',
      replace: 'thread',
    }, {
      mode: 'replace',
      totalReplacements: 7,
      processedFiles: 4,
      results: [
        { file: 'src/a.ts', changed: true },
        { file: 'src/b.ts', changed: false },
        { file: 'tests/a.test.ts', changed: true },
      ],
    });
    expect(result?.text).toBe('7 replacements | 2/4 files | "needle" -> "thread"');
  });

  it('formats generic unknown tools as explicit field summaries', () => {
    const call = summarizeToolCall('custom_tool', {
      path: 'src/a.ts',
      filters: ['one', 'two'],
      options: { recursive: true },
    });

    expect(call?.text).toContain('3 fields');
    expect(call?.text).toContain('path=src/a.ts');
    expect(call?.text).toContain('filters=[2 items]');
    expect(call?.text).not.toContain('{"path"');
  });

  it('formats progress from sub-agent style fields before generic fallback', () => {
    const progress = summarizeToolProgress('sub_agent', {}, {
      streamingText: '正在组织答案',
      tokens: 1200,
    });

    expect(progress?.text).toBe('正在组织答案 | 1,200 tokens');
  });
});
