import { useCallback, useEffect, useRef, useState } from 'react';

interface UseExitConfirmOptions {
  timeoutMs?: number;
}

export function useExitConfirm({ timeoutMs = 1500 }: UseExitConfirmOptions = {}) {
  const [exitConfirmArmed, setExitConfirmArmed] = useState(false);
  const exitConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExitConfirm = useCallback(() => {
    if (exitConfirmTimerRef.current) {
      clearTimeout(exitConfirmTimerRef.current);
      exitConfirmTimerRef.current = null;
    }
    setExitConfirmArmed(false);
  }, []);

  const armExitConfirm = useCallback(() => {
    if (exitConfirmTimerRef.current) clearTimeout(exitConfirmTimerRef.current);
    setExitConfirmArmed(true);
    exitConfirmTimerRef.current = setTimeout(() => {
      exitConfirmTimerRef.current = null;
      setExitConfirmArmed(false);
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    return () => {
      if (exitConfirmTimerRef.current) clearTimeout(exitConfirmTimerRef.current);
    };
  }, []);

  return {
    exitConfirmArmed,
    clearExitConfirm,
    armExitConfirm,
  };
}
