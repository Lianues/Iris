import * as path from 'node:path';
import type {
  SkillContextModifier,
  SkillDefinition,
  SkillDiagnostic,
  SkillSource,
  ToolPolicyConfig,
} from './types';
import {
  buildSkillResourceManifest,
  canonicalizeSkillRoot,
  createSkillUri,
} from './skill-resource-manifest';

const CLAUDE_TOOL_MAP: Readonly<Record<string, string[]>> = {
  // read_skill_resource is Iris' guarded equivalent for files bundled with
  // the active Skill. Granting it alongside read_file keeps CC resource reads
  // working without exposing the original Skill directory.
  Read: ['read_file', 'read_skill_resource'],
  Glob: ['find_files'],
  Grep: ['search_in_files'],
  LS: ['list_files'],
  Write: ['write_file'],
  Edit: ['apply_diff'],
  MultiEdit: ['apply_diff'],
  Agent: ['sub_agent'],
  Task: ['sub_agent'],
  Skill: ['invoke_skill'],
  AskUserQuestion: ['ask_question_first'],
};

const PLATFORM_COMMAND_TOOL = process.platform === 'win32' ? 'shell' : 'bash';

export interface ClaudeAllowedToolsTranslation {
  rawRules: string[];
  toolNames: string[];
  contextModifier?: SkillContextModifier;
  diagnostics: Array<{ code: string; message: string; field?: string }>;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function parseStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const result = value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean);
    return result.length ? result : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const result = value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
  return result.length ? result : undefined;
}

/** Split a CC tool rule list while preserving whitespace inside parentheses. */
export function parseClaudeAllowedToolRules(value: unknown): string[] {
  const inputs = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string' ? [value] : [];
  const result: string[] = [];

  for (const input of inputs) {
    let token = '';
    let depth = 0;
    let quote: '"' | "'" | undefined;
    let escaped = false;
    const flush = () => {
      const trimmed = token.trim();
      if (trimmed) result.push(trimmed);
      token = '';
    };

    for (const ch of input) {
      if (escaped) {
        token += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        token += ch;
        escaped = true;
        continue;
      }
      if (quote) {
        token += ch;
        if (ch === quote) quote = undefined;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        token += ch;
        continue;
      }
      if (ch === '(') depth++;
      if (ch === ')' && depth > 0) depth--;
      if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
        flush();
      } else {
        token += ch;
      }
    }
    flush();
  }

  return result;
}

function normalizeClaudeCommandPatterns(pattern: string): string[] {
  const trimmed = pattern.trim();
  if (!trimmed) return ['*'];
  // CC rules use `:<glob>` after a command prefix. Iris matches the raw
  // command. Keep the token boundary explicit so `git status:*` cannot also
  // match an unrelated executable such as `git status-evil`.
  if (trimmed.endsWith(':*')) {
    const prefix = trimmed.slice(0, -2).trimEnd();
    return prefix ? [prefix, `${prefix} *`] : ['*'];
  }
  return [trimmed];
}

export function translateClaudeAllowedTools(value: unknown): ClaudeAllowedToolsTranslation {
  const rawRules = parseClaudeAllowedToolRules(value);
  const toolNames = new Set<string>();
  const autoApproveTools = new Set<string>();
  const permissionOverrides: Record<string, Partial<ToolPolicyConfig>> = {};
  const diagnostics: ClaudeAllowedToolsTranslation['diagnostics'] = [];

  for (const rawRule of rawRules) {
    if (rawRule === '*') {
      diagnostics.push({
        code: 'claude-skill-wildcard-tool-grant-unsupported',
        field: 'allowed-tools',
        message: 'Claude Code allowed-tools "*" is not auto-approved by Iris; tools remain available through normal approval.',
      });
      continue;
    }

    const match = rawRule.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)(?:\(([\s\S]*)\))?$/);
    if (!match) {
      diagnostics.push({
        code: 'claude-skill-invalid-tool-rule',
        field: 'allowed-tools',
        message: `Unsupported Claude Code allowed-tools rule: ${rawRule}`,
      });
      continue;
    }

    const claudeName = match[1];
    const scopedPattern = match[2];
    if (claudeName.startsWith('mcp__')) {
      diagnostics.push({
        code: 'claude-skill-mcp-tool-out-of-scope',
        field: 'allowed-tools',
        message: `MCP tool grant is outside the local Skill compatibility scope: ${claudeName}`,
      });
      continue;
    }

    if (claudeName === 'Bash' || claudeName === 'PowerShell') {
      toolNames.add(PLATFORM_COMMAND_TOOL);
      const patterns = normalizeClaudeCommandPatterns(scopedPattern ?? '*');
      const current = permissionOverrides[PLATFORM_COMMAND_TOOL];
      permissionOverrides[PLATFORM_COMMAND_TOOL] = {
        ...(current ?? {}),
        allowPatterns: Array.from(new Set([...(current?.allowPatterns ?? []), ...patterns])),
      };
      continue;
    }

    const mappedNames = CLAUDE_TOOL_MAP[claudeName];
    if (!mappedNames) {
      diagnostics.push({
        code: 'claude-skill-unknown-tool',
        field: 'allowed-tools',
        message: `No Iris tool mapping for Claude Code tool "${claudeName}"; it will use normal Iris approval if available.`,
      });
      continue;
    }

    for (const mappedName of mappedNames) toolNames.add(mappedName);
    if (scopedPattern !== undefined) {
      diagnostics.push({
        code: 'claude-skill-scoped-tool-grant-unsupported',
        field: 'allowed-tools',
        message: `Scoped grant ${rawRule} cannot be translated safely for a non-shell tool; Iris keeps normal approval.`,
      });
      continue;
    }
    for (const mappedName of mappedNames) autoApproveTools.add(mappedName);
  }

  const contextModifier: SkillContextModifier | undefined =
    autoApproveTools.size > 0 || Object.keys(permissionOverrides).length > 0
      ? {
        autoApproveTools: autoApproveTools.size ? Array.from(autoApproveTools) : undefined,
        permissionOverrides: Object.keys(permissionOverrides).length ? permissionOverrides : undefined,
      }
      : undefined;

  return {
    rawRules,
    toolNames: Array.from(toolNames),
    contextModifier,
    diagnostics,
  };
}

function fallbackDescription(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const text = trimmed.match(/^#+\s+(.+)$/)?.[1] ?? trimmed;
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
  }
  return 'Skill';
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export interface AdaptClaudeSkillInput {
  directoryName: string;
  fields: Record<string, unknown>;
  content: string;
  filePath: string;
  source: Extract<SkillSource, 'claude-global' | 'claude-project'>;
}

export interface AdaptClaudeSkillResult {
  skill: SkillDefinition;
  diagnostics: SkillDiagnostic[];
}

export function adaptClaudeCodeSkill(input: AdaptClaudeSkillInput): AdaptClaudeSkillResult {
  const { directoryName: name, fields, content, filePath, source } = input;
  const diagnostics: SkillDiagnostic[] = [];
  const translated = translateClaudeAllowedTools(fields['allowed-tools']);
  for (const diagnostic of translated.diagnostics) {
    diagnostics.push({ ...diagnostic, severity: 'warning', skillName: name, filePath, source });
  }

  const displayName = scalarString(fields.name);
  if (displayName && displayName !== name) {
    diagnostics.push({
      severity: 'info',
      code: 'claude-skill-display-name-differs',
      message: `Claude Code invokes this Skill by directory name "${name}"; frontmatter name "${displayName}" is display-only.`,
      skillName: name,
      filePath,
      field: 'name',
      source,
    });
  }

  const description = scalarString(fields.description) ?? fallbackDescription(content);
  const modelRaw = scalarString(fields.model);
  const model = modelRaw && modelRaw !== 'inherit' ? modelRaw : undefined;
  const whenToUse = scalarString(fields.when_to_use) ?? scalarString(fields['when-to-use']);
  const shellRaw = scalarString(fields.shell)?.toLowerCase();
  const shell = shellRaw === 'powershell' || shellRaw === 'bash' ? shellRaw : undefined;
  if (shellRaw && !shell) {
    diagnostics.push({
      severity: 'warning', code: 'claude-skill-invalid-shell',
      message: `Unsupported Claude Code shell value "${shellRaw}"; using the platform default.`,
      skillName: name, filePath, field: 'shell', source,
    });
  }

  let canonicalBasePath: string | undefined;
  let resources: SkillDefinition['resources'] = [];
  const basePath = path.dirname(filePath);
  try {
    canonicalBasePath = canonicalizeSkillRoot(basePath);
    resources = buildSkillResourceManifest(name, canonicalBasePath, content);
  } catch (error) {
    diagnostics.push({
      severity: 'warning', code: 'skill-resource-manifest-failed',
      message: error instanceof Error ? error.message : String(error),
      skillName: name, filePath, source,
    });
  }

  const contextModifier: SkillContextModifier | undefined =
    translated.contextModifier || model
      ? { ...(translated.contextModifier ?? {}), modelOverride: model }
      : undefined;

  return {
    skill: {
      name,
      displayName,
      description,
      content,
      path: filePath,
      source,
      dialect: 'claude-code',
      basePath,
      canonicalBasePath,
      skillUri: createSkillUri(name),
      resources,
      allowedTools: translated.toolNames.length ? translated.toolNames : undefined,
      model,
      shell,
      agent: scalarString(fields.agent),
      effort: typeof fields.effort === 'number' || typeof fields.effort === 'string' ? fields.effort : undefined,
      version: scalarString(fields.version),
      mode: fields.context === 'fork' ? 'fork' : 'inline',
      arguments: parseStringList(fields.arguments)?.filter(name => !/^\d+$/.test(name)),
      argumentHint: scalarString(fields['argument-hint']),
      whenToUse,
      paths: parseStringList(fields.paths),
      userInvocable: fields['user-invocable'] === undefined ? true : parseBoolean(fields['user-invocable']),
      disableModelInvocation: parseBoolean(fields['disable-model-invocation']),
      contextModifier,
    },
    diagnostics,
  };
}
