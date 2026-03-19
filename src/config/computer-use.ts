/**
 * Computer Use 配置解析
 */

import { ComputerUseConfig, CUToolPolicy } from './types';

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
    targetWindow: typeof raw.targetWindow === 'string' ? raw.targetWindow : undefined,
    backgroundMode: typeof raw.backgroundMode === 'boolean' ? raw.backgroundMode : undefined,
    environmentTools,
  };
}
