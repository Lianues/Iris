import { describe, expect, it } from 'vitest';
import type { ToolDiffPreviewResponseLike } from 'irises-extension-sdk/plugin';
import { layoutCompactDiffPreview } from '../extensions/console/src/tool-renderers/diff-preview-layout.js';

function createPreview(diff: string): ToolDiffPreviewResponseLike {
  return {
    toolName: 'write_file',
    title: 'Diff 审批',
    toolLabel: 'write_file',
    summary: [],
    items: [{
      filePath: 'demo.ts',
      label: 'demo.ts · 修改',
      diff,
      added: 3,
      removed: 0,
    }],
  };
}

describe('console diff preview layout', () => {
  it('maxLines 恰好卡在完整行边界时，仍统计后续被截断的行', () => {
    const layout = layoutCompactDiffPreview({
      preview: createPreview([
        '--- a/demo.ts',
        '+++ b/demo.ts',
        '@@ -1,3 +1,6 @@',
        ' one',
        ' two',
        ' three',
        '+four',
        '+five',
        '+six',
      ].join('\n')),
      terminalWidth: 120,
      maxItems: 3,
      maxLines: 4,
      hunkStatuses: [],
    });

    expect(layout).toBeDefined();
    expect(layout?.rows).toHaveLength(4);
    expect(layout?.hiddenItems).toBe(0);
    expect(layout?.hiddenLines).toBe(0);
    expect(layout?.clippedRows).toBe(4);
  });
});
