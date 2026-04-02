/**
 * 子代理工具
 *
 * 主 LLM 通过此工具创建独立的子代理，
 * 每个子代理拥有独立上下文、独立工具集、独立工具循环。
 *
 * 子代理直接复用 ToolLoop（与 Orchestrator/CLI 相同的核心引擎），
 * 支持嵌套自我调用。
 *
 * 异步子代理改造说明：
 *   - 新增 run_in_background 参数，设为 true 时子代理在后台运行
 *   - handler 立即返回 { status: 'async_launched', taskId }
 *   - 子代理完成后通过 deps.enqueueNotification() 注入 task-notification
 *   - task-notification 触发主 LLM 的新 turn（由 Backend 的 MessageQueue 驱动）
 */

import { ToolDefinition } from '../../../types';
import type { Content, Part, LLMRequest, UsageMetadata } from '../../../types';
import { appendMergedPart } from '../../../core/backend/stream';
import { ToolPolicyConfig } from '../../../config';
import { LLMRouter } from '../../../llm/router';
import { agentContext } from '../../../logger';
import { ToolRegistry } from '../../registry';
import { ToolLoop, LLMCaller } from '../../../core/tool-loop';
import { PromptAssembler } from '../../../prompt/assembler';
import { createLogger } from '../../../logger';
import { SubAgentTypeRegistry, SubAgentTypeConfig } from './types';
import type { AgentTaskRegistry } from '../../../core/agent-task-registry';
import { createTaskId } from '../../../core/agent-task-registry';

// 统一导出类型层
export type { SubAgentTypeConfig } from './types';
export {
  SubAgentTypeRegistry,
} from './types';

const logger = createLogger('SubAgent');

export interface SubAgentToolDeps {
  /** 动态获取 router（支持热重载后取到最新实例） */
  getRouter: () => LLMRouter;
  /** LLM 调用报错时是否自动重试 */
  retryOnError?: boolean;
  /** 自动重试最大次数 */
  maxRetries?: number;
  tools: ToolRegistry;
  subAgentTypes: SubAgentTypeRegistry;
  maxDepth: number;
  getToolPolicies: () => Record<string, ToolPolicyConfig>;

  // ---- 异步子代理新增依赖（由 bootstrap 注入） ----

  /**
   * 异步子代理通知入口。
   * 子代理完成后调用此函数将 task-notification 入队，
   * 触发主 LLM 的新 turn。
   * 不提供时子代理只能同步运行。
   */
  enqueueNotification?: (sessionId: string, text: string) => void;
  /**
   * 获取当前活跃会话 ID。
   * 异步子代理需要知道属于哪个会话，才能将通知发到正确的队列。
   */
  getSessionId?: () => string | undefined;
  /**
   * 异步子代理任务注册表。
   * 用于跟踪后台任务状态、支持 clearSession 时批量中止。
   */
  agentTaskRegistry?: AgentTaskRegistry;
}

/** 工具名称常量 */
const TOOL_NAME = 'sub_agent';

/** 同一 session 最大并发异步子代理数（防止内存压力） */
const MAX_CONCURRENT_ASYNC_AGENTS = 5;

function getSubAgentTypeName(args: Record<string, unknown>): string {
  const type = args.type;
  return typeof type === 'string' && type.trim() ? type : 'general-purpose';
}

function formatTypeSuffix(type: SubAgentTypeConfig): string {
  const segments = [type.parallel ? '可并行调度' : '串行调度'];
  if (type.modelName) {
    segments.push(`模型名称=${type.modelName}`);
  }
  return segments.join('，');
}

/**
 * 构建 task-notification XML 文本。
 */
function buildNotificationXML(opts: {
  taskId: string;
  status: 'completed' | 'failed' | 'killed';
  description: string;
  result?: string;
  error?: string;
  toolUseCount?: number;
  durationMs?: number;
}): string {
  const resultSection = opts.result ? `\n<result>${opts.result}</result>` : '';
  const errorSection = opts.error ? `\n<error>${opts.error}</error>` : '';
  const usageSection = (opts.toolUseCount != null || opts.durationMs != null)
    ? `\n<usage>${opts.toolUseCount != null ? `<tool_uses>${opts.toolUseCount}</tool_uses>` : ''}${opts.durationMs != null ? `<duration_ms>${opts.durationMs}</duration_ms>` : ''}</usage>`
    : '';

  return `<task-notification>
<task-id>${opts.taskId}</task-id>
<status>${opts.status}</status>
<summary>${opts.description}</summary>${resultSection}${errorSection}${usageSection}
</task-notification>`;
}

/**
 * 创建带有可选实时反馈的流式 LLMCaller。
 *
 * 同步和异步子代理共用此函数。通过 onChunk / onTokens 回调抽象：
 * - 异步子代理：回调指向 AgentTaskRegistry（驱动 StatusBar）
 * - 同步子代理：回调指向 ToolStateManager.updateProgress（驱动 ToolCall 框内进度）
 * - 两个回调均为空时跳过事件发射（兼容无监控场景）
 */
function createStreamingLLMCaller(
  deps: SubAgentToolDeps,
  typeConfig: SubAgentTypeConfig,
  onChunk?: () => void,
  onTokens?: (tokens: number) => void,
): LLMCaller {
  return async (request, modelName, signal) => {
    const router = deps.getRouter();

    if (typeConfig.stream) {
      const parts: Part[] = [];
      let usageMetadata: UsageMetadata | undefined;
      for await (const chunk of router.chatStream(request, modelName, signal)) {
        // chunk 心跳回调：驱动 spinner 动画（只有真正有数据流动时才触发）
        onChunk?.();
        if (chunk.partsDelta && chunk.partsDelta.length > 0) {
          for (const part of chunk.partsDelta) {
            appendMergedPart(parts, part, Date.now());
          }
        } else {
          if (chunk.textDelta) appendMergedPart(parts, { text: chunk.textDelta }, Date.now());
          if (chunk.functionCalls) {
            for (const fc of chunk.functionCalls) appendMergedPart(parts, fc, Date.now());
          }
        }
        if (chunk.usageMetadata) {
          usageMetadata = chunk.usageMetadata;
          // token 更新回调：实时推送 token 计数
          const tokens = usageMetadata.totalTokenCount ?? usageMetadata.candidatesTokenCount ?? 0;
          if (tokens > 0) {
            onTokens?.(tokens);
          }
        }
      }
      if (parts.length === 0) parts.push({ text: '' });
      const content: Content = { role: 'model', parts, createdAt: Date.now() };
      if (usageMetadata) content.usageMetadata = usageMetadata;
      return content;
    }

    const response = await router.chat(request, modelName, signal);
    return response.content;
  };
}

/**
 * 创建 sub_agent 工具。
 *
 * 所有子代理引导信息（使用原则、异步说明、可用类型列表）全部放在工具描述中，
 * 不注入系统提示词，与 Skill 等工具的做法保持一致。
 */
export function createSubAgentTool(deps: SubAgentToolDeps, currentDepth: number = 0): ToolDefinition {
  const typeDescriptions = deps.subAgentTypes.getAll()
    .map(t => `  - ${t.name}: ${t.description}（${formatTypeSuffix(t)}）`)
    .join('\n');

  const asyncCapable = !!(deps.enqueueNotification && deps.getSessionId);

  // 工具描述：合并了原 buildSubAgentGuidance 中的使用原则和异步说明，
  // 作为工具 schema 的 description 字段发送给 LLM，
  // 不再通过 extraParts 注入系统提示词。
  let toolDescription = `启动子代理执行子任务。子代理拥有独立上下文和工具循环，完成后返回结果。

可用的子代理类型：
${typeDescriptions}

使用原则：
- 简单问题直接回答，不需要子代理
- 子代理没有你的对话历史，如果子任务需要背景信息，请通过 context 参数传递关键上下文
- 当子任务相对独立时，优先委派给子代理
- 提供清晰详细的 prompt，像给一个刚走进房间的聪明同事做简报
- 需要拆分多个独立子任务时，可以连续调用多个标记为"可并行调度"的子代理类型`;

  // 异步子代理使用说明（仅当异步能力可用时追加）
  if (asyncCapable) {
    toolDescription += `

后台运行：
- 通过 run_in_background: true 让子代理在后台运行，你会立即收到 async_launched 响应
- 后台子代理完成后，你会收到一条 <task-notification> 消息，包含任务结果
- 启动后台子代理后，应简要告知用户已启动了什么任务，然后结束回复，**不要猜测或模拟任务结果**
- 收到 <task-notification> 后，根据其中的 status 决定下一步行动
- 禁止完整复述 <task-notification> 的内容，因为用户可以在前端完整看到 <task-notification> 中的内容。
- 前台（默认）：需要子代理结果才能继续时使用。后台：有真正独立的并行工作时使用
- 需要并行执行多个独立任务时，连续启动多个后台子代理
- 读任务可并行，写任务涉及同一文件集合时应串行`;
  }

  // 工具参数声明
  const properties: Record<string, Record<string, unknown>> = {
    prompt: { type: 'string', description: '交给子代理执行的任务描述，应尽量详细清晰' },
    type: { type: 'string', description: '子代理类型（默认 general-purpose）' },
    // context 参数：子代理不共享父级对话历史，通过此参数让 AI 自主决定传递哪些背景信息。
    context: { type: 'string', description: '附加上下文或背景信息（可选）。子代理没有你的对话历史，如果任务需要背景信息（如相关文件路径、已有发现、约束条件），请通过此参数传递。' },
  };
  if (asyncCapable) {
    properties.run_in_background = { type: 'boolean', description: '是否在后台运行此子代理。设为 true 时立即返回，完成后自动通知。' };
  }

  return {
    declaration: {
      name: TOOL_NAME,
      description: toolDescription,
      parameters: { type: 'object', properties, required: ['prompt'] },
    },
    parallel: (args) => deps.subAgentTypes.get(getSubAgentTypeName(args))?.parallel === true,
    // handler 返回 Promise（异步路径）或 AsyncIterable（同步路径）。
    // scheduler 自动检测返回类型，AsyncIterable 走 generator 迭代路径。
    handler: async (args) => {
      const prompt = args.prompt as string;
      const typeName = getSubAgentTypeName(args);
      const contextText = typeof args.context === 'string' && args.context.trim() ? args.context.trim() : undefined;
      const runInBackground = args.run_in_background === true;

      // 将 context 和 prompt 拼接为子代理的完整输入。
      // 子代理不共享父级对话历史，context 是 AI 自主精炼后传入的背景信息。
      const fullPrompt = contextText
        ? `Context:\n${contextText}\n\nTask:\n${prompt}`
        : prompt;

      // 深度检查
      if (currentDepth >= deps.maxDepth) {
        logger.warn(`子代理嵌套深度超限 (${currentDepth}/${deps.maxDepth})`);
        return { error: `子代理嵌套深度超过上限（${deps.maxDepth}），拒绝创建` };
      }

      // 获取类型配置
      const typeConfig = deps.subAgentTypes.get(typeName);
      if (!typeConfig) {
        return { error: `未知的子代理类型: ${typeName}。可用类型: ${deps.subAgentTypes.list().join(', ')}` };
      }

      // 判断是否走异步路径
      const shouldRunAsync = asyncCapable && (runInBackground || (typeConfig as any).background === true);

      // 构建子工具集（同步/异步共用）
      let subTools: ToolRegistry;
      if (typeConfig.allowedTools) {
        subTools = deps.tools.createSubset(typeConfig.allowedTools);
      } else if (typeConfig.excludedTools) {
        subTools = deps.tools.createFiltered(typeConfig.excludedTools);
      } else {
        subTools = deps.tools.createFiltered([]);
      }

      // 注入深度递增的 sub_agent 工具（实现嵌套自我调用）
      if (currentDepth + 1 < deps.maxDepth) {
        subTools.unregister(TOOL_NAME);
        subTools.register(createSubAgentTool(deps, currentDepth + 1));
      } else {
        subTools.unregister(TOOL_NAME);
      }

      if (shouldRunAsync) {
        // ---- 异步路径 ----
        const sessionId = deps.getSessionId!();
        if (!sessionId) {
          return { error: '无法确定当前会话 ID，无法启动后台子代理' };
        }

        // 检查并发限制
        if (deps.agentTaskRegistry) {
          const running = deps.agentTaskRegistry.getRunningBySession(sessionId);
          if (running.length >= MAX_CONCURRENT_ASYNC_AGENTS) {
            return { error: `当前会话已有 ${running.length} 个后台子代理在运行，超过上限（${MAX_CONCURRENT_ASYNC_AGENTS}）。请等待现有任务完成后再创建。` };
          }
        }

        // 生成任务 ID 并注册
        const taskId = createTaskId();
        const description = `${typeName}: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`;
        const task = deps.agentTaskRegistry?.register(taskId, sessionId, description);

        logger.info(`异步子代理启动: taskId=${taskId} type=${typeName} depth=${currentDepth + 1}/${deps.maxDepth}`);

        // fire-and-forget 启动子代理
        void runSubAgentAsync(
          deps, typeConfig, subTools, fullPrompt, taskId, sessionId, description,
          task?.abortController?.signal,
        );

        // 立即返回 async_launched
        return {
          status: 'async_launched',
          taskId,
          description,
          message: '子代理已在后台启动，结果会稍后自动通知你。现在请简要告知用户你启动了什么任务，然后立即结束回复，不要猜测或模拟任务结果。',
        };
      }

      // ---- 同步路径 ----
      // 返回 AsyncIterable（generator），yield 中间进度值，
      // scheduler 自动检测并迭代消费，推送到 ToolStateManager.progress。
      const syncLabel = `sync_${typeName}`;
      logger.info(`创建子代理: type=${typeName} depth=${currentDepth + 1}/${deps.maxDepth} 工具数=${subTools.size}`);

      // 返回 async generator：yield 进度 → scheduler 推送到 ToolStateManager.progress → 前端渲染
      // 采用「回调更新共享状态 + 定时 yield」模式：
      //   1. createStreamingLLMCaller 的 onChunk/onTokens 回调更新 frame/tokens 计数器
      //   2. generator 每 500ms yield 一次进度快照 { tokens, frame }
      //   3. ToolLoop.run 完成后 yield 最终结果 { result: text }
      //   4. scheduler 的 for-await-of 每次 yield 都把中间值写入 ToolStateManager.progress
      async function* runSyncSubAgent(): AsyncIterable<unknown> {
        let frame = 0;
        let tokens = 0;

        // typeConfig 在 handler 顶部已做 if (!typeConfig) return error 检查，
        // 但 TypeScript 的类型缩窄不跨越函数边界，此处用 ! 断言安全。
        const tc = typeConfig!;
        const subPrompt = new PromptAssembler();
        subPrompt.setSystemPrompt(tc.systemPrompt);
        const loop = new ToolLoop(subTools, subPrompt, {
          maxRounds: tc.maxToolRounds,
          toolsConfig: { permissions: deps.getToolPolicies() },
          retryOnError: deps.retryOnError,
          maxRetries: deps.maxRetries,
        });

        // 回调只更新共享计数器，不直接 yield（回调不在 generator 上下文中）
        const callLLM = createStreamingLLMCaller(
          deps, tc,
          () => { frame++; },
          (t) => { tokens = t; },
        );

        // 启动 ToolLoop（不 await，让 generator 可以同时 yield 进度）
        const runPromise = loop.run(
          [{ role: 'user', parts: [{ text: fullPrompt }] }],
          callLLM,
          { modelName: tc.modelName },
        );

        // 定期 yield 进度，直到 run 完成
        let done = false;
        let runResult: Awaited<ReturnType<typeof loop.run>> | undefined;
        let runError: unknown;

        runPromise.then(
          (r) => { runResult = r; done = true; },
          (e) => { runError = e; done = true; },
        );

        // 每 500ms yield 一次进度快照
        while (!done) {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (!done) {
            yield { tokens, frame };
          }
        }

        // 最终 yield（确保最后的 token 数被记录）
        yield { tokens, frame };

        if (runError) {
          throw runError instanceof Error ? runError : new Error(String(runError));
        }

        if (runResult!.error) {
          throw new Error(runResult!.error);
        }

        logger.info(`子代理完成: type=${typeName}`);
        // 最后一个 yield 的值是最终结果（scheduler 取最后一个值作为 result）
        yield { result: runResult!.text };
      }

      // 在 agentContext 内启动 generator，确保日志前缀正确
      return agentContext.run(syncLabel, () => {
        return runSyncSubAgent();
      }) as unknown;
    },
  };
}

/**
 * 异步子代理执行函数（fire-and-forget）。
 *
 * 完成后通过 deps.enqueueNotification() 将 task-notification 入队，
 * 触发主 LLM 的新 turn。
 */
async function runSubAgentAsync(
  deps: SubAgentToolDeps,
  typeConfig: SubAgentTypeConfig,
  subTools: ToolRegistry,
  prompt: string,
  taskId: string,
  sessionId: string,
  description: string,
  signal?: AbortSignal,
): Promise<void> {
  // 整个异步子代理的生命周期都在 agentContext.run(taskId, ...) 内执行，
  // 使得子代理内部所有模块（ToolLoop、ToolScheduler、LLMRouter 等）
  // 的日志自动携带 [Module|taskId] 前缀，解决子代理工具执行日志
  // 无法区分来源的问题。对标 CC issue #31939 的 agent_id 传播。
  return agentContext.run(taskId, async () => {
  const startTime = Date.now();

  const subPrompt = new PromptAssembler();
  subPrompt.setSystemPrompt(typeConfig.systemPrompt);

  const loop = new ToolLoop(subTools, subPrompt, {
    maxRounds: typeConfig.maxToolRounds,
    toolsConfig: { permissions: deps.getToolPolicies() },
    retryOnError: deps.retryOnError,
    maxRetries: deps.maxRetries,
  });

  // 使用共用的流式 LLM 调用器，回调指向 AgentTaskRegistry（驱动 StatusBar）
  const callLLM = createStreamingLLMCaller(
    deps, typeConfig,
    () => deps.agentTaskRegistry?.emitChunkHeartbeat(taskId),
    (tokens) => deps.agentTaskRegistry?.updateTokens(taskId, tokens),
  );

  try {
    const result = await loop.run(
      [{ role: 'user', parts: [{ text: prompt }] }],
      callLLM,
      { modelName: typeConfig.modelName, signal },
    );

    const durationMs = Date.now() - startTime;

    if (result.error) {
      // ToolLoop 返回了错误（如 LLM 调用失败、轮次超限）
      deps.agentTaskRegistry?.fail(taskId, result.error);
      const xml = buildNotificationXML({
        taskId, status: 'failed', description, error: result.error, durationMs,
      });
      deps.enqueueNotification!(sessionId, xml);
      logger.error(`异步子代理失败: taskId=${taskId}, error="${result.error}"`);
      return;
    }

    // 成功完成
    deps.agentTaskRegistry?.complete(taskId, result.text);
    const xml = buildNotificationXML({
      taskId, status: 'completed', description, result: result.text, durationMs,
    });
    deps.enqueueNotification!(sessionId, xml);
    logger.info(`异步子代理完成: taskId=${taskId}, duration=${durationMs}ms`);

  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    // 检查是否是 abort
    if (signal?.aborted) {
      deps.agentTaskRegistry?.kill(taskId);
      const xml = buildNotificationXML({
        taskId, status: 'killed', description, durationMs,
      });
      deps.enqueueNotification!(sessionId, xml);
      logger.info(`异步子代理已中止: taskId=${taskId}`);
      return;
    }

    deps.agentTaskRegistry?.fail(taskId, errorMsg);
    const xml = buildNotificationXML({
      taskId, status: 'failed', description, error: errorMsg, durationMs,
    });
    deps.enqueueNotification!(sessionId, xml);
    logger.error(`异步子代理异常: taskId=${taskId}, error="${errorMsg}"`);
  }
  }); // agentContext.run() 结束
}
