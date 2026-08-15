/** Claude Code-compatible Skill argument parsing and substitution. */

export interface ParsedSkillArguments {
  /** Full argument string after outer whitespace trimming. */
  raw: string;
  positional: string[];
  named: Record<string, string>;
}

/**
 * Parse shell-like arguments without expanding environment variables or
 * executing operators. Quoted empty strings are retained as arguments.
 */
export function parseSkillArguments(raw: string, namedKeys?: string[]): ParsedSkillArguments {
  const trimmed = raw.trim();
  if (!trimmed) return { raw: '', positional: [], named: {} };

  const positional: string[] = [];
  let token = '';
  let tokenStarted = false;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let malformed = false;

  const flush = () => {
    if (tokenStarted) positional.push(token);
    token = '';
    tokenStarted = false;
  };

  for (const ch of trimmed) {
    if (escaped) {
      token += ch;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else token += ch;
      tokenStarted = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    token += ch;
    tokenStarted = true;
  }

  if (escaped) token += '\\';
  if (quote) malformed = true;
  flush();

  // Claude Code falls back to whitespace splitting when shell parsing fails.
  if (malformed) {
    positional.splice(0, positional.length, ...trimmed.split(/\s+/).filter(Boolean));
  }

  const named: Record<string, string> = {};
  for (let i = 0; i < (namedKeys?.length ?? 0) && i < positional.length; i++) {
    named[namedKeys![i]] = positional[i];
  }

  return { raw: trimmed, positional, named };
}

/**
 * Supported placeholders:
 * - $ARGUMENTS
 * - $ARGUMENTS[n]
 * - $n
 * - named arguments declared in frontmatter
 *
 * Substitution is a single pass so replacement values cannot recursively
 * expand placeholders. An explicit empty argument string clears placeholders.
 */
export function substituteSkillParams(
  content: string,
  args: ParsedSkillArguments,
  namedKeys?: string[],
): string {
  const keySet = new Set(namedKeys ?? []);
  let hasPlaceholder = false;

  const result = content.replace(
    /\$ARGUMENTS\[(\d+)\]|\$ARGUMENTS|\$(\d+)(?!\w)|\$([a-zA-Z_][a-zA-Z0-9_]*)(?![\[\w])/g,
    (
      match,
      argumentsIndex: string | undefined,
      shortIndex: string | undefined,
      namedKey: string | undefined,
    ) => {
      if (argumentsIndex !== undefined) {
        hasPlaceholder = true;
        return args.positional[Number.parseInt(argumentsIndex, 10)] ?? '';
      }
      if (match === '$ARGUMENTS') {
        hasPlaceholder = true;
        return args.raw;
      }
      if (shortIndex !== undefined) {
        hasPlaceholder = true;
        return args.positional[Number.parseInt(shortIndex, 10)] ?? '';
      }
      if (namedKey && keySet.has(namedKey)) {
        hasPlaceholder = true;
        return args.named[namedKey] ?? '';
      }
      return match;
    },
  );

  return !hasPlaceholder && args.raw
    ? `${result}\n\nARGUMENTS: ${args.raw}`
    : result;
}
