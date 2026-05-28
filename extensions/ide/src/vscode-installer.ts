import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFile = promisify(childProcess.execFile);

const EXTENSION_ID = 'iris.ide';

export interface VscodeCliCandidate {
  label: string;
  command: string;
  version?: string;
}

export interface InstallVscodeExtensionOptions {
  extensionRootDir?: string;
  dataDir: string;
  target?: string;
  force?: boolean;
  /** 扩展已是当前版本时是否仍尝试触发 VS Code 命令激活。默认 true。 */
  activateIfCurrent?: boolean;
}

export interface InstallVscodeExtensionResult {
  success: boolean;
  message: string;
  command?: string;
  label?: string;
  vsixPath?: string;
  alreadyInstalled?: boolean;
  error?: string;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function normalizeZipPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '');
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { date: dosDate, time: dosTime };
}

function createZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const { date, time } = dosDateTime();

  for (const entry of entries) {
    const name = normalizeZipPath(entry.name);
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuffer, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuffer.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, eocd]);
}

async function walkFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walkFiles(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
`;
}

function vsixManifestXml(pkg: Record<string, unknown>): string {
  const name = String(pkg.name ?? 'ide');
  const publisher = String(pkg.publisher ?? 'iris');
  const version = String(pkg.version ?? '0.1.0');
  const displayName = String(pkg.displayName ?? 'Iris IDE Integration');
  const description = String(pkg.description ?? 'Connects VS Code to Iris.');
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="${escapeXml(name)}" Version="${escapeXml(version)}" Language="en-US" Publisher="${escapeXml(publisher)}" />
    <DisplayName>${escapeXml(displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(description)}</Description>
    <Tags>Iris</Tags>
    <Categories>Other</Categories>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function getBundledVscodeExtensionDir(extensionRootDir: string | undefined): string {
  if (!extensionRootDir) throw new Error('当前 ide 扩展没有可用的 extensionRootDir，无法定位 VS Code 扩展资源。');
  const dir = path.join(extensionRootDir, 'vscode-extension');
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(`未找到 Iris VS Code 扩展资源: ${dir}`);
  }
  return dir;
}

async function readBundledVscodeExtensionPackage(sourceDir: string): Promise<Record<string, unknown>> {
  const pkgPath = path.join(sourceDir, 'package.json');
  return JSON.parse(await fsp.readFile(pkgPath, 'utf8')) as Record<string, unknown>;
}

async function packageVscodeExtension(sourceDir: string, outputDir: string, packageJson?: Record<string, unknown>): Promise<string> {
  const pkg = packageJson ?? await readBundledVscodeExtensionPackage(sourceDir);
  const publisher = String(pkg.publisher ?? 'iris');
  const name = String(pkg.name ?? 'ide');
  const version = String(pkg.version ?? '0.1.0');
  const vsixPath = path.join(outputDir, `${publisher}.${name}-${version}.vsix`);
  await fsp.mkdir(outputDir, { recursive: true });

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(), 'utf8') },
    { name: 'extension.vsixmanifest', data: Buffer.from(vsixManifestXml(pkg), 'utf8') },
  ];

  for (const file of await walkFiles(sourceDir)) {
    const relative = normalizeZipPath(path.relative(sourceDir, file));
    entries.push({ name: `extension/${relative}`, data: await fsp.readFile(file) });
  }

  await fsp.writeFile(vsixPath, createZip(entries));
  return vsixPath;
}

function shouldTryCommandPath(command: string): boolean {
  return !path.isAbsolute(command) || fs.existsSync(command);
}

function addCandidate(candidates: VscodeCliCandidate[], label: string, command: string): void {
  if (!command || !shouldTryCommandPath(command)) return;
  candidates.push({ label, command });
}

function dedupeCandidates(candidates: VscodeCliCandidate[]): VscodeCliCandidate[] {
  const seen = new Set<string>();
  const result: VscodeCliCandidate[] = [];
  for (const candidate of candidates) {
    const key = process.platform === 'win32' ? candidate.command.toLowerCase() : candidate.command;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function getWindowsCandidates(): VscodeCliCandidate[] {
  const candidates: VscodeCliCandidate[] = [];
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const roots = [localAppData, programFiles, programFilesX86];

  addCandidate(candidates, 'VS Code', 'code');
  for (const root of roots) {
    addCandidate(candidates, 'VS Code', path.join(root, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'));
    addCandidate(candidates, 'VS Code', path.join(root, 'Programs', 'Microsoft VS Code', 'Code.exe'));
    addCandidate(candidates, 'VS Code', path.join(root, 'Microsoft VS Code', 'bin', 'code.cmd'));
    addCandidate(candidates, 'VS Code', path.join(root, 'Microsoft VS Code', 'Code.exe'));
  }

  addCandidate(candidates, 'VS Code Insiders', 'code-insiders');
  for (const root of roots) {
    addCandidate(candidates, 'VS Code Insiders', path.join(root, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'));
    addCandidate(candidates, 'VS Code Insiders', path.join(root, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'));
    addCandidate(candidates, 'VS Code Insiders', path.join(root, 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'));
    addCandidate(candidates, 'VS Code Insiders', path.join(root, 'Microsoft VS Code Insiders', 'Code - Insiders.exe'));
  }

  addCandidate(candidates, 'Cursor', 'cursor');
  for (const root of roots) {
    for (const folder of ['Cursor', 'cursor']) {
      addCandidate(candidates, 'Cursor', path.join(root, 'Programs', folder, 'resources', 'app', 'bin', 'cursor.cmd'));
      addCandidate(candidates, 'Cursor', path.join(root, 'Programs', folder, 'Cursor.exe'));
      addCandidate(candidates, 'Cursor', path.join(root, folder, 'resources', 'app', 'bin', 'cursor.cmd'));
      addCandidate(candidates, 'Cursor', path.join(root, folder, 'Cursor.exe'));
    }
  }

  addCandidate(candidates, 'Windsurf', 'windsurf');
  for (const root of roots) {
    for (const folder of ['Windsurf', 'windsurf']) {
      addCandidate(candidates, 'Windsurf', path.join(root, 'Programs', folder, 'bin', 'windsurf.cmd'));
      addCandidate(candidates, 'Windsurf', path.join(root, 'Programs', folder, 'resources', 'app', 'bin', 'windsurf.cmd'));
      addCandidate(candidates, 'Windsurf', path.join(root, 'Programs', folder, 'Windsurf.exe'));
      addCandidate(candidates, 'Windsurf', path.join(root, folder, 'bin', 'windsurf.cmd'));
      addCandidate(candidates, 'Windsurf', path.join(root, folder, 'resources', 'app', 'bin', 'windsurf.cmd'));
      addCandidate(candidates, 'Windsurf', path.join(root, folder, 'Windsurf.exe'));
    }
  }

  return dedupeCandidates(candidates);
}

function getPosixCandidates(): VscodeCliCandidate[] {
  const candidates: VscodeCliCandidate[] = [];
  addCandidate(candidates, 'VS Code', 'code');
  addCandidate(candidates, 'VS Code Insiders', 'code-insiders');
  addCandidate(candidates, 'Cursor', 'cursor');
  addCandidate(candidates, 'Windsurf', 'windsurf');

  if (process.platform === 'darwin') {
    addCandidate(candidates, 'VS Code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
    addCandidate(candidates, 'VS Code Insiders', '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders');
    addCandidate(candidates, 'Cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor');
    addCandidate(candidates, 'Windsurf', '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf');
  } else {
    for (const base of ['/usr/local/bin', '/usr/bin', '/snap/bin']) {
      addCandidate(candidates, 'VS Code', path.join(base, 'code'));
      addCandidate(candidates, 'VS Code Insiders', path.join(base, 'code-insiders'));
      addCandidate(candidates, 'Cursor', path.join(base, 'cursor'));
      addCandidate(candidates, 'Windsurf', path.join(base, 'windsurf'));
    }
  }

  return dedupeCandidates(candidates);
}

function getDefaultCandidates(): VscodeCliCandidate[] {
  return process.platform === 'win32' ? getWindowsCandidates() : getPosixCandidates();
}

function candidateMatchesAlias(candidate: VscodeCliCandidate, alias: string): boolean {
  const normalized = alias.toLowerCase();
  if (normalized === 'code' || normalized === 'vscode' || normalized === 'vs-code') return candidate.label === 'VS Code';
  if (normalized === 'code-insiders' || normalized === 'insiders') return candidate.label === 'VS Code Insiders';
  if (normalized === 'cursor') return candidate.label === 'Cursor';
  if (normalized === 'windsurf') return candidate.label === 'Windsurf';
  return false;
}

async function tryExec(command: string, args: string[], timeout = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFile(command, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      // Windows 上 VS Code CLI 通常是 .cmd；shell=true 能兼容 PATH/PATHEXT 与带空格路径。
      shell: process.platform === 'win32',
    });
    return { ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
  } catch (error: any) {
    return { ok: false, stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? error?.message ?? '') };
  }
}

function resolveCandidate(target?: string): VscodeCliCandidate[] {
  const trimmed = target?.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return getDefaultCandidates();
  const aliased = getDefaultCandidates().filter((candidate) => candidateMatchesAlias(candidate, trimmed));
  if (aliased.length > 0) return aliased;
  return [{ label: trimmed, command: trimmed }];
}


export async function detectVscodeCliCommands(target?: string): Promise<VscodeCliCandidate[]> {
  const detected: VscodeCliCandidate[] = [];
  for (const candidate of resolveCandidate(target)) {
    const result = await tryExec(candidate.command, ['--version']);
    if (!result.ok) continue;
    detected.push({
      ...candidate,
      version: result.stdout.split(/\r?\n/g).find(Boolean),
    });
  }
  return detected;
}

async function getInstalledExtensionVersion(command: string): Promise<string | undefined> {
  const withVersions = await tryExec(command, ['--list-extensions', '--show-versions'], 20_000);
  if (withVersions.ok) {
    const match = withVersions.stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().startsWith(`${EXTENSION_ID}@`));
    if (match) return match.slice(EXTENSION_ID.length + 1).trim() || undefined;
  }

  const result = await tryExec(command, ['--list-extensions'], 20_000);
  if (!result.ok) return undefined;
  const installed = result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim().toLowerCase())
    .includes(EXTENSION_ID);
  return installed ? 'unknown' : undefined;
}

async function activateInstalledExtension(command: string): Promise<{ attempted: boolean; ok: boolean; stderr?: string }> {
  // VS Code CLI 支持 --command 时，可在当前/最近窗口中触发扩展命令。
  // 对新安装扩展来说，这通常足以让 onCommand activation event 立即激活，
  // 无需用户手动 Reload Window；旧版 VS Code 不支持时会失败并回退为提示。
  const attempts = [
    ['--reuse-window', '--command', 'irisIde.restartServer'],
    ['--command', 'irisIde.restartServer'],
  ];
  let lastError = '';
  for (const args of attempts) {
    const result = await tryExec(command, args, 20_000);
    if (result.ok) return { attempted: true, ok: true };
    lastError = result.stderr;
  }
  return { attempted: true, ok: false, stderr: lastError };
}

export async function installVscodeExtension(options: InstallVscodeExtensionOptions): Promise<InstallVscodeExtensionResult> {
  const candidates = await detectVscodeCliCommands(options.target);
  if (candidates.length === 0) {
    return {
      success: false,
      message: [
        '未找到可用的 VS Code / Cursor / Windsurf 命令。',
        '已尝试 PATH 与常见安装目录；如果仍失败，请使用 /ide install <命令路径> 指定 code.cmd / Code.exe / cursor.cmd 等路径。',
      ].join('\n'),
    };
  }

  const candidate = candidates[0];
  try {
    const extensionDir = getBundledVscodeExtensionDir(options.extensionRootDir);
    const bundledPackage = await readBundledVscodeExtensionPackage(extensionDir);
    const bundledVersion = String(bundledPackage.version ?? '0.1.0');
    const installedVersion = await getInstalledExtensionVersion(candidate.command);

    if (installedVersion === bundledVersion && !options.force) {
      const activation = options.activateIfCurrent === false ? undefined : await activateInstalledExtension(candidate.command);
      return {
        success: true,
        alreadyInstalled: true,
        command: candidate.command,
        label: candidate.label,
        message: [
          `${candidate.label} 已安装 Iris IDE 扩展 v${installedVersion}。`,
          activation
            ? (activation.ok ? '已尝试自动激活扩展。' : '自动激活未成功；如 /ide detect 无结果，请 Reload Window 或重启 VS Code。')
            : '扩展已是当前版本。',
          '请确认 VS Code 已打开目标工作区，然后执行 /ide detect 或 /ide connect。',
        ].join('\n'),
      };
    }

    const vsixPath = await packageVscodeExtension(extensionDir, path.join(options.dataDir, 'vscode-extension'), bundledPackage);
    const install = await tryExec(candidate.command, ['--install-extension', vsixPath, '--force'], 60_000);
    if (!install.ok) {
      return {
        success: false,
        command: candidate.command,
        label: candidate.label,
        vsixPath,
        error: install.stderr,
        message: `${candidate.label} 安装 Iris IDE 扩展失败：${install.stderr || 'unknown error'}`,
      };
    }

    const activation = await activateInstalledExtension(candidate.command);

    return {
      success: true,
      command: candidate.command,
      label: candidate.label,
      vsixPath,
      message: [
        installedVersion
          ? `已将 ${candidate.label} 的 Iris IDE 扩展从 v${installedVersion} 更新到 v${bundledVersion}。`
          : `已安装 Iris IDE 扩展 v${bundledVersion} 到 ${candidate.label}。`,
        activation.ok
          ? '已尝试通过 VS Code CLI 自动激活扩展。'
          : '未能通过 VS Code CLI 自动激活扩展；如 /ide detect 仍无结果，请执行 “Developer: Reload Window” 或重启 VS Code。',
        '激活后运行 /ide detect 或 /ide connect。',
      ].join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      command: candidate.command,
      label: candidate.label,
      error: error instanceof Error ? error.message : String(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getVscodeExtensionId(): string {
  return EXTENSION_ID;
}
