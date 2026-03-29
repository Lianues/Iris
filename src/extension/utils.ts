import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import type { ExtensionManifest } from './types';

const logger = createLogger('ExtensionUtils');

export const MANIFEST_FILE = 'manifest.json';

export function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function resolveSafeRelativePath(rootDir: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(normalizedRoot, relativePath);
  const rel = path.relative(normalizedRoot, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界: ${relativePath}`);
  }
  return resolvedPath;
}

export function parseExtensionManifest(raw: unknown, sourceLabel: string): ExtensionManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`extension manifest 格式无效，应为对象: ${sourceLabel}`);
  }
  const manifest = raw as Record<string, unknown>;
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error(`extension manifest 缺少 name: ${sourceLabel}`);
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error(`extension manifest 缺少 version: ${sourceLabel}`);
  }
  return manifest as unknown as ExtensionManifest;
}

/** 容错版：文件不存在或解析失败时返回 undefined */
export function readManifestFromDir(rootDir: string): ExtensionManifest | undefined {
  const manifestPath = path.join(rootDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return parseExtensionManifest(raw, manifestPath);
  } catch (err) {
    logger.warn(`extension manifest 读取失败: ${manifestPath}`, err);
    return undefined;
  }
}

/** 严格版：文件不存在或解析失败时抛异常 */
export function readManifestFromDirStrict(rootDir: string): ExtensionManifest {
  const manifestPath = path.join(rootDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`extension 缺少 manifest.json: ${rootDir}`);
  }
  return parseExtensionManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath);
}
