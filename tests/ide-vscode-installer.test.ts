import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createCommandInvocation,
  detectVscodeCliCandidates,
  resolveCommandPaths,
  selectBestCandidate,
  type VscodeCliCandidate,
} from '../extensions/ide/src/vscode-installer';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris ide installer '));
  tempDirs.push(dir);
  return dir;
}

function writeFakeCli(dir: string, name: string, version: string): string {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const filepath = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(filepath, `@echo off\r\necho ${version}\r\nexit /b 0\r\n`, 'utf8');
    return filepath;
  }

  const filepath = path.join(dir, name);
  fs.writeFileSync(filepath, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, 'utf8');
  fs.chmodSync(filepath, 0o755);
  return filepath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('VS Code CLI detection', () => {
  it('keeps the real VS Code candidate when a Cursor code shim is first in PATH', async () => {
    const root = createTempDir();
    const cursorBin = path.join(root, 'Cursor', 'resources', 'app', 'codeBin');
    const vscodeBin = path.join(root, 'Microsoft VS Code', 'bin');
    const cursorCommand = writeFakeCli(cursorBin, 'code', 'cursor-version');
    const vscodeCommand = writeFakeCli(vscodeBin, 'code', 'vscode-version');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: [cursorBin, vscodeBin].join(path.delimiter),
      PATHEXT: '.CMD',
    };

    expect(resolveCommandPaths('code', env)).toEqual([
      fs.realpathSync(cursorCommand),
      fs.realpathSync(vscodeCommand),
    ]);

    const detected = await detectVscodeCliCandidates(
      [{ label: 'VS Code', command: 'code' }],
      undefined,
      env,
    );
    expect(detected.map(({ label, version }) => ({ label, version }))).toEqual([
      { label: 'Cursor', version: 'cursor-version' },
      { label: 'VS Code', version: 'vscode-version' },
    ]);

    const vscodeOnly = await detectVscodeCliCandidates(
      [{ label: 'VS Code', command: 'code' }],
      'VS Code',
      env,
    );
    expect(vscodeOnly).toHaveLength(1);
    expect(vscodeOnly[0].label).toBe('VS Code');
    expect(vscodeOnly[0].command).toBe(fs.realpathSync(vscodeCommand));
  });

  it('builds a shell-free invocation for executables and a quoted cmd.exe invocation for scripts', () => {
    const command = process.platform === 'win32'
      ? 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd'
      : '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    const invocation = createCommandInvocation(command, ['--version']);

    if (process.platform === 'win32') {
      expect(invocation.command.toLowerCase()).toContain('cmd');
      expect(invocation.windowsVerbatimArguments).toBe(true);
      expect(invocation.args.at(-1)).toBe(
        '""C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd" "--version""',
      );
    } else {
      expect(invocation).toEqual({ command, args: ['--version'] });
    }
  });
});

describe('VS Code CLI selection', () => {
  const vscode: VscodeCliCandidate = {
    label: 'VS Code',
    command: 'C:\\Programs\\Microsoft VS Code\\bin\\code.cmd',
  };
  const cursor: VscodeCliCandidate = {
    label: 'Cursor',
    command: 'C:\\Programs\\Cursor\\bin\\cursor.cmd',
  };
  const windsurf: VscodeCliCandidate = {
    label: 'Windsurf',
    command: 'C:\\Programs\\Windsurf\\bin\\windsurf.cmd',
  };

  it('prefers VS Code regardless of PATH candidate order', () => {
    expect(selectBestCandidate([cursor, vscode])).toBe(vscode);
  });

  it('does not fall back to Cursor when code was explicitly requested', () => {
    expect(selectBestCandidate([cursor], 'code')).toBeUndefined();
  });

  it('selects the only installed editor family when no target was given', () => {
    expect(selectBestCandidate([cursor])).toBe(cursor);
  });

  it('requires an explicit target when multiple non-default editor families exist', () => {
    expect(selectBestCandidate([cursor, windsurf])).toBeUndefined();
  });
});
