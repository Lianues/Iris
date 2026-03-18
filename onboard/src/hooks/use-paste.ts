/**
 * usePaste — 监听 OpenTUI 的 bracketed paste 事件
 *
 * OpenTUI 的 StdinParser 已原生支持 bracketed paste mode（\x1b[200~ ... \x1b[201~），
 * 解析后通过 keyHandler.emit("paste", PasteEvent) 发出。
 * 此 hook 订阅该事件，将粘贴文本回调给调用方。
 *
 * 实现与 src/platforms/console/hooks/use-paste.ts 保持一致。
 */
import { useEffect, useCallback, useLayoutEffect, useRef } from "react"
import { useAppContext } from "@opentui/react"

export function usePaste(handler: (text: string) => void): void {
  const { keyHandler } = useAppContext()

  // 稳定回调引用（同 useEffectEvent 模式）
  const handlerRef = useRef(handler)
  useLayoutEffect(() => {
    handlerRef.current = handler
  })

  const stableHandler = useCallback(
    // OpenTUI PasteEvent 提供 bytes: Uint8Array，需要先解码为字符串
    (event: { bytes: Uint8Array }) => {
      handlerRef.current(new TextDecoder().decode(event.bytes))
    },
    []
  )

  useEffect(() => {
    keyHandler?.on("paste", stableHandler)
    return () => {
      keyHandler?.off("paste", stableHandler)
    }
  }, [keyHandler])
}
