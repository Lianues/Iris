/**
 * useCursorBlink — 闪动光标 hook
 */
import { useState, useEffect } from 'react';

export function useCursorBlink(intervalMs = 530): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((v) => !v);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return visible;
}
