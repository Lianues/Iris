/**
 * Extension 通用工具
 *
 * 从 @irises/extension-sdk/utils re-export 共享工具，
 * 同时提供 core 专属的严格类型版本。
 */

import { createLogger } from '../logger';
import type { ExtensionManifest } from '@irises/extension-sdk';

// 从 SDK 共享工具 re-export 基础工具
export { MANIFEST_FILE } from '@irises/extension-sdk/utils';
export { isDirectory, resolveSafeRelativePath } from '@irises/extension-sdk/utils';
import {
  parseExtensionManifest as parseExtensionManifestLike,
  readManifestFromDir as readManifestFromDirLike,
} from '@irises/extension-sdk/utils';

const logger = createLogger('ExtensionUtils');

/**
 * 解析 extension manifest —— core 严格类型版本。
 * 底层调用 extension-utils 的松散版，返回前转型为 ExtensionManifest。
 */
export function parseExtensionManifest(raw: unknown, sourceLabel: string): ExtensionManifest {
  return parseExtensionManifestLike(raw, sourceLabel) as unknown as ExtensionManifest;
}

/**
 * 从目录读取 manifest.json —— core 容错版。
 * 文件不存在或解析失败时返回 undefined。
 */
export function readManifestFromDir(rootDir: string): ExtensionManifest | undefined {
  try {
    return readManifestFromDirLike(rootDir) as ExtensionManifest | undefined;
  } catch (err) {
    logger.warn(`extension manifest 读取失败: ${rootDir}`, err);
    return undefined;
  }
}

/** 严格版：文件不存在或解析失败时抛异常 */
export function readManifestFromDirStrict(rootDir: string): ExtensionManifest {
  const result = readManifestFromDir(rootDir);
  if (!result) {
    throw new Error(`extension 缺少有效 manifest.json: ${rootDir}`);
  }
  return result;
}
