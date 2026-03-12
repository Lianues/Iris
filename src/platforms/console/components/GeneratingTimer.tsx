/**
 * 生成计时器 - 独立组件，自管理 state
 *
 * 将计时逻辑封装在此组件内部，避免每 100ms 触发 App 根组件重渲染。
 */

import React, { useState, useEffect, useRef } from 'react';
import { Text } from 'ink';
import { Spinner } from './Spinner';

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
    <Text>
      <Spinner />
      <Text dimColor italic> generating... ({time}s)</Text>
    </Text>
  );
}
