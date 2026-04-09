/**
 * 记忆新鲜度工具
 *
 * 基于 memdir/memoryAge.ts 的逻辑适配。
 * 输入为 Unix 时间戳（秒），输出人类可读的年龄描述。
 */

const DAY_MS = 86_400_000;

/**
 * 计算记忆年龄的人类可读描述。
 * @param updatedAtSec Unix 时间戳（秒）
 */
export function memoryAge(updatedAtSec: number): string {
  const now = Date.now();
  const updatedMs = updatedAtSec * 1000;
  const diffMs = now - updatedMs;

  if (diffMs < 0) return 'just now';

  const diffDays = Math.floor(diffMs / DAY_MS);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }
  const years = Math.floor(diffDays / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/**
 * 生成新鲜度警告文本。
 * 超过 1 天的记忆附加过时警告。返回 undefined 表示无需警告。
 */
export function memoryFreshnessText(updatedAtSec: number): string | undefined {
  const diffMs = Date.now() - updatedAtSec * 1000;
  const diffDays = Math.floor(diffMs / DAY_MS);
  if (diffDays <= 1) return undefined;
  return `This memory is ${memoryAge(updatedAtSec)} old. Claims about code behavior may be outdated.`;
}

/**
 * 生成新鲜度提示（带 system-reminder 标签，用于注入上下文）。
 */
export function memoryFreshnessNote(updatedAtSec: number): string | undefined {
  const text = memoryFreshnessText(updatedAtSec);
  if (!text) return undefined;
  return `[Note: ${text}]`;
}
