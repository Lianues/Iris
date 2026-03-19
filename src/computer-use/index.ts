/**
 * Computer Use 模块入口
 *
 * 导出模块公共 API，供 bootstrap 和外部使用。
 */

export type { Computer, EnvState } from './types';
export { BrowserEnvironment } from './browser-env';
export type { BrowserEnvConfig } from './browser-env';
export { ScreenEnvironment } from './screen-env';
export type { ScreenEnvConfig } from './screen-env';
export { createComputerUseTools, COMPUTER_USE_FUNCTION_NAMES, DEFAULT_ENVIRONMENT_TOOLS, resolveEnvironmentKey } from './tools';
export { denormalizeX, denormalizeY, normalizeX, normalizeY } from './coordinator';
