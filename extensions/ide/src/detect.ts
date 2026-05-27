import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { DetectedIde, IdeConfig, IdeLockfileContent, IdeTransport } from './types.js';

interface LockfileRecord {
  path: string;
  mtimeMs: number;
}

export interface DetectIdeOptions {
  dataDir: string;
  cwd: string;
  config: IdeConfig;
}

function resolveLockDirs(dataDir: string, config: IdeConfig): string[] {
  const dirs = new Set<string>();
  const configured = config.lockDir
    ? (path.isAbsolute(config.lockDir) ? config.lockDir : path.resolve(dataDir, config.lockDir))
    : path.join(dataDir, 'ide');
  dirs.add(configured);

  if (config.compatibility.claudeCodeLockfiles) {
    dirs.add(path.join(os.homedir(), '.claude', 'ide'));
  }

  return [...dirs];
}

async function listLockfiles(dir: string): Promise<LockfileRecord[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.lock'))
      .map(async (entry) => {
        const full = path.join(dir, entry.name);
        try {
          const stat = await fsp.stat(full);
          return { path: full, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      }));
    return records.filter((item): item is LockfileRecord => !!item);
  } catch {
    return [];
  }
}

function parsePortFromLockfile(lockfilePath: string): number | undefined {
  const base = path.basename(lockfilePath, '.lock');
  const port = Number.parseInt(base, 10);
  return Number.isFinite(port) && port > 0 ? port : undefined;
}

function safeJsonParse(content: string): IdeLockfileContent | undefined {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as IdeLockfileContent
      : undefined;
  } catch {
    return undefined;
  }
}

function parseLegacyWorkspaceList(content: string): IdeLockfileContent {
  return {
    workspaceFolders: content
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

async function readLockfile(lockfilePath: string): Promise<(IdeLockfileContent & { port: number }) | undefined> {
  const port = parsePortFromLockfile(lockfilePath);
  if (!port) return undefined;
  try {
    const content = await fsp.readFile(lockfilePath, 'utf-8');
    const parsed = safeJsonParse(content) ?? parseLegacyWorkspaceList(content);
    return { ...parsed, port };
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stripFileProtocol(input: string): string {
  if (!input.startsWith('file://')) return input;
  try {
    return fileURLToPath(input);
  } catch {
    return input.slice('file://'.length);
  }
}

function normalizeForCompare(input: string): string {
  let resolved = path.resolve(stripFileProtocol(input)).normalize();
  if (process.platform === 'win32') resolved = resolved.toLowerCase();
  return resolved;
}

function pathInsideOrEqual(base: string, target: string): boolean {
  const b = normalizeForCompare(base);
  const t = normalizeForCompare(target);
  return t === b || t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

function isWorkspaceMatch(workspaceFolders: string[] | undefined, cwd: string): boolean {
  if (!workspaceFolders || workspaceFolders.length === 0) return false;
  return workspaceFolders.some((folder) => {
    if (!folder) return false;
    try {
      return pathInsideOrEqual(folder, cwd);
    } catch {
      return false;
    }
  });
}

function detectWslWindowsHost(): string | undefined {
  if (process.platform === 'win32') return undefined;
  try {
    const content = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const match = /^nameserver\s+([^\s]+)\s*$/m.exec(content);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function getIdeHost(runningInWindows: boolean | undefined): string {
  if (runningInWindows && process.platform !== 'win32') {
    return detectWslWindowsHost() ?? '127.0.0.1';
  }
  return '127.0.0.1';
}

function normalizeTransport(value: unknown): IdeTransport {
  return value === 'ws' ? 'ws' : 'sse';
}

function toDisplayName(ideName: string | undefined): string {
  return ideName && ideName.trim() ? ideName.trim() : 'IDE';
}

export async function detectIDEs(options: DetectIdeOptions): Promise<DetectedIde[]> {
  if (!options.config.enabled) return [];

  const lockDirs = resolveLockDirs(options.dataDir, options.config);
  const lockfiles = (await Promise.all(lockDirs.map(listLockfiles)))
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const detected: DetectedIde[] = [];
  for (const lockfile of lockfiles) {
    const info = await readLockfile(lockfile.path);
    if (!info) continue;
    if (!isProcessRunning(info.pid)) continue;

    const transport = normalizeTransport(info.transport);
    const host = getIdeHost(info.runningInWindows === true);
    const url = transport === 'ws'
      ? `ws://${host}:${info.port}`
      : `http://${host}:${info.port}/sse`;
    const name = toDisplayName(info.ideName);
    const workspaceFolders = Array.isArray(info.workspaceFolders) ? info.workspaceFolders : [];
    const isValid = isWorkspaceMatch(workspaceFolders, options.cwd);

    detected.push({
      id: `${name}:${info.port}`,
      name,
      port: info.port,
      url,
      transport,
      workspaceFolders,
      isValid,
      lockfilePath: lockfile.path,
      pid: info.pid,
      authToken: info.authToken,
      runningInWindows: info.runningInWindows,
    });
  }

  return detected;
}

export function isPathInsideCwd(filePath: string | undefined, cwd: string): boolean {
  if (!filePath) return false;
  try {
    return pathInsideOrEqual(cwd, filePath);
  } catch {
    return false;
  }
}

export function relativeToCwd(filePath: string, cwd: string): string {
  try {
    const relative = path.relative(cwd, filePath);
    return relative && !relative.startsWith('..') ? relative : filePath;
  } catch {
    return filePath;
  }
}
