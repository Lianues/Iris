/** @jsxImportSource @opentui/react */

/**
 * 加载指示器
 *
 * 返回 <span> 而非 <text>，以便可以嵌套在 <text> 内部使用。
 * 单独使用时用 <text><Spinner /></text> 包裹。
 */

import React, { useState, useEffect, useRef } from 'react';
import { C } from '../theme';

const FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
const INTERVAL = 80;

export function Spinner() {
  const [frame, setFrame] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    const timer = setInterval(() => {
      if (mountedRef.current) {
        setFrame(f => (f + 1) % FRAMES.length);
      }
    }, INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  return <span fg={C.accent}>{FRAMES[frame]}</span>;
}
