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

  /**
   * 仅替换基础系统提示词文本，保留后续通过 addSystemPart 注入的运行时片段。
   * 用于配置热重载，避免覆盖 milestone / 插件等附加 system part。
   */
  replaceSystemPromptText(text: string): void {
    if (this.systemParts.length === 0) this.systemParts = [{ text }];
    else this.systemParts[0] = { text };
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
  ): LLMRequest {
    const request: LLMRequest = {
      // 剥离 usageMetadata（仅存储用，不发送给 LLM）
      contents: history.map(({ role, parts }) => ({ role, parts })),
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
