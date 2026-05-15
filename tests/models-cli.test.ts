import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYAML } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { isModelsCliSubcommand, runModelsCli } from '../src/models-cli';

const createdDirs: string[] = [];

function createTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-models-cli-'));
  createdDirs.push(dir);
  return dir;
}

function readYaml(filePath: string): any {
  return parseYAML(fs.readFileSync(filePath, 'utf-8'));
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('iris models CLI', () => {
  it('detects models CLI subcommands while leaving bare iris models for TUI', () => {
    expect(isModelsCliSubcommand('list')).toBe(true);
    expect(isModelsCliSubcommand('add')).toBe(true);
    expect(isModelsCliSubcommand(undefined)).toBe(false);
  });

  it('adds an OpenAI-compatible model and marks it default', async () => {
    const dataDir = createTempDataDir();

    const result = await runModelsCli([
      'add',
      'kimi',
      '--provider', 'openai-compatible',
      '--model', 'kimi-k2',
      '--api-key', 'sk-xxx',
      '--base-url', 'https://api.moonshot.cn/v1',
      '--context-window', '128000',
      '--supports-vision', 'true',
      '--default',
    ], { dataDir });

    expect(result.ok).toBe(true);
    const llm = readYaml(path.join(dataDir, 'configs', 'llm.yaml'));
    expect(llm.defaultModel).toBe('kimi');
    expect(llm.models.kimi).toMatchObject({
      provider: 'openai-compatible',
      model: 'kimi-k2',
      apiKey: 'sk-xxx',
      baseUrl: 'https://api.moonshot.cn/v1',
      contextWindow: 128000,
      supportsVision: true,
    });
  });

  it('lists, gets, sets default, and removes models', async () => {
    const dataDir = createTempDataDir();
    await runModelsCli(['add', 'a', '-p', 'gemini', '-m', 'gemini-2.5-flash', '-d'], { dataDir });
    await runModelsCli(['add', 'b', '-p', 'claude', '-m', 'claude-sonnet-4-6', '-k', 'sk-ant-xxx'], { dataDir });

    const list = await runModelsCli(['list'], { dataDir });
    expect(list.ok).toBe(true);
    expect(list.message).toContain('* a: gemini');
    expect(list.message).toContain('  b: claude');

    const get = await runModelsCli(['get', 'b'], { dataDir });
    expect(get.ok).toBe(true);
    expect(get.message).toContain('apiKey: ****-xxx');

    const setDefault = await runModelsCli(['default', 'b'], { dataDir });
    expect(setDefault.ok).toBe(true);
    expect(readYaml(path.join(dataDir, 'configs', 'llm.yaml')).defaultModel).toBe('b');

    const removed = await runModelsCli(['remove', 'b'], { dataDir });
    expect(removed.ok).toBe(true);
    const llm = readYaml(path.join(dataDir, 'configs', 'llm.yaml'));
    expect(llm.models.b).toBeUndefined();
    expect(llm.defaultModel).toBe('a');
  });

  it('writes agent-scoped overrides and can hide inherited global models', async () => {
    const dataDir = createTempDataDir();
    fs.mkdirSync(path.join(dataDir, 'configs'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'configs', 'llm.yaml'), [
      'defaultModel: global_model',
      'models:',
      '  global_model:',
      '    provider: gemini',
      '    model: gemini-2.5-flash',
      '    apiKey: global-key',
      '    baseUrl: https://generativelanguage.googleapis.com/v1beta',
    ].join('\n'), 'utf-8');

    const customAgentDir = path.join(dataDir, 'custom-agent-data');
    fs.writeFileSync(path.join(dataDir, 'agents.yaml'), [
      'agents:',
      '  worker:',
      `    dataDir: ${JSON.stringify(customAgentDir)}`,
    ].join('\n'), 'utf-8');

    const add = await runModelsCli(['add', '--agent', 'worker', 'agent_model', '-p', 'claude', '-m', 'claude-sonnet-4-6', '-d'], { dataDir });
    expect(add.ok).toBe(true);
    let agentLlm = readYaml(path.join(customAgentDir, 'configs', 'llm.yaml'));
    expect(agentLlm.defaultModel).toBe('agent_model');
    expect(agentLlm.models.agent_model.provider).toBe('claude');

    const list = await runModelsCli(['list', '--agent', 'worker'], { dataDir });
    expect(list.message).toContain('global_model');
    expect(list.message).toContain('* agent_model');

    const addNonDefault = await runModelsCli([
      'add', '--agent', 'worker', 'agent_secondary', '-p', 'gemini', '-m', 'gemini-2.5-flash',
    ], { dataDir });
    expect(addNonDefault.ok).toBe(true);
    agentLlm = readYaml(path.join(customAgentDir, 'configs', 'llm.yaml'));
    expect(agentLlm.defaultModel).toBe('agent_model');

    const overrideInherited = await runModelsCli([
      'add', '--agent', 'worker', 'global_model', '--context-window', '999999',
    ], { dataDir });
    expect(overrideInherited.ok).toBe(true);
    agentLlm = readYaml(path.join(customAgentDir, 'configs', 'llm.yaml'));
    expect(agentLlm.models.global_model).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash', contextWindow: 999999 });

    const removedInherited = await runModelsCli(['remove', '--agent', 'worker', 'global_model'], { dataDir });
    expect(removedInherited.ok).toBe(true);
    agentLlm = readYaml(path.join(customAgentDir, 'configs', 'llm.yaml'));
    expect(agentLlm.models.global_model).toBeNull();
  });
});
