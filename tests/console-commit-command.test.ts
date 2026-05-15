import { describe, expect, it } from 'vitest';
import { buildGitCommitPrompt, isGitPorcelainEmpty } from '../extensions/console/src/commit-command.js';

describe('console /commit command prompt', () => {
  it('判断 git porcelain 输出为空', () => {
    expect(isGitPorcelainEmpty('')).toBe(true);
    expect(isGitPorcelainEmpty('\n  \n')).toBe(true);
    expect(isGitPorcelainEmpty(' M src/index.ts\n')).toBe(false);
  });

  it('生成中文且精简的 commit 指令提示词', () => {
    const prompt = buildGitCommitPrompt({
      statusShort: '## main\n M src/index.ts\n?? tests/new.test.ts',
      recentCommits: 'abc1234 console rendering\ndef5678 add tool previews',
      extraInstruction: '优先使用中文 commit body',
    });

    expect(prompt).toContain('git diff HEAD');
    expect(prompt).toContain('最近提交');
    expect(prompt).toContain('abc1234 console rendering');
    expect(prompt).toContain('参考最近提交风格');
    expect(prompt).toContain('不使用 `git commit --amend`');
    expect(prompt).toContain('不 push');
    expect(prompt).toContain('多行提交信息示例');
    expect(prompt).toContain('powershell');
    expect(prompt).toContain('bash');
    expect(prompt).toContain('git status --short');
    expect(prompt).toContain('优先使用中文 commit body');
    expect(prompt).not.toContain('Git Safety Protocol');
    expect(prompt).not.toContain('Your task');
  });
});
