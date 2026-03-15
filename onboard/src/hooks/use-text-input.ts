/**
 * useTextInput — 带光标位置的文本输入状态管理
 *
 * 支持：
 * - 左右方向键移动光标
 * - Ctrl+Left / Ctrl+Right 按词跳转
 * - Home / Ctrl+A 跳到行首
 * - End / Ctrl+E 跳到行尾
 * - Backspace 删除光标前字符
 * - Delete / Ctrl+D 删除光标后字符
 * - Ctrl+U 清除到行首
 * - Ctrl+K 清除到行尾
 * - 任意位置插入字符 / 粘贴文本
 */
import { useState, useCallback } from "react"

export interface TextInputState {
  value: string
  cursor: number
}

export interface TextInputActions {
  /** 处理一次按键，返回 true 表示已消费 */
  handleKey: (key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean }) => boolean
  /** 在光标处插入文本（用于粘贴） */
  insert: (text: string) => void
  /** 直接设置整个值（光标移到末尾） */
  setValue: (value: string) => void
  /** 直接替换值和光标 */
  set: (value: string, cursor: number) => void
}

/**
 * 找到光标左侧的词边界位置
 */
function wordBoundaryLeft(text: string, pos: number): number {
  if (pos <= 0) return 0
  let i = pos - 1
  // 先跳过非词字符（空格、标点等）
  while (i > 0 && !/[a-zA-Z0-9_\-.]/.test(text[i])) i--
  // 再跳过词字符
  while (i > 0 && /[a-zA-Z0-9_\-.]/.test(text[i - 1])) i--
  return i
}

/**
 * 找到光标右侧的词边界位置
 */
function wordBoundaryRight(text: string, pos: number): number {
  const len = text.length
  if (pos >= len) return len
  let i = pos
  // 先跳过词字符
  while (i < len && /[a-zA-Z0-9_\-.]/.test(text[i])) i++
  // 再跳过非词字符
  while (i < len && !/[a-zA-Z0-9_\-.]/.test(text[i])) i++
  return i
}

export function useTextInput(initialValue = ""): [TextInputState, TextInputActions] {
  const [state, setState] = useState<TextInputState>({
    value: initialValue,
    cursor: initialValue.length,
  })

  const handleKey = useCallback(
    (key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean }): boolean => {
      setState((s) => {
        const { value, cursor } = s

        // ── 光标移动 ──

        if (key.name === "left" && !key.ctrl && !key.meta) {
          return { value, cursor: Math.max(0, cursor - 1) }
        }

        if (key.name === "right" && !key.ctrl && !key.meta) {
          return { value, cursor: Math.min(value.length, cursor + 1) }
        }

        // Ctrl+Left: 词跳转
        if (key.name === "left" && (key.ctrl || key.meta)) {
          return { value, cursor: wordBoundaryLeft(value, cursor) }
        }

        // Ctrl+Right: 词跳转
        if (key.name === "right" && (key.ctrl || key.meta)) {
          return { value, cursor: wordBoundaryRight(value, cursor) }
        }

        // Home / Ctrl+A: 行首
        if (key.name === "home" || (key.name === "a" && key.ctrl)) {
          return { value, cursor: 0 }
        }

        // End / Ctrl+E: 行尾
        if (key.name === "end" || (key.name === "e" && key.ctrl)) {
          return { value, cursor: value.length }
        }

        // ── 删除 ──

        if (key.name === "backspace") {
          if (cursor === 0) return s
          if (key.ctrl || key.meta) {
            // Ctrl+Backspace: 删除到词首
            const to = wordBoundaryLeft(value, cursor)
            return { value: value.slice(0, to) + value.slice(cursor), cursor: to }
          }
          return {
            value: value.slice(0, cursor - 1) + value.slice(cursor),
            cursor: cursor - 1,
          }
        }

        if (key.name === "delete" || (key.name === "d" && key.ctrl)) {
          if (cursor >= value.length) return s
          return {
            value: value.slice(0, cursor) + value.slice(cursor + 1),
            cursor,
          }
        }

        // Ctrl+U: 清除到行首
        if (key.name === "u" && key.ctrl) {
          return { value: value.slice(cursor), cursor: 0 }
        }

        // Ctrl+K: 清除到行尾
        if (key.name === "k" && key.ctrl) {
          return { value: value.slice(0, cursor), cursor }
        }

        // ── 字符输入 ──
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          return {
            value: value.slice(0, cursor) + key.sequence + value.slice(cursor),
            cursor: cursor + 1,
          }
        }

        return s
      })

      // 判断是否被消费
      if (key.name === "left" || key.name === "right" || key.name === "home" || key.name === "end") return true
      if (key.name === "backspace" || key.name === "delete") return true
      if ((key.name === "a" || key.name === "e" || key.name === "u" || key.name === "k" || key.name === "d") && key.ctrl) return true
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) return true

      return false
    },
    []
  )

  const insert = useCallback((text: string) => {
    setState((s) => ({
      value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor),
      cursor: s.cursor + text.length,
    }))
  }, [])

  const setValue = useCallback((value: string) => {
    setState({ value, cursor: value.length })
  }, [])

  const set = useCallback((value: string, cursor: number) => {
    setState({ value, cursor: Math.min(cursor, value.length) })
  }, [])

  return [state, { handleKey, insert, setValue, set }]
}
