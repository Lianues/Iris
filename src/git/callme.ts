/**
 * /callme git 提交署名支持。
 *
 * 设计目标：默认关闭；用户显式输入 /callme 后，Iris 代用户执行 git commit 时
 * 自动在提交信息末尾添加固定的 Iris 链接署名。
 */

export interface CallmeAttributionConfig {
  /** 是否启用 git commit co-author 署名。默认 false。 */
  enabled: boolean;
}

export type CallmeShellKind = 'bash' | 'powershell' | 'cmd';

export const CALLME_TRAILER = 'Co-authored with Iris: https://github.com/Lianues/Iris';

const DEFAULT_CALLME_CONFIG: CallmeAttributionConfig = Object.freeze({
  enabled: false,
});

interface ShellToken {
  value: string;
  start: number;
  end: number;
  delimiter: boolean;
}

/** 返回固定的 Iris 链接署名。该功能仅支持开关，不提供用户自定义。 */
export function buildCallmeTrailer(): string {
  return CALLME_TRAILER;
}

/**
 * 将 raw 配置规范化为运行时结构。
 *
 * /callme 只是开关：运行时配置使用 boolean。
 * 兼容旧的对象形态，但只读取 enabled，忽略其它字段。
 */
export function normalizeCallmeAttributionConfig(raw: unknown): CallmeAttributionConfig {
  if (typeof raw === 'boolean') {
    return { enabled: raw };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_CALLME_CONFIG };
  }

  const obj = raw as Record<string, unknown>;
  return {
    enabled: obj.enabled === true,
  };
}

/**
 * 如果 /callme 已启用且命令包含 git commit，则在提交信息末尾追加固定署名行。
 *
 * 通过额外的 `-m` 参数追加为最后一个 message 段，让 GitHub 可渲染其中 URL。
 * 这里只做轻量 shell-like 解析：覆盖常见的 `git commit`、`git -C dir commit`、
 * `git -c key=value commit`，并避免改写引号内文本。
 */
export function maybeAddCallmeTrailerToGitCommit(
  command: string,
  shellKind: CallmeShellKind,
  config?: CallmeAttributionConfig,
): string {
  const effectiveConfig = config ?? DEFAULT_CALLME_CONFIG;
  if (!effectiveConfig.enabled) return command;
  const trailer = CALLME_TRAILER;
  if (!trailer) return command;
  if (!/\bgit\b/i.test(command) || !/\bcommit\b/i.test(command)) return command;
  // 用户/模型已经显式写了相关署名时不重复添加。
  if (/co-authored-by\s*:|co-authored\s+with\s+iris\s*:|generated-with-iris\s*:/i.test(command)) return command;

  const tokens = tokenizeShellLike(command);
  const positions = findGitCommitInsertPositions(tokens);
  if (positions.length === 0) return command;

  // 追加到命令段末尾，保证多段 -m 时 Iris 链接位于提交信息尾部。
  const insertion = ` -m ${quoteForShell(trailer, shellKind)}`;
  let result = command;
  for (const pos of positions.sort((a, b) => b - a)) {
    result = result.slice(0, pos) + insertion + result.slice(pos);
  }
  return result;
}

function quoteForShell(value: string, shellKind: CallmeShellKind): string {
  if (shellKind === 'powershell') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (shellKind === 'cmd') {
    return `"${value.replace(/%/g, '%%').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tokenizeShellLike(input: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const delimiter = readDelimiter(input, i);
    if (delimiter) {
      tokens.push({ value: delimiter.value, start: i, end: i + delimiter.length, delimiter: true });
      i += delimiter.length;
      continue;
    }

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const start = i;
    let value = '';
    while (i < input.length) {
      const current = input[i];
      if (/\s/.test(current) || readDelimiter(input, i)) break;

      if (current === '\'' || current === '"') {
        const quote = current;
        i++;
        while (i < input.length) {
          const quoted = input[i];
          if (quoted === quote) {
            // PowerShell 单引号内用两个单引号表示一个字面量单引号。
            if (quote === '\'' && input[i + 1] === '\'') {
              value += '\'';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (quote === '"' && quoted === '\\' && i + 1 < input.length) {
            value += input[i + 1];
            i += 2;
            continue;
          }
          value += quoted;
          i++;
        }
        continue;
      }

      if (current === '\\' && i + 1 < input.length) {
        value += input[i + 1];
        i += 2;
        continue;
      }

      value += current;
      i++;
    }

    tokens.push({ value, start, end: i, delimiter: false });
  }

  return tokens;
}

function readDelimiter(input: string, index: number): { value: string; length: number } | undefined {
  const two = input.slice(index, index + 2);
  if (two === '&&' || two === '||') return { value: two, length: 2 };
  const one = input[index];
  if (one === ';' || one === '|' || one === '&' || one === '\n' || one === '\r') return { value: one, length: 1 };
  return undefined;
}

function findGitCommitInsertPositions(tokens: ShellToken[]): number[] {
  const positions: number[] = [];
  let atCommandStart = true;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.delimiter) {
      atCommandStart = true;
      continue;
    }

    if (!atCommandStart) {
      continue;
    }

    atCommandStart = false;
    if (token.value.toLowerCase() !== 'git') continue;

    const commitIndex = findCommitSubcommandIndex(tokens, i + 1);
    if (commitIndex >= 0) {
      positions.push(findCommandSegmentEnd(tokens, i));
    }
  }

  return positions;
}

function findCommandSegmentEnd(tokens: ShellToken[], startIndex: number): number {
  let lastEnd = tokens[startIndex].end;
  for (let i = startIndex + 1; i < tokens.length; i++) {
    if (tokens[i].delimiter) break;
    lastEnd = tokens[i].end;
  }
  return lastEnd;
}

function findCommitSubcommandIndex(tokens: ShellToken[], startIndex: number): number {
  let i = startIndex;
  while (i < tokens.length && !tokens[i].delimiter) {
    const value = tokens[i].value;
    const lower = value.toLowerCase();

    if (lower === 'commit') return i;
    if (lower === '--') return -1;

    const skip = gitGlobalOptionTokenCount(value);
    if (skip > 0) {
      i += skip;
      continue;
    }
    if (skip < 0) return -1;

    // 第一个非 option token 是其它 git 子命令，不应改写。
    return -1;
  }

  return -1;
}

function gitGlobalOptionTokenCount(value: string): number {
  const raw = value;
  const lower = value.toLowerCase();
  if (!raw.startsWith('-')) return 0;

  // 信息/帮助类全局 option 后面的 commit 不是要执行的子命令。
  if (raw === '-h' || raw === '-v' || lower === '--help' || lower === '--version'
    || lower === '--html-path' || lower === '--man-path' || lower === '--info-path') {
    return -1;
  }

  // 带等号或紧凑形式的全局 option，本 token 自带值。
  if (
    (raw.startsWith('-C') && raw !== '-C')
    || (raw.startsWith('-c') && raw !== '-c')
    || lower.startsWith('--git-dir=')
    || lower.startsWith('--work-tree=')
    || lower.startsWith('--namespace=')
    || lower.startsWith('--exec-path=')
    || lower.startsWith('--config-env=')
    || lower.startsWith('--super-prefix=')
  ) {
    return 1;
  }

  // 需要额外参数的常见 git 全局 option。
  if (
    raw === '-C'
    || raw === '-c'
    || lower === '--git-dir'
    || lower === '--work-tree'
    || lower === '--namespace'
    || lower === '--exec-path'
    || lower === '--config-env'
    || lower === '--super-prefix'
  ) {
    return 2;
  }

  // 其它 git 全局开关（如 --no-pager、--paginate、--literal-pathspecs）。
  return 1;
}
