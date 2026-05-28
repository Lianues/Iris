import { describe, expect, it } from 'vitest';
import { formatRunCommandFailureMessage } from '../src/core/backend/backend.js';

describe('Backend.runCommand failure formatting', () => {
  it('将 spawnSync 超时解释为超时而不是 exit code null', () => {
    const error = Object.assign(new Error('spawnSync cmd ETIMEDOUT'), { code: 'ETIMEDOUT' });

    const message = formatRunCommandFailureMessage({
      status: null,
      signal: 'SIGTERM',
      error,
    } as any, 30000);

    expect(message).toContain('命令执行超时');
    expect(message).toContain('30000ms');
    expect(message).toContain('SIGTERM');
    expect(message).not.toContain('exit code: null');
  });

  it('status 为 null 且只有 signal 时展示 signal', () => {
    const message = formatRunCommandFailureMessage({
      status: null,
      signal: 'SIGTERM',
      error: undefined,
    } as any);

    expect(message).toBe('命令被信号终止: SIGTERM');
    expect(message).not.toContain('exit code: null');
  });
});
