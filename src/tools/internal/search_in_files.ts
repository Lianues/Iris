/**
 * 在文件中搜索（和替换）内容工具
 *
 * 目标：提供一个不依赖 VSCode API 的 search_in_files 工具，
 * 适配 Iris 当前的 Node.js 运行环境。
 *
 * 能力范围：
 * - 使用 include/exclude glob 列表描述搜索范围
 * - 支持常见 glob 语法（*, ?, **, {a,b}, *.{ts,tsx}, extglob 等）
 * - 支持正则表达式搜索与替换
 * - 支持限制最大结果数与最大处理文件数
 * - 自动跳过疑似二进制文件与过大文件
 */

import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';
import { getToolLimits } from '../tool-limits';
import { getSkillAccessPreflightRejection, isSkillAccessPreflightBlockedPath } from './skill-access-guard';
import {
  isLikelyBinary, decodeText, buildSearchRegex,
  type TextEncoding,
} from 'irises-extension-sdk/tool-utils';

export {
  toPosix,
  globToRegExp,
  isLikelyBinary,
  decodeText,
  buildSearchRegex,
  walkFiles,
  DEFAULT_IGNORED_DIRS,
} from 'irises-extension-sdk/tool-utils';
export type { TextEncoding, DetectedText } from 'irises-extension-sdk/tool-utils';

const DEFAULT_INCLUDE = ['**/*'];
const DEFAULT_EXCLUDE = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.limcode/**',
];

interface SearchMatch {
  file: string;
  line: number;
  column: number;
  match: string;
  context: string;
}

interface ReplaceFileResult {
  file: string;
  replacements: number;
  changed: boolean;
  skipped?: boolean;
  reason?: string;
}

type ToolMode = 'search' | 'replace';

export interface SearchGlobArgs {
  /** 用户提供的 include glob；未提供时为默认全项目匹配 */
  include: string[];
  /** 用户提供的 exclude glob，不含默认排除项 */
  exclude: string[];
  /** 实际传给 glob 库的 ignore 列表：默认排除项 + 用户 exclude */
  effectiveExclude: string[];
}

export interface SearchFileMatch {
  fileAbs: string;
  relPosix: string;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  if (!isNonNegativeInteger(value)) return fallback;
  return value === 0 ? fallback : value;
}

function swapByteOrder16(buf: Buffer): Buffer {
  const len = buf.length - (buf.length % 2);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

function encodeText(text: string, encoding: TextEncoding, hasBom: boolean, preferCRLF: boolean): Buffer {
  const normalized = preferCRLF ? text.replace(/\r?\n/g, '\r\n') : text;

  if (encoding === 'utf-16le') {
    const body = Buffer.from(normalized, 'utf16le');
    return hasBom ? Buffer.concat([Buffer.from([0xFF, 0xFE]), body]) : body;
  }

  if (encoding === 'utf-16be') {
    const bodyLE = Buffer.from(normalized, 'utf16le');
    const bodyBE = swapByteOrder16(bodyLE);
    return hasBom ? Buffer.concat([Buffer.from([0xFE, 0xFF]), bodyBE]) : bodyBE;
  }

  // utf-8
  const body = Buffer.from(normalized, 'utf8');
  return hasBom ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body]) : body;
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function findLineIndex(lineStarts: number[], offset: number): number {
  // 返回 lineStarts 中最后一个 <= offset 的索引
  let lo = 0;
  let hi = lineStarts.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = lineStarts[mid];
    if (start === offset) return mid;
    if (start < offset) lo = mid + 1;
    else hi = mid - 1;
  }

  return Math.max(0, lo - 1);
}

function truncateLine(line: string, max: number): string {
  if (line.length <= max) return line;
  // 保留前部 + 尾部少量，中间标记截断
  const head = Math.floor(max * 0.75);
  const tail = Math.floor(max * 0.15);
  return line.slice(0, head) + ` ... [${line.length} chars] ... ` + line.slice(-tail);
}

function buildContext(lines: string[], lineNumber1Based: number, contextLines: number, maxLineChars: number): string {
  const total = lines.length;
  const start = Math.max(1, lineNumber1Based - contextLines);
  const end = Math.min(total, lineNumber1Based + contextLines);

  const out: string[] = [];
  for (let ln = start; ln <= end; ln++) {
    out.push(`${ln}: ${truncateLine(lines[ln - 1] ?? '', maxLineChars)}`);
  }
  return out.join('\n');
}

function normalizeGlobPattern(raw: string, field: 'include' | 'exclude', allowNegation: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${field} 中不能包含空 glob`);
  }

  const negated = trimmed.startsWith('!');
  if (negated && !allowNegation) {
    throw new Error(`${field} 不支持 ! 否定模式；请把排除规则放到 exclude 数组中`);
  }

  const bodyRaw = negated ? trimmed.slice(1).trim() : trimmed;
  if (!bodyRaw) {
    throw new Error(`${field} 中不能包含空 glob`);
  }

  const body = bodyRaw.replace(/\\/g, '/');
  if (path.isAbsolute(bodyRaw) || body.startsWith('/') || /^[A-Za-z]:[\\/]/.test(bodyRaw)) {
    throw new Error(`${field} 只接受相对于项目根目录的 glob: ${raw}`);
  }

  if (body.split('/').some(part => part === '..')) {
    throw new Error(`${field} 不允许包含 .. 路径段: ${raw}`);
  }

  return negated ? `!${body}` : body;
}

function normalizeGlobList(
  value: unknown,
  field: 'include' | 'exclude',
  fallback: string[],
  allowNegation: boolean,
): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) {
    throw new Error(`${field} 参数必须是字符串数组`);
  }

  const normalized = value.map((item) => {
    if (typeof item !== 'string') {
      throw new Error(`${field} 参数必须是字符串数组`);
    }
    return normalizeGlobPattern(item, field, allowNegation);
  });

  if (normalized.length === 0 && field === 'include') {
    throw new Error('include 参数必须是非空字符串数组');
  }

  return Array.from(new Set(normalized));
}

function assertNoLegacyScopeArgs(args: Record<string, unknown>): void {
  const legacyKeys = ['path', 'pattern', 'isRegex'].filter(key => args[key] !== undefined);
  if (legacyKeys.length > 0) {
    throw new Error(
      `search_in_files 已切换为 include/exclude glob 结构，不再支持旧参数: ${legacyKeys.join(', ')}。`
      + '请使用 include: ["src/**/*", "tests/**/*"]，regex: true。',
    );
  }
}

export function normalizeSearchGlobArgs(args: Record<string, unknown>): SearchGlobArgs {
  assertNoLegacyScopeArgs(args);

  const include = normalizeGlobList(args.include, 'include', DEFAULT_INCLUDE, true);
  const exclude = normalizeGlobList(args.exclude, 'exclude', [], false);
  const effectiveExclude = Array.from(new Set([...DEFAULT_EXCLUDE, ...exclude]));
  const skillAccessRejection = getSkillAccessPreflightRejection(...include);
  if (skillAccessRejection) {
    throw new Error(skillAccessRejection);
  }

  return { include, exclude, effectiveExclude };
}

function assertInsideRoot(rootAbs: string, fileAbs: string, displayPath: string): void {
  const rel = path.relative(rootAbs, fileAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`glob 匹配结果超出项目目录: ${displayPath}`);
  }
}

export function collectSearchFiles(rootAbs: string, include: string[], effectiveExclude: string[]): SearchFileMatch[] {
  const projectRoot = path.resolve(rootAbs);
  const entries = fg.sync(include, {
    cwd: projectRoot,
    ignore: effectiveExclude,
    onlyFiles: true,
    dot: true,
    unique: true,
    followSymbolicLinks: false,
    absolute: false,
  });

  return entries
    .map(entry => entry.replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b))
    .map((relPosix) => {
      const fileAbs = path.resolve(projectRoot, relPosix);
      assertInsideRoot(projectRoot, fileAbs, relPosix);
      return { fileAbs, relPosix };
    })
    .filter(file => !isSkillAccessPreflightBlockedPath(file.fileAbs) && !isSkillAccessPreflightBlockedPath(file.relPosix));
}

export const searchInFiles: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'search_in_files',
    description: [
      '在文件中搜索内容，可选执行替换。',
      '使用 include/exclude glob 数组描述范围，例如 include: ["src/**/*", "tests/**/*"]。',
      '支持常见 glob 语法：*, ?, **, {src,tests}/**/*, **/*.{ts,tsx}, extglob 等。',
      '默认忽略 .git、node_modules、dist、build 等目录。',
      '不要使用旧的 path/pattern/isRegex 参数；正则搜索请使用 regex: true。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: '操作模式：search（默认）或 replace',
          enum: ['search', 'replace'],
        },
        query: {
          type: 'string',
          description: '搜索关键词或正则表达式',
        },
        include: {
          type: 'array',
          description: '要搜索的文件 glob 数组（相对于项目根目录）。例如 ["src/**/*", "tests/**/*"] 或 ["{src,tests}/**/*.{ts,tsx}"]。默认 ["**/*"]。',
          items: { type: 'string' },
        },
        exclude: {
          type: 'array',
          description: '要排除的文件 glob 数组（相对于项目根目录）。默认已排除 .git、node_modules、dist、build 等目录。',
          items: { type: 'string' },
        },
        regex: {
          type: 'boolean',
          description: '是否将 query 视为正则表达式，默认 false',
        },
        maxResults: {
          type: 'number',
          description: '最大匹配结果数（默认 100，search 模式生效）',
        },
        replace: {
          type: 'string',
          description: '替换字符串（仅 replace 模式使用，正则支持 $1 $2 等捕获组）',
        },
        maxFiles: {
          type: 'number',
          description: '最大处理文件数（默认 50，replace 模式生效）',
        },
        contextLines: {
          type: 'number',
          description: '每条匹配返回的上下文行数（默认 2）',
        },
        maxFileSizeBytes: {
          type: 'number',
          description: '单文件最大读取字节数（默认 2097152 = 2MB）',
        },
      },
      required: ['query'],
    },
  },
  handler: async (args) => {
    const limits = getToolLimits().search_in_files;

    const mode = ((args.mode as ToolMode | undefined) ?? 'search');
    const query = String(args.query ?? '');
    const { include, exclude, effectiveExclude } = normalizeSearchGlobArgs(args as Record<string, unknown>);

    const regexMode = (args.regex as boolean | undefined) ?? false;
    // LLM 传入的值不得超过配置上限
    const maxResults = Math.min(clampPositiveInteger(args.maxResults, limits.maxResults), limits.maxResults);
    const maxFiles = Math.min(clampPositiveInteger(args.maxFiles, limits.maxFiles), limits.maxFiles);
    const contextLines = Math.min(clampPositiveInteger(args.contextLines, limits.contextLines), limits.contextLines);
    const maxFileSizeBytes = Math.min(clampPositiveInteger(args.maxFileSizeBytes, limits.maxFileSizeBytes), limits.maxFileSizeBytes);

    if (mode !== 'search' && mode !== 'replace') {
      throw new Error(`mode 参数无效: ${String(args.mode)}`);
    }

    const rootAbs = resolveProjectPath('.');
    const matchedFiles = collectSearchFiles(rootAbs, include, effectiveExclude);
    const emptyMatchWarning = matchedFiles.length === 0
      ? '没有文件匹配 include/exclude glob。请检查 include，例如 ["src/**/*", "tests/**/*"] 或 ["{src,tests}/**/*"]。'
      : undefined;

    if (mode === 'search') {
      const regex = buildSearchRegex(query, regexMode);

      const results: SearchMatch[] = [];
      let filesSearched = 0;
      let skippedBinary = 0;
      let skippedTooLarge = 0;
      let truncated = false;

      const shouldStop = () => results.length >= maxResults;

      const processFile = (fileAbs: string, relPosix: string) => {
        if (shouldStop()) return;

        filesSearched++;
        const buf = fs.readFileSync(fileAbs);

        if (buf.length > maxFileSizeBytes) {
          skippedTooLarge++;
          return;
        }

        if (isLikelyBinary(buf)) {
          skippedBinary++;
          return;
        }

        const decoded = decodeText(buf);
        // 为了稳定展示上下文，统一为 LF
        const textLF = decoded.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const localRegex = new RegExp(regex.source, regex.flags);
        const lineStarts = computeLineStarts(textLF);
        const lines = textLF.split('\n');

        for (;;) {
          const m = localRegex.exec(textLF);
          if (!m) break;

          // 防止零长度匹配导致死循环
          if (m[0].length === 0) {
            localRegex.lastIndex++;
            continue;
          }

          const offset = m.index ?? 0;
          const lineIndex0Based = findLineIndex(lineStarts, offset);
          const lineNumber = lineIndex0Based + 1;
          const lineStartOffset = lineStarts[lineIndex0Based] ?? 0;
          const column = offset - lineStartOffset + 1;

          results.push({
            file: relPosix,
            line: lineNumber,
            column,
            match: truncateLine(m[0], limits.maxMatchDisplayChars),
            context: buildContext(lines, lineNumber, contextLines, limits.maxLineDisplayChars),
          });

          if (shouldStop()) {
            truncated = true;
            break;
          }
        }
      };

      for (const file of matchedFiles) {
        if (shouldStop()) break;
        processFile(file.fileAbs, file.relPosix);
      }

      if (results.length >= maxResults) truncated = true;

      return {
        mode,
        query,
        regex: regexMode,
        include,
        exclude,
        effectiveExclude,
        results,
        count: results.length,
        truncated,
        filesMatched: matchedFiles.length,
        filesSearched,
        skippedBinary,
        skippedTooLarge,
        ...(emptyMatchWarning ? { warning: emptyMatchWarning } : {}),
      };
    }

    // replace 模式
    const replace = args.replace;
    if (typeof replace !== 'string') {
      throw new Error('replace 模式下必须提供 replace 参数');
    }

    const regex = buildSearchRegex(query, regexMode);

    const results: ReplaceFileResult[] = [];
    let processedFiles = 0;
    let totalReplacements = 0;
    const truncated = matchedFiles.length > maxFiles;

    const processFile = (fileAbs: string, relPosix: string) => {
      if (processedFiles >= maxFiles) return;

      processedFiles++;

      const buf = fs.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes) {
        results.push({
          file: relPosix,
          replacements: 0,
          changed: false,
          skipped: true,
          reason: `file too large (> ${maxFileSizeBytes} bytes)`,
        });
        return;
      }

      if (isLikelyBinary(buf)) {
        results.push({
          file: relPosix,
          replacements: 0,
          changed: false,
          skipped: true,
          reason: 'binary file',
        });
        return;
      }

      const decoded = decodeText(buf);
      const localRegex = new RegExp(regex.source, regex.flags);

      let replacements = 0;
      for (;;) {
        const m = localRegex.exec(decoded.text);
        if (!m) break;
        if (m[0].length === 0) {
          localRegex.lastIndex++;
          continue;
        }
        replacements++;
      }

      if (replacements === 0) {
        results.push({
          file: relPosix,
          replacements: 0,
          changed: false,
        });
        return;
      }

      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      const changed = newText !== decoded.text;

      if (changed) {
        const out = encodeText(newText, decoded.encoding, decoded.hasBom, decoded.hasCRLF);
        fs.writeFileSync(fileAbs, out);
      }

      results.push({
        file: relPosix,
        replacements,
        changed,
      });

      totalReplacements += replacements;
    };

    for (const file of matchedFiles.slice(0, maxFiles)) {
      processFile(file.fileAbs, file.relPosix);
    }

    return {
      mode,
      query,
      replace,
      regex: regexMode,
      include,
      exclude,
      effectiveExclude,
      results,
      filesMatched: matchedFiles.length,
      processedFiles,
      totalReplacements,
      truncated,
      ...(emptyMatchWarning ? { warning: emptyMatchWarning } : {}),
    };
  },
};
