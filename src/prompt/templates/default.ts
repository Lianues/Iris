/**
 * 默认系统提示词模板
 *
 * 可在此添加更多模板。
 * 模板是纯字符串，也可以是接受参数的函数。
 */

import { getSessionCwd } from '../../core/backend/session-context';

/** 默认系统提示词 */
export const DEFAULT_SYSTEM_PROMPT = `你是一个有用的 AI 助手。请用用户的语言回复，回答要准确、简洁。如果你有可用的工具，可以在需要时使用它们来辅助你的回答。`;

/**
 * 生成带时间信息的系统提示词
 */
export function systemPromptWithTime(basePrompt?: string): string {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const cwd = getSessionCwd();
  const base = basePrompt ?? DEFAULT_SYSTEM_PROMPT;
  return `${base}\n\n当前时间：${now}\n当前工作目录：${cwd}`;
}
