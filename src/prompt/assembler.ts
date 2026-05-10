/**
 * 提示词组装器
 *
 * 负责将系统提示词、聊天历史、工具声明、生成配置组装为完整的 LLMRequest。
 * 支持动态插入提示词片段（Part），可用于注入时间、用户信息等上下文。
 */

import { Content, Part, LLMRequest, FunctionDeclaration } from '../types';

export class PromptAssembler {
  private systemParts: Part[] = [];
  private generationConfig?: LLMRequest['generationConfig'];

  /** 设置系统提示词（替换当前全部） */
  setSystemPrompt(text: string): void {
    this.systemParts = [{ text }];
  }

  /** 追加系统提示词片段 */
  addSystemPart(part: Part): void {
    this.systemParts.push(part);
  }

  /** 移除指定的系统提示词片段（按引用匹配） */
  removeSystemPart(part: Part): void {
    const idx = this.systemParts.indexOf(part);
    if (idx !== -1) this.systemParts.splice(idx, 1);
  }

  /** 清空系统提示词 */
  clearSystemParts(): void {
    this.systemParts = [];
  }

  /** 设置默认生成配置 */
  setGenerationConfig(config: LLMRequest['generationConfig']): void {
    this.generationConfig = config;
  }

  /**
   * 组装完整的 LLM 请求
   *
   * @param history    聊天历史（Content[]）
   * @param toolDecls  工具声明列表（可选）
   * @param overrides  生成配置覆盖（可选）
   * @param extraParts 额外系统提示词片段（per-request，不修改共享状态）
   */
  assemble(
    history: Content[],
    toolDecls?: FunctionDeclaration[],
    overrides?: LLMRequest['generationConfig'],
    extraParts?: Part[],
    extraUserParts?: Part[],
  ): LLMRequest {
    const contents = history.map(({ role, parts }) => ({ role, parts }));

    // 非持久化的请求尾部提醒（例如动态进度守卫）不要放入 system prompt，
    // 否则会破坏 Claude system prompt cache。优先合并到最后一条 user
    // content，避免部分 provider 不接受连续 user message。
    if (extraUserParts && extraUserParts.length > 0) {
      const last = contents[contents.length - 1];
      if (last?.role === 'user') {
        contents[contents.length - 1] = {
          role: 'user',
          parts: [...last.parts, ...extraUserParts],
        };
      } else {
        contents.push({ role: 'user', parts: [...extraUserParts] });
      }
    }

    const request: LLMRequest = {
      // 剥离 usageMetadata（仅存储用，不发送给 LLM）
      contents,
    };

    // 系统提示词（含可选的额外片段）
    const allParts = extraParts
      ? [...this.systemParts, ...extraParts]
      : this.systemParts;
    if (allParts.length > 0) {
      request.systemInstruction = { parts: [...allParts] };
    }

    // 工具声明
    if (toolDecls && toolDecls.length > 0) {
      request.tools = [{ functionDeclarations: toolDecls }];
    }

    // 生成配置
    const config = overrides ?? this.generationConfig;
    if (config) {
      request.generationConfig = config;
    }

    return request;
  }
}
