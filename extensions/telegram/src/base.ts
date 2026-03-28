/** 将文本按最大长度分段，优先在换行处切分 */
export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

export abstract class PlatformAdapter {
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  get name(): string {
    return this.constructor.name;
  }
}
