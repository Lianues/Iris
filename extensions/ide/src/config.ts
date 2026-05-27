import type { IdeConfig } from './types.js';

const DEFAULT_CONFIG: IdeConfig = {
  enabled: true,
  autoConnect: false,
  context: {
    enabled: true,
    maxSelectedChars: 12_000,
    includeOpenedFile: true,
  },
  compatibility: {
    claudeCodeLockfiles: false,
  },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function parseIdeConfig(raw: unknown): IdeConfig {
  const root = asRecord(raw) ?? {};
  const context = asRecord(root.context) ?? {};
  const compatibility = asRecord(root.compatibility) ?? {};
  const lockDir = typeof root.lockDir === 'string' && root.lockDir.trim()
    ? root.lockDir.trim()
    : undefined;

  return {
    enabled: asBoolean(root.enabled, DEFAULT_CONFIG.enabled),
    autoConnect: asBoolean(root.autoConnect, DEFAULT_CONFIG.autoConnect),
    lockDir,
    context: {
      enabled: asBoolean(context.enabled, DEFAULT_CONFIG.context.enabled),
      maxSelectedChars: asPositiveInteger(context.maxSelectedChars, DEFAULT_CONFIG.context.maxSelectedChars),
      includeOpenedFile: asBoolean(context.includeOpenedFile, DEFAULT_CONFIG.context.includeOpenedFile),
    },
    compatibility: {
      claudeCodeLockfiles: asBoolean(
        compatibility.claudeCodeLockfiles,
        DEFAULT_CONFIG.compatibility.claudeCodeLockfiles,
      ),
    },
  };
}
