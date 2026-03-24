/**
 * 工具执行附件类型。
 *
 * 目的：把 MCP 工具等返回的图片/音频/文件从 LLM 上下文里旁路出去，
 * 让平台层按各自能力直接发送给用户，避免把 base64 当文本塞进历史。
 */

export interface ToolAttachment {
  /** 附件类型。当前先支持图片，后续可扩展音频、文件。 */
  type: 'image' | 'audio' | 'file';
  /** MIME 类型，如 image/png。 */
  mimeType: string;
  /** 附件二进制内容。 */
  data: Buffer;
  /** 可选文件名。 */
  fileName?: string;
  /** 可选来源工具名。 */
  toolName?: string;
  /** 可选说明文字，供平台展示为 caption。 */
  caption?: string;
}
