const CONTEXT_OVERFLOW_PATTERNS = [
  /context[_\s-]*length[_\s-]*exceeded/i,
  /maximum context length/i,
  /context window.{0,40}(?:exceed|overflow|limit|too (?:large|long))/i,
  /prompt.{0,30}too (?:long|large)/i,
  /too many (?:input )?tokens/i,
  /(?:input|prompt) tokens?.{0,40}(?:exceed|over|limit)/i,
  /token limit.{0,30}(?:exceed|reached)/i,
  /request.{0,30}too large.{0,30}(?:token|context)/i,
];

const PARTIAL_OUTPUT_ERRORS = new WeakSet<object>();

/** 识别 provider 常见的上下文窗口溢出错误。 */
export function isContextOverflowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * 给 LLM 调用错误附加“已经向外产生部分模型输出”的进程内标记。
 * 使用 WeakSet 避免修改第三方 Error 对象，也不会影响错误序列化或日志文本。
 */
export function markLLMErrorPartialOutput(error: unknown, hasPartialOutput: boolean): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (hasPartialOutput) PARTIAL_OUTPUT_ERRORS.add(normalized);
  return normalized;
}

/** 已产生部分文本/function call 的失败请求不能自动 compact 后重试。 */
export function hasPartialLLMOutput(error: unknown): boolean {
  return !!error && (typeof error === 'object' || typeof error === 'function')
    && PARTIAL_OUTPUT_ERRORS.has(error as object);
}
