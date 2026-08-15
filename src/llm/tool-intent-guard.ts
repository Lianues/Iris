/**
 * 检测模型只承诺调用工具、却把该候选响应当作最终回复结束的情况。
 *
 * 该模块不决定工具是否“应该”被调用；调用方必须同时确认本轮确实声明了工具，
 * 且模型响应中没有任何已解码的 FunctionCallPart。
 */

const TOOL_INTENT_PREAMBLE_OPENING = /^(?:我(?:来|先|会|将|准备|需要先)|让我(?:先)?|先(?:让我)?|现在(?:我)?(?:先)?|接下来(?:我)?(?:会|将|先)?|马上(?:我)?|let me|i(?:['’]ll| will| am going to| need to)|first(?:,)?(?: i(?:['’]ll| will))?)/i;
const TOOL_INTENT_ACTION = /(?:查看|看看|检查|读取|读一下|搜索|搜一下|查找|检索|运行|执行|调用|获取|确认|审阅|列出|打开|浏览|\b(?:check|inspect|read|search|grep|find|run|execute|call|fetch|look up|list|open|review)\b)/i;
const TOOL_INTENT_COMPLETION = /(?:结果(?:是|为|如下)|(?:已经|已)(?:完成|检查|查看|读取|找到|执行|运行|同步)|(?:发现|显示)(?:了|：|:|\s)|\b(?:result(?:s)?|found|shows?|returned|completed|done)\b)/i;
const TOOL_INTENT_LIMITATION = /(?:无法|不能|不可用|不支持|没有权限|无权|\b(?:cannot|can't|unable|unavailable|unsupported|no access)\b)/i;
const MAX_TOOL_INTENT_PREAMBLE_CHARS = 320;

/** 为 OpenAI/Gemini/Claude 等 Provider 原生工具协议补充预防性约束。 */
export function buildNativeToolUsePrompt(): string {
  return [
    'Use the provider-native tool/function calling mechanism whenever the task requires inspecting, reading, searching, running, checking, or fetching information with an available tool.',
    'If you decide or say that you will use a tool, emit the native tool call in that same response. Never end with only a promise, plan, or preamble such as "I will check...".',
    'Do not print serialized tool-call JSON, XML, <tool_call>, or DSML as visible assistant text; place the call only in the provider-native tool-call field.',
    'If no tool is needed, provide a complete final answer without claiming that an inspection or command is underway.',
  ].join('\n');
}

/** 为被丢弃的原生协议“只承诺调用”候选生成一次更靠后的纠偏指令。 */
export function buildNativeToolRepairPrompt(attempt: number): string {
  return [
    `[Native tool-call repair, attempt ${attempt}]`,
    'Your previous candidate response was discarded because it announced a tool action but emitted no native tool/function call.',
    'Do not repeat the promise or preamble. Use the available provider-native tool call now.',
    'Do not serialize the call as visible JSON, XML, <tool_call>, or DSML text.',
    'If no tool is actually needed, provide a complete final answer without claiming that you will inspect, read, search, run, check, or fetch anything.',
  ].join('\n');
}

/** 为 Provider 响应中被截断的原生 arguments 生成一次非流式重生指令。 */
export function buildNativeMalformedToolRetryPrompt(attempt: number): string {
  return [
    `[Native malformed tool-call recovery, attempt ${attempt}]`,
    'The previous provider response ended before the native tool-call arguments formed a complete JSON object. Iris discarded that call and did not execute it.',
    'Regenerate the intended call once through the provider-native tool/function calling field with every required schema field and a complete arguments object.',
    'Keep string arguments complete and properly escaped. Do not print tool-call JSON, XML, <tool_call>, or DSML in visible assistant text.',
    'If you cannot produce a complete native call, provide a complete final answer explaining the limitation instead of another partial call.',
  ].join('\n');
}

/**
 * 判断正文是否很可能只是尚未履行的工具调用开场白。
 *
 * 规则刻意保守：只看较短、以将来动作开头、包含工具动作动词，且没有明显
 * 结果、能力限制或冒号展开的文本，避免把正常最终回答强制改写成工具调用。
 */
export function isLikelyUnfulfilledToolIntentPreamble(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > MAX_TOOL_INTENT_PREAMBLE_CHARS) return false;
  if (!TOOL_INTENT_PREAMBLE_OPENING.test(normalized)) return false;
  if (!TOOL_INTENT_ACTION.test(normalized)) return false;
  if (TOOL_INTENT_COMPLETION.test(normalized)) return false;
  if (TOOL_INTENT_LIMITATION.test(normalized)) return false;
  if (/[:：]/.test(normalized)) return false;
  return true;
}
