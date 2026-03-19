/**
 * Screen 环境平台适配器抽象接口
 *
 * 每个操作系统提供一个实现，通过系统命令完成截屏和输入模拟。
 * 新增平台只需实现此接口并在 index.ts 中注册。
 */

export interface ScreenAdapter {
  /** 平台名称（日志用） */
  readonly platform: string;

  /** 检查当前系统是否支持此适配器 */
  isSupported(): boolean;

  /** 初始化（检查依赖、获取屏幕尺寸等） */
  initialize(): Promise<void>;

  /** 获取屏幕尺寸 [width, height] */
  getScreenSize(): Promise<[number, number]>;

  /** 截取全屏截图，返回 PNG Buffer */
  captureScreen(): Promise<Buffer>;

  /** 移动鼠标到指定位置 */
  moveMouse(x: number, y: number): Promise<void>;

  /** 在指定位置点击 */
  click(x: number, y: number): Promise<void>;

  /** 在指定位置双击 */
  doubleClick(x: number, y: number): Promise<void>;

  /** 在指定位置右键点击 */
  rightClick(x: number, y: number): Promise<void>;

  /** 拖放：从 (x, y) 拖到 (destX, destY) */
  drag(x: number, y: number, destX: number, destY: number): Promise<void>;

  /** 输入文本（通过剪贴板，避免 IME 问题） */
  typeText(text: string): Promise<void>;

  /** 按下单个按键 */
  keyPress(key: string): Promise<void>;

  /** 按键组合（如 ['Control', 'A']） */
  keyCombination(keys: string[]): Promise<void>;

  /** 鼠标滚轮滚动 */
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;

  /** 打开系统默认浏览器并导航到指定 URL */
  openUrl(url: string): Promise<void>;

  /**
   * 绑定目标窗口（按标题子串匹配）。
   * 绑定后，截屏只截取该窗口区域，鼠标操作坐标自动偏移到窗口位置，
   * 操作前自动将窗口置于前台。
   *
   * getScreenSize() 返回窗口尺寸而非全屏尺寸。
   * 不调用此方法则为全屏模式。
   */
  bindWindow?(windowTitle: string): Promise<void>;

  /**
   * 启用后台操作模式（仅窗口模式下有效）。
   *
   * 后台模式下：
   *   - 截图通过 PrintWindow 请求窗口自绘，不需要窗口在前台
   *   - 鼠标和键盘通过 PostMessage 直接向窗口句柄发消息
   *   - 不调用 SetForegroundWindow / ShowWindow
   *
   * 限制：
   *   - 对 DirectX / OpenGL / GPU 加速窗口可能截到黑屏
   *   - 部分应用不响应 PostMessage 的输入消息
   *   - 拖拽操作可能不工作
   */
  setBackgroundMode?(enabled: boolean): void;
}
