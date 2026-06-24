/**
 * 平台无关的工具摘要 formatter。
 *
 * 这里刻意只输出轻量的「语义摘要」，不绑定 React、OpenTUI、DOM、
 * Telegram Rich Markdown 或 Console service。各平台可以按自己的 UI 能力
 * 渲染 `segments`，也可以像 Bot 平台一样直接使用纯文本 `text`。
 *
 * 设计边界：
 * - 只总结工具调用、进度、结果，不读取文件系统，也不解析平台状态。
 * - 已知核心工具走语义化摘要，未知工具走明确的字段摘要。
 * - 不返回大段 JSON，避免把工具内部结构泄漏到用户可见 trace。
 */
export type ToolSummaryTone = 'normal' | 'muted' | 'success' | 'warning' | 'error' | 'accent';

export interface ToolSummarySegment {
  text: string;
  tone?: ToolSummaryTone;
}

export interface ToolSummary {
  /** 不带颜色/样式的纯文本摘要，供 Telegram、日志、aria fallback 使用。 */
  text: string;
  /** 可选语义片段，供 Console/Web 等富 UI 映射为颜色或样式。 */
  segments: ToolSummarySegment[];
}

const DEFAULT_TEXT_LIMIT = 120;
const COMMAND_TEXT_LIMIT = 80;
const PATH_TEXT_LIMIT = 80;

function segment(text: string, tone?: ToolSummaryTone): ToolSummarySegment {
  return tone ? { text, tone } : { text };
}

function buildSummary(segments: ToolSummarySegment[]): ToolSummary {
  return {
    text: segments.map((item) => item.text).join(''),
    segments,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function basename(value: string): string {
  return value.replace(/\\/g, '/').split('/').pop() || value;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function quoteText(text: string): string {
  return `"${text}"`;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function countLines(content: unknown): number {
  if (typeof content !== 'string' || content.length === 0) return 0;
  return content.endsWith('\n')
    ? content.split('\n').length - 1
    : content.split('\n').length;
}

function nonEmptyLineCount(content: unknown): number {
  if (typeof content !== 'string' || content.length === 0) return 0;
  return content.split('\n').filter(Boolean).length;
}

function firstLine(content: unknown, maxChars = DEFAULT_TEXT_LIMIT): string {
  if (typeof content !== 'string') return '';
  return truncateText(compactWhitespace(content.split('\n')[0] ?? ''), maxChars);
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return truncateText(compactWhitespace(value), 48);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return 'empty';
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).length} fields}`;
  return String(value);
}

/**
 * 未知工具的通用摘要。
 *
 * 这是一个显式 fallback：调用方仍然能看见“有几个字段、前几个字段是什么”，
 * 但不会退回整段 JSON。这样既保持 fail-fast 的工具契约（已知工具缺字段时
 * 由专用摘要返回 undefined），又避免 Bot trace 变成原始对象转储。
 */
function genericSummary(value: unknown): ToolSummary | undefined {
  if (value == null) return undefined;

  if (typeof value === 'string') {
    const text = truncateText(compactWhitespace(value), DEFAULT_TEXT_LIMIT);
    return text ? buildSummary([segment(text)]) : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return buildSummary([segment(String(value))]);
  }

  if (Array.isArray(value)) {
    return buildSummary([segment(`${value.length} items`)]);
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return undefined;

    const samples = entries
      .slice(0, 3)
      .map(([key, item]) => `${key}=${formatScalar(item)}`);
    const suffix = entries.length > 3 ? `, +${entries.length - 3}` : '';
    return buildSummary([
      segment(`${entries.length} fields`),
      segment(` | ${samples.join(', ')}${suffix}`, 'muted'),
    ]);
  }

  return buildSummary([segment(String(value))]);
}

interface PathEntry {
  path: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Iris 的文件类工具历史上存在单文件参数和 files 数组两种形态。
 * 摘要层只做展示兼容，不承担参数校验；真正的校验仍属于工具 handler。
 */
function pathEntryFromValue(value: unknown): PathEntry | undefined {
  if (typeof value === 'string' && value.trim()) return { path: value.trim() };
  const record = asRecord(value);
  const path = stringValue(record.path || record.file_path).trim();
  if (!path) return undefined;
  const startLine = numberValue(record.startLine ?? record.start_line);
  const endLine = numberValue(record.endLine ?? record.end_line);
  return { path, startLine, endLine };
}

function getPathEntries(args: Record<string, unknown>, arrayKey: string, fallbackKeys: string[]): PathEntry[] {
  const arrayValue = args[arrayKey];
  if (Array.isArray(arrayValue)) {
    return arrayValue.map(pathEntryFromValue).filter((item): item is PathEntry => !!item);
  }

  for (const key of fallbackKeys) {
    const entry = pathEntryFromValue(args[key]);
    if (entry) return [entry];
  }

  return [];
}

function formatPathEntry(entry: PathEntry, options: { includeRange?: boolean } = {}): string {
  const range = options.includeRange && entry.startLine != null && entry.endLine != null
    ? `:${entry.startLine}-${entry.endLine}`
    : '';
  return `${entry.path}${range}`;
}

function summarizePathEntries(entries: PathEntry[], options: { includeRange?: boolean; useBasenameForMany?: boolean } = {}): string {
  if (entries.length === 0) return '';
  if (entries.length === 1) return formatPathEntry(entries[0], options);
  const first = options.useBasenameForMany ? basename(entries[0].path) : entries[0].path;
  return `${truncateText(first, PATH_TEXT_LIMIT)} +${entries.length - 1}`;
}

function summarizePatternList(value: unknown): string {
  const values = Array.isArray(value)
    ? value.map(String).filter(Boolean)
    : typeof value === 'string' && value ? [value] : [];
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  return `${truncateText(values[0], PATH_TEXT_LIMIT)} +${values.length - 1}`;
}

function summarizeToolCallByName(toolName: string, args: Record<string, unknown>): ToolSummary | undefined {
  switch (toolName) {
    case 'shell':
    case 'bash': {
      const command = compactWhitespace(stringValue(args.command));
      return command ? buildSummary([segment(truncateText(command, COMMAND_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'read_file': {
      const entries = getPathEntries(args, 'files', ['file', 'path', 'file_path']);
      const text = summarizePathEntries(entries, { includeRange: true });
      return text ? buildSummary([segment(truncateText(text, PATH_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'write_file':
    case 'apply_diff':
    case 'insert_code':
    case 'delete_code': {
      const entries = getPathEntries(args, 'files', ['path', 'file_path']);
      const text = summarizePathEntries(entries);
      return text ? buildSummary([segment(truncateText(text, PATH_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'search_in_files': {
      const query = truncateText(compactWhitespace(stringValue(args.query)), 40);
      if (!query) return undefined;
      const include = Array.isArray(args.include) ? args.include.map(String).filter(Boolean).join(', ') : '';
      const scope = include ? ` in ${truncateText(include, 40)}` : '';
      const mode = stringValue(args.mode);
      if (mode === 'replace') {
        const replace = truncateText(compactWhitespace(stringValue(args.replace)), 24);
        return buildSummary([segment(`${quoteText(query)} -> ${quoteText(replace)}${scope}`, 'muted')]);
      }
      return buildSummary([segment(`${quoteText(query)}${scope}`, 'muted')]);
    }

    case 'find_files': {
      const pattern = summarizePatternList(args.patterns ?? args.pattern);
      return pattern ? buildSummary([segment(truncateText(pattern, PATH_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'list_files': {
      const path = summarizePatternList(args.paths ?? args.path);
      return path ? buildSummary([segment(truncateText(path, PATH_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'read_skill': {
      const name = stringValue(args.name || args.path).trim();
      return name ? buildSummary([segment(truncateText(name, PATH_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'read_skill_resource':
    case 'execute_skill_script': {
      const name = stringValue(args.name).trim();
      const relativePath = stringValue(args.relativePath).trim();
      const text = [name, relativePath].filter(Boolean).join(' | ');
      return text ? buildSummary([segment(truncateText(text, PATH_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'invoke_skill': {
      const skill = stringValue(args.skill).trim();
      const skillArgs = compactWhitespace(stringValue(args.args));
      const preview = skillArgs ? ` ${truncateText(skillArgs, 40)}` : '';
      const text = `${skill}${preview}`.trim();
      return text ? buildSummary([segment(truncateText(text, PATH_TEXT_LIMIT), 'muted')]) : undefined;
    }

    case 'sub_agent': {
      const type = stringValue(args.type).trim();
      const prompt = stringValue(args.prompt).trim();
      const text = type && type !== 'general-purpose' ? type : prompt;
      return text ? buildSummary([segment(truncateText(compactWhitespace(text), 60), 'muted')]) : undefined;
    }

    default:
      return undefined;
  }
}

/**
 * 总结工具调用参数。
 *
 * 返回 undefined 表示参数为空且没有可展示摘要；调用方可以选择跳过这一行。
 */
export function summarizeToolCall(toolName: string, args?: Record<string, unknown>): ToolSummary | undefined {
  const normalizedArgs = args ?? {};
  return summarizeToolCallByName(toolName, normalizedArgs) ?? genericSummary(normalizedArgs);
}

interface ReadFileResultItem {
  path?: string;
  success?: boolean;
  lineCount?: number;
  startLine?: number;
  endLine?: number;
  error?: string;
}

function summarizeReadFileResult(result: Record<string, unknown>): ToolSummary | undefined {
  if (!Array.isArray(result.results)) return undefined;
  const items = result.results as ReadFileResultItem[];

  if (items.length === 0) return buildSummary([segment('0 lines', 'muted')]);

  if (items.length === 1) {
    const item = items[0];
    const path = item.path ?? '?';
    if (item.success === false) {
      const error = item.error ? ` | ${truncateText(compactWhitespace(item.error), 80)}` : '';
      return buildSummary([segment('failed', 'error'), segment(` | ${path}${error}`, 'muted')]);
    }
    const lines = item.lineCount ?? 0;
    const range = item.startLine != null && item.endLine != null ? `:${item.startLine}-${item.endLine}` : '';
    return buildSummary([segment(`${lines} lines`, 'accent'), segment(` | ${path}${range}`, 'muted')]);
  }

  const totalLines = items.reduce((sum, item) => sum + (item.success === false ? 0 : item.lineCount ?? 0), 0);
  const failed = items.filter((item) => item.success === false).length;
  const names = items.map((item) => basename(item.path ?? '?')).join(', ');
  const failedText = failed > 0 ? ` | ${failed} failed` : '';
  return buildSummary([
    segment(`${totalLines} lines`, 'accent'),
    segment(` | ${truncateText(names, PATH_TEXT_LIMIT)}${failedText}`, failed > 0 ? 'warning' : 'muted'),
  ]);
}

function summarizeShellResult(result: Record<string, unknown>): ToolSummary | undefined {
  const exitCode = numberValue(result.exitCode) ?? 0;
  const killed = booleanValue(result.killed) === true;
  const abortedByUser = booleanValue(result.abortedByUser) === true;

  if (abortedByUser) return buildSummary([segment('aborted by user', 'error')]);
  if (killed) return buildSummary([segment('killed (timeout)', 'warning')]);

  if (exitCode !== 0) {
    const reason = firstLine(result.stderr, 100) || `exit ${exitCode}`;
    return buildSummary([segment(`failed: ${reason}`, 'error')]);
  }

  const lines = nonEmptyLineCount(result.stdout);
  const text = lines > 0 ? `${lines} lines output` : 'done (no output)';
  return buildSummary([segment(text, 'success')]);
}

function summarizeWriteFileResult(result: Record<string, unknown>, args: Record<string, unknown>): ToolSummary | undefined {
  const path = stringValue(result.path || args.path || args.file_path).trim();
  if (!path) return undefined;

  const action = stringValue(result.action || (result.success === false ? 'failed' : 'written')) || 'written';
  if (result.success === false) {
    const error = stringValue(result.error);
    return buildSummary([
      segment(action, 'error'),
      segment(` | ${path}${error ? ` | ${truncateText(compactWhitespace(error), 80)}` : ''}`, 'muted'),
    ]);
  }

  if (action === 'unchanged') return buildSummary([segment('unchanged'), segment(` | ${path}`, 'muted')]);

  const lines = countLines(args.content);
  const lineText = lines > 0
    ? `${action === 'created' ? '+' : '~'}${lines} lines | `
    : '';
  return buildSummary([
    ...(lineText ? [segment(lineText, action === 'created' ? 'success' : 'accent')] : []),
    segment(action),
    segment(` | ${path}`, 'muted'),
  ]);
}

function countPatchChanges(patch: unknown): { added: number; deleted: number } {
  if (typeof patch !== 'string') return { added: 0, deleted: 0 };
  let added = 0;
  let deleted = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) deleted++;
  }
  return { added, deleted };
}

function summarizeApplyDiffResult(result: Record<string, unknown>, args: Record<string, unknown>): ToolSummary | undefined {
  const applied = numberValue(result.applied);
  const totalHunks = numberValue(result.totalHunks);
  if (applied == null || totalHunks == null) return undefined;

  const failed = numberValue(result.failed) ?? 0;
  const path = stringValue(result.path || args.path).trim();
  const { added, deleted } = countPatchChanges(args.patch);
  const changes = [
    added > 0 ? `+${added}` : '',
    deleted > 0 ? `-${deleted}` : '',
  ].filter(Boolean).join(' ');

  const parts: ToolSummarySegment[] = [];
  if (changes) parts.push(segment(`${changes} | `, failed > 0 ? 'warning' : 'accent'));
  parts.push(segment(`${applied}/${totalHunks} hunks`));
  if (failed > 0) parts.push(segment(` | ${failed} failed`, 'warning'));
  if (path) parts.push(segment(` | ${path}`, 'muted'));
  return buildSummary(parts);
}

function summarizeSearchInFilesResult(result: Record<string, unknown>, args: Record<string, unknown>): ToolSummary | undefined {
  const mode = stringValue(result.mode || args.mode || 'search');
  const truncated = result.truncated === true;
  const suffix = truncated ? ' | truncated' : '';

  if (mode === 'replace') {
    const total = numberValue(result.totalReplacements) ?? 0;
    const processedFiles = numberValue(result.processedFiles) ?? 0;
    const results = Array.isArray(result.results) ? result.results as Array<Record<string, unknown>> : [];
    const changedFiles = results.length > 0
      ? results.filter((item) => item.changed === true).length
      : processedFiles;
    const query = stringValue(args.query);
    const replace = stringValue(args.replace);
    const detail = query ? ` | ${quoteText(truncateText(query, 24))} -> ${quoteText(truncateText(replace, 24))}` : '';
    return buildSummary([
      segment(`${total} replacements`, 'accent'),
      segment(` | ${changedFiles}/${processedFiles} files${detail}${suffix}`, truncated ? 'warning' : 'muted'),
    ]);
  }

  const count = numberValue(result.count);
  if (count == null) return undefined;
  return buildSummary([
    segment(`${count} matches found`),
    ...(suffix ? [segment(suffix, 'warning')] : []),
  ]);
}

function summarizeFindFilesResult(result: Record<string, unknown>): ToolSummary | undefined {
  const count = numberValue(result.count);
  if (count == null) return undefined;
  const suffix = result.truncated === true ? ' | truncated' : '';
  return buildSummary([
    segment(`${count} files found`),
    ...(suffix ? [segment(suffix, 'warning')] : []),
  ]);
}

function summarizeListFilesResult(result: Record<string, unknown>): ToolSummary | undefined {
  const totalFiles = numberValue(result.totalFiles);
  const totalDirs = numberValue(result.totalDirs);
  if (totalFiles == null && totalDirs == null) return undefined;

  const results = Array.isArray(result.results) ? result.results as Array<Record<string, unknown>> : [];
  const failed = results.filter((item) => item.success === false).length;
  const truncated = result.truncated === true ? ' | truncated' : '';
  return buildSummary([
    segment(`${totalFiles ?? 0} files, ${totalDirs ?? 0} dirs`),
    ...(failed > 0 ? [segment(` | ${failed} failed`, 'warning')] : []),
    ...(truncated ? [segment(truncated, 'warning')] : []),
  ]);
}

function summarizeInsertCodeResult(result: Record<string, unknown>): ToolSummary | undefined {
  const path = stringValue(result.path).trim();
  if (!path) return undefined;

  if (result.success === false) {
    const error = stringValue(result.error);
    return buildSummary([segment(`failed${error ? `: ${truncateText(compactWhitespace(error), 80)}` : ''}`, 'error')]);
  }

  const inserted = numberValue(result.insertedLines) ?? 0;
  const line = numberValue(result.line);
  return buildSummary([
    segment(`+${inserted} lines`, 'success'),
    segment(`${line != null ? ` | L${line}` : ''} | ${path}`, 'muted'),
  ]);
}

function summarizeDeleteCodeResult(result: Record<string, unknown>): ToolSummary | undefined {
  const path = stringValue(result.path).trim();
  if (!path) return undefined;

  if (result.success === false) {
    const error = stringValue(result.error);
    return buildSummary([segment(`failed${error ? `: ${truncateText(compactWhitespace(error), 80)}` : ''}`, 'error')]);
  }

  const deleted = numberValue(result.deletedLines) ?? 0;
  const startLine = numberValue(result.start_line);
  const endLine = numberValue(result.end_line);
  const range = startLine != null && endLine != null ? ` | L${startLine}-${endLine}` : '';
  return buildSummary([
    segment(`-${deleted} lines`, 'error'),
    segment(`${range} | ${path}`, 'muted'),
  ]);
}

function unwrapSkillPayload(result: unknown): Record<string, unknown> {
  const root = asRecord(result);
  const rich = asRecord(root.__response);
  if (Object.keys(rich).length > 0) return rich;
  const nested = asRecord(root.result);
  if (Object.keys(nested).length > 0) return nested;
  return root;
}

function summarizeSkillResult(toolName: string, result: unknown): ToolSummary | undefined {
  const payload = unwrapSkillPayload(result);
  if (Object.keys(payload).length === 0) return undefined;

  const name = stringValue(payload.skillName || payload.name).trim() || 'skill';
  const relativePath = stringValue(payload.relativePath).trim();
  const label = (toolName === 'read_skill_resource' || toolName === 'execute_skill_script') && relativePath
    ? `${name}/${relativePath}`
    : name;
  const details = [
    typeof payload.content === 'string' ? `${payload.content.length} chars` : '',
    typeof payload.output === 'string' ? `${payload.output.length} output chars` : '',
    Array.isArray(payload.resources) && payload.resources.length > 0 ? `${payload.resources.length} resources` : '',
    typeof payload.exitCode === 'number' ? `exit ${payload.exitCode}` : '',
    payload.killed === true ? 'killed' : '',
    payload.truncated === true ? 'truncated' : '',
  ].filter(Boolean);

  return buildSummary([
    segment(label),
    ...(details.length > 0 ? [segment(` | ${details.join(' | ')}`, 'muted')] : []),
  ]);
}

/**
 * 结果摘要只依赖工具公开返回对象中的稳定字段。
 * 例如 read_file 读取 lineCount/path，shell 读取 exitCode/stdout/stderr。
 * 不在这里解析工具的大段 content/stdout 全量文本，避免摘要层变成第二套详情视图。
 */
function summarizeResultByName(toolName: string, args: Record<string, unknown>, result: unknown): ToolSummary | undefined {
  const record = asRecord(result);

  switch (toolName) {
    case 'shell':
    case 'bash':
      return summarizeShellResult(record);
    case 'read_file':
      return summarizeReadFileResult(record);
    case 'write_file':
      return summarizeWriteFileResult(record, args);
    case 'apply_diff':
      return summarizeApplyDiffResult(record, args);
    case 'search_in_files':
      return summarizeSearchInFilesResult(record, args);
    case 'find_files':
      return summarizeFindFilesResult(record);
    case 'list_files':
      return summarizeListFilesResult(record);
    case 'insert_code':
      return summarizeInsertCodeResult(record);
    case 'delete_code':
      return summarizeDeleteCodeResult(record);
    case 'read_skill':
    case 'read_skill_resource':
    case 'execute_skill_script':
    case 'invoke_skill':
      return summarizeSkillResult(toolName, result);
    default:
      return undefined;
  }
}

/**
 * 总结工具终态结果。
 *
 * 专用摘要缺少必要字段时会回到通用字段摘要；这不是静默降级到 JSON，
 * 而是保持“可读但不伪装成已知工具语义”的展示契约。
 */
export function summarizeToolResult(
  toolName: string,
  args: Record<string, unknown> | undefined,
  result: unknown,
): ToolSummary | undefined {
  if (result == null) return undefined;
  const normalizedArgs = args ?? {};
  return summarizeResultByName(toolName, normalizedArgs, result) ?? genericSummary(result);
}

/**
 * 总结执行中进度。
 *
 * 当前核心进度格式主要来自 sub_agent：childStatus / streamingText / tokens。
 * 其他工具可以返回任意 progress 对象，未知结构会用通用字段摘要展示。
 */
export function summarizeToolProgress(
  _toolName: string,
  _args: Record<string, unknown> | undefined,
  progress: Record<string, unknown> | undefined,
): ToolSummary | undefined {
  if (!progress || Object.keys(progress).length === 0) return undefined;

  const childStatus = stringValue(progress.childStatus).trim();
  const streamingText = stringValue(progress.streamingText).trim();
  const tokens = numberValue(progress.tokens);
  const primary = childStatus || streamingText;
  const parts = [
    primary ? truncateText(compactWhitespace(primary), DEFAULT_TEXT_LIMIT) : '',
    tokens != null && tokens > 0 ? `${tokens.toLocaleString()} tokens` : '',
  ].filter(Boolean);

  if (parts.length > 0) return buildSummary([segment(parts.join(' | '), 'muted')]);
  return genericSummary(progress);
}
