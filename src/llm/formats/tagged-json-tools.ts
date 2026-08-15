/**
 * Tagged JSON 文本工具协议。
 *
 * 使用 XML 风格标签做流式分帧，标签内部保持 JSON 载荷：
 *   <tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>
 *
 * 该模块只负责文本协议与内部 FunctionCallPart / FunctionResponsePart 的转换，
 * 不执行工具，也不绕过 ToolLoop / scheduler 的校验和审批边界。
 */

import {
  isFunctionCallPart,
  isFunctionResponsePart,
  isVisibleTextPart,
} from '../../types';
import type {
  FunctionCallPart,
  FunctionDeclaration,
  Part,
} from '../../types';

export const TAGGED_JSON_TOOL_CALL_OPEN = '<tool_call>';
export const TAGGED_JSON_TOOL_CALL_CLOSE = '</tool_call>';
export const TAGGED_JSON_TOOL_RESULT_OPEN = '<tool_result>';
export const TAGGED_JSON_TOOL_RESULT_CLOSE = '</tool_result>';

type TaggedJsonToolFrameKind = 'tagged-json' | 'dsml';

interface TaggedJsonToolFrame {
  open: string;
  close: string;
  kind: TaggedJsonToolFrameKind;
}

/** 部分 Kimi 兼容渠道会在正文中暴露其内部 DSML 调用边界。 */
const TOOL_CALL_FRAMES: readonly TaggedJsonToolFrame[] = [
  { open: TAGGED_JSON_TOOL_CALL_OPEN, close: TAGGED_JSON_TOOL_CALL_CLOSE, kind: 'tagged-json' },
  { open: '<|DSML|_call>', close: '</|DSML|_call>', kind: 'dsml' },
  { open: '<｜DSML｜_call>', close: '</｜DSML｜_call>', kind: 'dsml' },
  { open: '<|DSML｜_call>', close: '</|DSML｜_call>', kind: 'dsml' },
  { open: '<｜DSML|_call>', close: '</｜DSML|_call>', kind: 'dsml' },
];
const COMPLETE_DSML_CALL_ENVELOPE = /^\s*<[|｜]DSML[|｜]_call>\s*([\s\S]*?)\s*<\/[|｜]DSML[|｜]_call>\s*$/i;

/** 防止缺失闭合标签时无限缓存模型输出。 */
const MAX_BUFFERED_TOOL_CALL_CHARS = 1_000_000;

let taggedCallPrefixCounter = 0;

export interface TaggedJsonToolStreamState {
  /** 尚不能确定是普通文本还是标签前缀，或正在累积的工具 JSON。 */
  buffer: string;
  insideToolCall: boolean;
  activeOpenTag?: string;
  activeCloseTag?: string;
  activeFrameKind?: TaggedJsonToolFrameKind;
  /** 裸 JSON 兼容只允许覆盖整条 assistant 正文，因此仅在内容起点判断。 */
  atContentStart: boolean;
  bufferingBareJson: boolean;
  callIdPrefix: string;
  nextCallIndex: number;
}

interface ParsedTaggedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** 每个响应/流使用独立前缀，保证多会话并发和多轮历史中的 callId 不冲突。 */
export function createTaggedJsonToolStreamState(callIdPrefix?: string): TaggedJsonToolStreamState {
  const prefixSequence = ++taggedCallPrefixCounter;
  return {
    buffer: '',
    insideToolCall: false,
    atContentStart: true,
    bufferingBareJson: false,
    callIdPrefix: callIdPrefix
      ?? `tagged_${Date.now().toString(36)}_${prefixSequence.toString(36)}`,
    nextCallIndex: 0,
  };
}

/** 将工具声明注入 system prompt，供不支持原生 tools 的模型选择工具。 */
export function buildTaggedJsonToolPrompt(declarations: FunctionDeclaration[]): string {
  const tools = declarations.map(declaration => ({
    name: declaration.name,
    description: declaration.description,
    parameters: declaration.parameters ?? { type: 'object', properties: {} },
  }));

  return [
    'You can call tools using the Tagged JSON tool protocol.',
    `Emit exactly one ${TAGGED_JSON_TOOL_CALL_OPEN}{"name":"tool_name","arguments":{"key":"value"}}${TAGGED_JSON_TOOL_CALL_CLOSE} block for each tool call.`,
    'The payload must be a valid JSON object. "name" must be an available tool name and "arguments" must be a JSON object.',
    'Every top-level key in "arguments" must exactly match a property from that tool schema, and every required property must be present.',
    'Do not invent wrapper keys such as "parameters", "input", or "__unparsedToolInput" unless that exact key exists in the tool schema.',
    'Never emit a partial JSON value or an unclosed <tool_call> block. If the arguments are not complete, do not emit the tool call yet.',
    'Tool calls must be emitted in ordinary assistant content, never only in hidden reasoning or thinking fields.',
    'If you decide or say that you will inspect, read, search, run, check, or otherwise use a tool, that same response must contain the complete <tool_call> block.',
    'Never end a response with only a promise, plan, or preamble such as "I will check..." or "Let me inspect...". Emit the tool call now, or give a complete final answer without claiming the action is underway.',
    'Compatibility fallback: if your gateway cannot preserve <tool_call> tags, emit only the same {"name":"tool_name","arguments":{...}} JSON object as the entire assistant content, with no prose or Markdown around it.',
    'Do not nest provider-specific wrappers such as DSML inside <tool_call>; emit either the standard complete block or the bare JSON fallback.',
    'For multiple tool calls, emit multiple complete <tool_call> blocks. Do not wrap them in Markdown code fences.',
    `Tool results are returned by Iris as ${TAGGED_JSON_TOOL_RESULT_OPEN}{"call_id":"...","name":"...","result":{...}}${TAGGED_JSON_TOOL_RESULT_CLOSE}. Never invent tool results yourself.`,
    'If no tool is needed, answer normally without tool tags.',
    `Available tools (JSON): ${stringifyProtocolJson(tools)}`,
  ].join('\n');
}

/** 为被丢弃的“只承诺调用”候选响应生成一次更靠后的强制纠偏指令。 */
export function buildTaggedJsonToolRepairPrompt(attempt: number): string {
  return [
    `[Tagged JSON protocol repair, attempt ${attempt}]`,
    'Your previous candidate response was discarded because it announced a tool action but emitted no tool call.',
    'Do not repeat the promise or preamble.',
    `If the request requires a tool, emit the complete ${TAGGED_JSON_TOOL_CALL_OPEN}{"name":"tool_name","arguments":{"key":"value"}}${TAGGED_JSON_TOOL_CALL_CLOSE} block now in ordinary assistant content, using an available tool name and its exact schema keys. If the gateway strips those tags, emit that JSON object alone as the entire content.`,
    'Otherwise provide a complete final answer without saying that you will inspect, read, search, run, or check something.',
  ].join('\n');
}

/** 将内部 model 消息按原顺序编码为可回传的 tagged JSON 历史。 */
export function encodeTaggedJsonAssistantContent(parts: Part[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    if (isVisibleTextPart(part)) {
      if (part.text) segments.push(part.text);
      continue;
    }
    if (!isFunctionCallPart(part)) continue;

    const payload = {
      name: part.functionCall.name,
      arguments: part.functionCall.args,
      ...(part.functionCall.callId ? { call_id: part.functionCall.callId } : {}),
    };
    segments.push(
      `${TAGGED_JSON_TOOL_CALL_OPEN}${stringifyProtocolJson(payload)}${TAGGED_JSON_TOOL_CALL_CLOSE}`,
    );
  }
  return segments.join('\n');
}

/** 将同一轮的一个或多个工具结果编码为单条 user 文本消息。 */
export function encodeTaggedJsonToolResults(parts: Part[]): string {
  const blocks: string[] = [];
  for (const part of parts) {
    if (!isFunctionResponsePart(part)) continue;
    const payload = {
      ...(part.functionResponse.callId ? { call_id: part.functionResponse.callId } : {}),
      name: part.functionResponse.name,
      result: part.functionResponse.response,
    };
    blocks.push(
      `${TAGGED_JSON_TOOL_RESULT_OPEN}${stringifyProtocolJson(payload)}${TAGGED_JSON_TOOL_RESULT_CLOSE}`,
    );
  }
  return blocks.join('\n');
}

/** 非流式文本解码；与流式解析共用同一状态机和边界行为。 */
export function decodeTaggedJsonToolText(text: string, callIdPrefix?: string): Part[] {
  const state = createTaggedJsonToolStreamState(callIdPrefix);
  return consumeTaggedJsonToolText(state, text, true);
}

/**
 * 增量消费可见文本。
 *
 * - 普通文本尽快返回，仅保留可能构成 `<tool_call>` 的最短尾部。
 * - 进入工具块后缓存到完整闭合标签，再一次性解析并产出 FunctionCallPart。
 * - 格式错误或流结束时仍未闭合的块按原文本返回，绝不执行部分/非法 JSON。
 */
export function consumeTaggedJsonToolText(
  state: TaggedJsonToolStreamState,
  delta: string,
  finish = false,
): Part[] {
  if (delta) state.buffer += delta;
  const emitted: Part[] = [];

  // 一些兼容渠道会保留 JSON 载荷却剥掉 <tool_call> 标签。仅当整条正文从
  // 第一个非空白字符起就是 JSON 对象/数组时延迟输出，并在流结束后做严格恢复。
  // 普通 prose 仍沿用原来的增量输出路径。
  if (!state.insideToolCall && state.atContentStart) {
    const trimmedStart = state.buffer.trimStart();
    if (!trimmedStart) {
      if (!finish && state.buffer.length <= MAX_BUFFERED_TOOL_CALL_CHARS) return emitted;
      state.atContentStart = false;
    } else {
      state.atContentStart = false;
      state.bufferingBareJson = trimmedStart.startsWith('{') || trimmedStart.startsWith('[');
    }
  }

  if (state.bufferingBareJson) {
    if (!finish && state.buffer.length <= MAX_BUFFERED_TOOL_CALL_CHARS) return emitted;

    const parsedCalls = finish ? parseBareJsonToolCallPayload(state.buffer) : undefined;
    if (parsedCalls) appendParsedToolCalls(emitted, state, parsedCalls);
    else appendVisibleText(emitted, state.buffer);
    state.buffer = '';
    state.bufferingBareJson = false;
    return emitted;
  }

  while (true) {
    if (state.insideToolCall) {
      const openTag = state.activeOpenTag ?? TAGGED_JSON_TOOL_CALL_OPEN;
      const closeTag = state.activeCloseTag ?? TAGGED_JSON_TOOL_CALL_CLOSE;
      const frameKind = state.activeFrameKind ?? 'tagged-json';
      const closeIndex = state.buffer.indexOf(closeTag);
      if (closeIndex < 0) {
        if (finish || state.buffer.length > MAX_BUFFERED_TOOL_CALL_CHARS) {
          // 某些渠道输出 `<tool_call><|DSML|_call>{完整 JSON}</...>`，却丢掉
          // 最外层 `</tool_call>`。只有完整 DSML 内层能提供独立、严格的结束边界；
          // 普通未闭合 JSON 仍按原文返回，绝不推测执行。
          const recovered = finish && frameKind === 'tagged-json'
            ? parseCompleteDsmlToolCallEnvelope(state.buffer)
            : undefined;
          if (recovered) appendParsedToolCalls(emitted, state, recovered);
          else appendVisibleText(emitted, openTag + state.buffer);
          state.buffer = '';
          clearActiveToolCallFrame(state);
        }
        return emitted;
      }

      const payloadText = state.buffer.slice(0, closeIndex);
      const rawBlock = openTag
        + payloadText
        + closeTag;
      state.buffer = state.buffer.slice(closeIndex + closeTag.length);
      clearActiveToolCallFrame(state);

      const parsedCalls = frameKind === 'dsml'
        ? parseBareJsonToolCallPayload(payloadText)
        : parseTaggedToolCallPayload(payloadText);
      if (!parsedCalls) {
        appendVisibleText(emitted, rawBlock);
      } else {
        appendParsedToolCalls(emitted, state, parsedCalls);
      }
      continue;
    }

    const opening = findNextToolCallOpening(state.buffer);
    if (opening) {
      appendVisibleText(emitted, state.buffer.slice(0, opening.index));
      state.buffer = state.buffer.slice(opening.index + opening.frame.open.length);
      state.insideToolCall = true;
      state.activeOpenTag = opening.frame.open;
      state.activeCloseTag = opening.frame.close;
      state.activeFrameKind = opening.frame.kind;
      continue;
    }

    if (finish) {
      appendVisibleText(emitted, state.buffer);
      state.buffer = '';
      return emitted;
    }

    const retainedLength = longestOpeningTagPrefixSuffix(state.buffer);
    const visibleLength = state.buffer.length - retainedLength;
    appendVisibleText(emitted, state.buffer.slice(0, visibleLength));
    state.buffer = state.buffer.slice(visibleLength);
    return emitted;
  }
}

function parseCompleteDsmlToolCallEnvelope(payloadText: string): ParsedTaggedToolCall[] | undefined {
  const match = COMPLETE_DSML_CALL_ENVELOPE.exec(payloadText);
  return match ? parseBareJsonToolCallPayload(match[1]) : undefined;
}

function clearActiveToolCallFrame(state: TaggedJsonToolStreamState): void {
  state.insideToolCall = false;
  state.activeOpenTag = undefined;
  state.activeCloseTag = undefined;
  state.activeFrameKind = undefined;
}

function findNextToolCallOpening(
  value: string,
): { index: number; frame: TaggedJsonToolFrame } | undefined {
  let found: { index: number; frame: TaggedJsonToolFrame } | undefined;
  for (const frame of TOOL_CALL_FRAMES) {
    const index = value.indexOf(frame.open);
    if (index < 0 || (found && index >= found.index)) continue;
    found = { index, frame };
  }
  return found;
}

/**
 * 裸 JSON 的恢复条件比标签内载荷更严格：整条内容必须是单个调用对象或调用数组，
 * 必须显式包含 arguments/args，且不得混入说明性字段。这样普通 JSON 回答不会
 * 因为偶然包含 name 字段而被当成工具调用执行。
 */
function parseBareJsonToolCallPayload(payloadText: string): ParsedTaggedToolCall[] | undefined {
  const normalized = payloadText.trim();
  if (!normalized) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return undefined;
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (candidates.length === 0) return undefined;
  const allowedKeys = new Set(['name', 'arguments', 'args', 'call_id', 'id']);
  for (const candidate of candidates) {
    if (!isRecord(candidate)) return undefined;
    if (!Object.hasOwn(candidate, 'arguments') && !Object.hasOwn(candidate, 'args')) return undefined;
    if (Object.keys(candidate).some(key => !allowedKeys.has(key))) return undefined;
  }

  return parseTaggedToolCallPayload(normalized);
}

function appendParsedToolCalls(
  parts: Part[],
  state: TaggedJsonToolStreamState,
  parsedCalls: ParsedTaggedToolCall[],
): void {
  for (const parsed of parsedCalls) {
    const call: FunctionCallPart = {
      functionCall: {
        name: parsed.name,
        args: parsed.args,
        callId: `${state.callIdPrefix}_${state.nextCallIndex++}`,
      },
    };
    parts.push(call);
  }
}

function parseTaggedToolCallPayload(payloadText: string): ParsedTaggedToolCall[] | undefined {
  let normalized = payloadText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(normalized);
  if (fenced) normalized = fenced[1].trim();
  if (!normalized) return undefined;

  const dsml = COMPLETE_DSML_CALL_ENVELOPE.exec(normalized);
  if (dsml) return parseBareJsonToolCallPayload(dsml[1]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return undefined;
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (candidates.length === 0) return undefined;

  const calls: ParsedTaggedToolCall[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) return undefined;
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (!name) return undefined;

    let args: unknown = candidate.arguments ?? candidate.args ?? {};
    if (typeof args === 'string') {
      if (!args.trim()) {
        args = {};
      } else {
        try {
          args = JSON.parse(args);
        } catch {
          return undefined;
        }
      }
    }
    if (!isRecord(args)) return undefined;
    calls.push({ name, args });
  }
  return calls;
}

function appendVisibleText(parts: Part[], text: string): void {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && 'text' in last && last.thought !== true) {
    last.text = (last.text ?? '') + text;
  } else {
    parts.push({ text });
  }
}

function longestOpeningTagPrefixSuffix(value: string): number {
  let longest = 0;
  for (const frame of TOOL_CALL_FRAMES) {
    const maxLength = Math.min(value.length, frame.open.length - 1);
    for (let length = maxLength; length > longest; length--) {
      if (frame.open.startsWith(value.slice(-length))) {
        longest = length;
        break;
      }
    }
  }
  return longest;
}

function stringifyProtocolJson(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  // 工具参数/结果可能包含协议标签。JSON Unicode 转义可避免它们突破当前块边界。
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
