import { describe, expect, it } from 'vitest';
import {
  buildNonInteractiveEnv,
  detectInteractiveFailure,
  formatInteractiveFailureHint,
} from '../src/tools/internal/non-interactive-command';

describe('non-interactive command helpers', () => {
  it('构造后台非交互环境，但不设置 CI=1 以避免改变构建/测试语义', () => {
    const env = buildNonInteractiveEnv({ PATH: '/bin' }, 'bash');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GCM_INTERACTIVE).toBe('never');
    expect(env.PAGER).toBe('cat');
    expect(env.GIT_PAGER).toBe('cat');
    expect(env.TERM).toBe('dumb');
    expect(env.CI).toBeUndefined();
  });

  it('保留已有 TERM，不强行覆盖用户终端设置', () => {
    const env = buildNonInteractiveEnv({ TERM: 'xterm-256color' }, 'bash');
    expect(env.TERM).toBe('xterm-256color');
  });

  it('识别 /dev/tty / TTY 类失败', () => {
    const hint = detectInteractiveFailure({
      command: 'ssh user@example.com',
      exitCode: 255,
      stderr: "read_passphrase: can't open /dev/tty: No such device or address",
    });
    expect(hint?.reason).toContain('终端');
  });

  it('识别 Git/凭据提示被禁用的失败', () => {
    const hint = detectInteractiveFailure({
      command: 'git fetch',
      exitCode: 128,
      stderr: 'fatal: could not read Username for https://example.com: terminal prompts disabled',
    });
    expect(hint?.reason).toContain('凭据');
  });

  it('识别超时且输出尾部停在密码提示', () => {
    const hint = detectInteractiveFailure({
      command: 'ssh user@example.com',
      exitCode: 1,
      killed: true,
      stdout: 'user@example.com password: ',
    });
    expect(hint?.reason).toContain('密码');
  });

  it('成功命令即使包含类似提示文本也不误判', () => {
    const hint = detectInteractiveFailure({
      command: 'node -e "console.log(\'password:\')"',
      exitCode: 0,
      stdout: 'password:',
    });
    expect(hint).toBeNull();
  });

  it('普通失败不误判为交互失败', () => {
    const hint = detectInteractiveFailure({
      command: 'npm test',
      exitCode: 1,
      stderr: 'AssertionError: expected 1 to equal 2',
    });
    expect(hint).toBeNull();
  });

  it('格式化提示只建议外部终端，不提扩展或 terminal-use', () => {
    const text = formatInteractiveFailureHint({ reason: '命令需要 TTY', matched: 'not a tty' });
    expect(text).toContain('如果确实需要人工交互，请用户在外部终端执行');
    expect(text).not.toMatch(/terminal-use|扩展|专门/i);
  });
});
