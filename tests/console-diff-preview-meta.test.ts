import { describe, expect, it } from 'vitest';
import type { ToolDiffPreviewResponseLike } from 'irises-extension-sdk/plugin';
import { attachResultDiffPreview, extractResultDiffPreview } from '../extensions/console/src/tool-renderers/diff-preview-meta.js';

function createPreview(filePath = 'demo.ts'): ToolDiffPreviewResponseLike {
  return {
    toolName: 'write_file',
    title: 'Diff 审批',
    toolLabel: 'write_file',
    summary: [],
    items: [{
      filePath,
      label: `${filePath} · 修改`,
      diff: '@@ -1,1 +1,1 @@\n-old\n+new',
      added: 1,
      removed: 1,
    }],
  };
}

describe('console diff preview metadata helpers', () => {
  it('可把独立 diffPreview 挂回普通 result 对象，供渲染器提取', () => {
    const result = { path: 'demo.ts', success: true, action: 'modified' };
    const preview = createPreview();

    const enriched = attachResultDiffPreview(result, preview) as Record<string, unknown>;

    expect(enriched).not.toBe(result);
    expect(enriched.path).toBe('demo.ts');
    expect(extractResultDiffPreview(enriched)).toEqual(preview);
  });

  it('已有 diffPreview 时保持原值，不被后续注入覆盖', () => {
    const existingPreview = createPreview('existing.ts');
    const attached = attachResultDiffPreview(
      { path: 'demo.ts', success: true, action: 'modified' },
      existingPreview,
    );

    const nextPreview = createPreview('next.ts');
    const enrichedAgain = attachResultDiffPreview(attached, nextPreview);

    expect(extractResultDiffPreview(enrichedAgain)).toEqual(existingPreview);
  });
});
