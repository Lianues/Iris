import type { ModelCatalogResultLike } from 'irises-extension-sdk';
import { ICONS } from './terminal-compat';
import { getTextWidth, splitGraphemes } from './text-layout';

export interface ModelPickerEntry {
  id: string;
  label: string;
}

function normalizeSingleLine(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Catalog 的 label 是完整展示文本，displayName 才是需要与 id 组合的名称。
 * 同时在 UI 边界过滤空 id 和重复项，避免 React key 冲突。
 */
export function normalizeModelCatalogEntries(
  models: ModelCatalogResultLike['models'],
): ModelPickerEntry[] {
  const seen = new Set<string>();
  const entries: ModelPickerEntry[] = [];

  for (const model of models ?? []) {
    const id = normalizeSingleLine(model?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // 兼容尚未同步 SDK 类型但运行时已返回 label 的宿主版本。
    const completeLabel = normalizeSingleLine('label' in model ? model.label : undefined)
      .replace(/\s+·\s+/g, ` ${ICONS.separator} `);
    const displayName = normalizeSingleLine(model.displayName);
    entries.push({
      id,
      label: completeLabel
        || (displayName && displayName !== id ? `${id} ${ICONS.separator} ${displayName}` : id),
    });
  }

  return entries;
}

export function filterModelPickerEntries(
  entries: ModelPickerEntry[],
  filter: string,
): ModelPickerEntry[] {
  const keyword = filter.trim().toLowerCase();
  if (!keyword) return entries;
  return entries.filter((entry) =>
    entry.id.toLowerCase().includes(keyword)
    || entry.label.toLowerCase().includes(keyword),
  );
}

export function fitModelPickerSingleLine(text: string, maxWidth: number): string {
  const normalized = normalizeSingleLine(text);
  const targetWidth = Math.max(1, maxWidth);
  if (getTextWidth(normalized) <= targetWidth) return normalized;

  const ellipsisWidth = getTextWidth(ICONS.ellipsis);
  let output = '';
  let usedWidth = 0;
  for (const grapheme of splitGraphemes(normalized)) {
    const graphemeWidth = getTextWidth(grapheme);
    if (usedWidth + graphemeWidth + ellipsisWidth > targetWidth) break;
    output += grapheme;
    usedWidth += graphemeWidth;
  }
  return `${output}${ICONS.ellipsis}`;
}

export function getModelPickerVisibleRowCount(termHeight: number): number {
  const safeHeight = Number.isFinite(termHeight) ? Math.trunc(termHeight) : 24;
  return Math.max(3, Math.min(8, safeHeight - 19));
}

/**
 * Settings 底栏的内容区使用稳定行数，避免状态切换时挤压主列表。
 * 普通状态固定为“说明 / 状态 / 快捷键”三行；编辑状态则是
 * “标题 / 可选提示 / 单行输入 / 快捷键”。
 */
export function getSettingsBottomBarContentRowCount(
  editing: boolean,
  hasEditorHint: boolean,
): number {
  return editing ? 3 + (hasEditorHint ? 1 : 0) : 3;
}

export function getModelPickerWindow(
  entries: ModelPickerEntry[],
  highlightIndex: number,
  maxVisible: number,
): { startIndex: number; entries: ModelPickerEntry[] } {
  if (entries.length === 0) return { startIndex: 0, entries: [] };

  const visibleCount = Math.max(1, Math.trunc(maxVisible));
  const safeHighlight = Math.max(0, Math.min(entries.length - 1, highlightIndex));
  let startIndex = Math.max(0, safeHighlight - Math.floor(visibleCount / 2));
  startIndex = Math.min(startIndex, Math.max(0, entries.length - visibleCount));
  return {
    startIndex,
    entries: entries.slice(startIndex, startIndex + visibleCount),
  };
}

export function buildSettingsShortcutHelp(parts: string[], maxWidth: number): string {
  let output = '';
  for (const part of parts) {
    const next = output ? `${output}  ${part}` : part;
    if (getTextWidth(next) > Math.max(1, maxWidth)) break;
    output = next;
  }
  return output || fitModelPickerSingleLine(parts[0] ?? '', maxWidth);
}
