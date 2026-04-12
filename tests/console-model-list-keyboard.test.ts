import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('console /model keyboard regressions', () => {
  it('模型编辑态的全局 Esc 处理应先取消编辑，而不是直接回到聊天页', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/hooks/use-app-keyboard.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /if \(viewMode === 'model-list'\) \{\s+if \(modelEditingField\) \{\s+resetModelEditing\(\);\s+setModelStatus\(null\);\s+return;\s+\}\s+setViewMode\('chat'\);\s+return;\s+\}/m,
    );
  });

  it('更新当前模型配置后应重新同步 ConsolePlatform 内部保存的当前模型元数据', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/index.ts'),
      'utf8',
    );

    expect(source).toMatch(/if \(wasCurrent\) \{[\s\S]*?const currentInfo = this\.backend\.getCurrentModelInfo\?\.\(\)/m);
    expect(source).toMatch(/if \('contextWindow' in \(currentInfo \?\? \{\}\)\) \{\s+this\.contextWindow = currentInfo\?\.contextWindow;/m);
  });
});
