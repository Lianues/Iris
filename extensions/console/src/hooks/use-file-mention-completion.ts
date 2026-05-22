import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterFileMentionCandidates,
  findFileMentionToken,
  type FileMentionCandidate,
  type FileMentionToken,
} from '../file-mention-completion';

export interface UseFileMentionCompletionOptions {
  value: string;
  cursor: number;
  disabled?: boolean;
  onListFiles?: () => readonly string[] | Promise<readonly string[]>;
}

export interface FileMentionCompletionState {
  token: FileMentionToken | null;
  candidates: FileMentionCandidate[];
  loading: boolean;
}

export function useFileMentionCompletion(options: UseFileMentionCompletionOptions): FileMentionCompletionState {
  const { value, cursor, disabled, onListFiles } = options;
  const [files, setFiles] = useState<readonly string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const token = useMemo(() => {
    if (disabled || !onListFiles) return null;
    return findFileMentionToken(value, cursor);
  }, [cursor, disabled, onListFiles, value]);

  useEffect(() => {
    if (!token || files) return;

    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);

    Promise.resolve()
      .then(() => onListFiles?.() ?? [])
      .then((nextFiles) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setFiles(nextFiles);
      })
      .catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setFiles([]);
      })
      .finally(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [files, onListFiles, token]);

  const candidates = useMemo(() => {
    if (!token || !files) return [];
    return filterFileMentionCandidates(files, token.query);
  }, [files, token]);

  return { token, candidates, loading };
}
