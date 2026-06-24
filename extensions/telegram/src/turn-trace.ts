/**
 * Telegram turn trace 聚合器。
 *
 * 该模块只处理 Telegram 展示层状态：把 Backend 的结构化 part 增量与
 * ToolExecutionHandle 快照合并成一个按时间排列的 trace timeline。
 * Backend 历史、LLM 上下文和工具执行契约都不受影响。
 */
import {
  TOOL_STATUS_LABELS,
  isFunctionCallPart,
  isThoughtTextPart,
  summarizeToolCall,
  summarizeToolProgress,
  summarizeToolResult,
  type FunctionCallPart,
  type Part,
  type ToolExecutionHandleLike,
  type ToolInvocation,
  type ToolOutputEntry,
  type ToolStatus,
} from 'irises-extension-sdk';
import type { TelegramTraceSection } from './rich-message';

const TRACE_SECTION_CHAR_LIMIT = 9000;
const THOUGHT_BLOCK_CHAR_LIMIT = 1600;
const VALUE_SUMMARY_CHAR_LIMIT = 500;
const OUTPUT_SUMMARY_CHAR_LIMIT = 240;
const MAX_OUTPUT_ENTRIES = 3;

interface TelegramTraceThoughtBlock {
  kind: 'thought';
  text: string;
  durationMs?: number;
}

interface TelegramTraceToolBlock {
  kind: 'tool';
  handleId?: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: unknown;
  error?: string;
  progress?: Record<string, unknown>;
  outputs: ToolOutputEntry[];
  children: TelegramTraceToolBlock[];
  createdAt: number;
  updatedAt: number;
}

type TelegramTraceBlock = TelegramTraceThoughtBlock | TelegramTraceToolBlock;

export interface AppendTracePartsOptions {
  includeTools?: boolean;
}

export class TelegramTurnTraceCollector {
  private blocks: TelegramTraceBlock[] = [];
  private toolBlocksByHandleId = new Map<string, TelegramTraceToolBlock>();

  appendParts(parts: Part[], options: AppendTracePartsOptions = {}): boolean {
    const includeTools = options.includeTools !== false;
    let changed = false;

    for (const part of parts) {
      if (isThoughtTextPart(part) && part.text) {
        this.appendThought(part.text, part.thoughtDurationMs);
        changed = true;
        continue;
      }

      if (includeTools && isFunctionCallPart(part)) {
        this.appendToolCall(part);
        changed = true;
      }
    }

    return changed;
  }

  bindToolHandle(handle: ToolExecutionHandleLike): void {
    const block = this.resolveToolBlock(handle);
    this.updateToolBlockFromHandle(block, handle);
  }

  updateToolHandle(handle: ToolExecutionHandleLike): void {
    this.bindToolHandle(handle);
  }

  toTraceSections(): TelegramTraceSection[] {
    if (this.blocks.length === 0) return [];

    const hasTool = this.blocks.some((block) => block.kind === 'tool');
    const content = hasTool ? this.renderTimeline() : this.renderThoughtsOnly();
    if (!content.trim()) return [];

    return [{
      title: hasTool ? '执行过程' : '思考过程',
      content,
      format: 'text',
    }];
  }

  private appendThought(text: string, durationMs?: number): void {
    const last = this.blocks[this.blocks.length - 1];
    if (last?.kind === 'thought') {
      last.text += text;
      if (durationMs != null) last.durationMs = durationMs;
      return;
    }

    this.blocks.push({ kind: 'thought', text, durationMs });
  }

  private appendToolCall(part: FunctionCallPart): void {
    const now = Date.now();
    this.blocks.push({
      kind: 'tool',
      toolName: part.functionCall.name,
      args: part.functionCall.args ?? {},
      status: 'queued',
      outputs: [],
      children: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  private resolveToolBlock(handle: ToolExecutionHandleLike): TelegramTraceToolBlock {
    const bound = this.toolBlocksByHandleId.get(handle.id);
    if (bound) return bound;

    const snapshot = handle.getSnapshot();
    const parentId = handle.parentId;
    if (parentId) {
      // 子工具通过 handle.parentId 建树。若父工具尚未绑定，保持事件顺序本身：
      // 先把子工具放入根 timeline，避免吞掉可见 trace。
      const parent = this.toolBlocksByHandleId.get(parentId);
      const child = this.createToolBlockFromSnapshot(snapshot, handle);
      if (parent) {
        parent.children.push(child);
      } else {
        this.blocks.push(child);
      }
      this.toolBlocksByHandleId.set(handle.id, child);
      return child;
    }

    const existing = this.findUnboundRootToolBlock(snapshot);
    if (existing) {
      this.toolBlocksByHandleId.set(handle.id, existing);
      return existing;
    }

    const created = this.createToolBlockFromSnapshot(snapshot, handle);
    this.blocks.push(created);
    this.toolBlocksByHandleId.set(handle.id, created);
    return created;
  }

  private findUnboundRootToolBlock(snapshot: ToolInvocation): TelegramTraceToolBlock | undefined {
    // assistant:content 中的 functionCall 会先生成一个未绑定 block；
    // 随后的 tool:execute 才带来真实 handle id。这里用稳定 args 匹配把两者合并，
    // 避免 Telegram trace 中同一个工具调用重复出现。
    const toolBlocks = this.blocks.filter((block): block is TelegramTraceToolBlock => block.kind === 'tool');
    return toolBlocks.find((block) => (
      !block.handleId
      && block.toolName === snapshot.toolName
      && stableStringify(block.args) === stableStringify(snapshot.args ?? {})
    )) ?? toolBlocks.find((block) => !block.handleId && block.toolName === snapshot.toolName);
  }

  private createToolBlockFromSnapshot(snapshot: ToolInvocation, handle: ToolExecutionHandleLike): TelegramTraceToolBlock {
    const now = Date.now();
    return {
      kind: 'tool',
      handleId: handle.id,
      toolName: handle.toolName,
      args: snapshot.args ?? {},
      status: handle.status,
      result: snapshot.result,
      error: snapshot.error,
      progress: snapshot.progress,
      outputs: handle.getOutputHistory(),
      children: [],
      createdAt: snapshot.createdAt ?? now,
      updatedAt: snapshot.updatedAt ?? now,
    };
  }

  private updateToolBlockFromHandle(block: TelegramTraceToolBlock, handle: ToolExecutionHandleLike): void {
    const snapshot = handle.getSnapshot();
    block.handleId = handle.id;
    block.toolName = handle.toolName;
    block.args = snapshot.args ?? {};
    block.status = handle.status;
    block.result = snapshot.result;
    block.error = snapshot.error;
    block.progress = snapshot.progress;
    block.outputs = handle.getOutputHistory();
    block.createdAt = snapshot.createdAt ?? block.createdAt;
    block.updatedAt = snapshot.updatedAt ?? Date.now();
  }

  private renderThoughtsOnly(): string {
    const content = this.blocks
      .filter((block): block is TelegramTraceThoughtBlock => block.kind === 'thought')
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join('\n\n');
    return limitTraceSection(content);
  }

  private renderTimeline(): string {
    const rendered = this.blocks
      .map((block) => block.kind === 'thought' ? renderThoughtBlock(block, 0) : renderToolBlock(block, 0))
      .filter(Boolean)
      .join('\n\n');
    return limitTraceSection(rendered);
  }
}

function renderThoughtBlock(block: TelegramTraceThoughtBlock, indent: number): string {
  const text = block.text.trim();
  if (!text) return '';

  const pad = indentText(indent);
  const duration = block.durationMs != null ? ` ${formatDuration(block.durationMs)}` : '';
  return [
    `${pad}thinking${duration}`,
    indentMultiline(truncateText(text, THOUGHT_BLOCK_CHAR_LIMIT), indent + 1),
  ].join('\n');
}

function renderToolBlock(block: TelegramTraceToolBlock, indent: number): string {
  const pad = indentText(indent);
  const label = TOOL_STATUS_LABELS[block.status] ?? block.status;
  const duration = isTerminalStatus(block.status) ? formatToolDuration(block) : '';
  const lines = [`${pad}tool ${block.toolName} ${label}${duration ? ` ${duration}` : ''}`];

  // 工具摘要来自 SDK 的平台无关 formatter；Telegram 这里只负责排版 timeline，
  // 不复制 TUI/Web 的工具语义规则，也不把 raw args/result JSON 暴露给用户。
  const call = summarizeToolCall(block.toolName, block.args);
  if (call) lines.push(`${pad}  call: ${call.text}`);

  const progress = summarizeToolProgress(block.toolName, block.args, block.progress);
  if (progress && !isTerminalStatus(block.status)) lines.push(`${pad}  progress: ${progress.text}`);

  appendOutputLines(lines, block, pad);

  for (const child of block.children) {
    const rendered = renderToolBlock(child, indent + 1);
    if (rendered) lines.push(rendered);
  }

  const error = summarizeToolError(block.error);
  if (error) {
    lines.push(`${pad}  error: ${error}`);
  } else if (isTerminalStatus(block.status)) {
    const result = summarizeToolResult(block.toolName, block.args, block.result);
    if (result) lines.push(`${pad}  result: ${result.text}`);
  }

  return lines.join('\n');
}

function appendOutputLines(lines: string[], block: TelegramTraceToolBlock, pad: string): void {
  if (block.outputs.length === 0) return;

  // output 是执行过程中的流式日志/子代理对话片段；只展示最近几条，
  // 完整历史仍由 ToolExecutionHandle 保留，Telegram trace 保持轻量。
  const visible = block.outputs.length > MAX_OUTPUT_ENTRIES
    ? block.outputs.slice(-MAX_OUTPUT_ENTRIES)
    : block.outputs;
  const skipped = block.outputs.length - visible.length;
  if (skipped > 0) lines.push(`${pad}  output: ... ${skipped} earlier entries`);

  for (const entry of visible) {
    const content = truncateText(compactWhitespace(entry.content), OUTPUT_SUMMARY_CHAR_LIMIT);
    if (content) lines.push(`${pad}  ${entry.type}: ${content}`);
  }
}

function summarizeToolError(error: string | undefined): string | undefined {
  if (!error) return undefined;
  return truncateText(compactWhitespace(error), VALUE_SUMMARY_CHAR_LIMIT);
}

function isTerminalStatus(status: string): boolean {
  return status === 'success' || status === 'warning' || status === 'error';
}

function formatToolDuration(block: TelegramTraceToolBlock): string {
  const elapsed = block.updatedAt - block.createdAt;
  return elapsed > 0 ? formatDuration(elapsed) : '';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)}s`;
}

function limitTraceSection(text: string): string {
  return truncateText(text, TRACE_SECTION_CHAR_LIMIT, '\n... trace truncated ...');
}

function truncateText(text: string, maxChars: number, suffix = '...'): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  const suffixChars = Array.from(suffix);
  return `${chars.slice(0, Math.max(0, maxChars - suffixChars.length)).join('')}${suffix}`;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function indentText(level: number): string {
  return '  '.repeat(level);
}

function indentMultiline(text: string, level: number): string {
  const pad = indentText(level);
  return text.split('\n').map((line) => `${pad}${line}`).join('\n');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value)) ?? String(value);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }
  return value;
}
