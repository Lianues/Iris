/**
 * usePaste — 监听 OpenTUI 的 bracketed paste 事件
 *
 * OpenTUI 的 StdinParser 已原生支持 bracketed paste mode（\x1b[200~ ... \x1b[201~），
 * 解析后通过 keyHandler.emit("paste", PasteEvent) 发出。
 * 此 hook 订阅该事件，将粘贴文本回调给调用方。
 */
import { useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { decodePasteBytes, type PasteEvent } from '@opentui/core';
import { useAppContext } from '@opentui/react';

export function usePaste(handler: (text: string) => void): void {
  const { keyHandler } = useAppContext();

  // 稳定回调引用（同 useEffectEvent 模式）
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  const stableHandler = useCallback(
    (event: PasteEvent) => {
      handlerRef.current(decodePasteBytes(event.bytes));
    },
    [],
  );

  useEffect(() => {
    (keyHandler as any)?.on('paste', stableHandler);
    return () => {
      (keyHandler as any)?.off('paste', stableHandler);
    };
  }, [keyHandler, stableHandler]);
}
