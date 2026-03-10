/**
 * 读取文件工具
 *
 * 读取文本文件内容，返回带行号的格式化文本。
 * 支持指定起止行号。仅支持文本类型的文件。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

/** 支持的文本文件扩展名 */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc', '.json5',
  '.html', '.htm', '.css', '.scss', '.less',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.svg',
  '.csv', '.tsv', '.log',
  '.gitignore', '.dockerignore', '.editorconfig',
  '.sql',
  '',  // 无扩展名文件（如 Makefile、Dockerfile）
]);

/** 无扩展名但是文本的已知文件名 */
const TEXT_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile', 'Rakefile',
  'LICENSE', 'CHANGELOG', 'README',
  '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc',
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const basename = path.basename(filePath);
  if (basename.startsWith('.env')) return true;
  return TEXT_FILENAMES.has(basename);
}

/** 将文本内容格式化为带行号的形式 */
function formatWithLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const totalLines = startLine + lines.length - 1;
  const width = String(totalLines).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width)} | ${line}`)
    .join('\n');
}

export const readFile: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'read_file',
    description: [
      '读取文本文件内容，返回带行号的格式化文本。',
      '仅支持文本类型的文件（代码、配置、文档等）。',
      '可通过 startLine 和 endLine 指定读取范围（行号从 1 开始）。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于项目根目录）',
        },
        startLine: {
          type: 'number',
          description: '起始行号（1-based，含），默认从第 1 行开始',
        },
        endLine: {
          type: 'number',
          description: '结束行号（1-based，含），默认到文件末尾',
        },
      },
      required: ['path'],
    },
  },
  handler: async (args) => {
    const filePath = args.path as string;
    const startLine = (args.startLine as number | undefined) ?? 1;
    const endLine = args.endLine as number | undefined;

    // 安全检查：禁止路径穿越
    const resolved = resolveProjectPath(filePath);

    // 文件类型检查
    if (!isTextFile(filePath)) {
      throw new Error(`不支持的文件类型: ${path.extname(filePath) || '(无扩展名)'}\n仅支持文本类型的文件。`);
    }

    // 读取文件
    const raw = await fs.readFile(resolved, 'utf-8');
    const allLines = raw.split('\n');
    const totalLines = allLines.length;

    // 范围截取
    const start = Math.max(1, startLine);
    const end = endLine ? Math.min(endLine, totalLines) : totalLines;

    if (start > totalLines) {
      throw new Error(`startLine (${start}) 超出文件总行数 (${totalLines})`);
    }

    const sliced = allLines.slice(start - 1, end);
    const formatted = formatWithLineNumbers(sliced.join('\n'), start);

    return {
      path: filePath,
      totalLines,
      startLine: start,
      endLine: end,
      content: formatted,
    };
  },
};
