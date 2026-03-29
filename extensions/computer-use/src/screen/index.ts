/**
 * Screen 适配器注册中心
 *
 * 根据当前操作系统自动选择对应的平台实现。
 */

import type { ScreenAdapter } from './adapter';
import { WindowsScreenAdapter } from './windows';

const adapters: ScreenAdapter[] = [
  new WindowsScreenAdapter(),
];

export function getScreenAdapter(): ScreenAdapter | undefined {
  return adapters.find(a => a.isSupported());
}

export type { ScreenAdapter } from './adapter';
