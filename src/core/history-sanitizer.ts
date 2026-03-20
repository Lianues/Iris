/**
 * 历史消息清理工具
 *
 * 清理对话历史末尾不完整的消息，保证格式合法。
 * 核心约束：任何 model 的 functionCall 必须有对应的 user functionResponse。
 *
 * 用于两个场景：
 *   1. abort 后清理（ToolLoop.buildAbortResult）
 *   2. 加载历史时兜底检查（Backend.handleMessage）
 */

import {
  Content, isFunctionCallPart, extractText,
  FunctionResponsePart, FunctionCallPart,
} from '../types';
import { createLogger } from '../logger';

const logger = createLogger('HistorySanitizer');

/**
 * 从历史末尾往前清理不完整的消息，保证格式合法。
 * 直接修改传入的数组。
 *
 * 清理策略（从末尾往前扫描）：
 *   1. model 含 functionCall（无对应 response）→ 保留 model 消息，追加中断提示作为响应
 *   2. model 纯 thought 或空内容 → 丢弃
 *   3. model 有可见文本 → 保留（视为正常截断）
 *   4. user 是孤立的 functionResponse → 丢弃
 *   5. user+functionResponse 与前面的 model+functionCall 配对 → 保留
 *   6. 普通 user 消息 → 保留
 *
 * @param history       对话历史数组（会被原地修改）
 * @param minLength     清理不能低于此长度（abort 用 historyBaseLength，加载兜底用 0）
 * @param abortMessage  functionResponse 中的错误提示文案
 * @returns 新追加的消息列表（中断响应），空数组表示无新增
 */
export function cleanupTrailingHistory(
  history: Content[],
  minLength: number = 0,
  abortMessage: string = 'Tool execution was interrupted by user',
): Content[] {
  const appended: Content[] = [];

  while (history.length > minLength) {
    const last = history[history.length - 1];

    if (last.role === 'model') {
      const functionCalls = last.parts.filter(isFunctionCallPart) as FunctionCallPart[];
      if (functionCalls.length > 0) {
        // model 消息包含 functionCall 但无对应 response → 保留并追加中断提示
        const abortResponses: FunctionResponsePart[] = functionCalls.map(fc => ({
          functionResponse: {
            name: fc.functionCall.name,
            response: { error: abortMessage },
            callId: fc.functionCall.callId,
          },
        }));
        const abortContent: Content = { role: 'user', parts: abortResponses };
        history.push(abortContent);
        appended.push(abortContent);
        break;
      }

      const visibleText = extractText(last.parts);
      const hasOnlyThought = last.parts.every(p =>
        ('thought' in p && p.thought === true) || ('text' in p && !p.text)
      );

      if (hasOnlyThought || !visibleText) {
        // 纯 thought 或空内容 → 丢弃
        history.pop();
        continue;
      }

      // 有可见文本（输出中中止）→ 保留，视为正常截断
      break;
    }

    if (last.role === 'user') {
      // 检查是否是 tool response（包含 functionResponse part）
      const isToolResponse = last.parts.some(p => 'functionResponse' in p);
      if (isToolResponse) {
        // 检查前一条是否是匹配的 model functionCall
        if (history.length >= 2) {
          const prev = history[history.length - 2];
          if (prev.role === 'model' && prev.parts.some(isFunctionCallPart)) {
            // model(functionCall) + user(functionResponse) 是完整对，保留
            break;
          }
        }
        // 孤立的 tool response → 丢弃
        history.pop();
        continue;
      }
      // 普通用户消息 → 保留
      break;
    }

    // 其他角色（不应存在）→ 安全起见丢弃
    history.pop();
  }

  return appended;
}

/**
 * 加载历史时的兜底清理。
 * 修复因中断、崩溃等原因导致的不完整消息。
 * 直接修改传入的数组。
 *
 * @returns 新追加的消息列表（中断响应），空数组表示历史已合法无需修改
 */
export function sanitizeHistory(history: Content[]): Content[] {
  const before = history.length;
  const appended = cleanupTrailingHistory(
    history, 0,
    'Tool execution was interrupted (recovered from incomplete history)',
  );
  const keptFromOriginal = history.length - appended.length;
  if (keptFromOriginal !== before || appended.length > 0) {
    logger.info(`历史兜底清理: ${before} → ${history.length} 条 (移除 ${before - keptFromOriginal}, 追加 ${appended.length})`);
  }
  return appended;
}
