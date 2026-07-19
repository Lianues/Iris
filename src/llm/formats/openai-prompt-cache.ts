/**
 * OpenAI GPT-5.6+ Prompt Caching 请求策略。
 *
 * GPT-5.6 起，缓存通过 prompt_cache_options 控制：
 * - implicit：自动在最新消息放置断点；
 * - explicit 且请求内没有显式断点：不读写 Prompt Cache。
 *
 * prompt_cache_key 会参与更可靠的缓存匹配。这里根据模型、稳定系统指令和
 * 工具声明生成短且稳定的 key，避免把用户内容或本地路径直接放进请求字段。
 */

export function supportsOpenAIPromptCacheOptions(model: string): boolean {
  const normalized = String(model ?? '').trim().toLowerCase();
  const match = normalized.match(/(?:^|[/_:])gpt-(\d+)\.(\d+)(?:$|[-._:])/);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 6);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function buildOpenAIPromptCacheKey(model: string, stablePrefix: unknown): string {
  const material = JSON.stringify({
    model: String(model ?? '').trim().toLowerCase(),
    stablePrefix,
  });
  return `iris:${stableHash(material)}`;
}

export function applyOpenAIPromptCachePolicy(
  body: Record<string, unknown>,
  options: {
    model: string;
    enabled?: boolean;
    stablePrefix: unknown;
  },
): void {
  if (!supportsOpenAIPromptCacheOptions(options.model)) return;

  if (options.enabled === false) {
    // GPT-5.6 没有独立的 enabled=false；官方关闭方式是 explicit 且不放断点。
    body.prompt_cache_options = { mode: 'explicit' };
    delete body.prompt_cache_key;
    return;
  }

  body.prompt_cache_key = buildOpenAIPromptCacheKey(options.model, options.stablePrefix);
  body.prompt_cache_options = {
    mode: 'implicit',
    ttl: '30m',
  };
}
