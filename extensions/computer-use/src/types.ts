/**
 * Computer Use 类型定义
 *
 * 将所有 CU 相关类型集中在此文件中，
 * 消除对宿主内部 src/config/types.ts 和 src/computer-use/types.ts 的依赖。
 */

// ============ 执行环境接口 ============

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
  /**
   * 当前截图目标描述（写入 get_screenshot 工具定义，供 LLM 了解当前操作环境）。
   * 初始化和窗口绑定时更新。
   */
  screenDescription: string;

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
  listWindows?(): Promise<WindowInfo[]>;
  switchWindow?(hwnd: string): Promise<void>;
}

// ============ 配置类型 ============

/**
 * 窗口选择器（对象形式）。
 *
 * hwnd 优先级最高：填了 hwnd 就直接定位到该窗口，忽略其他字段。
 * 其他字段同时存在时取交集（全部匹配才选中）。
 */
export interface WindowSelector {
  hwnd?: string;
  title?: string;
  exactTitle?: string;
  processName?: string;
  processId?: number;
  className?: string;
}

/**
 * Computer Use 单环境工具策略。
 * exclude 和 include 互斥，同时配置时 include 优先。
 */
export interface CUToolPolicy {
  include?: string[];
  exclude?: string[];
}

/** Computer Use 配置 */
export interface ComputerUseConfig {
  enabled: boolean;
  environment: 'browser' | 'screen';
  screenWidth?: number;
  screenHeight?: number;
  postActionDelay?: number;
  screenshotFormat?: 'png' | 'jpeg';
  screenshotQuality?: number;
  headless?: boolean;
  initialUrl?: string;
  searchEngineUrl?: string;
  highlightMouse?: boolean;
  maxRecentScreenshots?: number;
  targetWindow?: string | WindowSelector;
  backgroundMode?: boolean;
  environmentTools?: {
    browser?: CUToolPolicy;
    screen?: CUToolPolicy;
    background?: CUToolPolicy;
  };
}

// ============ 环境配置 ============

export interface BrowserEnvConfig {
  screenWidth: number;
  screenHeight: number;
  headless?: boolean;
  initialUrl?: string;
  searchEngineUrl?: string;
  highlightMouse?: boolean;
}

export interface ScreenEnvConfig {
  searchEngineUrl?: string;
  targetWindow?: string | WindowSelector;
  backgroundMode?: boolean;
}
