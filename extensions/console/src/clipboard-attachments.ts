import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { readClipboardText } from './terminal-compat';

export interface ClipboardAttachmentReadResult {
  paths: string[];
  error?: string;
  /** 清理读取截图时创建的临时文件；调用方应在附件内容读入内存后执行。 */
  cleanup: () => void;
}

interface WindowsClipboardPayload {
  kind: 'files' | 'image' | 'none';
  paths: string[];
}

const WINDOWS_CLIPBOARD_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$kind = 'none'
$paths = @()
$outputPath = [Environment]::GetEnvironmentVariable('IRIS_CLIPBOARD_IMAGE_PATH', 'Process')

# Explorer / 截图工具写入剪贴板时可能短暂持有锁，或延迟提供 FileDrop/Bitmap。
# 在同一个 STA 进程内重试完整的格式检测，避免用户必须再按一次快捷键。
for ($attempt = 0; $attempt -lt 8 -and $kind -eq 'none'; $attempt++) {
  try {
    if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
      $drop = [System.Windows.Forms.Clipboard]::GetFileDropList()
      $attemptPaths = @()
      foreach ($item in $drop) {
        if ($null -ne $item) { $attemptPaths += [string]$item }
      }
      if ($attemptPaths.Count -gt 0) {
        $paths = $attemptPaths
        $kind = 'files'
        break
      }
    }

    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
      $image = [System.Windows.Forms.Clipboard]::GetImage()
      if ($null -ne $image -and -not [string]::IsNullOrWhiteSpace($outputPath)) {
        try {
          $image.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
          if ($image -is [System.IDisposable]) { $image.Dispose() }
        }
        $paths = @($outputPath)
        $kind = 'image'
        break
      }
    }
  } catch {
    if ($attempt -ge 7) { throw }
  }

  if ($kind -eq 'none' -and $attempt -lt 7) {
    Start-Sleep -Milliseconds 75
  }
}

$json = ConvertTo-Json ([ordered]@{ kind = $kind; paths = @($paths) }) -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
[Console]::Out.Write([Convert]::ToBase64String($bytes))
`.trim();

const WINDOWS_CLIPBOARD_ENCODED_COMMAND = Buffer
  .from(WINDOWS_CLIPBOARD_SCRIPT, 'utf16le')
  .toString('base64');

const NOOP_CLEANUP = () => {};

/**
 * 解析 PowerShell 返回的 Base64(UTF-8 JSON)。
 * 使用 Base64 是为了避免 Windows PowerShell 控制台代码页损坏中文文件名。
 */
export function decodeWindowsClipboardPayload(output: string): WindowsClipboardPayload | undefined {
  try {
    const json = Buffer.from(output.trim(), 'base64').toString('utf8');
    const value = JSON.parse(json) as { kind?: unknown; paths?: unknown };
    if (value.kind !== 'files' && value.kind !== 'image' && value.kind !== 'none') return undefined;

    const rawPaths = Array.isArray(value.paths)
      ? value.paths
      : (typeof value.paths === 'string' ? [value.paths] : []);
    const paths = rawPaths
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && !item.includes('\0'));

    return { kind: value.kind, paths };
  } catch {
    return undefined;
  }
}

/** 解析文件管理器可能放入纯文本剪贴板的本地路径。 */
export function parseClipboardTextPaths(text: string | undefined): string[] {
  if (!text) return [];

  const paths: string[] = [];
  for (const rawLine of text.split(/\r?\n|\0/)) {
    let value = rawLine.trim();
    if (!value || value === 'copy' || value === 'cut') continue;
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    try {
      if (value.startsWith('file://')) value = fileURLToPath(value);
    } catch {
      continue;
    }

    try {
      if (fs.statSync(value).isFile()) paths.push(path.resolve(value));
    } catch {
      // 普通文本或已经不存在的路径不应被当作附件。
    }
  }

  return Array.from(new Set(paths));
}

function readTextClipboardPaths(): string[] {
  return parseClipboardTextPaths(readClipboardText());
}

function createCleanup(tempDir: string): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 临时截图已读入附件内存，清理失败不应影响发送。
    }
  };
}

function readWindowsClipboardAttachments(): ClipboardAttachmentReadResult {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-clipboard-'));
  const imagePath = path.join(tempDir, `clipboard-image-${Date.now()}.png`);
  const cleanup = createCleanup(tempDir);
  let output: string | undefined;

  for (const command of ['powershell.exe', 'pwsh.exe']) {
    try {
      output = execFileSync(command, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-EncodedCommand',
        WINDOWS_CLIPBOARD_ENCODED_COMMAND,
      ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        // Windows PowerShell 可能把“首次准备模块”的 CLIXML progress 写到 stderr；
        // 在全屏 TUI 中必须静默，否则会污染渲染缓冲区。
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          IRIS_CLIPBOARD_IMAGE_PATH: imagePath,
        },
      });
      break;
    } catch {
      // 尝试下一种 PowerShell 可执行文件名。
    }
  }

  const payload = output ? decodeWindowsClipboardPayload(output) : undefined;
  if (payload && payload.paths.length > 0) {
    return { paths: payload.paths, cleanup };
  }

  cleanup();
  const textPaths = readTextClipboardPaths();
  if (textPaths.length > 0) {
    return { paths: textPaths, cleanup: NOOP_CLEANUP };
  }

  return {
    paths: [],
    error: output
      ? '剪贴板中没有可附加的文件或图片。'
      : '无法读取剪贴板中的文件或图片。',
    cleanup: NOOP_CLEANUP,
  };
}

/**
 * 读取系统剪贴板中的文件或截图。
 *
 * Windows 支持资源管理器 FileDrop 与截图 Bitmap；其它平台在没有额外系统工具时
 * 回退为识别剪贴板文本中的现有本地文件路径。
 */
export function readClipboardAttachments(): ClipboardAttachmentReadResult {
  if (process.platform === 'win32') return readWindowsClipboardAttachments();

  const paths = readTextClipboardPaths();
  return paths.length > 0
    ? { paths, cleanup: NOOP_CLEANUP }
    : {
        paths: [],
        error: '剪贴板中没有可附加的本地文件路径；截图粘贴当前仅支持 Windows。',
        cleanup: NOOP_CLEANUP,
      };
}
