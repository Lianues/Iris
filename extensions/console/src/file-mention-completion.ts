export interface FileMentionToken {
  start: number;
  end: number;
  query: string;
}

export interface FileMentionCandidate {
  path: string;
}

interface RankedCandidate {
  candidate: FileMentionCandidate;
  rank: number;
  index: number;
}

export const DEFAULT_FILE_MENTION_LIMIT = 30;

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let cursor = 0;
  for (const ch of haystack) {
    if (ch === needle[cursor]) cursor++;
    if (cursor === needle.length) return true;
  }
  return false;
}

function matchRank(filePath: string, query: string): number | null {
  const normalizedPath = filePath.toLowerCase();
  const fileName = basename(normalizedPath);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  if (fileName.includes(normalizedQuery)) return 0;
  if (normalizedPath.includes(normalizedQuery)) return 1;
  if (isSubsequence(normalizedQuery, fileName)) return 2;
  if (isSubsequence(normalizedQuery, normalizedPath)) return 3;
  return null;
}

export function findFileMentionToken(value: string, cursor: number): FileMentionToken | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const prefix = value.slice(0, safeCursor);
  const match = /(^|\s)@([^\s@]*)$/.exec(prefix);
  if (!match) return null;

  const query = match[2] ?? '';
  const start = safeCursor - query.length - 1;
  return { start, end: safeCursor, query };
}

export function normalizeFileMentionPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function filterFileMentionCandidates(
  files: readonly string[],
  query: string,
  limit = DEFAULT_FILE_MENTION_LIMIT,
): FileMentionCandidate[] {
  const ranked: RankedCandidate[] = [];

  files.forEach((filePath, index) => {
    const normalized = normalizeFileMentionPath(filePath);
    const rank = matchRank(normalized, query);
    if (rank == null) return;
    ranked.push({ candidate: { path: normalized }, rank, index });
  });

  return ranked
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.candidate.path.length !== b.candidate.path.length) {
        return a.candidate.path.length - b.candidate.path.length;
      }
      const byName = basename(a.candidate.path).localeCompare(basename(b.candidate.path));
      if (byName !== 0) return byName;
      const byPath = a.candidate.path.localeCompare(b.candidate.path);
      return byPath !== 0 ? byPath : a.index - b.index;
    })
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.candidate);
}
