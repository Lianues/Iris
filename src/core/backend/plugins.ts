/**
 * 插件钩子到 ToolLoopConfig 的装配
 */

import type { PluginHook } from '../../extension';
import type { ToolLoopConfig } from '../tool-loop';
import { createLogger } from '../../logger';

const logger = createLogger('Backend');

/**
 * 将插件钩子列表组装为 ToolLoopConfig 中的回调函数。
 *
 * 每类钩子（before/after × tool/LLM）遍历所有注册了该钩子的插件，
 * 按注册顺序依次执行，支持拦截和修改。
 */
export function buildPluginHookConfig(
  hooks: PluginHook[],
): Pick<ToolLoopConfig, 'beforeToolExec' | 'afterToolExec' | 'beforeLLMCall' | 'afterLLMCall'> {
  const config: Pick<ToolLoopConfig, 'beforeToolExec' | 'afterToolExec' | 'beforeLLMCall' | 'afterLLMCall'> = {
    beforeToolExec: undefined,
    afterToolExec: undefined,
    beforeLLMCall: undefined,
    afterLLMCall: undefined,
  };

  // ---- beforeToolExec ----
  const beforeToolExecHooks = hooks.filter(h => h.onBeforeToolExec);
  if (beforeToolExecHooks.length > 0) {
    config.beforeToolExec = async (toolName, args) => {
      let currentArgs = args;
      for (const hook of beforeToolExecHooks) {
        try {
          const result = await hook.onBeforeToolExec!({ toolName, args: currentArgs });
          if (result) {
            if (result.blocked) return result;
            if (result.args) currentArgs = result.args;
          }
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onBeforeToolExec 执行失败:`, err);
        }
      }
      if (currentArgs !== args) return { blocked: false as const, args: currentArgs };
      return undefined;
    };
  }

  // ---- afterToolExec ----
  const afterToolExecHooks = hooks.filter(h => h.onAfterToolExec);
  if (afterToolExecHooks.length > 0) {
    config.afterToolExec = async (toolName, args, result, durationMs) => {
      let currentResult = result;
      let changed = false;
      for (const hook of afterToolExecHooks) {
        try {
          const hookResult = await hook.onAfterToolExec!({ toolName, args, result: currentResult, durationMs });
          if (hookResult) {
            currentResult = hookResult.result;
            changed = true;
          }
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onAfterToolExec 执行失败:`, err);
        }
      }
      return changed ? { result: currentResult } : undefined;
    };
  }

  // ---- beforeLLMCall ----
  const beforeLLMCallHooks = hooks.filter(h => h.onBeforeLLMCall);
  if (beforeLLMCallHooks.length > 0) {
    config.beforeLLMCall = async (request, round) => {
      let currentRequest = request;
      let changed = false;
      for (const hook of beforeLLMCallHooks) {
        try {
          const hookResult = await hook.onBeforeLLMCall!({ request: currentRequest, round });
          if (hookResult) {
            currentRequest = hookResult.request;
            changed = true;
          }
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onBeforeLLMCall 执行失败:`, err);
        }
      }
      return changed ? { request: currentRequest } : undefined;
    };
  }

  // ---- afterLLMCall ----
  const afterLLMCallHooks = hooks.filter(h => h.onAfterLLMCall);
  if (afterLLMCallHooks.length > 0) {
    config.afterLLMCall = async (content, round) => {
      let currentContent = content;
      let changed = false;
      for (const hook of afterLLMCallHooks) {
        try {
          const hookResult = await hook.onAfterLLMCall!({ content: currentContent, round });
          if (hookResult) {
            currentContent = hookResult.content;
            changed = true;
          }
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onAfterLLMCall 执行失败:`, err);
        }
      }
      return changed ? { content: currentContent } : undefined;
    };
  }

  return config;
}
