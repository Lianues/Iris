import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile as readFileTool } from '../src/tools/internal/read_file.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function asReadFileResult(value: unknown) {
  return value as {
    successCount: number;
    failCount: number;
    results: Array<{
      success: boolean;
      content?: string;
      encoding?: string;
      error?: string;
    }>;
  };
}

describe('read_file content-based text detection', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.tmp-read-file-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function rel(filePath: string): string {
    return path.relative(process.cwd(), filePath);
  }

  async function readOne(filePath: string) {
    return asReadFileResult(await readFileTool.handler({
      files: [{ path: rel(filePath) }],
    }));
  }

  it('允许读取 .smali 这类非内置白名单思路下的纯文本文件', async () => {
    const file = path.join(tmpDir, 'OooO0O0.smali');
    await fs.writeFile(file, '.class public Lo00o/OooO0O0;\n.super Ljava/lang/Object;\n', 'utf8');

    const result = await readOne(file);

    expect(result.successCount).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].content).toContain('.class public Lo00o/OooO0O0;');
  });

  it('无后缀纯文本可以正常读取', async () => {
    const file = path.join(tmpDir, 'README_LIKE');
    await fs.writeFile(file, 'hello\n无后缀文本\n', 'utf8');

    const result = await readOne(file);

    expect(result.successCount).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].content).toContain('无后缀文本');
  });

  it('无后缀图片会按内容识别为二进制并拒绝', async () => {
    const file = path.join(tmpDir, 'image_without_ext');
    await fs.writeFile(file, PNG_1X1);

    const result = await readOne(file);

    expect(result.failCount).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('二进制文件');
  });

  it('图片即使伪装成 .txt 也会被拒绝', async () => {
    const file = path.join(tmpDir, 'fake.txt');
    await fs.writeFile(file, PNG_1X1);

    const result = await readOne(file);

    expect(result.failCount).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('二进制文件');
  });

  it('拒绝直接读取 Skill 目录资源，要求使用 read_skill_resource', async () => {
    const file = path.join(tmpDir, '.agents', 'skills', 'demo', 'SKILL.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'secret skill', 'utf8');

    const result = await readOne(file);

    expect(result.failCount).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('read_skill_resource');
  });
});
