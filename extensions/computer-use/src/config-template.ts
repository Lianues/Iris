/**
 * Computer Use 默认配置模板
 *
 * 当宿主配置目录中不存在 computer_use.yaml 时，
 * 插件通过 ensureConfigFile() 将该模板写入。
 */

export const DEFAULT_CONFIG_TEMPLATE = `# Computer Use 配置
#
# 启用后，LLM 可通过一组预定义工具操控浏览器或桌面。
# 工具包括 get_screenshot、click_at、type_text_at、scroll_document 等，
# 走普通 function calling 路径，任何支持工具调用的模型均可使用。
#
# 依赖：
#   browser 环境需要安装 Playwright
#     npm install playwright
#     laywright install chromium
#   screen 环境无额外依赖（Windows 通过 PowerShell 调用系统 API）

# 是否启用（默认关闭）
enabled: false

# 执行环境
#   browser — Playwright 控制 Chromium 浏览器（操作范围限定在浏览器窗口内）
#   screen  — 系统级截屏 + 输入模拟（默认全屏，可通过 targetWindow 限定到单个窗口）
environment: browser

# ─── 工具策略 ───
#
# 按环境配置要启用或排除的工具。
# 三个环境层级，运行时自动选择匹配的一个：
#   browser     — Playwright 浏览器环境
#   screen      — 桌面全屏 / 窗口前台模式
#   background  — 桌面窗口后台模式（screen + backgroundMode: true）
#
# 每个环境支持两种策略（互斥，include 优先）：
#   include: [工具名]  — 白名单，仅启用列出的工具
#   exclude: [工具名]  — 黑名单，排除列出的工具，其余全部启用
#
# 不配置 environmentTools 时使用内置默认策略：
#   browser:    全部启用
#   screen:     排除 go_back, go_forward, search
#   background: 排除 go_back, go_forward, search, drag_and_drop
#
# 配置后覆盖对应环境的默认策略。未配置的环境仍使用默认值。
#
# 全部 13 个工具：
#   get_screenshot, click_at, hover_at, type_text_at,
#   scroll_document, scroll_at, key_combination, navigate,
#   go_back, go_forward, search, wait_5_seconds, drag_and_drop
#
# ── 示例 ──
#
# environmentTools:
#   # 浏览器环境：排除拖拽
#   browser:
#     exclude:
#       - drag_and_drop
#
#   # 桌面环境：使用内置默认排除策略（不配置即可）
#
#   # 后台模式：白名单，只允许基础操作
#   background:
#     include:
#       - get_screenshot
#       - click_at
#       - type_text_at
#       - scroll_document
#       - key_combination
#       - wait_5_seconds

# ─── browser 环境专用 ───

# 启动时打开的初始页面
# initialUrl: https://www.google.com

# 搜索引擎首页（search 工具导航的目标）
# searchEngineUrl: https://www.google.com

# 浏览器视口尺寸（像素），仅 browser 环境生效
# screen 环境下屏幕/窗口尺寸自动检测，无需手动配置
# Gemini 推荐 1440×900 以获得最佳效果
screenWidth: 1440
screenHeight: 900

# 是否无头模式（不显示浏览器窗口）
# 调试时建议关闭，以便观察操作过程
headless: false

# 是否在操作位置显示红色圆圈标记（调试用）
# highlightMouse: true

# ─── screen 环境专用 ───
#
# 默认为全屏模式（截取整个桌面，操作范围不受限制）。
# 如需限定在某个应用窗口内，设置 targetWindow 即可。
#
# 目标窗口标题（子串匹配）。设置后：
#   - 截屏只截取该窗口区域
#   - 鼠标坐标自动偏移到窗口位置
#   - 操作前自动将窗口置于前台（后台模式除外）
#   - screenSize 返回窗口尺寸（LLM 的坐标归一化基于窗口尺寸）
# 不设置则为全屏模式。
#
# 示例：
#   targetWindow: "记事本"       # 匹配标题包含"记事本"的窗口
#   targetWindow: "Chrome"       # 匹配标题包含 Chrome 的窗口
#   targetWindow: "Visual Studio Code"
# targetWindow:
#
# 注意：全屏模式下 AI 的操作范围不受限制，请谨慎使用。
# 建议将 key_combination 等高风险工具设为 autoApprove: false（在 tools.yaml 中配置）。

# 后台操作模式（仅窗口模式下有效，需先设置 targetWindow）。
# 启用后不需要目标窗口在前台，AI 可以在后台操作窗口。
# 窗口只需处于显示状态（不最小化），可以被其他窗口遮挡。
# 如果窗口被最小化，会自动恢复但不激活（不抢焦点）。
#
# 实现方式：
#   截图 → PrintWindow（请求窗口自绘，支持 GPU 加速窗口）
#   鼠标 → PostMessage(WM_LBUTTONDOWN/UP)
#   键盘 → PostMessage(WM_KEYDOWN/UP) / WM_CHAR
#
# 截图兼容性（PrintWindow）：
#   ✓ 原生 Win32 / WPF / WinForms 应用
#   ✓ GPU 加速窗口（Chrome、Electron、游戏等）— 只要窗口处于显示状态
#
# 操作兼容性（PostMessage）：
#   ✓ 原生 Win32 / WPF / WinForms — 点击、键盘、滚动均正常
#   △ 部分应用可能不响应 PostMessage 的鼠标/键盘消息
#   △ 拖拽操作通过消息模拟，部分应用可能不支持
#
# 默认 false（前台模式）。
# backgroundMode: true

# ─── 截图保留策略 ───
#
# 发送给 LLM 时，只保留最近 N 轮 Computer Use 工具交互中的截图。
# 超出的旧轮次截图会被自动剥离，以节省 token。
# 存储中的完整截图不受影响。
#
# 默认 3，与 Gemini 官方示例一致。
# 设为 0 表示不保留任何截图（仅保留 URL 等文本信息）。
# 不设置或注释掉则使用默认值 3。
maxRecentScreenshots: 3
`;
