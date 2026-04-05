/**
 * delegate_to_agent + query_delegated_task 工具
 *
 * delegate_to_agent:
 *   将任务委派给另一个独立的 Agent 执行（fire-and-forget）。
 *   目标 Agent 通过 backend.chat() 以完整主体身份执行任务，
 *   完成后由 CrossAgentTaskBoard 自动构建通知并推回发起方会话。
 *
 * query_delegated_task:
 *   查询后台任务的实时状态（sub_agent 异步任务和 delegate 任务均可查询）。
 *   数据来自 CrossAgentTaskBoard.query()。
 */

import { ToolDefinition } from '@/types';
import type { AgentNetworkLike, IrisBackendLike } from '@irises/extension-sdk';
import type { CrossAgentTaskBoard } from '@/core/cross-agent-task-board';
import { createTaskId } from '@/core/cross-agent-task-board';
import { createLogger } from '@/logger';

const logger = createLogger('DelegateAgent');

// ---- 依赖接口 ----

export interface DelegateAgentToolDeps {
  /** 跨 Agent 通信网络（由 IrisHost.injectAgentNetwork 注入） */
  agentNetwork: AgentNetworkLike;
  /** 全局任务板 */
  taskBoard: CrossAgentTaskBoard;
  /** 获取发起方当前活跃会话 ID */
  getSessionId: () => string | undefined;
}

// ---- 常量 ----

/** 同一个目标 Agent 最大并发 delegate 任务数 */
const MAX_CONCURRENT_DELEGATE_PER_TARGET = 5;

// ---- delegate_to_agent 工具 ----

/**
 * 创建 delegate_to_agent 工具。
 *
 * description 中内联所有可委派的 Agent 列表（名称 + 描述），
 * 与 sub_agent 内联子代理类型列表的做法一致。
 * 同时明确与 sub_agent 的区别，避免 LLM 混淆。
 */
export function createDelegateToAgentTool(deps: DelegateAgentToolDeps): ToolDefinition {
  // 构建可委派 Agent 列表描述
  const peers = deps.agentNetwork.listPeers();
  const peerDescriptions = peers.map((name: string) => {
    const desc = deps.agentNetwork.getPeerDescription(name);
    return `  - ${name}: ${desc ?? '(无描述)'}`;
  }).join('\n');

  const toolDescription = `将任务委派给另一个独立的 Agent 执行（fire-and-forget）。
目标 Agent 拥有自己的人格、记忆、工具集和会话历史，是一个完全独立的实体。
完成后结果会通过 <task-notification> 自动通知你。

注意：这不是 sub_agent。sub_agent 是你自己的临时分身，共享你的工具集；
delegate_to_agent 是把任务交给一个真正的、不同的 Agent。

可委派的 Agent：
${peerDescriptions}

使用原则：
- 选择最适合任务的 Agent 进行委派
- 提供清晰详细的 prompt，像给一个刚走进房间的聪明同事做简报
- 委派后立即告知用户已启动了什么任务，然后结束回复，不要猜测任务结果
- 收到 <task-notification> 后，根据 status 决定下一步行动
- 禁止完整复述 <task-notification> 的内容，用户可以在前端完整看到`;

  return {
    declaration: {
      name: 'delegate_to_agent',
      description: toolDescription,
      parameters: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            description: '目标 Agent 名称（从上方可委派列表中选择）',
          },
          prompt: {
            type: 'string',
            description: '交给目标 Agent 的任务描述，应尽量详细清晰',
          },
        },
        required: ['agent', 'prompt'],
      },
    },
    // delegate 总是并行安全的：fire-and-forget，不阻塞当前 Agent
    parallel: () => true,
    handler: async (args) => {
      const targetAgentName = args.agent as string;
      const prompt = args.prompt as string;

      // 1. 校验目标 Agent 存在
      const targetBackend = deps.agentNetwork.getPeerBackend(targetAgentName);
      if (!targetBackend) {
        return {
          error: `目标 Agent "${targetAgentName}" 不存在。可用的 Agent: ${peers.join(', ')}`,
        };
      }

      // 2. 获取发起方当前会话 ID
      const sourceSessionId = deps.getSessionId();
      if (!sourceSessionId) {
        return { error: '无法确定当前会话 ID，无法发起跨 Agent 委派' };
      }

      // 3. 检查目标 Agent 的并发限制
      const runningForTarget = deps.taskBoard.getRunningByTargetAgent(targetAgentName);
      if (runningForTarget.length >= MAX_CONCURRENT_DELEGATE_PER_TARGET) {
        return {
          error: `目标 Agent "${targetAgentName}" 当前已有 ${runningForTarget.length} 个委派任务在运行，超过上限（${MAX_CONCURRENT_DELEGATE_PER_TARGET}）。请等待现有任务完成后再委派。`,
        };
      }

      // 4. 注册到 taskBoard
      const taskId = createTaskId();
      const sourceAgent = deps.agentNetwork.selfName;
      const description = `delegate → ${targetAgentName}: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`;

      const task = deps.taskBoard.register({
        taskId,
        sourceAgent,
        sourceSessionId,
        targetAgent: targetAgentName,
        type: 'delegate',
        description,
      });

      // 5. 构建发送给目标 Agent 的 prompt（注明来源）
      const targetPrompt = `[来自 ${sourceAgent} 的委派任务]\n${prompt}`;

      // 6. 确定目标 sessionId
      const targetSessionId = `cross-agent:${sourceAgent}:${taskId}`;

      // 7. fire-and-forget 启动
      logger.info(`跨 Agent 委派启动: taskId=${taskId}, ${sourceAgent} → ${targetAgentName}`);
      void runDelegatedTask({
        targetBackend,
        targetSessionId,
        targetPrompt,
        taskId,
        taskBoard: deps.taskBoard,
        signal: task.abortController?.signal,
      });

      // 8. 立即返回
      return {
        status: 'dispatched',
        taskId,
        targetAgent: targetAgentName,
        message: `任务已委派给 ${targetAgentName}，结果会稍后自动通知你。现在请简要告知用户你启动了什么任务，然后立即结束回复，不要猜测任务结果。`,
      };
    },
  };
}

// ---- runDelegatedTask ----

/**
 * 异步执行跨 Agent 委派任务（fire-and-forget）。
 *
 * 调用目标 Agent 的 backend.chat()，监听事件获取执行结果，
 * 完成后通过 taskBoard 自动构建通知并推回发起方会话。
 */
async function runDelegatedTask(opts: {
  targetBackend: IrisBackendLike;
  targetSessionId: string;
  targetPrompt: string;
  taskId: string;
  taskBoard: CrossAgentTaskBoard;
  signal?: AbortSignal;
}): Promise<void> {
  const { targetBackend, targetSessionId, targetPrompt, taskId, taskBoard, signal } = opts;
  const startTime = Date.now();

  try {
    // 用 Promise 包装事件监听，等待目标 Agent 的 turn 完成
    const resultText = await new Promise<string>((resolve, reject) => {
      let finalText = '';

      // 监听非流式完整回复
      const onResponse = (sid: string, text: string) => {
        if (sid !== targetSessionId) return;
        finalText = text;
      };

      // 监听流式完整内容（每轮模型输出完成后触发）
      const onAssistantContent = (sid: string, content: { parts?: Array<{ text?: string }> }) => {
        if (sid !== targetSessionId) return;
        // 取最后一轮的文本输出
        if (content?.parts) {
          const textParts = content.parts.filter((p) => typeof p.text === 'string').map((p) => p.text as string);
          if (textParts.length > 0) {
            finalText = textParts.join('');
          }
        }
      };

      // 监听 turn 完成
      const onDone = (sid: string) => {
        if (sid !== targetSessionId) return;
        cleanup();
        resolve(finalText);
      };

      // 监听错误
      const onError = (sid: string, error: string) => {
        if (sid !== targetSessionId) return;
        cleanup();
        reject(new Error(error));
      };

      // abort 处理
      const onAbort = () => {
        cleanup();
        reject(new Error('任务被中止'));
      };

      // 清理所有监听器
      const cleanup = () => {
        targetBackend.off('response', onResponse);
        targetBackend.off('assistant:content', onAssistantContent);
        targetBackend.off('done', onDone);
        targetBackend.off('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };

      // 注册监听器
      targetBackend.on('response', onResponse);
      targetBackend.on('assistant:content', onAssistantContent);
      targetBackend.on('done', onDone);
      targetBackend.on('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });

      // 发起 chat 调用
      targetBackend.chat(targetSessionId, targetPrompt).catch((err: Error) => {
        cleanup();
        reject(err);
      });
    });

    // 检查是否被 abort
    if (signal?.aborted) {
      taskBoard.kill(taskId);
      logger.info(`跨 Agent 委派已中止: taskId=${taskId}`);
      return;
    }

    // 成功完成
    taskBoard.complete(taskId, resultText);
    logger.info(`跨 Agent 委派完成: taskId=${taskId}, duration=${Date.now() - startTime}ms`);

  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (signal?.aborted) {
      taskBoard.kill(taskId);
      logger.info(`跨 Agent 委派已中止: taskId=${taskId}`);
      return;
    }

    taskBoard.fail(taskId, errorMsg);
    logger.error(`跨 Agent 委派失败: taskId=${taskId}, error="${errorMsg}"`);
  }
}

// ---- query_delegated_task 工具 ----

/**
 * 创建 query_delegated_task 工具。
 *
 * 查询后台任务的实时状态，数据来自 CrossAgentTaskBoard.query()。
 * sub_agent 异步任务和 delegate 任务均可查询。
 */
export function createQueryDelegatedTaskTool(deps: { taskBoard: CrossAgentTaskBoard }): ToolDefinition {
  return {
    declaration: {
      name: 'query_delegated_task',
      description: `查询后台任务的实时状态。可查询 delegate_to_agent 和异步 sub_agent 的任务。
返回任务的当前状态、是否正在输出、已运行时长、token 消耗等信息。`,
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: '任务 ID（从 delegate_to_agent 或 sub_agent 的返回值中获取）',
          },
        },
        required: ['taskId'],
      },
    },
    handler: async (args) => {
      const taskId = args.taskId as string;
      const snapshot = deps.taskBoard.query(taskId);

      if (!snapshot) {
        return { error: `任务 "${taskId}" 不存在或已被清理` };
      }

      return snapshot;
    },
  };
}
