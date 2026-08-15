import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decodeWindowsClipboardPayload,
  parseClipboardTextPaths,
} from '../extensions/console/src/clipboard-attachments';

describe('console clipboard attachments', () => {
  it('解析 PowerShell 的 Base64 JSON 时保留 Unicode 文件名与多文件顺序', () => {
    const payload = {
      kind: 'files',
      paths: [
        'C:\\Users\\测试\\截图.png',
        'D:\\资料\\说明.pdf',
      ],
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

    expect(decodeWindowsClipboardPayload(encoded)).toEqual(payload);
    expect(decodeWindowsClipboardPayload('not-base64-json')).toBeUndefined();
  });

  it('兼容 PowerShell 将单个路径折叠为字符串的输出', () => {
    const encoded = Buffer.from(JSON.stringify({
      kind: 'image',
      paths: 'C:\\Temp\\clipboard-image.png',
    }), 'utf8').toString('base64');

    expect(decodeWindowsClipboardPayload(encoded)).toEqual({
      kind: 'image',
      paths: ['C:\\Temp\\clipboard-image.png'],
    });
  });

  it('纯文本回退只接受真实文件路径和 file URL，不把普通文字当附件', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'iris-clipboard-test-'));
    const first = path.join(tempDir, 'first file.txt');
    const second = path.join(tempDir, '第二个文件.md');
    writeFileSync(first, 'first', 'utf8');
    writeFileSync(second, 'second', 'utf8');

    try {
      expect(parseClipboardTextPaths([
        'copy',
        `"${first}"`,
        pathToFileURL(second).href,
        'ordinary clipboard text',
        first,
      ].join('\n'))).toEqual([path.resolve(first), path.resolve(second)]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Alt+V 仅通过专用回调进入现有 /file 附件链路', () => {
    const keyboardSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/hooks/use-app-keyboard.ts'),
      'utf8',
    );
    const appSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/App.tsx'),
      'utf8',
    );
    const platformSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/index.ts'),
      'utf8',
    );
    const clipboardSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/clipboard-attachments.ts'),
      'utf8',
    );
    const inputSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/InputBar.tsx'),
      'utf8',
    );

    expect(keyboardSource).toContain("isAltLetterShortcut(key, 'v')");
    expect(keyboardSource).toContain('onClipboardFileAttach?.()');
    expect(keyboardSource).toContain("viewMode === 'chat'");
    expect(keyboardSource).toContain("isAltLetterShortcut(key, 'd')");
    expect(keyboardSource).toContain('onRemoveLastPendingFile?.()');
    expect(appSource).toContain("onFileAttach?.('__clipboard__')");
    expect(appSource).toContain('pendingFileCount: pendingFiles.length');
    expect(platformSource).toContain('readClipboardAttachments()');
    expect(platformSource).toContain('this.handleFileAttach(attachmentPath)');
    expect(platformSource).toContain('clipboard.cleanup()');
    expect(clipboardSource).toContain('ContainsFileDropList()');
    expect(clipboardSource).toContain('$attempt -lt 8');
    expect(clipboardSource).toContain('Start-Sleep -Milliseconds 75');
    expect(inputSource).toContain("key.name === 'backspace' || key.name === 'delete'");
  });
});
