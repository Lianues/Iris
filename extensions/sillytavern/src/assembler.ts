/**
 * 格式桥接层
 *
 * 负责 Iris Content[] ↔ fast-tavern ChatMessage[] 的双向转换。
 * 两者都使用 Gemini 风格（role + parts），核心映射很直接，
 * 只需处理 Iris 特有的 FunctionCall/FunctionResponse 部分。
 */

import type { Content, Part } from 'irises-extension-sdk';
import type { ChatMessage, BuildPromptResult } from 'fast-tavern';
import type { LLMRequest } from 'irises-extension-sdk';

// ─── Iris → fast-tavern ───

/**
 * 将 Iris 的 Content[] 转为 fast-tavern 的 ChatMessage[]。
 * 只提取文本部分作为聊天历史（工具调用/响应不参与 ST 提示词组装）。
 */
export function irisContentsToHistory(contents: Content[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const content of contents) {
    // 提取文本 parts（跳过 thought、functionCall、functionResponse）
    const textParts: { text: string }[] = [];
    for (const part of content.parts) {
      if ('text' in part && part.text && !('functionCall' in part) && !('functionResponse' in part)) {
        // 跳过 thought（思考链）
        if ((part as any).thought) continue;
        textParts.push({ text: part.text });
      }
    }

    // 跳过没有文本内容的消息（纯工具调用/响应轮次）
    if (textParts.length === 0) continue;

    result.push({
      role: content.role,       // 'user' | 'model'，fast-tavern 直接兼容
      parts: textParts,
    });
  }

  return result;
}

// ─── fast-tavern → Iris LLMRequest ───

/**
 * 将 fast-tavern 的 Gemini 格式输出转为 Iris 的 LLMRequest 结构。
 *
 * 策略：
 *   - 所有消息（含 system）统一转为 user/model 放入 contents
 *   - system 角色 → 转为 user
 *   - 不设置 systemInstruction（由 fast-tavern 的组装结果完全接管）
 *   - 保留原始 request 的 tools 和 generationConfig
 */
export function assembledToLLMRequest(
  assembled: ChatMessage[],
  originalRequest: LLMRequest,
): LLMRequest {
  const contents: Content[] = [];

  for (const msg of assembled) {
    // fast-tavern gemini 输出的 parts 格式: { text: string }[]
    const parts = (msg as any).parts as Array<{ text: string }>;
    if (!parts || parts.length === 0) continue;

    const irisParts: Part[] = parts
      .filter(p => p.text)
      .map(p => ({ text: p.text }));
    if (irisParts.length === 0) continue;

    // system → user，其余保持原样
    const role: 'user' | 'model' = msg.role === 'model' ? 'model' : 'user';

    contents.push({ role, parts: irisParts });
  }

  return {
    contents,
    systemInstruction: undefined,
    tools: originalRequest.tools,
    generationConfig: originalRequest.generationConfig,
  };
}

// ─── 调试辅助 ───

/**
 * 将 tagged 阶段输出格式化为可读字符串，用于日志。
 */
export function formatTaggedForLog(result: BuildPromptResult): string {
  const tagged = result.stages.tagged.afterPostRegex;
  const lines: string[] = ['=== SillyTavern Assembled Prompt ==='];

  for (const item of tagged) {
    const roleTag = `[${item.role}]`;
    const label = item.tag;
    const preview = item.text.length > 200
      ? item.text.slice(0, 200) + '...'
      : item.text;
    lines.push(`${roleTag} ${label}: ${preview}`);
  }

  lines.push(`=== Total items: ${tagged.length} ===`);
  return lines.join('\n');
}
