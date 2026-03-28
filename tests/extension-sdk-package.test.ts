import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension sdk package', () => {
  it('package.json 应面向 dist 产物导出，并具备独立构建脚本', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'packages/extension-sdk/package.json'), 'utf8'),
    ) as {
      name?: string;
      type?: string;
      main?: string;
      types?: string;
      files?: string[];
      exports?: Record<string, any>;
      scripts?: Record<string, string>;
      publishConfig?: { access?: string };
    };

    expect(packageJson.name).toBe('@irises/extension-sdk');
    expect(packageJson.type).toBe('module');
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.files).toContain('dist');
    expect(packageJson.exports?.['.']?.import).toBe('./dist/index.js');
    expect(packageJson.exports?.['./plugin']?.import).toBe('./dist/plugin.js');
    expect(packageJson.exports?.['./pairing']?.import).toBe('./dist/pairing/index.js');
    expect(packageJson.scripts?.build).toBeTruthy();
    expect(packageJson.publishConfig?.access).toBe('public');
  });
});
