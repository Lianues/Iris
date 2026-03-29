// src/screen-sidecar.ts
import * as readline from "readline";

// src/screen/windows.ts
import { execFile } from "child_process";
import { promisify } from "util";
var exec = promisify(execFile);
var SENDKEYS_MAP = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  escape: "{ESC}",
  backspace: "{BACKSPACE}",
  delete: "{DELETE}",
  space: " ",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  insert: "{INSERT}",
  f1: "{F1}",
  f2: "{F2}",
  f3: "{F3}",
  f4: "{F4}",
  f5: "{F5}",
  f6: "{F6}",
  f7: "{F7}",
  f8: "{F8}",
  f9: "{F9}",
  f10: "{F10}",
  f11: "{F11}",
  f12: "{F12}"
};
var MODIFIER_MAP = {
  control: "^",
  ctrl: "^",
  alt: "%",
  shift: "+"
};
var VK_MAP = {
  enter: 13,
  return: 13,
  tab: 9,
  escape: 27,
  backspace: 8,
  delete: 46,
  space: 32,
  up: 38,
  down: 40,
  left: 37,
  right: 39,
  home: 36,
  end: 35,
  pageup: 33,
  pagedown: 34,
  insert: 45,
  control: 17,
  ctrl: 17,
  alt: 18,
  shift: 16,
  f1: 112,
  f2: 113,
  f3: 114,
  f4: 115,
  f5: 116,
  f6: 117,
  f7: 118,
  f8: 119,
  f9: 120,
  f10: 121,
  f11: 122,
  f12: 123
};
var PREAMBLE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, IntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint nFlags);
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP   = 0x0202;
    public const uint WM_RBUTTONDOWN = 0x0204;
    public const uint WM_RBUTTONUP   = 0x0205;
    public const uint WM_MOUSEMOVE   = 0x0200;
    public const uint WM_MOUSEWHEEL  = 0x020A;
    public const uint WM_KEYDOWN     = 0x0100;
    public const uint WM_KEYUP       = 0x0101;
    public const uint WM_CHAR        = 0x0102;
    public const int MK_LBUTTON = 0x0001;
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
function normalizeSelector(selector) {
  return typeof selector === "string" ? { title: selector } : selector;
}
function windowFindScript(selector, activate) {
  const activateBlock = activate ? `if ([WinAPI]::IsIconic($_hwnd)) {
    [WinAPI]::ShowWindow($_hwnd, 9) | Out-Null
}
[WinAPI]::SetForegroundWindow($_hwnd) | Out-Null
Start-Sleep -Milliseconds 150` : `if ([WinAPI]::IsIconic($_hwnd)) {
    [WinAPI]::ShowWindow($_hwnd, 4) | Out-Null
    Start-Sleep -Milliseconds 150
}`;
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
  const conditions = [];
  const vars = [];
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
  const matchExpr = conditions.length > 0 ? conditions.join(" -and ") : "$sb.ToString().Length -gt 0";
  const selectorLabel = JSON.stringify(selector).replace(/'/g, "''");
  return `
${vars.join(`
`)}
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

class WindowsScreenAdapter {
  platform = "windows";
  _windowSelector;
  _backgroundMode = false;
  _boundWindowInfo;
  get boundWindowInfo() {
    return this._boundWindowInfo;
  }
  isSupported() {
    return process.platform === "win32";
  }
  async initialize() {
    try {
      await this.ps("$PSVersionTable.PSVersion.Major");
    } catch {
      throw new Error("Windows Screen 环境需要 PowerShell 5.1+");
    }
  }
  setBackgroundMode(enabled) {
    this._backgroundMode = enabled;
  }
  async bindWindow(selector) {
    const sel = normalizeSelector(selector);
    const script = PREAMBLE + windowFindScript(sel, !this._backgroundMode) + `
$_bindHwnd = '0x' + $_hwnd.ToString('X')
$_bindTitle = New-Object System.Text.StringBuilder 256
[WinAPI]::GetWindowText($_hwnd, $_bindTitle, 256) | Out-Null
$_bindClass = New-Object System.Text.StringBuilder 256
[WinAPI]::GetClassName($_hwnd, $_bindClass, 256) | Out-Null
"$_bindHwnd,$ww,$wh,$($_bindTitle.ToString()),$($_bindClass.ToString())"
`;
    const output = await this.ps(script);
    const firstComma = output.indexOf(",");
    const secondComma = output.indexOf(",", firstComma + 1);
    const thirdComma = output.indexOf(",", secondComma + 1);
    const lastComma = output.lastIndexOf(",");
    const hwnd = output.substring(0, firstComma).trim();
    const w = Number(output.substring(firstComma + 1, secondComma));
    const h = Number(output.substring(secondComma + 1, thirdComma));
    const title = output.substring(thirdComma + 1, lastComma).trim();
    const className = output.substring(lastComma + 1).trim();
    if (!hwnd || !w || !h)
      throw new Error(`窗口绑定异常: ${output.trim()}`);
    this._windowSelector = { hwnd };
    this._boundWindowInfo = { hwnd, title, className };
  }
  async bindWindowByHwnd(hwnd) {
    const activateBlock = this._backgroundMode ? `if ([WinAPI]::IsIconic($_hwnd)) {
    [WinAPI]::ShowWindow($_hwnd, 4) | Out-Null
    Start-Sleep -Milliseconds 150
}` : `if ([WinAPI]::IsIconic($_hwnd)) {
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
$_bindTitle = New-Object System.Text.StringBuilder 256
[WinAPI]::GetWindowText($_hwnd, $_bindTitle, 256) | Out-Null
$_bindClass = New-Object System.Text.StringBuilder 256
[WinAPI]::GetClassName($_hwnd, $_bindClass, 256) | Out-Null
"$ww,$wh,$($_bindTitle.ToString()),$($_bindClass.ToString())"
`;
    const output = await this.ps(script);
    const firstComma = output.indexOf(",");
    const secondComma = output.indexOf(",", firstComma + 1);
    const lastComma = output.lastIndexOf(",");
    const w = Number(output.substring(0, firstComma).trim());
    const h = Number(output.substring(firstComma + 1, secondComma));
    const title = output.substring(secondComma + 1, lastComma).trim();
    const className = output.substring(lastComma + 1).trim();
    if (!w || !h)
      throw new Error(`窗口尺寸异常: ${output.trim()}`);
    this._windowSelector = { hwnd };
    this._boundWindowInfo = { hwnd, title, className };
  }
  async getScreenSize() {
    if (this._windowSelector) {
      const script2 = PREAMBLE + windowFindScript(this._windowSelector, !this._backgroundMode) + '"$ww,$wh"';
      const output2 = await this.ps(script2);
      const [w2, h2] = output2.trim().split(",").map(Number);
      return [w2, h2];
    }
    const script = PREAMBLE + `
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
"$($s.Width),$($s.Height)"
`;
    const output = await this.ps(script);
    const [w, h] = output.trim().split(",").map(Number);
    return [w, h];
  }
  async captureScreen() {
    if (this._windowSelector && this._backgroundMode) {
      const script2 = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$bmp = New-Object System.Drawing.Bitmap($ww, $wh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WinAPI]::PrintWindow($_hwnd, $hdc, 0x02)
if (-not $ok) {
    [WinAPI]::PrintWindow($_hwnd, $hdc, 0) | Out-Null
}
$g.ReleaseHdc($hdc)
$g.Dispose()
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
      const output2 = await this.ps(script2);
      return Buffer.from(output2.trim(), "base64");
    }
    if (this._windowSelector) {
      const script2 = PREAMBLE + windowFindScript(this._windowSelector, true) + `
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
      const output2 = await this.ps(script2);
      return Buffer.from(output2.trim(), "base64");
    }
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
    return Buffer.from(output.trim(), "base64");
  }
  async moveMouse(x, y) {
    if (this._backgroundMode && this._windowSelector) {
      const script2 = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_MOUSEMOVE, [IntPtr]::Zero, $lp) | Out-Null
`;
      await this.ps(script2);
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
`;
    await this.ps(script);
  }
  async click(x, y) {
    if (this._backgroundMode && this._windowSelector) {
      const script2 = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_LBUTTONDOWN, [IntPtr]([WinAPI]::MK_LBUTTON), $lp) | Out-Null
Start-Sleep -Milliseconds 30
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_LBUTTONUP, [IntPtr]::Zero, $lp) | Out-Null
`;
      await this.ps(script2);
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE + (this._windowSelector ? windowFindScript(this._windowSelector, true) : "") + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
[WinAPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(script);
  }
  async doubleClick(x, y) {
    await this.click(x, y);
    await this.sleep(50);
    await this.click(x, y);
  }
  async rightClick(x, y) {
    if (this._backgroundMode && this._windowSelector) {
      const script2 = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_RBUTTONDOWN, [IntPtr]::Zero, $lp) | Out-Null
Start-Sleep -Milliseconds 30
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_RBUTTONUP, [IntPtr]::Zero, $lp) | Out-Null
`;
      await this.ps(script2);
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const script = PREAMBLE + (this._windowSelector ? windowFindScript(this._windowSelector, true) : "") + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)
[WinAPI]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(script);
  }
  async drag(x, y, destX, destY) {
    if (this._backgroundMode && this._windowSelector) {
      const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lpStart = [WinAPI]::MakeLParam(${x}, ${y})
$lpEnd = [WinAPI]::MakeLParam(${destX}, ${destY})
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_LBUTTONDOWN, [IntPtr]([WinAPI]::MK_LBUTTON), $lpStart) | Out-Null
Start-Sleep -Milliseconds 50
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
    const downScript = PREAMBLE + (this._windowSelector ? windowFindScript(this._windowSelector, true) : "") + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
Start-Sleep -Milliseconds 30
[WinAPI]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
`;
    await this.ps(downScript);
    const steps = 10;
    for (let i = 1;i <= steps; i++) {
      const cx = Math.round(ax + (adx - ax) * i / steps);
      const cy = Math.round(ay + (ady - ay) * i / steps);
      await this.ps(PREAMBLE + `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})
`);
      await this.sleep(20);
    }
    await this.ps(PREAMBLE + `[WinAPI]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)`);
  }
  async typeText(text) {
    if (this._backgroundMode && this._windowSelector) {
      const escaped2 = text.replace(/'/g, "''");
      const script2 = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$text = '${escaped2}'
foreach ($ch in $text.ToCharArray()) {
    [WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_CHAR, [IntPtr][int]$ch, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 10
}
`;
      await this.ps(script2);
      return;
    }
    const escaped = text.replace(/'/g, "''");
    const script = PREAMBLE + (this._windowSelector ? windowFindScript(this._windowSelector, true) : "") + `
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
Start-Sleep -Milliseconds 50
[WinAPI]::keybd_event(0x11, 0, 0, [IntPtr]::Zero)
[WinAPI]::keybd_event(0x56, 0, 0, [IntPtr]::Zero)
[WinAPI]::keybd_event(0x56, 0, 2, [IntPtr]::Zero)
[WinAPI]::keybd_event(0x11, 0, 2, [IntPtr]::Zero)
`;
    await this.ps(script);
  }
  async keyPress(key) {
    await this.keyCombination([key]);
  }
  async keyCombination(keys) {
    if (this._backgroundMode && this._windowSelector) {
      const vkCodes = keys.map((k) => {
        const vk = VK_MAP[k.toLowerCase()];
        if (vk !== undefined)
          return vk;
        if (k.length === 1)
          return k.toUpperCase().charCodeAt(0);
        return 0;
      }).filter((v) => v > 0);
      if (vkCodes.length === 0)
        return;
      let script2 = PREAMBLE + windowFindScript(this._windowSelector, false);
      for (const vk of vkCodes) {
        script2 += `[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_KEYDOWN, [IntPtr]${vk}, [IntPtr]::Zero) | Out-Null
`;
      }
      script2 += `Start-Sleep -Milliseconds 30
`;
      for (const vk of [...vkCodes].reverse()) {
        script2 += `[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_KEYUP, [IntPtr]${vk}, [IntPtr]::Zero) | Out-Null
`;
      }
      await this.ps(script2);
      return;
    }
    let prefix = "";
    let mainKey = "";
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
    const script = PREAMBLE + (this._windowSelector ? windowFindScript(this._windowSelector, true) : "") + `[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`;
    await this.ps(script);
  }
  async scroll(x, y, deltaX, deltaY) {
    if (this._backgroundMode && this._windowSelector) {
      const wheelDelta2 = -deltaY;
      if (wheelDelta2 !== 0) {
        const script = PREAMBLE + windowFindScript(this._windowSelector, false) + `
$lp = [WinAPI]::MakeLParam(${x}, ${y})
$wp = [IntPtr](${wheelDelta2 * 120} -shl 16)
[WinAPI]::PostMessage($_hwnd, [WinAPI]::WM_MOUSEWHEEL, $wp, $lp) | Out-Null
`;
        await this.ps(script);
      }
      return;
    }
    const [ax, ay] = await this.toScreen(x, y);
    const wheelDelta = -deltaY;
    let scrollScript = PREAMBLE + (this._windowSelector ? windowFindScript(this._windowSelector, true) : "") + `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ax}, ${ay})
`;
    if (wheelDelta !== 0) {
      scrollScript += `[WinAPI]::mouse_event(0x0800, 0, 0, ${wheelDelta * 120}, [IntPtr]::Zero)
`;
    }
    if (deltaX !== 0) {
      scrollScript += `[WinAPI]::mouse_event(0x01000, 0, 0, ${deltaX * 120}, [IntPtr]::Zero)
`;
    }
    await this.ps(scrollScript);
  }
  async openUrl(url) {
    const escaped = url.replace(/'/g, "''");
    await this.ps(`Start-Process '${escaped}'`);
  }
  async listWindows() {
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
    if (!trimmed)
      return [];
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((w) => ({
        hwnd: String(w.hwnd ?? ""),
        title: String(w.title ?? ""),
        processName: String(w.processName ?? ""),
        processId: Number(w.processId ?? 0),
        className: String(w.className ?? "")
      }));
    } catch {
      return [];
    }
  }
  async toScreen(x, y) {
    if (!this._windowSelector)
      return [x, y];
    const script = PREAMBLE + windowFindScript(this._windowSelector, !this._backgroundMode) + '"$wx,$wy"';
    const output = await this.ps(script);
    const [wx, wy] = output.trim().split(",").map(Number);
    return [wx + x, wy + y];
  }
  async ps(script) {
    const { stdout } = await exec("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], { timeout: 15000, maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// src/screen/index.ts
var adapters = [
  new WindowsScreenAdapter
];
function getScreenAdapter() {
  return adapters.find((a) => a.isSupported());
}

// src/screen-sidecar.ts
var adapter = null;
var screenSize = [1920, 1080];
function log(msg) {
  process.stderr.write(`[ComputerUse:screen-sidecar] ${msg}
`);
}
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + `
`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function captureState() {
  if (!adapter)
    throw new Error("adapter 未初始化");
  await sleep(500);
  screenSize = await adapter.getScreenSize();
  const buffer = await adapter.captureScreen();
  return { screenshot: buffer.toString("base64"), url: "screen://", screenSize };
}
async function handleRequest(req) {
  try {
    const p = req.params ?? {};
    let result;
    switch (req.method) {
      case "initialize": {
        log("正在检测平台适配器...");
        const warnings = [];
        adapter = getScreenAdapter() ?? null;
        if (!adapter) {
          throw new Error(`当前操作系统 (${process.platform}) 不支持 screen 环境`);
        }
        log(`使用平台适配器: ${adapter.platform}`);
        await adapter.initialize();
        screenSize = await adapter.getScreenSize();
        const targetWindow = p.targetWindow;
        if (targetWindow && adapter.bindWindow) {
          const bgMode = p.backgroundMode;
          if (bgMode && adapter.setBackgroundMode) {
            adapter.setBackgroundMode(true);
            log("后台操作模式已启用（PostMessage + PrintWindow）");
          }
          const label = typeof targetWindow === "string" ? targetWindow : JSON.stringify(targetWindow);
          log(`正在绑定目标窗口: ${label} ...`);
          try {
            await adapter.bindWindow(targetWindow);
            screenSize = await adapter.getScreenSize();
            const wi = adapter.boundWindowInfo;
            log(`窗口模式已启用: ${wi?.title ?? "?"} [${wi?.hwnd}]，尺寸: ${screenSize[0]}×${screenSize[1]}`);
          } catch (e) {
            const msg = `窗口绑定失败: ${e?.message ?? e}，已回退到全屏模式。可用 /window 手动绑定。`;
            log(msg);
            warnings.push(msg);
          }
        }
        log(`屏幕尺寸: ${screenSize[0]}×${screenSize[1]}`);
        log("Screen 环境就绪");
        result = { ok: true, screenSize, warnings, windowInfo: adapter.boundWindowInfo ?? null };
        break;
      }
      case "dispose": {
        adapter = null;
        result = { ok: true };
        break;
      }
      case "listWindows": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        if (!adapter.listWindows)
          throw new Error("当前适配器不支持窗口列表");
        const windows = await adapter.listWindows();
        result = { windows };
        break;
      }
      case "switchWindow": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        if (!adapter.bindWindowByHwnd)
          throw new Error("当前适配器不支持按 HWND 绑定");
        const hwnd = p.hwnd;
        if (!hwnd)
          throw new Error("未指定窗口 HWND");
        await adapter.bindWindowByHwnd(hwnd);
        screenSize = await adapter.getScreenSize();
        const wi = adapter.boundWindowInfo;
        log(`已切换到窗口: ${wi?.title ?? "?"} [${hwnd}]，尺寸: ${screenSize[0]}×${screenSize[1]}`);
        result = { ok: true, screenSize, windowInfo: wi ?? null };
        break;
      }
      case "screenSize": {
        if (adapter)
          screenSize = await adapter.getScreenSize();
        result = { screenSize };
        break;
      }
      case "currentState":
      case "openWebBrowser": {
        result = await captureState();
        break;
      }
      case "navigate": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.openUrl(p.url);
        await sleep(1500);
        result = await captureState();
        break;
      }
      case "search": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.openUrl(p.searchEngineUrl || "https://www.google.com");
        await sleep(1500);
        result = await captureState();
        break;
      }
      case "goBack": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.keyCombination(["Alt", "Left"]);
        await sleep(500);
        result = await captureState();
        break;
      }
      case "goForward": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.keyCombination(["Alt", "Right"]);
        await sleep(500);
        result = await captureState();
        break;
      }
      case "clickAt": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.click(p.x, p.y);
        result = await captureState();
        break;
      }
      case "hoverAt": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.moveMouse(p.x, p.y);
        result = await captureState();
        break;
      }
      case "dragAndDrop": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.drag(p.x, p.y, p.destX, p.destY);
        result = await captureState();
        break;
      }
      case "typeTextAt": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.click(p.x, p.y);
        await sleep(200);
        if (p.clearBeforeTyping === true) {
          await adapter.keyCombination(["Control", "A"]);
          await sleep(50);
          await adapter.keyPress("Delete");
          await sleep(50);
        }
        await adapter.typeText(p.text);
        await sleep(200);
        if (p.pressEnter === true) {
          await adapter.keyPress("Enter");
        }
        result = await captureState();
        break;
      }
      case "keyCombination": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        await adapter.keyCombination(p.keys);
        result = await captureState();
        break;
      }
      case "scrollDocument": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        const dir = p.direction;
        const notches = 5;
        switch (dir) {
          case "up":
            await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, 0, -notches);
            break;
          case "down":
            await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, 0, notches);
            break;
          case "left":
            await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, -notches, 0);
            break;
          case "right":
            await adapter.scroll(screenSize[0] / 2, screenSize[1] / 2, notches, 0);
            break;
        }
        result = await captureState();
        break;
      }
      case "scrollAt": {
        if (!adapter)
          throw new Error("adapter 未初始化");
        let dx = 0, dy = 0;
        const notches = p.magnitude || 3;
        switch (p.direction) {
          case "up":
            dy = -notches;
            break;
          case "down":
            dy = notches;
            break;
          case "left":
            dx = -notches;
            break;
          case "right":
            dx = notches;
            break;
        }
        await adapter.scroll(p.x, p.y, dx, dy);
        result = await captureState();
        break;
      }
      case "wait5Seconds": {
        await sleep(5000);
        result = await captureState();
        break;
      }
      default: {
        send({ id: req.id, error: `未知方法: ${req.method}` });
        return;
      }
    }
    send({ id: req.id, result });
  } catch (err) {
    send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
}
var rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  handleRequest(req).catch((err) => {
    send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  });
});
process.stdin.on("end", () => {
  process.exit(0);
});
log("sidecar 进程已启动，等待指令...");
