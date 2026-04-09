/**
 * 记忆清单构建工具
 *
 * 用于构建记忆的摘要清单（manifest），供 LLM 进行相关性判断。
 * 清单不包含完整内容，只有 id / name / description / type / age。
 */

import type { MemoryManifestEntry } from '../types.js';

/**
 * 将 manifest 条目格式化为 LLM 可读的文本。
 */
export function formatManifest(entries: MemoryManifestEntry[]): string {
  if (entries.length === 0) return '(no memories stored)';

  const lines = entries.map(m => {
    const desc = m.description ? ` — ${m.description}` : '';
    return `  #${m.id} [${m.type}] ${m.name}${desc} (${m.age})`;
  });

  return `Memory manifest (${entries.length} entries):\n${lines.join('\n')}`;
}

/**
 * 将 manifest 格式化为紧凑的 CSV 格式（节省 token）。
 * 用于提取和归纳 prompt。
 */
export function formatManifestCompact(entries: MemoryManifestEntry[]): string {
  if (entries.length === 0) return '(no memories)';

  const header = 'id | type | name | description | age';
  const rows = entries.map(m =>
    `${m.id} | ${m.type} | ${m.name} | ${m.description || '-'} | ${m.age}`
  );

  return [header, ...rows].join('\n');
}
