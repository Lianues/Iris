import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findDisallowedBareRuntimeImports,
} from '../script/extension-bundle-validation';

interface EmbeddedExtensionConfig {
  name: string;
  external?: string[];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function getEmbeddedExtensionConfigs(): EmbeddedExtensionConfig[] {
  const embeddedJson = readJson<{ extensions?: EmbeddedExtensionConfig[] }>(
    path.resolve(process.cwd(), 'extensions', 'embedded.json'),
  );
  return embeddedJson.extensions ?? [];
}

function extractRepeatedOptionValues(command: string, optionName: string): string[] {
  const values: string[] = [];
  const regex = new RegExp(`${optionName}(?:=|\\s+)([^\\s]+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    values.push(match[1]);
  }
  return values.sort();
}

function readExtensionPackageJson(name: string): {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
} {
  return readJson(path.resolve(process.cwd(), 'extensions', name, 'package.json'));
}

function normalizeList(values: string[] | undefined): string[] {
  return [...(values ?? [])].sort();
}

describe('extension bundle validation', () => {
  it('detects non-external bare ESM imports while allowing node, relative, and external imports', () => {
    const content = `
      import fs from 'node:fs';
      import local from './local.js';
      import opentui from '@opentui/core';
      const crypto = await import('node:crypto');
      const sdk = await import('@modelcontextprotocol/sdk/client');
      const ajv = await import('ajv');
    `;

    const violations = findDisallowedBareRuntimeImports(content, {
      allowedBarePackages: ['@opentui/core'],
    });

    expect(violations).toEqual([
      { specifier: '@modelcontextprotocol/sdk/client', packageName: '@modelcontextprotocol/sdk' },
      { specifier: 'ajv', packageName: 'ajv' },
    ]);
  });

  it('embedded extension build scripts must bundle packages and declare allowed externals consistently', () => {
    for (const extension of getEmbeddedExtensionConfigs()) {
      const packageJson = readExtensionPackageJson(extension.name);
      const buildScript = packageJson.scripts?.build ?? '';
      const expectedExternal = normalizeList(extension.external);

      expect(buildScript, `${extension.name} build should force dependency bundling`).toContain('--packages=bundle');
      expect(buildScript, `${extension.name} build should validate bundle runtime imports`).toContain('validate-extension-bundle.ts');

      const buildExternal = extractRepeatedOptionValues(buildScript, '--external');
      const validationAllow = extractRepeatedOptionValues(buildScript, '--allow');

      expect(buildExternal, `${extension.name} package build external list should match embedded.json`).toEqual(expectedExternal);
      expect(validationAllow, `${extension.name} bundle validation allow list should match embedded.json`).toEqual(expectedExternal);
    }
  });

  it('embedded extension dist bundles should not retain non-external bare ESM imports', () => {
    for (const extension of getEmbeddedExtensionConfigs()) {
      const bundlePath = path.resolve(process.cwd(), 'extensions', extension.name, 'dist', 'index.mjs');
      if (!fs.existsSync(bundlePath)) continue;

      const violations = findDisallowedBareRuntimeImports(fs.readFileSync(bundlePath, 'utf8'), {
        allowedBarePackages: extension.external,
      });

      expect(violations, `${extension.name} dist/index.mjs should only reference explicit externals`).toEqual([]);
    }
  });

  it('mcp extension build must bundle dependencies and pin the MCP SDK version', () => {
    const extensionDir = path.resolve(process.cwd(), 'extensions', 'mcp');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string>; dependencies?: Record<string, string> };
    const packageLock = JSON.parse(
      fs.readFileSync(path.join(extensionDir, 'package-lock.json'), 'utf8'),
    ) as { packages?: Record<string, { version?: string; dependencies?: Record<string, string> }> };

    const buildScript = packageJson.scripts?.build ?? '';
    const sdkVersion = packageJson.dependencies?.['@modelcontextprotocol/sdk'];

    expect(buildScript).toContain('--packages=bundle');
    expect(buildScript).toContain('validate-extension-bundle.ts');
    expect(sdkVersion).toBe('1.29.0');
    expect(sdkVersion).not.toMatch(/^[~^]/);
    expect(packageLock.packages?.['']?.dependencies?.['@modelcontextprotocol/sdk']).toBe(sdkVersion);
    expect(packageLock.packages?.['node_modules/@modelcontextprotocol/sdk']?.version).toBe(sdkVersion);
  });
});
