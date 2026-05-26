import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgentConfig, type GlobalConfigResult } from '../src/config/index.js';
import { loadRawConfigDir } from '../src/config/raw.js';
import type { AgentPaths } from '../src/paths.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeYaml(dir: string, filename: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function createAgentPaths(): AgentPaths {
  const dataDir = createTempDir('iris-plugin-toggle-agent-');
  return {
    dataDir,
    configDir: path.join(dataDir, 'configs'),
    attachmentsDir: path.join(dataDir, 'attachments'),
    sessionsDir: path.join(dataDir, 'sessions'),
    logsDir: path.join(dataDir, 'logs'),
    sessionDbPath: path.join(dataDir, 'iris.db'),
    memoryDbPath: path.join(dataDir, 'memory.db'),
  };
}

describe('/extension toggle persistence', () => {
  let globalDir: string;
  let agentPaths: AgentPaths;

  beforeEach(() => {
    globalDir = createTempDir('iris-plugin-toggle-global-');
    agentPaths = createAgentPaths();
  });

  afterEach(() => {
    cleanDir(globalDir);
    cleanDir(agentPaths.dataDir);
  });

  it('agent 层 plugins.yaml 应覆盖扩展开关，保证 /extension 保存后重启仍生效', () => {
    writeYaml(globalDir, 'plugins.yaml', [
      'plugins:',
      '  - name: memory',
      '    enabled: true',
      '  - name: virtual-lover',
      '    enabled: true',
      '    priority: 10',
      '    config:',
      '      mood: gentle',
    ].join('\n'));
    writeYaml(globalDir, 'system.yaml', [
      'extensions:',
      '  # virtual-lover 是源码仓库里的 workspace extension；/extension 启用后会持久化该 allowlist。',
      '  loadWorkspaceExtensions: true',
      '  workspaceAllowlist:',
      '    - virtual-lover',
    ].join('\n'));

    writeYaml(agentPaths.configDir, 'plugins.yaml', [
      'plugins:',
      '  - name: virtual-lover',
      '    enabled: false',
    ].join('\n'));

    const raw = loadRawConfigDir(globalDir);
    const globalResult = {
      raw,
      config: { llm: {} as any, ocr: undefined, storage: {} as any },
    } satisfies GlobalConfigResult;

    const config = loadAgentConfig(globalResult, agentPaths);

    expect(config.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'memory', enabled: true }),
      expect.objectContaining({ name: 'virtual-lover', enabled: false, priority: 10, config: { mood: 'gentle' } }),
    ]));
  });
});
