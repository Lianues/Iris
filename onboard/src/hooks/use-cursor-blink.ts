/**
 * useCursorBlink — 闪动光标 hook
 *
 * 返回当前是否显示光标的布尔值，以固定间隔交替切换。
 */
import { useState, useEffect } from "react"

export function useCursorBlink(intervalMs = 530): boolean {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((v) => !v)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return visible
}
