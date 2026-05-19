import type { ToolDiffPreviewResponseLike } from 'irises-extension-sdk';

interface ResultWithUiPreview {
  __ui?: {
    diffPreview?: ToolDiffPreviewResponseLike;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isDiffPreviewResponse(value: unknown): value is ToolDiffPreviewResponseLike {
  return isRecord(value)
    && typeof value.toolName === 'string'
    && Array.isArray(value.items);
}

export function extractResultDiffPreview(result: unknown): ToolDiffPreviewResponseLike | undefined {
  if (!isRecord(result)) return undefined;
  const diffPreview = (result as ResultWithUiPreview).__ui?.diffPreview;
  return isDiffPreviewResponse(diffPreview) ? diffPreview : undefined;
}

export function attachResultDiffPreview(
  result: unknown,
  preview: ToolDiffPreviewResponseLike | undefined,
): unknown {
  if (!preview || !isRecord(result) || extractResultDiffPreview(result)) return result;

  const existingUi = isRecord((result as ResultWithUiPreview).__ui)
    ? (result as ResultWithUiPreview).__ui as Record<string, unknown>
    : {};

  const withUi: Record<string, unknown> = { ...result };
  Object.defineProperty(withUi, '__ui', {
    value: {
      ...existingUi,
      diffPreview: preview,
    },
    enumerable: false,
    configurable: true,
  });
  return withUi;
}
