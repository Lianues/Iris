/**
 * Windows 平台 Screen 适配器
 *
 * 通过 PowerShell 调用 .NET API 实现截屏和输入模拟。
 * 无额外依赖，仅需 Windows 自带的 PowerShell 5.1+。
 *
 * 支持三种模式：
 *   - 全屏模式（默认）：截取整个屏幕，操作范围为全屏
 *   - 窗口前台模式（bindWindow）：截取指定窗口区域，操作前激活窗口
 *   - 窗口后台模式（bindWindow + backgroundMode）：通过 PostMessage + PrintWindow 在后台操作，
 *     窗口只需显示（不最小化），不需要在前台，可以被其他窗口遮挡
 *
 * 注意事项：
 *   - 通过 SetProcessDPIAware 确保高 DPI 下坐标和截图为物理像素
 *   - 通过 DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) 获取不含阴影的实际窗口区域
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ScreenAdapter } from './adapter';
import type { WindowInfo } from '../types';
import type { WindowSelector } from '../../config/types';

const exec = promisify(execFile);

/** PowerShell 按键名映射 → SendKeys 格式 */
const SENDKEYS_MAP: Record<string, string> = {
  enter: '{ENTER}',
  return: '{ENTER}',
  tab: '{TAB}',
  escape: '{ESC}',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  space: ' ',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
  insert: '{INSERT}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
  f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
  f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
};

/** 修饰键前缀映射（SendKeys 格式） */
const MODIFIER_MAP: Record<string, string> = {
  control: '^',
  ctrl: '^',
  alt: '%',
  shift: '+',
};

/** 按键名 → Win32 虚拟键码（后台模式 PostMessage 用） */
const VK_MAP: Record<string, number> = {
  enter: 0x0D, return: 0x0D, tab: 0x09, escape: 0x1B,
  backspace: 0x08, delete: 0x2E, space: 0x20,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, insert: 0x2D,
  control: 0x11, ctrl: 0x11, alt: 0x12, shift: 0x10,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73,
  f5: 0x74, f6: 0x75, f7: 0x76, f8: 0x77,
  f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
};

/**
 * 公共 PowerShell 前缀：
 *   1. 声明 DPI 感知
 *   2. 加载 .NET 程序集
 *   3. 声明 P/Invoke 类型（含前台 + 后台模式所需 API）
 */
const PREAMBLE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
    // ---- DPI ----
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    // ---- 鼠标 / 键盘（前台模式） ----
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, IntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);

    // ---- 窗口枚举 ----
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    // ---- 窗口位置 / 激活 ----
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);

    // ---- DWM：获取不含阴影的窗口区域 ----
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);

    // ---- 后台模式: 消息 + PrintWindow ----
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint nFlags);

    // WM 常量
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP   = 0x0202;
    public const uint WM_RBUTTONDOWN = 0x0204;
    public const uint WM_RBUTTONUP   = 0x0205;
    public const uint WM_MOUSEMOVE   = 0x0200;
    public const uint WM_MOUSEWHEEL  = 0x020A;
    public const uint WM_KEYDOWN     = 0x0100;
    public const uint WM_KEYUP       = 0x0101;
    public const uint WM_CHAR        = 0x0102;

    // MK 常量
    public const int MK_LBUTTON = 0x0001;

    // PrintWindow PW_RENDERFULLCONTENT (支持 DX 窗口, Win 8.1+)
    public const uint PW_RENDERFULLCONTENT = 0x02;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    public static IntPtr MakeLParam(int lo, int hi) {
        return (IntPtr)((hi << 16) | (lo & 0xFFFF));
    }
}
"@
[WinAPI]::SetProcessDPIAware() | Out-Null
`;

/**
 * 将选择器统一为 WindowSelector 对象。
 * 字符串形式自动转为 { title: str }。
 */
function normalizeSelector(selector: string | WindowSelector): WindowSelector {
  return typeof selector === 'string' ? { title: selector } : selector;
}

/**
 * 生成查找窗口并设置 $wx, $wy, $ww, $wh, $_hwnd 变量的 PowerShell 代码。
 *
 * hwnd 优先：填了 hwnd 直接定位，不走 EnumWindows。
 * @param activate 是否激活窗口（前台模式 true，后台模式 false）
 */
function windowFindScript(selector: WindowSelector, activate: boolean): string {
  const activateBlock = activate
    ? `# 前台模式：仅最小化时恢复，不改变最大化/正常状态
if ([WinAPI]::IsIconic($_hwnd)) {
    [WinAPI]::ShowWindow($_hwnd, 9) | Out-Null
}
[WinAPI]::SetForegroundWindow($_hwnd) | Out-Null
Start-Sleep -Milliseconds 150`
    : `# 后台模式：不激活窗口，但确保窗口不是最小化状态
# IsIconic 检测最小化 → ShowWindow(SW_SHOWNOACTIVATE=4) 恢复但不抢焦点
if ([WinAPI]::IsIconic($_hwnd)) {
    [WinAPI]::ShowWindow($_hwnd, 4) | Out-Null
    Start-Sleep -Milliseconds 150
}`;

  // hwnd 优先：直接用句柄定位，跳过枚举
  if (selector.hwnd) {
    return `
$_hwnd = [IntPtr]${selector.hwnd}
if (-not [WinAPI]::IsWindowVisible($_hwnd)) { throw '窗口不可见或已关闭: ${selector.hwnd}' }
${activateBlock}
$_dwmRect = New-Object WinAPI+RECT
$_hr = [WinAPI]::DwmGetWindowAttribute($_hwnd, 9, [ref]$_dwmRect, [System.Runtime.InteropServices.Marshal]::SizeOf($_dwmRect))
if ($_hr -eq 0) {
    $wx = $_dwmRect.Left; $wy = $_dwmRect.Top
    $ww = $_dwmRect.Right - $_dwmRect.Left; $wh = $_dwmRect.Bottom - $_dwmRect.Top
} else {
    $_rect = New-Object WinAPI+RECT
    [WinAPI]::GetWindowRect($_hwnd, [ref]$_rect) | Out-Null
    $wx = $_rect.Left; $wy = $_rect.Top
    $ww = $_rect.Right - $_rect.Left; $wh = $_rect.Bottom - $_rect.Top
}
`;
  }

  // 构建匹配条件列表（PowerShell 布尔表达式）
  const conditions: string[] = [];
  const vars: string[] = [];

  if (selector.title) {
    const escaped = selector.title.replace(/'/g, "''");
    vars.push(`$_targetTitle = '${escaped}'`);
    conditions.push(`$sb.ToString() -like "*$_targetTitle*"`);
  }
  if (selector.exactTitle) {
    const escaped = selector.exactTitle.replace(/'/g, "''");
    vars.push(`$_exactTitle = '${escaped}'`);
    conditions.push(`$sb.ToString() -ceq $_exactTitle`);
  }
  if (selector.processName) {
    const escaped = selector.processName.replace(/'/g, "''");
    vars.push(`$_targetProc = '${escaped}'`);
    conditions.push(`$_pName -eq $_targetProc`);
  }
  if (selector.processId != null) {
    conditions.push(`$_pid -eq ${selector.processId}`);
  }
  if (selector.className) {
    const escaped = selector.className.replace(/'/g, "''");
    vars.push(`$_targetClass = '${escaped}'`);
    conditions.push(`$_cn.ToString() -ceq $_targetClass`);
  }

  // 无任何条件时，匹配第一个有标题的可见窗口
  const matchExpr = conditions.length > 0 ? conditions.join(' -and ') : '$sb.ToString().Length -gt 0';
  // 错误提示标签：会嵌入 PowerShell 单引号字符串，只需转义单引号
  const selectorLabel = JSON.stringify(selector).replace(/'/g, "''");

  return `
${vars.join('\n')}
$_hwnd = [IntPtr]::Zero
[WinAPI]::EnumWindows({
    param($h, $l)
    if ([WinAPI]::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder 256
        [WinAPI]::GetWindowText($h, $sb, 256) | Out-Null
        if ($sb.ToString().Length -gt 0) {
            $_pid = 0
            [WinAPI]::GetWindowThreadProcessId($h, [ref]$_pid) | Out-Null
            $_pName = ''
            try { $_pName = (Get-Process -Id $_pid -ErrorAction SilentlyContinue).ProcessName } catch {}
            $_cn = New-Object System.Text.StringBuilder 256
            [WinAPI]::GetClassName($h, $_cn, 256) | Out-Null
            if (${matchExpr}) {
                $script:_hwnd = $h
                return $false
            }
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($_hwnd -eq [IntPtr]::Zero) { throw '找不到窗口: ${selectorLabel}' }
${activateBlock}
$_dwmRect = New-Object WinAPI+RECT
$_hr = [WinAPI]::DwmGetWindowAttribute($_hwnd, 9, [ref]$_dwmRect, [System.Runtime.InteropServices.Marshal]::SizeOf($_dwmRect))
if ($_hr -eq 0) {
    $wx = $_dwmRect.Left; $wy = $_dwmRect.Top
    $ww = $_dwmRect.Right - $_dwmRect.Left; $wh = $_dwmRect.Bottom - $_dwmRect.Top
} else {
    $_rect = New-Object WinAPI+RECT
    [WinAPI]::GetWindowRect($_hwnd, [ref]$_rect) | Out-Null
    $wx = $_rect.Left; $wy = $_rect.Top
    $ww = $_rect.Right - $_rect.Left; $wh = $_rect.Bottom - $_rect.Top
}
`;
}

export class WindowsScreenAdapter implements ScreenAdapter {
  readonly platform = 'windows';
  private _windowSelector?: WindowSelector;
  private _backgroundMode = false;

  isSupported(): boolean {
    return process.platform === 'win32';
  }

  async initialize(): Promise<void> {
    try {
      await this.ps('$PSVersionTable.PSVersion.Major');
    } catch {
      throw new Error('Windows Screen 环境需要 PowerShell 5.1+');
    }
  }

  setBackgroundMode(enabled: boolean): void {
    this._backgroundMode = enabled;
  }

  async bindWindow(selector: string | WindowSelector): Promise<void> {
    const sel = normalizeSelector(selector);
    // 输出 HWND 和窗口尺寸，格式: "0x001A0B2C,1920,1080"
    const script = PREAMBLE + windowFindScript(sel, !this._backgroundMode)
      + '"$(' + "'0x' + $_hwnd.ToString('X')" + '),$ww,$wh"';
    const output = await this.ps(script);
    const parts = output.trim().split(',');
    const hwnd = parts[0];
    const w = Number(parts[1]);
    const h = Number(parts[2]);
    if (!hwnd || !w || !h) throw new Error(`窗口绑定异常: ${output.trim()}`);
    // 锁定到 HWND，后续操作不再按选择器重新搜索
    this._windowSelector = { hwnd };
  }

  async bindWindowByHwnd(hwnd: string): Promise<void> {
    // 直接用 HWND 定位，验证窗口可见后锁定
    const activateBlock = this._backgroundMode
      ? `if ([WinAPI]::IsIconic($_hwnd)) {
    [WinAPI]::ShowWindow($_hwnd, 4) | Out-Null
    Start-Sleep -Milliseconds 150
}`
      : `if ([WinAPI]::IsIconic($_hwnd)) {
    [WinAPI]::ShowWindow($_hwnd, 9) | Out-Null
}
[WinAPI]::SetForegroundWindow($_hwnd) | Out-Null
Start-Sleep -Milliseconds 150`;

    const script = PREAMBLE + `
$_hwnd = [IntPtr]${hwnd}
if (-not [WinAPI]::IsWindowVisible($_hwnd)) { throw '窗口不可见或已关闭: ${hwnd}' }
${activateBlock}
$_dwmRect = New-Object WinAPI+RECT
$_hr = [WinAPI]::DwmGetWindowAttribute($_hwnd, 9, [ref]$_dwmRect, [System.Runtime.InteropServices.Marshal]::SizeOf($_dwmRect))
if ($_hr -eq 0) {
    $wx = $_dwmRect.Left; $wy = $_dwmRect.Top
    $ww = $_dwmRect.Right - $_dwmRect.Left; $wh = $_dwmRect.Bottom - $_dwmRect.Top
} else {
    $_rect = New-Object WinAPI+RECT
    [WinAPI]::GetWindowRect($_hwnd, [ref]$_rect) | Out-Null
    $wx = $_rect.Left; $wy = $_rect.Top
    $ww = $_rect.Right - $_rect.Left; $wh = $_rect.Bottom - $_rect.Top
}
"$ww,$wh"
`;
    const output = await this.ps(script);
    const [w, h] = output.trim().split(',').map(Number);
    if (!w || !h) throw new Error(`窗口尺寸异常: ${output.trim()}`);
    this._windowSelector = { hwnd };
  }

  async getScreenSize(): Promise<[number, number]> {
    if (this._windowSelector) {
      const script = PREAMBLE + windowFindScript(this._windowSelector, !this._backgroundMode) + '"$ww,$wh"';
      const output = await this.ps(script);
      const [w, h] = output.trim().split(',').map(Number);
      return [w, h];
    }
    const script = PREAMBLE + `
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
"$($s.Width),$($s.Height)"
`;
    const output = await this.ps(script);
    const [w, h] = output.trim().split(',').map(Number);
    return [w, h];
  }

  async captureScreen(): Promise<Buffer> {
    if (this._windowSelector && this._backgroundMode) {
      // 后台模式：通过 PrintWindow 请求窗口自绘
      // 窗口只需处于显示状态（不最小化），不需要在前台，可以被其他窗口遮挡
      const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$bmp = New-Object System.Drawing.Bitmap($ww, $wh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT (0x02): 支持 DX / 硬件加速窗口 (Win 8.1+)
$ok = [WinAPI]::PrintWindow($_hwnd, $hdc, 0x02)
if (-not $ok) {
    # 回退到普通 PrintWindow
    [WinAPI]::PrintWindow($_hwnd, $hdc, 0) | Out-Null
}
$g.ReleaseHdc($hdc)
$g.Dispose()
# 裁剪到客户区（去掉标题栏和边框的偏差）
$clientRect = New-Object WinAPI+RECT
[WinAPI]::GetClientRect($_hwnd, [ref]$clientRect) | Out-Null
$clientOrigin = New-Object WinAPI+POINT
[WinAPI]::ClientToScreen($_hwnd, [ref]$clientOrigin) | Out-Null
$offsetX = $clientOrigin.X - $wx
$offsetY = $clientOrigin.Y - $wy
$cw = $clientRect.Right
$ch = $clientRect.Bottom
if ($offsetX -gt 0 -or $offsetY -gt 0) {
    $cropped = $bmp.Clone((New-Object System.Drawing.Rectangle($offsetX, $offsetY, [Math]::Min($cw, $ww - $offsetX), [Math]::Min($ch, $wh - $offsetY))), $bmp.PixelFormat)
    $bmp.Dispose()
    $bmp = $cropped
}
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
`;
      const output = await this.ps(script);
      return Buffer.from(output.trim(), 'base64');
    }
    if (this._windowSelector) {
      // 前台窗口模式：CopyFromScreen
      const script = PREAMBLE + windowFindScript(this._windowSelector, true) + `
$bmp = New-Object System.Drawing.Bitmap($ww, $wh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($wx, $wy, 0, 0, (New-Object System.Drawing.Size($ww, $wh)))
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
`;
      const output = await this.ps(script);
      return Buffer.from(output.trim(), 'base64');
    }
    // 全屏模式
    const script = PREAMBLE + `
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
`;
    const output = await this.ps(script);
    return Buffer.from(output.trim(), 'base64');
  }

  async moveMouse(x: number, y: number): Promise<void> {
    if (this._backgroundMode && this._windowSelector) {
      // 后台模式：发送 WM_MOUSEMOVE
      const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_MOUSEMOVE, [IntPtr]::Zero, $lp) | Out-Null
`;
      await this.ps(script);
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
`;
    await this.ps(script);
  }

  async click(x: number, y: number): Promise<void> {
    if (this._backgroundMode && this._windowSelector) {
      const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_LBUTTONDOWN, [IntPtr]([WinAPI]::MK_LBUTTON), $lp) | Out-Null
Start-Sleep -Milliseconds 30
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_LBUTTONUP, [IntPtr]::Zero, $lp) | Out-Null
`;
      await this.ps(script);
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE
      + (this._windowSelector ? windowFindScript(this._windowSelector, true) : '')
      + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
[WinAPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(script);
  }

  async doubleClick(x: number, y: number): Promise<void> {
    await this.click(x, y);
    await this.sleep(50);
    await this.click(x, y);
  }

  async rightClick(x: number, y: number): Promise<void> {
    if (this._backgroundMode && this._windowSelector) {
      const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_RBUTTONDOWN, [IntPtr]::Zero, $lp) | Out-Null
Start-Sleep -Milliseconds 30
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_RBUTTONUP, [IntPtr]::Zero, $lp) | Out-Null
`;
      await this.ps(script);
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE
      + (this._windowSelector ? windowFindScript(this._windowSelector, true) : '')
      + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)
[WinAPI]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(script);
  }

  async drag(x: number, y: number, destX: number, destY: number): Promise<void> {
    if (this._backgroundMode && this._windowSelector) {
      // 后台拖放：尽力而为，但并非所有应用都响应
      const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lpStart = [WinAPI]::MakeLParam(${x}, ${y})
$lpEnd = [WinAPI]::MakeLParam(${destX}, ${destY})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_LBUTTONDOWN, [IntPtr]([WinAPI]::MK_LBUTTON), $lpStart) | Out-Null
Start-Sleep -Milliseconds 50
# 分步移动
for ($i = 1; $i -le 10; $i++) {
    $cx = [int](${x} + (${destX} - ${x}) * $i / 10)
    $cy = [int](${y} + (${destY} - ${y}) * $i / 10)
    $lp = [WinAPI]::MakeLParam($cx, $cy)
    [WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_MOUSEMOVE, [IntPtr]([WinAPI]::MK_LBUTTON), $lp) | Out-Null
    Start-Sleep -Milliseconds 20
}
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_LBUTTONUP, [IntPtr]::Zero, $lpEnd) | Out-Null
`;
      await this.ps(script);
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const [adx, ady] = await this.toScreen(destX, destY);
    const downScript = PREAMBLE
      + (this._windowSelector ? windowFindScript(this._windowSelector, true) : '')
      + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(downScript);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const cx = Math.round(ax + (adx - ax) * i / steps);
      const cy = Math.round(ay + (ady - ay) * i / steps);
      await this.ps(PREAMBLE + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})
`);
      await this.sleep(20);
    }
    await this.ps(PREAMBLE + `[WinAPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)`);
  }

  async typeText(text: string): Promise<void> {
    if (this._backgroundMode && this._windowSelector) {
      // 后台模式：通过 WM_CHAR 逐字符发送
      const escaped = text.replace(/'/g, "''");
      const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$text = '${escaped}'
foreach ($ch in $text.ToCharArray()) {
    [WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_CHAR, [IntPtr][int]$ch, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 10
}
`;
      await this.ps(script);
      return;
    }
    const escaped = text.replace(/'/g, "''");
    const script = PREAMBLE
      + (this._windowSelector ? windowFindScript(this._windowSelector, true) : '')
      + `
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
Start-Sleep -Milliseconds 50
[WinAPI]::keybd_event(0x11, 0, 0, [IntPtr]::Zero)  # Ctrl down
[WinAPI]::keybd_event(0x56, 0, 0, [IntPtr]::Zero)  # V down
[WinAPI]::keybd_event(0x56, 0, 2, [IntPtr]::Zero)  # V up
[WinAPI]::keybd_event(0x11, 0, 2, [IntPtr]::Zero)  # Ctrl up
`;
    await this.ps(script);
  }

  async keyPress(key: string): Promise<void> {
    await this.keyCombination([key]);
  }

  async keyCombination(keys: string[]): Promise<void> {
    if (this._backgroundMode && this._windowSelector) {
      // 后台模式：通过 WM_KEYDOWN/WM_KEYUP 发送虚拟键码
      const vkCodes = keys.map(k => {
        const vk = VK_MAP[k.toLowerCase()];
        if (vk !== undefined) return vk;
        // 单字母的虚拟键码 = 大写 ASCII
        if (k.length === 1) return k.toUpperCase().charCodeAt(0);
        return 0;
      }).filter(v => v > 0);

      if (vkCodes.length === 0) return;

      let script = PREAMBLE + windowFindScript(this._windowSelector, false);
      // 按下所有键
      for (const vk of vkCodes) {
        script += `[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_KEYDOWN, [IntPtr]${vk}, [IntPtr]::Zero) | Out-Null\n`;
      }
      script += `Start-Sleep -Milliseconds 30\n`;
      // 释放所有键（反序）
      for (const vk of [...vkCodes].reverse()) {
        script += `[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_KEYUP, [IntPtr]${vk}, [IntPtr]::Zero) | Out-Null\n`;
      }
      await this.ps(script);
      return;
    }
    let prefix = '';
    let mainKey = '';
    for (const k of keys) {
      const lower = k.toLowerCase();
      const mod = MODIFIER_MAP[lower];
      if (mod) {
        prefix += mod;
      } else {
        mainKey = SENDKEYS_MAP[lower] ?? k;
      }
    }
    const combo = prefix + mainKey;
    const escaped = combo.replace(/'/g, "''");
    const script = PREAMBLE
      + (this._windowSelector ? windowFindScript(this._windowSelector, true) : '')
      + `[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`;
    await this.ps(script);
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    if (this._backgroundMode && this._windowSelector) {
      // 后台模式：通过 WM_MOUSEWHEEL
      const wheelDelta = -deltaY;
      if (wheelDelta !== 0) {
        const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
$wp = [IntPtr](${wheelDelta * 120} -shl 16)
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_MOUSEWHEEL, $wp, $lp) | Out-Null
`;
        await this.ps(script);
      }
      // WM_MOUSEHWHEEL 支持有限，水平滚动在后台模式下省略
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const wheelDelta = -deltaY;
    let scrollScript = PREAMBLE
      + (this._windowSelector ? windowFindScript(this._windowSelector, true) : '')
      + `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})\n`;
    if (wheelDelta !== 0) {
      scrollScript += `[WinAPI]::mouse_event(0x0800, 0, 0, ${wheelDelta * 120}, [IntPtr]::Zero)\n`;
    }
    if (deltaX !== 0) {
      scrollScript += `[WinAPI]::mouse_event(0x01000, 0, 0, ${deltaX * 120}, [IntPtr]::Zero)\n`;
    }
    await this.ps(scrollScript);
  }

  async openUrl(url: string): Promise<void> {
    const escaped = url.replace(/'/g, "''");
    await this.ps(`Start-Process '${escaped}'`);
  }

  async listWindows(): Promise<WindowInfo[]> {
    const script = PREAMBLE + `
$results = @()
[WinAPI]::EnumWindows({
    param($h, $l)
    if ([WinAPI]::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder 256
        [WinAPI]::GetWindowText($h, $sb, 256) | Out-Null
        $title = $sb.ToString()
        if ($title.Length -gt 0) {
            $_wpid = 0
            [WinAPI]::GetWindowThreadProcessId($h, [ref]$_wpid) | Out-Null
            $cn = New-Object System.Text.StringBuilder 256
            [WinAPI]::GetClassName($h, $cn, 256) | Out-Null
            $procName = ''
            try { $procName = (Get-Process -Id $_wpid -ErrorAction SilentlyContinue).ProcessName } catch {}
            $script:results += [PSCustomObject]@{
                hwnd = '0x' + $h.ToString('X')
                title = $title
                processName = $procName
                processId = $_wpid
                className = $cn.ToString()
            }
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
$results | ConvertTo-Json -Compress -Depth 2
`;
    const output = await this.ps(script);
    const trimmed = output.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      // PowerShell ConvertTo-Json 在只有 1 条结果时返回对象而非数组
      const list: WindowInfo[] = Array.isArray(parsed) ? parsed : [parsed];
      // 规范化字段名（PowerShell 输出的 JSON key 大小写可能不稳定）
      return list.map(w => ({
        hwnd: String(w.hwnd ?? ''),
        title: String(w.title ?? ''),
        processName: String(w.processName ?? ''),
        processId: Number(w.processId ?? 0),
        className: String(w.className ?? ''),
      }));
    } catch {
      return [];
    }
  }

  // ============ 内部 ============

  private async toScreen(x: number, y: number): Promise<[number, number]> {
    if (!this._windowSelector) return [x, y];
    const script = PREAMBLE + windowFindScript(this._windowSelector, !this._backgroundMode) + '"$wx,$wy"';
    const output = await this.ps(script);
    const [wx, wy] = output.trim().split(',').map(Number);
    return [wx + x, wy + y];
  }

  private async ps(script: string): Promise<string> {
    const { stdout } = await exec('powershell', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { timeout: 15_000 });
    return stdout;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
