/**
 * Console 扩展宿主适配器
 *
 * 实现 extension-sdk 中定义的各个 *Like 接口，
 * 将主项目内部模块桥接给 console 扩展使用。
 */

import type {
  ConfigManagerLike,
  ToolPreviewUtilsLike,
  MCPManagerLike,
  MCPServerInfoLike,
  IrisAPI,
} from '@irises/extension-sdk';
import { readEditableConfig, updateEditableConfig } from '../config/manage';
import { applyRuntimeConfigReload, type RuntimeConfigReloadContext } from '../config/runtime';
import { DEFAULTS, parseLLMConfig } from '../config/llm';
import { parseSystemConfig } from '../config/system';
import { parseToolsConfig } from '../config/tools';
import { parseUnifiedDiff } from '../tools/internal/apply_diff/unified_diff';
import { buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles } from '../tools/internal/search_in_files';
import { normalizeWriteArgs } from '../tools/internal/write_file';
import { normalizeInsertArgs } from '../tools/internal/insert_code';
import { normalizeDeleteCodeArgs } from '../tools/internal/delete_code';
import { resolveProjectPath } from '../tools/utils';
import type { MCPManager } from '../mcp';
import { setGlobalLogLevel, getGlobalLogLevel, LogLevel } from '../logger';
import { isCompiledBinary } from '../paths';
import { estimateTokenCount } from 'tokenx';

// ── ConfigManagerLike 适配器 ────────────────────────────────────

export function createConfigManagerAdapter(
  configDir: string,
  reloadContext: () => RuntimeConfigReloadContext,
): ConfigManagerLike {
  return {
    getConfigDir: () => configDir,
    readEditableConfig: () => readEditableConfig(configDir),
    updateEditableConfig: (updates: Record<string, unknown>) => updateEditableConfig(configDir, updates),
    applyRuntimeConfigReload: async (mergedConfig: Record<string, unknown>) => {
      try {
        await applyRuntimeConfigReload(reloadContext(), mergedConfig);
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    getLLMDefaults: () => DEFAULTS as Record<string, Record<string, unknown>>,
    parseLLMConfig: (raw?: Record<string, unknown>) => parseLLMConfig(raw as any) as unknown as Record<string, unknown>,
    parseSystemConfig: (raw?: Record<string, unknown>) => parseSystemConfig(raw as any) as unknown as Record<string, unknown>,
    parseToolsConfig: (raw?: Record<string, unknown>) => parseToolsConfig(raw as any) as unknown as Record<string, unknown>,
  };
}

// ── ToolPreviewUtilsLike 适配器 ─────────────────────────────────

export const toolPreviewUtilsAdapter: ToolPreviewUtilsLike = {
  parseUnifiedDiff: parseUnifiedDiff as any,
  normalizeWriteArgs,
  normalizeInsertArgs,
  normalizeDeleteCodeArgs,
  resolveProjectPath,
  walkFiles,
  buildSearchRegex,
  decodeText: decodeText as any,
  globToRegExp,
  isLikelyBinary,
  toPosix,
};

// ── MCPManagerLike 适配器 ───────────────────────────────────────

export function createMCPManagerAdapter(
  getMCPManager: () => MCPManager | undefined,
): MCPManagerLike {
  return {
    getServerInfo(name: string): MCPServerInfoLike | undefined {
      const mgr = getMCPManager();
      if (!mgr) return undefined;
      // MCPManager.getServerInfo() 返回所有服务器，按 name 过滤
      const servers = mgr.getServerInfo();
      return servers.find((s) => s.name === name) as MCPServerInfoLike | undefined;
    },
    listServers(): MCPServerInfoLike[] {
      const mgr = getMCPManager();
      if (!mgr) return [];
      return mgr.getServerInfo() as MCPServerInfoLike[];
    },
    getConfig(): Record<string, unknown> {
      // MCPManager 不暴露原始 config 属性，返回空对象
      return {};
    },
    async connectAll(): Promise<void> {
      const mgr = getMCPManager();
      if (mgr) {
        await mgr.connectAll();
      }
    },
  };
}

// ── 宿主级 IrisAPI 扩展字段 ────────────────────────────────────

export { isCompiledBinary };

export function createConsoleHostAPIFields(
  configDir: string,
  getMCPManager: () => MCPManager | undefined,
  reloadContext: () => RuntimeConfigReloadContext,
): Partial<IrisAPI> {
  return {
    configManager: createConfigManagerAdapter(configDir, reloadContext),
    toolPreviewUtils: toolPreviewUtilsAdapter,
    mcpManager: createMCPManagerAdapter(getMCPManager),
    estimateTokenCount: (text: string) => estimateTokenCount(text),
    isCompiledBinary,
    setLogLevel: (level: number) => setGlobalLogLevel(level as LogLevel),
    getLogLevel: () => getGlobalLogLevel() as number,
  };
}
