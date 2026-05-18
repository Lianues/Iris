import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { tryExtensionCommand } from '../src/extension/cli-dispatch.js';
import { workspaceExtensionsDir } from '../src/paths.js';

const createdDirs: string[] = [];
const RESULT_KEY = '__irisExtensionCliDispatchTestResult';

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete (globalThis as Record<string, unknown>)[RESULT_KEY];
});

describe('extension CLI dispatch', () => {
  it('可加载 manifest.commands 声明的本地 extension 命令', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const extensionName = `vitest-cli-extension-${suffix}`;
    const commandName = `vitest_cli_${suffix}`;
    const rootDir = path.join(workspaceExtensionsDir, extensionName);
    fs.mkdirSync(rootDir, { recursive: true });
    createdDirs.push(rootDir);

    fs.writeFileSync(
      path.join(rootDir, 'manifest.json'),
      JSON.stringify({
        name: extensionName,
        version: '0.1.0',
        commands: {
          [commandName]: {
            entry: 'command.mjs',
            export: 'runCommand',
          },
        },
      }, null, 2),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(rootDir, 'command.mjs'),
      `export async function runCommand(args) {\n  globalThis[${JSON.stringify(RESULT_KEY)}] = args;\n}\n`,
      'utf-8',
    );

    const handled = await tryExtensionCommand(commandName, ['--flag', 'value']);

    expect(handled).toBe(true);
    expect((globalThis as Record<string, unknown>)[RESULT_KEY]).toEqual(['--flag', 'value']);
  });
});