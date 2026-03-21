/**
 * Computer Use 类型定义
 *
 * 定义执行环境的抽象接口和状态结构。
 * 所有环境实现（浏览器、桌面）都遵循此接口。
 */

/** 窗口信息（screen 环境下枚举可见窗口时返回） */
export interface WindowInfo {
  /** 窗口句柄（十六进制字符串，如 "0x001A0B2C"） */
  hwnd: string;
  /** 窗口标题 */
  title: string;
  /** 进程名称（不含 .exe 后缀） */
  processName: string;
  /** 进程 ID */
  processId: number;
  /** 窗口类名 */
  className: string;
}

/** 环境状态：截屏 + 当前 URL */
export interface EnvState {
  /** 截屏 PNG 字节 */
  screenshot: Buffer;
  /** 当前页面 URL */
  url: string;
}

/**
 * Computer 抽象接口。
 *
 * 所有方法接收的坐标都是反归一化后的实际像素值（由 tools 层完成转换）。
 * 每个操作方法返回操作后的环境状态（含截屏）。
 */
export interface Computer {
  /** 返回屏幕尺寸 [width, height]（像素） */
  screenSize(): [number, number];

  /** 初始化环境 */
  initialize(): Promise<void>;
  /** 销毁环境 */
  dispose(): Promise<void>;

  /** 获取当前环境状态（截屏 + URL） */
  currentState(): Promise<EnvState>;

  // ---- 浏览器导航 ----
  openWebBrowser(): Promise<EnvState>;
  goBack(): Promise<EnvState>;
  goForward(): Promise<EnvState>;
  search(): Promise<EnvState>;
  navigate(url: string): Promise<EnvState>;

  // ---- 鼠标操作 ----
  clickAt(x: number, y: number): Promise<EnvState>;
  hoverAt(x: number, y: number): Promise<EnvState>;
  dragAndDrop(x: number, y: number, destX: number, destY: number): Promise<EnvState>;

  // ---- 键盘操作 ----
  typeTextAt(x: number, y: number, text: string, pressEnter: boolean, clearBeforeTyping: boolean): Promise<EnvState>;
  keyCombination(keys: string[]): Promise<EnvState>;

  // ---- 滚动 ----
  scrollDocument(direction: 'up' | 'down' | 'left' | 'right'): Promise<EnvState>;
  scrollAt(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', magnitude: number): Promise<EnvState>;

  // ---- 等待 ----
  wait5Seconds(): Promise<EnvState>;

  // ---- 窗口管理（仅 screen 环境支持） ----
  /** 列举当前可见窗口 */
  listWindows?(): Promise<WindowInfo[]>;
  /** 运行时切换绑定的目标窗口（按 HWND 精确绑定） */
  switchWindow?(hwnd: string): Promise<void>;
}
