import * as fs from 'node:fs';
import * as path from 'node:path';

function normalizeForSkillAccessPreflight(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/%5c/gi, '/')
    .replace(/%2f/gi, '/')
    .toLowerCase();
}

function normalizePathForCompare(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function realpathOrResolved(input: string): string {
  try {
    return fs.realpathSync.native(input);
  } catch {
    try {
      return fs.realpathSync(input);
    } catch {
      return path.resolve(input);
    }
  }
}

function isPathInsideOrEqual(base: string, target: string): boolean {
  const comparableBase = normalizePathForCompare(base);
  const comparableTarget = normalizePathForCompare(target);
  const relative = path.relative(comparableBase, comparableTarget);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandContainsProtectedRoot(normalizedText: string, normalizedRoot: string): boolean {
  const rootText = normalizedRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!rootText) return false;
  const pattern = new RegExp(`(^|[^a-z0-9._~%+\\-])${escapeRegExp(rootText)}(?:$|[\\s"'\\)\\]\\}<>;&|]|/)`, 'i');
  return pattern.test(normalizedText);
}

const SKILL_ACCESS_MARKERS = [
  'skill://',
  '/.iris/skills/',
  '/.agents/skills/',
  '/.claude/skills/',
  '.iris/skills/',
  '.agents/skills/',
  '.claude/skills/',
  '~/.iris/skills/',
];

const SKILL_ACCESS_EXACT_SUFFIXES = [
  '/.iris/skills',
  '/.agents/skills',
  '/.claude/skills',
  '.iris/skills',
  '.agents/skills',
  '.claude/skills',
  '~/.iris/skills',
];

const SKILL_ACCESS_REJECTION_MESSAGE = 'Direct access to Skill directories is blocked. Use read_skill_resource or execute_skill_script instead.';

const protectedRootsByOwner = new Map<string, string[]>();

function collectProtectedSkillRoots(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const roots of protectedRootsByOwner.values()) {
    for (const root of roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      result.push(root);
    }
  }
  return result;
}

function normalizeRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const normalizedRoots: string[] = [];
  for (const root of roots) {
    if (typeof root !== 'string' || !root.trim()) continue;
    const normalized = normalizePathForCompare(realpathOrResolved(root));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedRoots.push(normalized);
  }
  return normalizedRoots;
}

/**
 * Compatibility API for single-core scenarios. Prefer setProtectedSkillRootsForOwner
 * when multiple IrisCore instances can coexist in the same process.
 */
export function setProtectedSkillRoots(roots: string[]): void {
  setProtectedSkillRootsForOwner('default', roots);
}

export function setProtectedSkillRootsForOwner(ownerId: string, roots: string[]): void {
  const key = ownerId || 'default';
  const normalizedRoots = normalizeRoots(roots);
  if (normalizedRoots.length === 0) {
    protectedRootsByOwner.delete(key);
    return;
  }
  protectedRootsByOwner.set(key, normalizedRoots);
}

export function clearProtectedSkillRootsForOwner(ownerId: string): void {
  protectedRootsByOwner.delete(ownerId || 'default');
}

export function getProtectedSkillRoots(): string[] {
  return collectProtectedSkillRoots();
}

export function isProtectedSkillPath(input: string | undefined): boolean {
  if (typeof input !== 'string' || !input.trim()) return false;
  const protectedSkillRoots = collectProtectedSkillRoots();
  if (protectedSkillRoots.length === 0) return false;
  try {
    const resolved = normalizePathForCompare(realpathOrResolved(input.trim()));
    return protectedSkillRoots.some(root => isPathInsideOrEqual(root, resolved));
  } catch {
    return false;
  }
}

export function isProtectedSkillPathOrAncestor(input: string | undefined): boolean {
  if (typeof input !== 'string' || !input.trim()) return false;
  const protectedSkillRoots = collectProtectedSkillRoots();
  if (protectedSkillRoots.length === 0) return false;
  try {
    const resolved = normalizePathForCompare(realpathOrResolved(input.trim()));
    return protectedSkillRoots.some(root => isPathInsideOrEqual(root, resolved) || isPathInsideOrEqual(resolved, root));
  } catch {
    return false;
  }
}

export function isSkillAccessPreflightBlockedPath(input: string | undefined): boolean {
  if (typeof input !== 'string' || !input.trim()) return false;
  if (isProtectedSkillPath(input)) return true;
  const normalized = normalizeForSkillAccessPreflight(input.trim());
  return SKILL_ACCESS_MARKERS.some(marker => normalized.includes(marker))
    || SKILL_ACCESS_EXACT_SUFFIXES.some(marker => normalized === marker || normalized.endsWith(marker));
}

function matchesProtectedSkillRoot(inputs: string[]): boolean {
  const protectedSkillRoots = collectProtectedSkillRoots();
  if (protectedSkillRoots.length === 0) return false;
  for (const input of inputs) {
    if (!input) continue;
    const trimmed = input.trim();
    if (!trimmed) continue;

    // Exact path/cwd checks for already-resolved paths passed by tools.
    try {
      const resolved = normalizePathForCompare(realpathOrResolved(trimmed));
      if (protectedSkillRoots.some(root => isPathInsideOrEqual(root, resolved))) return true;
    } catch {
      // Fall through to command-string checks.
    }

    // Best-effort command-string check for absolute protected roots embedded in shell text.
    const normalizedText = normalizeForSkillAccessPreflight(trimmed);
    if (protectedSkillRoots.some(root => commandContainsProtectedRoot(normalizedText, root))) return true;
  }
  return false;
}

export function getSkillAccessPreflightRejection(...inputs: Array<string | undefined>): string | null {
  const concreteInputs = inputs.filter((item): item is string => typeof item === 'string' && item.length > 0);
  const combined = concreteInputs.join('\n');
  if (!combined) return null;

  if (matchesProtectedSkillRoot(concreteInputs)) {
    return SKILL_ACCESS_REJECTION_MESSAGE;
  }

  const normalized = normalizeForSkillAccessPreflight(combined);
  if (SKILL_ACCESS_MARKERS.some(marker => normalized.includes(marker))) {
    return SKILL_ACCESS_REJECTION_MESSAGE;
  }
  if (SKILL_ACCESS_EXACT_SUFFIXES.some(marker => normalized === marker || normalized.endsWith(marker))) {
    return SKILL_ACCESS_REJECTION_MESSAGE;
  }
  return null;
}
