/**
 * LayeredConfigManager 分层配置管理器测试
 *
 * 验证多 Agent 配置分层重构后 Settings UI 数据断裂的三个修复：
 *   1. readEditableConfig 返回 global + agent 合并后的完整配置
 *   2. updateEditableConfig 只写 agent 层，但返回合并后的完整配置（供热重载）
 *   3. 单目录 fallback 模式（CLI 直接启动，无 agent 分层）行为不变
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LayeredConfigManager } from '../src/config/manage';

// ---- 测试辅助：创建临时配置目录 ----

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-test-'));
}

function writeYaml(dir: string, filename: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

function readYaml(dir: string, filename: string): string | null {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 测试 ----

describe('LayeredConfigManager', () => {
  let globalDir: string;
  let agentDir: string;

  beforeEach(() => {
    globalDir = createTempDir();
    agentDir = createTempDir();
  });

  afterEach(() => {
    cleanDir(globalDir);
    cleanDir(agentDir);
  });

  // ============================================================
  // 问题一：readEditableConfig 应返回 global + agent 合并后的配置
  // ============================================================

  describe('readEditableConfig - 分层合并', () => {
    it('agent 目录为空时，应返回全局目录的完整配置', () => {
      // 全局目录有 llm.yaml，agent 目录为空
      writeYaml(globalDir, 'llm.yaml', [
        'defaultModel: my-model',
        'models:',
        '  my-model:',
        '    provider: gemini',
        '    model: gemini-2.5-flash',
        '    apiKey: test-key-123',
      ].join('\n'));

      const manager = new LayeredConfigManager(globalDir, agentDir);
      // readEditableConfig 返回 Record<string, unknown>，
      // 测试中需要访问嵌套属性，用 any 断言简化类型体操。
      const config = manager.readEditableConfig() as any;

      // 应该能读到全局配置中的 LLM 信息
      expect(config.llm).toBeDefined();
      expect(config.llm.defaultModel).toBe('my-model');
      expect(config.llm.models['my-model'].provider).toBe('gemini');
    });

    it('agent 层配置应覆盖全局层同名字段', () => {
      writeYaml(globalDir, 'system.yaml', [
        'maxToolRounds: 30',
        'stream: true',
      ].join('\n'));

      // agent 层只覆盖 maxToolRounds
      writeYaml(agentDir, 'system.yaml', [
        'maxToolRounds: 50',
      ].join('\n'));

      const manager = new LayeredConfigManager(globalDir, agentDir);
      const config = manager.readEditableConfig() as any;

      // maxToolRounds 被 agent 层覆盖
      expect(config.system.maxToolRounds).toBe(50);
      // stream 从全局层继承
      expect(config.system.stream).toBe(true);
    });

    it('全局和 agent 的 MCP servers 应合并', () => {
      writeYaml(globalDir, 'mcp.yaml', [
        'servers:',
        '  global_server:',
        '    transport: stdio',
        '    command: node',
      ].join('\n'));

      writeYaml(agentDir, 'mcp.yaml', [
        'servers:',
        '  agent_server:',
        '    transport: sse',
        '    url: http://localhost:3000',
      ].join('\n'));

      const manager = new LayeredConfigManager(globalDir, agentDir);
      const config = manager.readEditableConfig() as any;

      // 两个 server 都应该出现
      expect(config.mcp.servers.global_server).toBeDefined();
      expect(config.mcp.servers.agent_server).toBeDefined();
    });
  });

  // ============================================================
  // 问题二：updateEditableConfig 只写 agent 层，返回合并后的完整配置
  // ============================================================

  describe('updateEditableConfig - 写入定向 + 返回合并', () => {
    it('写入应只修改 agent 目录，不动全局目录', () => {
      writeYaml(globalDir, 'llm.yaml', [
        'defaultModel: global-model',
        'models:',
        '  global-model:',
        '    provider: gemini',
        '    model: gemini-2.5-flash',
        '    apiKey: global-key',
      ].join('\n'));

      const manager = new LayeredConfigManager(globalDir, agentDir);

      // 通过 settings UI 更新系统配置
      manager.updateEditableConfig({
        system: { maxToolRounds: 99 },
      });

      // 全局 llm.yaml 不应被修改
      const globalLLM = readYaml(globalDir, 'llm.yaml');
      expect(globalLLM).toContain('global-key');

      // agent 目录应该出现 system.yaml
      const agentSystem = readYaml(agentDir, 'system.yaml');
      expect(agentSystem).toContain('maxToolRounds');
    });

    it('返回的 mergedRaw 应包含全局 + agent 合并后的完整配置', () => {
      writeYaml(globalDir, 'llm.yaml', [
        'defaultModel: global-model',
        'models:',
        '  global-model:',
        '    provider: gemini',
        '    model: gemini-2.5-flash',
        '    apiKey: global-key',
      ].join('\n'));

      writeYaml(globalDir, 'system.yaml', [
        'maxToolRounds: 30',
        'stream: true',
      ].join('\n'));

      const manager = new LayeredConfigManager(globalDir, agentDir);

      const { mergedRaw } = manager.updateEditableConfig({
        system: { maxToolRounds: 99 },
      }) as any;

      // mergedRaw 应包含全局 LLM 配置（供热重载用）
      expect(mergedRaw.llm).toBeDefined();
      expect(mergedRaw.llm.models['global-model'].provider).toBe('gemini');

      // mergedRaw 中 system 应是合并后的
      expect(mergedRaw.system.maxToolRounds).toBe(99);
      expect(mergedRaw.system.stream).toBe(true);
    });
  });

  // ============================================================
  // 单目录 fallback：globalDir == agentDir 时行为等同旧版
  // ============================================================

  describe('单目录模式（globalDir == agentDir）', () => {
    it('读写应等同于直接操作单个目录', () => {
      const singleDir = createTempDir();
      writeYaml(singleDir, 'llm.yaml', [
        'defaultModel: my-model',
        'models:',
        '  my-model:',
        '    provider: gemini',
        '    model: gemini-2.5-flash',
      ].join('\n'));

      // globalDir 和 agentDir 相同
      const manager = new LayeredConfigManager(singleDir, singleDir);
      const config = manager.readEditableConfig() as any;

      expect(config.llm.defaultModel).toBe('my-model');

      manager.updateEditableConfig({
        system: { maxToolRounds: 42 },
      });

      const updated = manager.readEditableConfig() as any;
      expect(updated.system.maxToolRounds).toBe(42);
      expect(updated.llm.defaultModel).toBe('my-model');

      cleanDir(singleDir);
    });
  });
});
