import { useMemo } from 'react';
import { attachResultDiffPreview, extractResultDiffPreview } from './diff-preview-meta.js';

export function useResultWithResolvedDiffPreview(result: unknown): unknown {
  const embeddedDiffPreview = useMemo(() => (
    result != null ? extractResultDiffPreview(result) : undefined
  ), [result]);
  return useMemo(() => attachResultDiffPreview(result, embeddedDiffPreview), [result, embeddedDiffPreview]);
}
