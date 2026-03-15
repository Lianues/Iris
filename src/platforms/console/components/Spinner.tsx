/**
 * 加载指示器
 *
 * 返回 <span> 而非 <text>，以便可以嵌套在 <text> 内部使用。
 * 单独使用时用 <text><Spinner /></text> 包裹。
 */

import React, { useState, useEffect, useRef } from 'react';
import { C } from '../theme';

const FRAMES = ['\u00b7  ', '\u00b7\u00b7 ', '\u00b7\u00b7\u00b7', ' \u00b7\u00b7', '  \u00b7'];
const INTERVAL = 120;

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
