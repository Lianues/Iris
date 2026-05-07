/** @jsxImportSource @opentui/react */

/**
 * 加载指示器
 *
 * 返回 <span> 而非 <text>，以便可以嵌套在 <text> 内部使用。
 * 单独使用时用 <text><Spinner /></text> 包裹。
 */

import React, { useState, useEffect, useRef } from 'react';
import { C } from '../theme';
import { SPINNER_FRAMES as FRAMES, SPINNER_INTERVAL_MS } from '../terminal-compat';

interface SpinnerProps {
  color?: string;
  frames?: readonly string[];
  intervalMs?: number;
}

export function Spinner({ color = C.accent, frames = FRAMES, intervalMs = SPINNER_INTERVAL_MS }: SpinnerProps) {
  const [frame, setFrame] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const timer = setInterval(() => {
      if (mountedRef.current) {
        setFrame(f => (f + 1) % frames.length);
      }
    }, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [frames, intervalMs]);

  return <span fg={color}>{frames[frame % frames.length]}</span>;
}
