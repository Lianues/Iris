import type {
  ParsedUnifiedDiff,
  UnifiedDiffHunk,
  UnifiedDiffLine,
  WriteEntry,
  InsertEntry,
  DeleteCodeEntry,
} from '../tool-utils.js';

/** @deprecated 请直接使用 ParsedUnifiedDiff */
export type ParsedUnifiedDiffLike = ParsedUnifiedDiff;
/** @deprecated 请直接使用 UnifiedDiffHunk */
export type UnifiedDiffHunkLike = UnifiedDiffHunk;
/** @deprecated 请直接使用 UnifiedDiffLine */
export type UnifiedDiffLineLike = UnifiedDiffLine;
/** @deprecated 请直接使用 WriteEntry */
export type WriteEntryLike = WriteEntry;
/** @deprecated 请直接使用 InsertEntry */
export type InsertEntryLike = InsertEntry;
/** @deprecated 请直接使用 DeleteCodeEntry */
export type DeleteCodeEntryLike = DeleteCodeEntry;

export interface SearchGlobArgsLike {
  include: string[];
  exclude: string[];
  effectiveExclude: string[];
}

export interface SearchFileMatchLike {
  fileAbs: string;
  relPosix: string;
}

export interface ToolPreviewUtilsLike {
  parseUnifiedDiff(patch: string): ParsedUnifiedDiffLike;
  normalizeWriteArgs(args: Record<string, unknown>): WriteEntryLike[] | undefined;
  normalizeInsertArgs(args: Record<string, unknown>): InsertEntryLike[] | undefined;
  normalizeDeleteCodeArgs(args: Record<string, unknown>): DeleteCodeEntryLike[] | undefined;
  resolveProjectPath(inputPath: string): string;
  walkFiles(rootAbs: string, onFile: (fileAbs: string, relPosix: string) => void, shouldStop: () => boolean): void;
  buildSearchRegex(query: string, isRegex: boolean): RegExp;
  decodeText(buf: Buffer): { text: string; encoding: string; hasBom: boolean; hasCRLF: boolean };
  globToRegExp(glob: string): RegExp;
  isLikelyBinary(buf: Buffer): boolean;
  toPosix(p: string): string;
  normalizeSearchGlobArgs(args: Record<string, unknown>): SearchGlobArgsLike;
  collectSearchFiles(rootAbs: string, include: string[], effectiveExclude: string[]): SearchFileMatchLike[];
}

export interface ToolDiffPreviewItemLike {
  id?: string;
  filePath: string;
  label: string;
  diff?: string;
  filetype?: string;
  added: number;
  removed: number;
  message?: string;
}

export interface ToolDiffPreviewResponseLike {
  toolName: string;
  title: string;
  toolLabel?: string;
  summary: string[];
  items: ToolDiffPreviewItemLike[];
}
