/**
 * 读取文件工具
 *
 * 支持批量读取，每个文件可单独指定行范围。
 * 返回带行号的格式化文本。仅支持文本类型文件。
 */

import { TextDecoder } from 'node:util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as chardet from 'chardet';
import { isBinaryFile } from 'isbinaryfile';
import { ToolDefinition } from '../../types';
import { normalizeObjectArrayArg, resolveProjectPath } from '../utils';
import { getToolLimits } from '../tool-limits';

interface EncodingMatch {
  encoding: string;
  confidence: number;
}

interface DecodedText {
  text: string;
  encoding: string;
}

const TEXT_DECODER_ALIASES: Record<string, string> = {
  'ascii': 'utf-8',
  'utf-8': 'utf-8',
  'utf8': 'utf-8',
  'utf-16 le': 'utf-16le',
  'utf-16le': 'utf-16le',
  'utf-16-le': 'utf-16le',
  'utf-16 be': 'utf-16be',
  'utf-16be': 'utf-16be',
  'utf-16-be': 'utf-16be',
  'utf-32 le': 'utf-32le',
  'utf-32le': 'utf-32le',
  'utf-32-le': 'utf-32le',
  'utf-32 be': 'utf-32be',
  'utf-32be': 'utf-32be',
  'utf-32-be': 'utf-32be',
  'shift-jis': 'shift_jis',
  'shift_jis': 'shift_jis',
  'sjis': 'shift_jis',
  'big5': 'big5',
  'euc-jp': 'euc-jp',
  'euc_jp': 'euc-jp',
  'euc-kr': 'euc-kr',
  'euc_kr': 'euc-kr',
  'gb18030': 'gb18030',
  'gb2312': 'gb18030',
  'gbk': 'gb18030',
  'iso-8859-1': 'iso-8859-1',
  'iso-8859-2': 'iso-8859-2',
  'iso-8859-5': 'iso-8859-5',
  'iso-8859-6': 'iso-8859-6',
  'iso-8859-7': 'iso-8859-7',
  'iso-8859-8': 'iso-8859-8',
  'iso-8859-9': 'iso-8859-9',
  'windows-1250': 'windows-1250',
  'windows-1251': 'windows-1251',
  'windows-1252': 'windows-1252',
  'windows-1253': 'windows-1253',
  'windows-1254': 'windows-1254',
  'windows-1255': 'windows-1255',
  'windows-1256': 'windows-1256',
  'koi8-r': 'koi8-r',
};

/**
 * isbinaryfile@5 对非 UTF-8 多字节文本偏保守，可能把 GBK/Big5/SJIS 文本判为二进制。
 * 这些编码在 chardet 高置信命中且解码结果仍像文本时允许兜底放行。
 */
const RESCUABLE_TEXT_ENCODINGS = new Set([
  'utf-16le', 'utf-16be', 'utf-32le', 'utf-32be',
  'gb18030', 'big5', 'shift_jis', 'euc-jp', 'euc-kr',
]);

function normalizeEncodingName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ');
  return TEXT_DECODER_ALIASES[key] ?? TEXT_DECODER_ALIASES[key.replace(/ /g, '-')];
}

function getBestEncodingMatch(buffer: Buffer): EncodingMatch | undefined {
  try {
    const [best] = chardet.analyse(buffer);
    const encoding = normalizeEncodingName(best?.name);
    if (!best || !encoding) return undefined;
    return {
      encoding,
      confidence: best.confidence,
    };
  } catch {
    return undefined;
  }
}

function detectBomEncoding(buffer: Buffer): { encoding: string; offset: number } | undefined {
  if (buffer.length >= 4) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe && buffer[2] === 0x00 && buffer[3] === 0x00) {
      return { encoding: 'utf-32le', offset: 4 };
    }
    if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xfe && buffer[3] === 0xff) {
      return { encoding: 'utf-32be', offset: 4 };
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf-8', offset: 3 };
  }
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return { encoding: 'utf-16le', offset: 2 };
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return { encoding: 'utf-16be', offset: 2 };
  }
  return undefined;
}

function decodeUtf32(buffer: Buffer, littleEndian: boolean, offset: number): string {
  const chars: string[] = [];
  for (let i = offset; i + 3 < buffer.length; i += 4) {
    const codePoint = littleEndian
      ? ((buffer[i] ?? 0) | ((buffer[i + 1] ?? 0) << 8) | ((buffer[i + 2] ?? 0) << 16) | ((buffer[i + 3] ?? 0) << 24)) >>> 0
      : (((buffer[i] ?? 0) << 24) | ((buffer[i + 1] ?? 0) << 16) | ((buffer[i + 2] ?? 0) << 8) | (buffer[i + 3] ?? 0)) >>> 0;
    try {
      chars.push(String.fromCodePoint(codePoint));
    } catch {
      chars.push('\uFFFD');
    }
  }
  return chars.join('');
}

function decodeBuffer(buffer: Buffer): DecodedText {
  const bom = detectBomEncoding(buffer);
  const encoding = bom?.encoding ?? getBestEncodingMatch(buffer)?.encoding ?? 'utf-8';
  const offset = bom?.offset ?? 0;

  if (encoding === 'utf-32le' || encoding === 'utf-32be') {
    return {
      text: decodeUtf32(buffer, encoding === 'utf-32le', offset),
      encoding,
    };
  }

  try {
    return {
      text: new TextDecoder(encoding, { fatal: false }).decode(buffer.subarray(offset)),
      encoding,
    };
  } catch {
    return {
      text: new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(offset)),
      encoding: 'utf-8',
    };
  }
}

function looksLikeDecodedText(text: string): boolean {
  if (text.length === 0) return true;

  let controlChars = 0;
  let replacementChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0xfffd) replacementChars++;

    const allowedControl = code === 0x09  // tab
      || code === 0x0a                    // LF
      || code === 0x0d                    // CR
      || code === 0x0c                    // FF
      || code === 0x1b;                   // ESC（日志/终端输出常见）
    if (!allowedControl && ((code < 0x20) || (code >= 0x7f && code <= 0x9f))) {
      controlChars++;
    }
  }

  return replacementChars / text.length <= 0.01
    && controlChars / text.length <= 0.01;
}

function canRescueAsEncodedText(buffer: Buffer, decoded: DecodedText): boolean {
  const match = getBestEncodingMatch(buffer);
  if (!match || match.confidence < 50) return false;
  if (!RESCUABLE_TEXT_ENCODINGS.has(match.encoding)) return false;
  if (!looksLikeDecodedText(decoded.text)) return false;

  // 不依赖文件名/后缀维护列表；只有内容编码检测足够确定时才兜底放行。
  return match.confidence >= 80;
}

async function decodeReadableText(buffer: Buffer, filePath: string): Promise<DecodedText> {
  const decoded = decodeBuffer(buffer);
  const binary = await isBinaryFile(buffer, buffer.length);
  if (!binary || canRescueAsEncodedText(buffer, decoded)) {
    return decoded;
  }

  throw new Error(`文件看起来是二进制文件，拒绝按文本读取: ${path.extname(filePath) || '(无扩展名)'}`);
}

function formatWithLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const totalLines = startLine + lines.length - 1;
  const width = String(totalLines).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width)} | ${line}`)
    .join('\n');
}

interface FileReadRequest {
  path: string;
  startLine?: number;
  endLine?: number;
}

interface ReadResult {
  path: string;
  success: boolean;
  type?: 'text';
  content?: string;
  encoding?: string;
  lineCount?: number;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  error?: string;
}

function isFileReadRequest(value: unknown): value is FileReadRequest {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string';
}

export const readFile: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'read_file',
    description: [
      '读取一个或多个文本文件的内容。',
      '按文件内容判断文本/二进制，不依赖扩展名白名单。',
      '返回带行号的格式化文本。',
      '每个文件可单独指定 startLine 和 endLine（行号从 1 开始）。',
      '参数 files 必须是数组，即使只读一个文件。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '文件列表，每项包含 path（必填）、startLine（可选）、endLine（可选）',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（相对于项目根目录）' },
              startLine: { type: 'number', description: '起始行号（1-based，含）' },
              endLine: { type: 'number', description: '结束行号（1-based，含）' },
            },
            required: ['path'],
          },
        },
      },
      required: ['files'],
    },
  },
  handler: async (args) => {
    const limits = getToolLimits().read_file;
    const fileList = normalizeObjectArrayArg(args, {
      arrayKey: 'files',
      singularKeys: ['file'],
      isEntry: isFileReadRequest,
    });

    if (!fileList || fileList.length === 0) {
      throw new Error('files 参数必须是非空数组');
    }

    const results: ReadResult[] = [];
    let successCount = 0;
    let failCount = 0;
    let totalOutputChars = 0;

    // 文件数量上限
    const cappedList = fileList.length > limits.maxFiles
      ? fileList.slice(0, limits.maxFiles)
      : fileList;
    const filesCapped = fileList.length > limits.maxFiles;

    for (const fileReq of cappedList) {
      try {
        const resolved = resolveProjectPath(fileReq.path);

        // 文件大小检查
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          throw new Error('路径不是文件');
        }
        if (stat.size > limits.maxFileSizeBytes) {
          throw new Error(
            `文件过大 (${stat.size} bytes > ${limits.maxFileSizeBytes} bytes)，请使用 startLine/endLine 分段读取`,
          );
        }

        const buffer = await fs.readFile(resolved);
        const { text: raw, encoding } = await decodeReadableText(buffer, fileReq.path);
        const allLines = raw.split('\n');
        const totalLines = allLines.length;

        const startLine = Math.max(1, fileReq.startLine ?? 1);
        const endLine = fileReq.endLine ? Math.min(fileReq.endLine, totalLines) : totalLines;

        if (startLine > totalLines) {
          throw new Error(`startLine (${startLine}) 超出文件总行数 (${totalLines})`);
        }

        const sliced = allLines.slice(startLine - 1, endLine);
        const formatted = formatWithLineNumbers(sliced.join('\n'), startLine);

        // 总输出字符数安全检查
        totalOutputChars += formatted.length;
        if (totalOutputChars > limits.maxTotalOutputChars) {
          results.push({
            path: fileReq.path, success: false,
            error: `总输出已达上限 (${limits.maxTotalOutputChars} chars)，后续文件已跳过。请使用 startLine/endLine 分段读取`,
          });
          failCount++;
          break;  // 停止处理后续文件
        }

        const result: ReadResult = {
          path: fileReq.path,
          success: true,
          type: 'text',
          encoding,
          content: formatted,
          lineCount: sliced.length,
        };

        // 如果指定了行范围，附加额外信息
        if (fileReq.startLine !== undefined || fileReq.endLine !== undefined) {
          result.totalLines = totalLines;
          result.startLine = startLine;
          result.endLine = endLine;
        }

        results.push(result);
        successCount++;
      } catch (err) {
        results.push({
          path: fileReq.path,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failCount++;
      }
    }

    const output: Record<string, unknown> = { results, successCount, failCount, totalCount: cappedList.length };

    if (filesCapped) {
      output.warning = `文件数量已截断: 请求 ${fileList.length} 个，上限 ${limits.maxFiles} 个`;
      output.totalCount = fileList.length;
    }

    return output;
  },
};
