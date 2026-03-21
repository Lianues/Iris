/**
 * 消息附件存储
 *
 * 将消息中的大型内联二进制数据（base64 截图等）提取到独立文件，
 * 聊天记录 JSON / SQLite 中只保留轻量引用。构建 LLM 请求或
 * 加载历史时按需还原为完整 base64。
 *
 * 文件使用内容哈希命名（SHA-256 前 16 位 hex），自动去重。
 *
 * 引用格式：attachment:{hash}.{ext}
 *   示例：attachment:a1b2c3d4e5f67890.png
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import mime from 'mime-types';
import { Content, Part, isInlineDataPart, isFunctionResponsePart } from '../types';
import { createLogger } from '../logger';

const logger = createLogger('Attachment');

/** 引用前缀 */
const ATTACHMENT_PREFIX = 'attachment:';

// ============ 公共工具函数 ============

/** 判断 InlineDataPart.data 是否为附件引用 */
export function isAttachmentRef(data: string): boolean {
  return data.startsWith(ATTACHMENT_PREFIX);
}

// ============ 文件级操作 ============

/** MIME → 扩展名 */
function mimeToExt(mimeType: string): string {
  // mime-types 内置完整 IANA MIME 数据库，覆盖图片/音频/视频/文档等所有常见类型
  return mime.extension(mimeType) || 'bin';
}

/** 对 base64 字符串计算 SHA-256，取前 16 位 hex */
function hashBase64(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * 将 base64 数据保存为附件文件，返回引用字符串。
 * 内容寻址：同一数据只写入一次。
 */
async function saveAttachment(
  data: string,
  mimeType: string,
  dir: string,
): Promise<string> {
  const hash = hashBase64(data);
  const ext = mimeToExt(mimeType);
  const filename = `${hash}.${ext}`;
  const filePath = path.join(dir, filename);

  // 文件已存在 → 跳过（去重）
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    const buffer = Buffer.from(data, 'base64');
    await fs.writeFile(filePath, buffer);
  }

  return `${ATTACHMENT_PREFIX}${filename}`;
}

/**
 * 从附件文件加载数据，返回 base64 字符串。
 * 文件不存在时返回空字符串（优雅降级）。
 */
async function loadAttachment(
  ref: string,
  dir: string,
): Promise<string> {
  const filename = ref.slice(ATTACHMENT_PREFIX.length);
  const filePath = path.join(dir, filename);
  try {
    const buffer = await fs.readFile(filePath);
    return buffer.toString('base64');
  } catch {
    logger.warn(`附件文件缺失: ${filePath}`);
    return '';
  }
}

// ============ Content 级批量操作 ============

/**
 * 提取一条消息中的大型内联数据为附件文件。
 *
 * 遍历 content.parts 中的 InlineDataPart 及 FunctionResponsePart.parts，
 * 将超过阈值的 base64 数据写入附件目录，data 字段替换为引用字符串。
 *
 * 返回新的 Content 对象（浅拷贝），不修改原对象。
 * 若无需提取，直接返回原对象。
 */
export async function extractAttachments(
  content: Content,
  attachmentsDir: string,
): Promise<Content> {
  let modified = false;
  const newParts: Part[] = [];

  for (const part of content.parts) {
    // ---- 顶层 InlineDataPart ----
    if (isInlineDataPart(part)
      && !isAttachmentRef(part.inlineData.data)
    ) {
      try {
        const ref = await saveAttachment(part.inlineData.data, part.inlineData.mimeType, attachmentsDir);
        newParts.push({ inlineData: { mimeType: part.inlineData.mimeType, data: ref } });
        modified = true;
        continue;
      } catch (err) {
        // 写入失败 → 保留原始内联数据，不阻塞流程
        logger.warn('附件提取失败，保留内联数据:', err);
      }
    }

    // ---- FunctionResponsePart 内的 parts（CU 截图） ----
    if (isFunctionResponsePart(part) && part.functionResponse.parts?.length) {
      let innerModified = false;
      const newInnerParts = [];

      for (const innerPart of part.functionResponse.parts) {
        if (!isAttachmentRef(innerPart.inlineData.data)
        ) {
          try {
            const ref = await saveAttachment(innerPart.inlineData.data, innerPart.inlineData.mimeType, attachmentsDir);
            newInnerParts.push({ inlineData: { mimeType: innerPart.inlineData.mimeType, data: ref } });
            innerModified = true;
            continue;
          } catch (err) {
            logger.warn('附件提取失败，保留内联数据:', err);
          }
        }
        newInnerParts.push(innerPart);
      }

      if (innerModified) {
        newParts.push({
          functionResponse: {
            ...part.functionResponse,
            parts: newInnerParts,
          },
        });
        modified = true;
        continue;
      }
    }

    newParts.push(part);
  }

  if (!modified) return content;
  return { ...content, parts: newParts };
}

/**
 * 还原一条消息中的附件引用为完整 base64 数据。
 *
 * 遍历 content.parts，识别 attachment: 前缀的引用，
 * 从附件目录读取文件并还原 data 字段。
 *
 * 返回新的 Content 对象（浅拷贝），不修改原对象。
 * 若无需还原，直接返回原对象。
 */
export async function restoreAttachments(
  content: Content,
  attachmentsDir: string,
): Promise<Content> {
  let modified = false;
  const newParts: Part[] = [];

  for (const part of content.parts) {
    // ---- 顶层 InlineDataPart ----
    if (isInlineDataPart(part) && isAttachmentRef(part.inlineData.data)) {
      const data = await loadAttachment(part.inlineData.data, attachmentsDir);
      newParts.push({ inlineData: { mimeType: part.inlineData.mimeType, data } });
      modified = true;
      continue;
    }

    // ---- FunctionResponsePart 内的 parts ----
    if (isFunctionResponsePart(part) && part.functionResponse.parts?.length) {
      let innerModified = false;
      const newInnerParts = [];

      for (const innerPart of part.functionResponse.parts) {
        if (isAttachmentRef(innerPart.inlineData.data)) {
          const data = await loadAttachment(innerPart.inlineData.data, attachmentsDir);
          newInnerParts.push({ inlineData: { mimeType: innerPart.inlineData.mimeType, data } });
          innerModified = true;
        } else {
          newInnerParts.push(innerPart);
        }
      }

      if (innerModified) {
        newParts.push({
          functionResponse: {
            ...part.functionResponse,
            parts: newInnerParts,
          },
        });
        modified = true;
        continue;
      }
    }

    newParts.push(part);
  }

  if (!modified) return content;
  return { ...content, parts: newParts };
}
