/**
 * 宿主内部类型（不导出给扩展）
 *
 * 公共类型全部由扩展直接从 @irises/extension-sdk 导入。
 */

import type { Content, LLMRequest } from '../types';
import type { IrisAPI, PluginHook, PluginEntry, IrisPlugin, ToolExecInterception, PlatformAdapter } from '@irises/extension-sdk';

/** 已加载的插件实例（PluginManager 内部） */
export interface LoadedPlugin {
  entry: PluginEntry;
  plugin: IrisPlugin;
  hooks: PluginHook[];
  readyCallbacks: Array<(api: IrisAPI) => void | Promise<void>>;
  platformReadyCallbacks: Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>>;
}

/** 插件信息（公开查询用） */
export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  type: 'local' | 'npm' | 'inline';
  priority: number;
  hookCount: number;
}

// ── 拦截器类型（Backend 内部使用） ─────────────────────────────

export type BeforeToolExecInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolExecInterception | undefined>;

export type AfterToolExecInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  durationMs: number,
) => Promise<{ result: unknown } | undefined>;

export type BeforeLLMCallInterceptor = (
  request: LLMRequest,
  round: number,
) => Promise<{ request: LLMRequest } | undefined>;

export type AfterLLMCallInterceptor = (
  content: Content,
  round: number,
) => Promise<{ content: Content } | undefined>;
