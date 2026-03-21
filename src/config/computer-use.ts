/**
 * Computer Use 配置解析
 */

import { ComputerUseConfig, CUToolPolicy, WindowSelector } from './types';

function parseStringArray(arr: unknown): string[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const result = arr.filter((s): s is string => typeof s === 'string');
  return result.length > 0 ? result : undefined;
}

function parseToolPolicy(raw: any): CUToolPolicy | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const include = parseStringArray(raw.include);
  const exclude = parseStringArray(raw.exclude);
  if (!include && !exclude) return undefined;
  return { include, exclude };
}

function parseTargetWindow(raw: unknown): string | WindowSelector | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const selector: WindowSelector = {};
    if (typeof obj.hwnd === 'string') selector.hwnd = obj.hwnd;
    if (typeof obj.title === 'string') selector.title = obj.title;
    if (typeof obj.exactTitle === 'string') selector.exactTitle = obj.exactTitle;
    if (typeof obj.processName === 'string') selector.processName = obj.processName;
    if (typeof obj.processId === 'number') selector.processId = obj.processId;
    if (typeof obj.className === 'string') selector.className = obj.className;
    // 至少有一个有效字段才视为合法选择器
    if (Object.keys(selector).length === 0) return undefined;
    return selector;
  }
  return undefined;
}

export function parseComputerUseConfig(raw: any): ComputerUseConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!raw.enabled) return undefined;

  // 解析 environmentTools
  let environmentTools: ComputerUseConfig['environmentTools'];
  if (raw.environmentTools && typeof raw.environmentTools === 'object') {
    const et = raw.environmentTools;
    const browser = parseToolPolicy(et.browser);
    const screen = parseToolPolicy(et.screen);
    const background = parseToolPolicy(et.background);
    if (browser || screen || background) {
      environmentTools = { browser, screen, background };
    }
  }

  return {
    enabled: true,
    environment: raw.environment === 'screen' ? 'screen' : 'browser',
    screenWidth: typeof raw.screenWidth === 'number' ? raw.screenWidth : undefined,
    screenHeight: typeof raw.screenHeight === 'number' ? raw.screenHeight : undefined,
    postActionDelay: typeof raw.postActionDelay === 'number' ? raw.postActionDelay : undefined,
    screenshotFormat: raw.screenshotFormat === 'jpeg' ? 'jpeg' : undefined,
    screenshotQuality: typeof raw.screenshotQuality === 'number' ? raw.screenshotQuality : undefined,
    headless: typeof raw.headless === 'boolean' ? raw.headless : undefined,
    initialUrl: typeof raw.initialUrl === 'string' ? raw.initialUrl : undefined,
    searchEngineUrl: typeof raw.searchEngineUrl === 'string' ? raw.searchEngineUrl : undefined,
    highlightMouse: typeof raw.highlightMouse === 'boolean' ? raw.highlightMouse : undefined,
    maxRecentScreenshots: typeof raw.maxRecentScreenshots === 'number' ? raw.maxRecentScreenshots : undefined,
    targetWindow: parseTargetWindow(raw.targetWindow),
    backgroundMode: typeof raw.backgroundMode === 'boolean' ? raw.backgroundMode : undefined,
    environmentTools,
  };
}
