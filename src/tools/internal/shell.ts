/**
 * Shell 命令执行工具
 *
 * 在项目目录下执行 Shell 命令，返回 stdout 和 stderr。
 * 支持设置超时和工作目录。
 */

import { exec } from 'child_process';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

/** 默认超时 30 秒 */
const DEFAULT_TIMEOUT = 30_000;

/** 输出最大长度（字符） */
const MAX_OUTPUT_LENGTH = 50_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return text.slice(0, half) + `\n\n... (已截断，共 ${text.length} 字符) ...\n\n` + text.slice(-half);
}

export const shell: ToolDefinition = {
  declaration: {
    name: 'shell',
    description: [
      '在项目目录下执行 Shell 命令。',
      '返回命令的 stdout、stderr 和退出码。',
      '超时默认 30 秒。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 Shell 命令',
        },
        cwd: {
          type: 'string',
          description: '工作目录（相对于项目根目录），默认为项目根目录',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 30000',
        },
      },
      required: ['command'],
    },
  },
  handler: async (args) => {
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;
    const timeout = (args.timeout as number | undefined) ?? DEFAULT_TIMEOUT;

    // 解析工作目录（安全检查：禁止超出项目范围）
    const projectRoot = process.cwd();
    const workDir = cwd ? resolveProjectPath(cwd) : projectRoot;

    return new Promise<unknown>((resolve) => {
      exec(
        command,
        {
          cwd: workDir,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        },
        (error, stdout, stderr) => {
          const exitCode = error ? (error as any).code ?? 1 : 0;
          const killed = error ? !!(error as any).killed : false;

          resolve({
            command,
            exitCode,
            killed,
            stdout: truncate(stdout, MAX_OUTPUT_LENGTH),
            stderr: truncate(stderr, MAX_OUTPUT_LENGTH),
          });
        },
      );
    });
  },
};
