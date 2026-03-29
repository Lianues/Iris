/**
 * Screen 环境平台适配器抽象接口
 *
 * 每个操作系统提供一个实现，通过系统命令完成截屏和输入模拟。
 */

import type { WindowInfo, WindowSelector } from '../types';

export interface ScreenAdapter {
  readonly platform: string;
  isSupported(): boolean;
  initialize(): Promise<void>;
  getScreenSize(): Promise<[number, number]>;
  captureScreen(): Promise<Buffer>;
  moveMouse(x: number, y: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  rightClick(x: number, y: number): Promise<void>;
  drag(x: number, y: number, destX: number, destY: number): Promise<void>;
  typeText(text: string): Promise<void>;
  keyPress(key: string): Promise<void>;
  keyCombination(keys: string[]): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  openUrl(url: string): Promise<void>;
  bindWindow?(selector: string | WindowSelector): Promise<void>;
  setBackgroundMode?(enabled: boolean): void;
  listWindows?(): Promise<WindowInfo[]>;
  bindWindowByHwnd?(hwnd: string): Promise<void>;
  readonly boundWindowInfo?: { hwnd: string; title: string; className: string };
}
