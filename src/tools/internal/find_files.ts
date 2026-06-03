/**
 * 查找文件工具
 *
 * 在项目目录下基于一个或多个 glob 模式查找文件。
 *
 * 设计目标：
 * - 不依赖 VSCode API
 * - 支持基础 glob（*、?、**）
 * - 支持 exclude 排除模式
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';
import { getToolLimits } from '../tool-limits';
import { getSkillAccessPreflightRejection, isSkillAccessPreflightBlockedPath } from './skill-access-guard';

/** 默认排除模式 */
const DEFAULT_EXCLUDE = '**/node_modules/**';

/** 默认忽略目录（仅按目录名判断） */
const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.limcode',
]);

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function globToRegExp(glob: string): RegExp {
  const g = toPosix(glob.trim());
  let re = '^';

  for (let i = 0; i < g.length; i++) {
    const ch = g[i];

    if (ch === '*') {
      const next = g[i + 1];
      if (next === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*\\/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
      continue;
    }

    if (ch === '?') {
      re += '[^/]';
      continue;
    }

    if ('\\.^$+()[]{}|'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }

  re += '$';
  return new RegExp(re);
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function parseBraceList(input: string): string[] {
  const s = input.trim();
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1);
    return inner.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [s];
}

function buildExcludeMatchers(exclude: string): RegExp[] {
  const parts = parseBraceList(exclude).filter(Boolean);
  return parts.map(p => globToRegExp(p));
}

function isExcluded(relPosixPath: string, excludeMatchers: RegExp[]): boolean {
  for (const re of excludeMatchers) {
    if (re.test(relPosixPath)) return true;
  }
  return false;
}

function walkFiles(
  rootAbs: string,
  onFile: (relPosix: string) => void,
  shouldStop: () => boolean,
  relPosixDir: string = '',
): void {
  if (shouldStop()) return;

  const dirAbs = relPosixDir ? path.join(rootAbs, relPosixDir) : rootAbs;
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });

  for (const ent of entries) {
    if (shouldStop()) return;

    const relPosix = relPosixDir ? `${relPosixDir}/${ent.name}` : ent.name;
    const entryAbs = path.join(rootAbs, relPosix);
    if (isSkillAccessPreflightBlockedPath(entryAbs) || isSkillAccessPreflightBlockedPath(relPosix)) continue;

    if (ent.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(ent.name)) continue;
      walkFiles(rootAbs, onFile, shouldStop, relPosix);
      continue;
    }

    if (ent.isFile()) {
      onFile(relPosix);
    }
  }
}

interface FindFilesPatternResult {
  pattern: string;
  matches: string[];
  count: number;
  truncated: boolean;
}

export const findFiles: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'find_files',
    description: [
      '基于一个或多个 glob 模式查找文件。',
      '支持基础 glob（*、?、**）。',
      '默认排除 **/node_modules/**。',
      'patterns 参数必须为数组，即使只传一个模式。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        patterns: {
          type: 'array',
          description: 'glob 模式数组（必填）',
          items: { type: 'string' },
        },
        exclude: {
          type: 'string',
          description: '排除模式，例如 "**/node_modules/**"。支持 "{a,b}" 形式的简单多模式',
        },
        maxResults: {
          type: 'number',
          description: '每个 pattern 的最大返回数量，默认 500',
        },
      },
      required: ['patterns'],
    },
  },
  handler: async (args) => {
    const patterns = args.patterns as unknown;
    if (!Array.isArray(patterns) || patterns.length === 0 || patterns.some(p => typeof p !== 'string')) {
      throw new Error('patterns 参数必须是非空字符串数组');
    }

    const patternList = patterns.map(p => p.trim()).filter(Boolean);
    if (patternList.length === 0) {
      throw new Error('patterns 参数不能为空');
    }

    const exclude = (args.exclude as string | undefined) ?? DEFAULT_EXCLUDE;
    const skillAccessRejection = getSkillAccessPreflightRejection(...patternList);
    if (skillAccessRejection) {
      throw new Error(skillAccessRejection);
    }
    const configMax = getToolLimits().find_files.maxResults;
    const maxResults = Math.min(clampPositiveInteger(args.maxResults, configMax), configMax);

    const rootAbs = resolveProjectPath('.');
    const patternRes = patternList.map(p => ({
      pattern: p,
      re: globToRegExp(p),
      matches: [] as string[],
      truncated: false,
    }));

    const excludeMatchers = buildExcludeMatchers(exclude);

    const shouldStop = () => patternRes.every(p => p.matches.length >= maxResults);

    walkFiles(
      rootAbs,
      (relPosix) => {
        if (isExcluded(relPosix, excludeMatchers)) return;

        for (const p of patternRes) {
          if (p.matches.length >= maxResults) continue;
          if (p.re.test(relPosix)) {
            p.matches.push(relPosix);
            if (p.matches.length >= maxResults) {
              p.truncated = true;
            }
          }
        }
      },
      shouldStop,
    );

    // 排序，保持输出稳定
    for (const p of patternRes) {
      p.matches.sort();
    }

    const perPattern: FindFilesPatternResult[] = patternRes.map(p => ({
      pattern: p.pattern,
      matches: p.matches,
      count: p.matches.length,
      truncated: p.truncated,
    }));

    const results = Array.from(new Set(perPattern.flatMap(p => p.matches))).sort();

    return {
      patterns: patternList,
      exclude,
      maxResults,
      perPattern,
      results,
      count: results.length,
      truncated: perPattern.some(p => p.truncated),
    };
  },
};
