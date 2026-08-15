import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getClaudeProjectSkillDirs,
  loadSkillsFromFilesystemWithDiagnostics,
} from '../src/config/skill-loader';
import { translateClaudeAllowedTools } from '../src/config/claude-skill-adapter';
import { createExecuteSkillScriptTool } from '../src/tools/internal/execute_skill_script';
import { expandClaudeCodeSkillContent } from '../src/tools/internal/skill-content-expansion';
import { stageSkillPackage } from '../src/tools/internal/skill-staging';
import { ToolRegistry } from '../src/tools/registry';
import { executeToolWithScheduler, matchesCommandPatterns } from '../src/tools/scheduler';
import type { SkillDefinition } from '../src/config/types';

function writeSkill(root: string, name: string, body: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf8');
  return dir;
}

describe('Claude Code Skill compatibility loader', () => {
  it('uses directory invocation names, CC booleans, when_to_use and scoped tool grants', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-cc-skill-'));
    try {
      const repo = path.join(tmp, 'repo');
      const cwd = path.join(repo, 'packages', 'app');
      const dataDir = path.join(tmp, 'iris-data');
      const homeDir = path.join(tmp, 'home');
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      const skillsRoot = path.join(repo, '.claude', 'skills');
      writeSkill(skillsRoot, 'review-code', [
        '---',
        'name: Pretty Reviewer',
        'allowed-tools: Bash(git status:*) Read LS',
        'user-invocable: "false"',
        'disable-model-invocation: "true"',
        'when_to_use: when reviewing changes',
        '---',
        '# Review the current changes',
      ].join('\n'));

      const loaded = loadSkillsFromFilesystemWithDiagnostics(dataDir, { cwd, homeDir });
      const skill = loaded.skills.find(item => item.name === 'review-code')!;
      const commandTool = process.platform === 'win32' ? 'shell' : 'bash';

      expect(skill).toBeDefined();
      expect(skill.displayName).toBe('Pretty Reviewer');
      expect(skill.description).toBe('Review the current changes');
      expect(skill.whenToUse).toBe('when reviewing changes');
      expect(skill.userInvocable).toBe(false);
      expect(skill.disableModelInvocation).toBe(true);
      expect(skill.source).toBe('claude-project');
      expect(skill.dialect).toBe('claude-code');
      expect(skill.allowedTools).toEqual([commandTool, 'read_file', 'read_skill_resource', 'list_files']);
      expect(skill.contextModifier?.autoApproveTools).toEqual(['read_file', 'read_skill_resource', 'list_files']);
      const allowPatterns = skill.contextModifier?.permissionOverrides?.[commandTool]?.allowPatterns ?? [];
      expect(allowPatterns).toEqual([
        'git status',
        'git status *',
      ]);
      expect(matchesCommandPatterns('git status --short', allowPatterns)).toBe(true);
      expect(matchesCommandPatterns('git status-evil', allowPatterns)).toBe(false);
      expect(loaded.diagnostics.some(item => item.code === 'claude-skill-display-name-differs')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps Iris-native precedence and lets the nearest CC project directory win', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-cc-priority-'));
    try {
      const repo = path.join(tmp, 'repo');
      const cwd = path.join(repo, 'nested');
      const dataDir = path.join(tmp, 'data');
      const homeDir = path.join(tmp, 'home');
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });

      writeSkill(path.join(homeDir, '.claude', 'skills'), 'shadow', 'global CC');
      writeSkill(path.join(repo, '.claude', 'skills'), 'shadow', 'root CC');
      writeSkill(path.join(cwd, '.claude', 'skills'), 'shadow', 'near CC');
      writeSkill(path.join(homeDir, '.claude', 'skills'), 'native-wins', 'CC copy');
      writeSkill(path.join(dataDir, 'skills'), 'native-wins', 'Iris copy');

      const loaded = loadSkillsFromFilesystemWithDiagnostics(dataDir, { cwd, homeDir });
      expect(loaded.skills.find(item => item.name === 'shadow')?.content).toBe('near CC');
      expect(loaded.skills.find(item => item.name === 'native-wins')?.content).toBe('Iris copy');
      expect(loaded.diagnostics.some(item => item.code === 'claude-skill-shadowed-by-iris')).toBe(true);
      expect(getClaudeProjectSkillDirs(cwd)).toEqual([
        path.join(repo, '.claude', 'skills'),
        path.join(cwd, '.claude', 'skills'),
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('walks toward home when cwd is outside a Git repository', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-cc-no-git-'));
    try {
      const homeDir = path.join(tmp, 'home');
      const workspace = path.join(homeDir, 'work');
      const cwd = path.join(workspace, 'nested');
      fs.mkdirSync(cwd, { recursive: true });
      expect(getClaudeProjectSkillDirs(cwd, homeDir)).toEqual([
        path.join(workspace, '.claude', 'skills'),
        path.join(cwd, '.claude', 'skills'),
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('diagnoses unknown and MCP grants instead of broadening permissions', () => {
    const translated = translateClaudeAllowedTools('WebFetch custom_tool mcp__server__thing Bash(npm test:*)');
    const commandTool = process.platform === 'win32' ? 'shell' : 'bash';
    expect(translated.toolNames).toEqual([commandTool]);
    expect(translated.contextModifier?.permissionOverrides?.[commandTool]?.allowPatterns).toEqual([
      'npm test',
      'npm test *',
    ]);
    expect(translated.diagnostics.map(item => item.code)).toEqual([
      'claude-skill-unknown-tool',
      'claude-skill-unknown-tool',
      'claude-skill-mcp-tool-out-of-scope',
    ]);
  });

  it('maps Agent/Task grants only to launching sub_agent, not to child write permissions', () => {
    const translated = translateClaudeAllowedTools('Agent Task');
    expect(translated.toolNames).toEqual(['sub_agent']);
    expect(translated.contextModifier?.autoApproveTools).toEqual(['sub_agent']);
    expect(translated.contextModifier?.autoApproveTools).not.toContain('write_file');
    expect(translated.contextModifier?.autoApproveTools).not.toContain('apply_diff');
  });
});

describe('Claude Code Skill resources and runtime expansion', () => {
  it('recursively manifests and stages a package so scripts can use relative imports', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-cc-package-'));
    try {
      const dataDir = path.join(tmp, 'data');
      const homeDir = path.join(tmp, 'home');
      const cwd = path.join(tmp, 'repo');
      fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
      const skillDir = writeSkill(
        path.join(cwd, '.claude', 'skills'),
        'package-skill',
        '---\ndescription: package test\n---\nRun scripts/check.mjs',
      );
      fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(skillDir, 'lib', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'lib', 'nested', 'value.mjs'), 'export default "relative-ok";');
      fs.writeFileSync(
        path.join(skillDir, 'scripts', 'check.mjs'),
        'import value from "../lib/nested/value.mjs"; console.log(`${value}:${process.env.CLAUDE_SESSION_ID}:${process.env.CLAUDE_SKILL_DIR}`);',
      );

      const skill = loadSkillsFromFilesystemWithDiagnostics(dataDir, { cwd, homeDir }).skills[0];
      expect(skill.resources?.map(item => item.relativePath)).toEqual([
        'lib/nested/value.mjs',
        'scripts/check.mjs',
      ]);

      const tool = createExecuteSkillScriptTool({
        getBackend: () => ({ getSkillByName: (name: string) => name === skill.name ? skill : undefined }),
      });
      const result = await tool.handler(
        { name: skill.name, relativePath: 'scripts/check.mjs' },
        { sessionId: 'session-42', requestApproval: async () => true },
      ) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.output).toContain('relative-ok:session-42:[skill-staging]');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('expands ! commands through the Iris command handler and exposes only skill:// roots', async () => {
    const commandTool = process.platform === 'win32' ? 'shell' : 'bash';
    const registry = new ToolRegistry();
    let approvedByUser = false;
    let forcedLocalExecution = false;
    registry.register({
      declaration: { name: commandTool, description: 'mock command' },
      approvalMode: 'handler',
      handler: async (_args, context) => {
        approvedByUser = context?.approvedByUser === true;
        forcedLocalExecution = context?.forceLocalExecution === true;
        return { stdout: 'expanded-output', stderr: '', exitCode: 0, killed: false };
      },
    });
    const skill: SkillDefinition = {
      name: 'expand-me',
      description: 'test',
      content: '',
      path: 'inline:test',
      dialect: 'claude-code',
      skillUri: 'skill://expand-me/',
      contextModifier: {
        permissionOverrides: { [commandTool]: { allowPatterns: ['echo*'] } },
      },
    };

    const result = await expandClaudeCodeSkillContent({
      skill,
      content: 'Before !`echo hello` after ${CLAUDE_SKILL_DIR}/guide.md ${CLAUDE_SESSION_ID}',
      sessionId: 's-1',
      tools: registry,
      toolsConfig: { permissions: { [commandTool]: { autoApprove: false } } },
    });
    expect(approvedByUser).toBe(true);
    expect(forcedLocalExecution).toBe(true);
    expect(result).toContain('Before expanded-output after skill://expand-me/guide.md s-1');
    expect(result).toContain('Resource base for this skill: skill://expand-me/');
  });

  it('routes embedded ! commands through inherited scheduler hooks', async () => {
    const commandTool = process.platform === 'win32' ? 'shell' : 'bash';
    const registry = new ToolRegistry();
    const commandHandler = vi.fn(async () => ({
      stdout: 'must-not-run', stderr: '', exitCode: 0, killed: false,
    }));
    registry.register({
      declaration: { name: commandTool, description: 'guarded command' },
      approvalMode: 'handler',
      handler: commandHandler,
    });
    const skill: SkillDefinition = {
      name: 'hooked-expansion',
      description: 'test nested scheduler boundary',
      content: '',
      path: 'inline:hooked-expansion',
      dialect: 'claude-code',
      contextModifier: {
        permissionOverrides: { [commandTool]: { allowPatterns: ['echo*'] } },
      },
    };
    registry.register({
      declaration: { name: 'skill_expansion_probe', description: 'outer skill invocation' },
      handler: async (_args, context) => expandClaudeCodeSkillContent({
        skill,
        content: '!`echo blocked`',
        tools: registry,
        toolsConfig: { permissions: { [commandTool]: { autoApprove: false } } },
        context,
      }),
    });
    const seenTools: string[] = [];

    await expect(executeToolWithScheduler('skill_expansion_probe', {}, {
      registry,
      toolsConfig: {
        permissions: {
          skill_expansion_probe: { autoApprove: true },
          [commandTool]: { autoApprove: false },
        },
      },
      beforeToolExec: async (toolName) => {
        seenTools.push(toolName);
        return toolName === commandTool
          ? { blocked: true, reason: 'blocked embedded command' }
          : undefined;
      },
    })).rejects.toThrow('blocked embedded command');

    expect(seenTools).toEqual(['skill_expansion_probe', commandTool]);
    expect(commandHandler).not.toHaveBeenCalled();
  });

  it('prefers Bash for ! commands when both command handlers are available', async () => {
    const registry = new ToolRegistry();
    let selected = '';
    for (const name of ['shell', 'bash']) {
      registry.register({
        declaration: { name, description: `mock ${name}` },
        approvalMode: 'handler',
        handler: async () => {
          selected = name;
          return { stdout: name, stderr: '', exitCode: 0, killed: false };
        },
      });
    }
    const skill: SkillDefinition = {
      name: 'default-shell',
      description: 'test',
      content: '',
      path: 'inline:test',
      dialect: 'claude-code',
    };

    const result = await expandClaudeCodeSkillContent({
      skill,
      content: '!`echo hello`',
      tools: registry,
      toolsConfig: { permissions: { bash: { autoApprove: true }, shell: { autoApprove: true } } },
    });
    expect(selected).toBe('bash');
    expect(result).toContain('\n\nbash');
  });

  it('refuses whole-package staging when the resource manifest is truncated', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-cc-truncated-'));
    try {
      const skill: SkillDefinition = {
        name: 'truncated',
        description: 'test',
        content: '',
        path: path.join(tmp, 'SKILL.md'),
        canonicalBasePath: tmp,
        resources: [{
          skillUri: 'skill://truncated/__truncated__',
          relativePath: '__truncated__',
          kind: 'other',
          size: 0,
          sha256: '',
          maybeExecutable: false,
          textReadable: false,
          truncatedReason: 'test limit',
        }],
      };
      await expect(stageSkillPackage(skill)).rejects.toThrow('manifest is truncated');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
