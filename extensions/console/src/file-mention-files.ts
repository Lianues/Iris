import fs from 'node:fs';
import path from 'node:path';

export const FILE_MENTION_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  'out',
  'target',
  '.output',
  '.vite',
]);

export interface ListFileMentionFilesOptions {
  maxFiles?: number;
}

export function listFileMentionFiles(root: string, options: ListFileMentionFilesOptions = {}): string[] {
  const maxFiles = options.maxFiles ?? 5000;
  const result: string[] = [];
  const rootPath = path.resolve(root);

  function visit(dir: string): void {
    if (result.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (result.length >= maxFiles) return;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!FILE_MENTION_IGNORED_DIRS.has(entry.name)) visit(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const relative = path.relative(rootPath, fullPath);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      result.push(relative.split(path.sep).join('/'));
    }
  }

  visit(rootPath);
  return result;
}
