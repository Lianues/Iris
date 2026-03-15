/**
 * 生成计时器
 */

import React, { useState, useEffect, useRef } from 'react';
import { Spinner } from './Spinner';
import { C } from '../theme';

interface GeneratingTimerProps {
  isGenerating: boolean;
}

export function GeneratingTimer({ isGenerating }: GeneratingTimerProps) {
  const [time, setTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isGenerating) {
      setTime(0);
      timerRef.current = setInterval(() => {
        setTime(t => +(t + 0.1).toFixed(1));
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isGenerating]);

  if (!isGenerating) return null;

  return (
    <text>
      <Spinner />
      <span fg={C.dim}><em>{` generating... (${time}s)`}</em></span>
    </text>
  );
}
