import { describe, expect, it } from 'vitest';
import {
  buildCallmeTrailer,
  maybeAddCallmeTrailerToGitCommit,
  normalizeCallmeAttributionConfig,
} from '../src/git/callme';

const enabled = normalizeCallmeAttributionConfig(true);

describe('/callme git commit attribution', () => {
  it('defaults to disabled', () => {
    const config = normalizeCallmeAttributionConfig(undefined);
    expect(config.enabled).toBe(false);
    expect(maybeAddCallmeTrailerToGitCommit('git commit -m "init"', 'bash', config)).toBe('git commit -m "init"');
  });

  it('builds the standard Iris link attribution line', () => {
    expect(buildCallmeTrailer()).toBe('Co-authored with Iris: https://github.com/Lianues/Iris');
  });

  it('appends the Iris link as the final commit message paragraph', () => {
    expect(maybeAddCallmeTrailerToGitCommit('git commit -m "init"', 'bash', enabled))
      .toBe('git commit -m "init" -m \'Co-authored with Iris: https://github.com/Lianues/Iris\'');
  });

  it('supports git global options before commit', () => {
    expect(maybeAddCallmeTrailerToGitCommit('git -C packages/app -c user.name=bot commit -m "init"', 'bash', enabled))
      .toBe('git -C packages/app -c user.name=bot commit -m "init" -m \'Co-authored with Iris: https://github.com/Lianues/Iris\'');
  });

  it('does not append -m to file-based commit messages', () => {
    const command = 'git commit -F .git/IRIS_COMMIT_MESSAGE';
    expect(maybeAddCallmeTrailerToGitCommit(command, 'powershell', enabled)).toBe(command);
  });

  it('still rewrites later git commit segments when one segment uses -F', () => {
    const command = 'git commit -F msg.txt && git commit -m "followup"';
    expect(maybeAddCallmeTrailerToGitCommit(command, 'bash', enabled))
      .toBe('git commit -F msg.txt && git commit -m "followup" -m \'Co-authored with Iris: https://github.com/Lianues/Iris\'');
  });

  it('does not duplicate an explicit co-author attribution', () => {
    const command = 'git commit -m "init\n\nCo-authored-by: Alice <alice@example.com>"';
    expect(maybeAddCallmeTrailerToGitCommit(command, 'bash', enabled)).toBe(command);
  });

  it('does not rewrite quoted text or non-git command segments', () => {
    const command = 'echo "git commit -m hi" && git status';
    expect(maybeAddCallmeTrailerToGitCommit(command, 'bash', enabled)).toBe(command);
  });

  it('does not rewrite git help commands', () => {
    const command = 'git --help commit';
    expect(maybeAddCallmeTrailerToGitCommit(command, 'bash', enabled)).toBe(command);
  });

  it('accepts legacy object-shaped switch values', () => {
    const config = normalizeCallmeAttributionConfig({ enabled: true });
    expect(maybeAddCallmeTrailerToGitCommit('git commit -m "init"', 'powershell', config))
      .toBe("git commit -m \"init\" -m 'Co-authored with Iris: https://github.com/Lianues/Iris'");
  });

  it('uses cmd-safe double quoting for /sh on Windows', () => {
    const config = normalizeCallmeAttributionConfig({
      enabled: true,
    });
    expect(maybeAddCallmeTrailerToGitCommit('git commit -m "init"', 'cmd', config))
      .toBe('git commit -m "init" -m "Co-authored with Iris: https://github.com/Lianues/Iris"');
  });
});
