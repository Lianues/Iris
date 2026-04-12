/**
 * Agent 配置分层加载测试
 *
 * 验证启动阶段的 loadAgentConfig 与 Settings UI 的 LayeredConfigManager
 * 保持一致的 LLM 合并语义，避免 /model 只看到全局层模型。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadAgentConfig, type GlobalConfigResult } from '../src/config';
import { parseLLMConfig } from '../src/config/llm';
import { parseOCRConfig } from '../src/config/ocr';
import { loadRawConfigDir } from '../src/config/raw';
import { parseStorageConfig } from '../src/config/storage';
import type { AgentPaths } from '../src/paths';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeYaml(dir: string, filename: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createAgentPaths(): AgentPaths {
  const dataDir = createTempDir('iris-agent-data-');
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

function createGlobalConfigResult(globalDir: string): GlobalConfigResult {
  const raw = loadRawConfigDir(globalDir);
  return {
    config: {
      llm: parseLLMConfig(raw.llm),
      ocr: parseOCRConfig(raw.ocr),
      storage: parseStorageConfig(raw.storage),
    },
    raw,
  };
}

describe('loadAgentConfig - LLM 分层合并', () => {
  let globalDir: string;
  let agentPaths: AgentPaths;

  beforeEach(() => {
    globalDir = createTempDir('iris-global-config-');
    agentPaths = createAgentPaths();
  });

  afterEach(() => {
    cleanDir(globalDir);
    cleanDir(agentPaths.dataDir);
  });

  it('应合并全局与 agent 层的模型池，并允许 agent 覆盖默认模型', () => {
    writeYaml(globalDir, 'llm.yaml', [
      'defaultModel: gemini_flash',
      'models:',
      '  gemini_flash:',
      '    provider: gemini',
      '    model: gemini-2.5-flash',
      '    apiKey: global-key',
    ].join('\n'));

    writeYaml(agentPaths.configDir, 'llm.yaml', [
      'defaultModel: claude_sonnet',
      'models:',
      '  claude_sonnet:',
      '    provider: claude',
      '    model: claude-sonnet-4-6',
      '    apiKey: agent-key',
    ].join('\n'));

    const config = loadAgentConfig(createGlobalConfigResult(globalDir), agentPaths);
    const modelNames = config.llm.models.map(model => model.modelName).sort();

    expect(config.llm.defaultModelName).toBe('claude_sonnet');
    expect(modelNames).toEqual(['claude_sonnet', 'gemini_flash']);
  });

  it('agent 层将模型写为 null 时，应从最终模型池中移除该模型', () => {
    writeYaml(globalDir, 'llm.yaml', [
      'defaultModel: gemini_flash',
      'models:',
      '  gemini_flash:',
      '    provider: gemini',
      '    model: gemini-2.5-flash',
      '    apiKey: global-key',
      '  gemini_pro:',
      '    provider: gemini',
      '    model: gemini-2.5-pro',
      '    apiKey: global-key',
    ].join('\n'));

    writeYaml(agentPaths.configDir, 'llm.yaml', [
      'defaultModel: gemini_flash',
      'models:',
      '  gemini_pro: null',
    ].join('\n'));

    const config = loadAgentConfig(createGlobalConfigResult(globalDir), agentPaths);
    const modelNames = config.llm.models.map(model => model.modelName);

    expect(config.llm.defaultModelName).toBe('gemini_flash');
    expect(modelNames).toEqual(['gemini_flash']);
  });
});
