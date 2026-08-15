import type { SkillDefinition, ToolsConfig } from '../../config/types';
import { cloneToolsConfig } from '../../config/clone-tools-config';
import { applySkillContextModifierToToolsConfig } from '../../config/skill-permissions';
import { createSkillUri } from '../../config/skill-resource-manifest';
import type { ToolExecutionContext } from '../../types';
import { executeToolWithScheduler } from '../scheduler';
import type { ToolRegistry } from '../registry';
import { stageSkillPackage, type StagedSkillPackage } from './skill-staging';

interface PromptCommandMatch {
  start: number;
  end: number;
  source: string;
  command: string;
}

const MAX_PROMPT_COMMAND_OUTPUT_CHARS = 20_000;

function collectPromptCommands(content: string): PromptCommandMatch[] {
  const matches: PromptCommandMatch[] = [];
  const blockPattern = /```!\s*\n?([\s\S]*?)\n?```/g;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(content)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length, source: match[0], command: match[1].trim() });
  }

  const inlinePattern = /(^|\s)!`([^`]+)`/gm;
  while ((match = inlinePattern.exec(content)) !== null) {
    const prefixLength = match[1].length;
    const start = match.index + prefixLength;
    const end = match.index + match[0].length;
    if (matches.some(existing => start >= existing.start && end <= existing.end)) continue;
    matches.push({ start, end, source: match[0].slice(prefixLength), command: match[2].trim() });
  }
  return matches.filter(item => item.command).sort((a, b) => a.start - b.start);
}

function selectCommandTool(skill: SkillDefinition, tools: ToolRegistry): string | undefined {
  if (skill.shell === 'powershell' && tools.get('shell')) return 'shell';
  // Claude Code defaults embedded prompt commands to Bash regardless of the
  // host platform. Iris falls back to its platform command tool only when a
  // Bash handler is not registered (the normal Windows configuration).
  if (skill.shell !== 'powershell' && tools.get('bash')) return 'bash';
  const platformName = process.platform === 'win32' ? 'shell' : 'bash';
  if (tools.get(platformName)) return platformName;
  return tools.get('shell') ? 'shell' : tools.get('bash') ? 'bash' : undefined;
}

function formatCommandResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return String(result ?? '');
  const record = result as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error) throw new Error(record.error);
  const stdout = typeof record.stdout === 'string' ? record.stdout.trim() : '';
  const stderr = typeof record.stderr === 'string' ? record.stderr.trim() : '';
  const exitCode = typeof record.exitCode === 'number' ? record.exitCode : 0;
  const killed = record.killed === true;
  const output = [stdout, stderr ? `[stderr]\n${stderr}` : ''].filter(Boolean).join('\n');
  if (exitCode !== 0 || killed) {
    throw new Error(output || `Embedded Skill command failed with exit code ${exitCode}.`);
  }
  return output.length > MAX_PROMPT_COMMAND_OUTPUT_CHARS
    ? `${output.slice(-MAX_PROMPT_COMMAND_OUTPUT_CHARS)}\n... (output truncated)`
    : output;
}

function normalizeForCommand(value: string): string {
  return process.platform === 'win32' ? value.replace(/\\/g, '/') : value;
}

async function executePromptCommand(options: {
  command: string;
  displayCommand: string;
  commandTool: string;
  tools: ToolRegistry;
  toolsConfig: ToolsConfig;
  context?: ToolExecutionContext;
}): Promise<string> {
  const { command, displayCommand, commandTool, tools, toolsConfig, context } = options;
  context?.reportProgress?.({
    kind: 'skill_prompt_command',
    command: displayCommand,
    shellTool: commandTool,
    awaitingApproval: false,
  });
  const permissionOverride = toolsConfig.permissions[commandTool];
  const executed = context?.executeTool
    ? await context.executeTool(commandTool, { command }, {
        permissionOverride,
        // `${CLAUDE_SKILL_DIR}` points at a verified local staging package.
        // Sending that path to remote-exec would both fail and skip the local
        // command handler's security pipeline.
        forceLocalExecution: true,
      })
    : await executeToolWithScheduler(commandTool, { command }, {
        registry: tools,
        toolsConfig,
        signal: context?.signal,
        sessionId: context?.sessionId,
        permissionOverride,
        flags: { forceLocalExecution: true },
      });
  return formatCommandResult(executed);
}

/**
 * Expand CC runtime variables and embedded ! commands without exposing the
 * original Skill root. Commands execute through Iris command handlers and
 * their approval/classifier chain; resource references use a verified staging
 * package only for the duration of expansion.
 */
export async function expandClaudeCodeSkillContent(options: {
  skill: SkillDefinition;
  content: string;
  sessionId?: string;
  tools: ToolRegistry;
  toolsConfig: ToolsConfig;
  context?: ToolExecutionContext;
}): Promise<string> {
  const { skill, tools, context } = options;
  const sessionId = options.sessionId ?? '';
  const skillUri = skill.skillUri ?? createSkillUri(skill.name);
  const uriVariableValue = skillUri.endsWith('/') ? skillUri.slice(0, -1) : skillUri;
  const promptCommands = collectPromptCommands(options.content);
  let staged: StagedSkillPackage | undefined;

  try {
    if (promptCommands.some(item => item.command.includes('${CLAUDE_SKILL_DIR}'))) {
      staged = await stageSkillPackage(skill);
    }

    const commandTool = promptCommands.length ? selectCommandTool(skill, tools) : undefined;
    if (promptCommands.length && !commandTool) {
      throw new Error('No Iris shell/bash tool is available for embedded Claude Code Skill commands.');
    }

    const localToolsConfig = cloneToolsConfig(options.toolsConfig);
    if (skill.contextModifier) {
      applySkillContextModifierToToolsConfig(localToolsConfig, skill.contextModifier);
    }

    let expanded = '';
    let cursor = 0;
    for (const item of promptCommands) {
      expanded += options.content.slice(cursor, item.start);
      const stagedRoot = staged ? normalizeForCommand(staged.dir) : '';
      const command = item.command
        .replace(/\$\{CLAUDE_SKILL_DIR\}/g, stagedRoot)
        .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId);

      // Patterns may contain the same runtime variables as the command.
      const commandPolicy = localToolsConfig.permissions[commandTool!];
      if (commandPolicy?.allowPatterns) {
        commandPolicy.allowPatterns = commandPolicy.allowPatterns.map(pattern => pattern
          .replace(/\$\{CLAUDE_SKILL_DIR\}/g, stagedRoot)
          .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId));
      }
      if (commandPolicy?.denyPatterns) {
        commandPolicy.denyPatterns = commandPolicy.denyPatterns.map(pattern => pattern
          .replace(/\$\{CLAUDE_SKILL_DIR\}/g, stagedRoot)
          .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId));
      }
      let output = await executePromptCommand({
        command,
        displayCommand: item.command,
        commandTool: commandTool!,
        tools,
        toolsConfig: localToolsConfig,
        context,
      });
      if (staged) {
        output = output
          .split(staged.dir).join('[skill-staging]')
          .split(normalizeForCommand(staged.dir)).join('[skill-staging]');
      }
      expanded += output;
      cursor = item.end;
    }
    expanded += options.content.slice(cursor);

    expanded = expanded
      .replace(/\$\{CLAUDE_SKILL_DIR\}/g, uriVariableValue)
      .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId);
    return `Resource base for this skill: ${skillUri}\n\n${expanded}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const redacted = staged
      ? message
        .split(staged.dir).join('[skill-staging]')
        .split(normalizeForCommand(staged.dir)).join('[skill-staging]')
      : message;
    throw new Error(redacted);
  } finally {
    staged?.cleanup();
  }
}
