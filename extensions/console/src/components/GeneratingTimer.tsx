/** @jsxImportSource @opentui/react */

/**
 * 生成计时器
 */

import React, { useState, useEffect, useRef } from 'react';
import { Spinner } from './Spinner';
import { C } from '../theme';

export interface RetryInfo {
  attempt: number;
  maxRetries: number;
  error: string;
}

interface GeneratingTimerProps {
  isGenerating: boolean;
  retryInfo?: RetryInfo | null;
}

export function GeneratingTimer({ isGenerating, retryInfo }: GeneratingTimerProps) {
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

  if (retryInfo) {
    // 简短错误摘要：取第一行、截断到 60 字符
    const briefError = (retryInfo.error || '').split('\n')[0].slice(0, 60);
    return (
      <box flexDirection="column">
        <text>
          <Spinner />
          <span fg={C.warn}><em>{` retrying (${retryInfo.attempt}/${retryInfo.maxRetries})... (${time}s)`}</em></span>
        </text>
        <text fg={C.dim}>{`  └ ${briefError}`}</text>
      </box>
    );
  }

  return (
    <text>
      <Spinner />
      <span fg={C.dim}><em>{` generating... (${time}s)`}</em></span>
    </text>
  );
}
