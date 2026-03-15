/**
 * InputDisplay — 带光标的文本渲染组件
 *
 * 将文本分为 光标前 | 光标字符 | 光标后 三段渲染，
 * 光标字符使用反色（背景高亮）模拟终端光标效果。
 */

import { C } from '../theme';

interface InputDisplayProps {
  value: string
  cursor: number
  isActive: boolean
  cursorVisible: boolean
  placeholder?: string
  transform?: (value: string) => string
}

export function InputDisplay({ value, cursor, isActive, cursorVisible, placeholder, transform }: InputDisplayProps) {
  const display = transform ? transform(value) : value

  if (!display && !isActive) {
    return <text fg={C.dim}>{placeholder || ''}</text>
  }

  if (!display) {
    return (
      <text>
        {cursorVisible && <span bg={C.accent} fg={C.cursorFg}>{' '}</span>}
        {!cursorVisible && <span fg={C.accent}>{' '}</span>}
        {placeholder && <span fg={C.dim}>{` ${placeholder}`}</span>}
      </text>
    )
  }

  if (!isActive) {
    return <text fg={C.textSec}>{display}</text>
  }

  const before = display.slice(0, cursor)
  const at = cursor < display.length ? display[cursor] : ''
  const after = cursor < display.length ? display.slice(cursor + 1) : ''

  return (
    <text>
      <span fg={C.text}>{before}</span>
      {at ? (
        cursorVisible
          ? <span bg={C.accent} fg={C.cursorFg}>{at}</span>
          : <span fg={C.text}>{at}</span>
      ) : (
        cursorVisible
          ? <span bg={C.accent} fg={C.cursorFg}>{' '}</span>
          : <span>{' '}</span>
      )}
      {after && <span fg={C.text}>{after}</span>}
    </text>
  )
}
