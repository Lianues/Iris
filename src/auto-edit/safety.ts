import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AutoEditPathSafetyResult, AutoEditSafetyCategory } from './types';

const SENSITIVE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.ssh',
  '.iris',
  '.vscode',
  '.idea',
]);

const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.gitconfig',
  '.git-credentials',
  '.bashrc',
  '.zshrc',
  '.profile',
  '.bash_profile',
  'id_rsa',
  'id_ed25519',
  'known_hosts',
  'authorized_keys',
]);

const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.cer',
]);

function deny(inputPath: string, category: AutoEditSafetyCategory, reason: string): AutoEditPathSafetyResult {
  return { ok: false, inputPath, category, reason };
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInsideOrEqual(base: string, target: string): boolean {
  const comparableBase = normalizeForComparison(base);
  const comparableTarget = normalizeForComparison(target);
  const relative = path.relative(comparableBase, comparableTarget);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
function realpathOrResolved(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  }
}

function nearestExistingParent(p: string, stopAt: string): string | null {
  let current = path.dirname(p);
  const stop = path.resolve(stopAt);
  while (isPathInsideOrEqual(stop, current)) {
    if (pathExists(current)) return current;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return pathExists(stop) ? stop : null;
}

function hasUncPath(raw: string): boolean {
  return raw.startsWith('\\\\') || raw.startsWith('//');
}

function hasLongOrDevicePathPrefix(raw: string): boolean {
  return raw.startsWith('\\\\?\\')
    || raw.startsWith('\\\\.\\')
    || raw.startsWith('//?/')
    || raw.startsWith('//./');
}

function hasNtfsAlternateDataStream(raw: string): boolean {
  const normalized = raw.replace(/\\/g, '/');
  const withoutDrive = /^[A-Za-z]:\//.test(normalized) ? normalized.slice(2) : normalized;
  return withoutDrive.split('/').some(segment => segment.includes(':'));
}

function hasTrailingDotOrSpaceSegment(raw: string): boolean {
  return raw.split(/[\\/]+/).some(segment => (
    segment.length > 0 && segment !== '.' && segment !== '..' && /[.\s]$/.test(segment)
  ));
}

function hasDosDeviceName(raw: string): boolean {
  return raw.split(/[\\/]+/).some(segment => {
    const trimmed = segment.replace(/[.\s]+$/g, '');
    if (!trimmed) return false;
    const base = trimmed.split('.')[0]?.toUpperCase();
    return !!base && /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base);
  });
}

function hasSuspiciousWindowsPathPattern(raw: string): { category: AutoEditSafetyCategory; reason: string } | null {
  if (hasLongOrDevicePathPrefix(raw)) {
    return { category: 'windows_special_path', reason: '路径包含 Windows long/device path 前缀，Auto Edit 不会自动应用。' };
  }
  if (hasUncPath(raw)) {
    return { category: 'unc_path', reason: '路径是 UNC/网络路径，Auto Edit 不会自动应用。' };
  }
  if (hasNtfsAlternateDataStream(raw)) {
    return { category: 'windows_special_path', reason: '路径疑似包含 NTFS Alternate Data Stream，Auto Edit 不会自动应用。' };
  }
  if (hasTrailingDotOrSpaceSegment(raw)) {
    return { category: 'windows_special_path', reason: '路径段以点或空格结尾，Auto Edit 不会自动应用。' };
  }
  if (hasDosDeviceName(raw)) {
    return { category: 'windows_special_path', reason: '路径包含 Windows 保留设备名，Auto Edit 不会自动应用。' };
  }
  return null;
}

function toRelativePosix(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join('/');
}

function isSensitiveRelativePath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('..')) return null;
  const lower = normalized.toLowerCase();
  const segments = lower.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? '';

  if (segments.some(segment => SENSITIVE_DIRS.has(segment))) {
    return `路径位于敏感目录 ${segments.find(segment => SENSITIVE_DIRS.has(segment))}`;
  }

  if (segments[0] === '.github' && segments[1] === 'workflows') {
    return '路径位于 .github/workflows，CI 工作流变更需要人工确认';
  }

  if (segments[0] === 'data' && segments[1] === 'configs') {
    return '路径位于 data/configs，Iris 配置变更需要人工确认';
  }

  const agentConfigIndex = segments.findIndex((segment, index) => (
    segment === 'agents' && segments[index + 2] === 'configs'
  ));
  if (agentConfigIndex >= 0) {
    return '路径位于 Agent configs，配置变更需要人工确认';
  }

  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return '路径是环境变量/密钥文件，Auto Edit 不会自动应用';
  }

  if (SENSITIVE_FILE_NAMES.has(fileName)) {
    return `路径是敏感文件 ${fileName}，Auto Edit 不会自动应用`;
  }

  const extension = path.posix.extname(fileName);
  if (SENSITIVE_EXTENSIONS.has(extension)) {
    return `路径扩展名 ${extension} 常用于密钥或证书，Auto Edit 不会自动应用`;
  }

  if (/(credential|credentials|secret|secrets|token|tokens|apikey|api_key|private[-_]?key)/i.test(fileName)) {
    return '路径文件名疑似包含凭据/密钥信息，Auto Edit 不会自动应用';
  }

  return null;
}

/**
 * 判断单个目标路径是否允许被 Auto Edit 自动应用。
 *
 * 失败时只表示“不能自动应用”，不代表工具本身禁止执行；scheduler 会回退到原有审批流程。
 */
export function checkAutoEditPathSafety(inputPath: string, cwd: string): AutoEditPathSafetyResult {
  const raw = inputPath.trim();
  if (!raw) return deny(inputPath, 'invalid_path', '路径为空，Auto Edit 不会自动应用。');

  const suspicious = hasSuspiciousWindowsPathPattern(raw);
  if (suspicious) return deny(inputPath, suspicious.category, suspicious.reason);

  const workspacePath = path.resolve(cwd);
  const workspaceRealPath = realpathOrResolved(workspacePath);
  const resolvedPath = path.resolve(workspacePath, raw);

  if (!isPathInsideOrEqual(workspacePath, resolvedPath)) {
    return deny(inputPath, 'outside_workspace', `路径超出当前工作目录，Auto Edit 不会自动应用：${inputPath}`);
  }

  const relative = toRelativePosix(workspacePath, resolvedPath);
  const sensitiveReason = isSensitiveRelativePath(relative);
  if (sensitiveReason) {
    return deny(inputPath, 'sensitive_path', sensitiveReason);
  }

  if (pathExists(resolvedPath)) {
    const realTarget = realpathOrResolved(resolvedPath);
    if (!isPathInsideOrEqual(workspaceRealPath, realTarget)) {
      return deny(inputPath, 'symlink_escape', `路径通过符号链接指向工作目录外部，Auto Edit 不会自动应用：${inputPath}`);
    }

    const realRelative = toRelativePosix(workspaceRealPath, realTarget);
    const realSensitiveReason = isSensitiveRelativePath(realRelative);
    if (realSensitiveReason) {
      return deny(inputPath, 'sensitive_path', realSensitiveReason);
    }
  } else {
    const existingParent = nearestExistingParent(resolvedPath, workspacePath);
    if (!existingParent) {
      return deny(inputPath, 'invalid_path', `无法找到目标路径的现有父目录，Auto Edit 不会自动应用：${inputPath}`);
    }
    const realParent = realpathOrResolved(existingParent);
    if (!isPathInsideOrEqual(workspaceRealPath, realParent)) {
      return deny(inputPath, 'symlink_escape', `目标父目录通过符号链接指向工作目录外部，Auto Edit 不会自动应用：${inputPath}`);
    }
  }

  return { ok: true, inputPath, resolvedPath };
}
