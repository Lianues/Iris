/**
 * Console 平台文本布局工具。
 *
 * 提供 grapheme 切分和宽字符宽度计算。
 * 输入栏已改用 OpenTUI 内置组件，大部分光标计算函数已移除。
 */

const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
  : null;

export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (part: any) => part.segment as string);
  }
  return Array.from(text);
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115F
    || codePoint === 0x2329
    || codePoint === 0x232A
    || (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE10 && codePoint <= 0xFE19)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
    || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
    || (codePoint >= 0x1F300 && codePoint <= 0x1FAFF)
    || (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
  );
}

function getGraphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;

  let width = 0;
  for (const symbol of Array.from(grapheme)) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }

  return width || 1;
}

export function getTextWidth(text: string): number {
  return splitGraphemes(text).reduce((total, grapheme) => total + getGraphemeWidth(grapheme), 0);
}

export function getLineLength(text: string): number {
  return splitGraphemes(text).length;
}
