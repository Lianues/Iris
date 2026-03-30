/** @jsxImportSource @opentui/react */

/**
 * InputDisplay — 带光标的文本渲染组件
 *
 * 将文本分为 光标前 | 光标字符 | 光标后 三段渲染，
 * 光标字符使用反色（背景高亮）模拟终端光标效果。
 *
 * 当光标位于视觉行末尾（即文本恰好填满行宽）时，采用终端标准
 * 行为：光标与最后一个字符重合显示（反色），避免额外占一列导致
 * 意外换行。
 */

import { C } from '../theme';
import { getTextWidth } from '../text-layout';

interface InputDisplayProps {
  value: string
  cursor: number
  availableWidth?: number
  isActive: boolean
  cursorVisible: boolean
  placeholder?: string
  transform?: (value: string) => string
}

export function InputDisplay({ value, cursor, availableWidth, isActive, cursorVisible, placeholder, transform }: InputDisplayProps) {
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
  const rawAt = cursor < display.length ? display[cursor] : ''
  const after = cursor < display.length ? display.slice(cursor + 1) : ''

  // 判断是否需要光标重合：光标在文本末尾、文本非空、且最后一个字符
  // 恰好在视觉行的最后一列（再多一列就会换行）。
  // 此时参照终端行为，让光标反色叠加在最后一个字符上，而非追加空格。
  let overlapEnd = false
  if (!rawAt && before.length > 0 && availableWidth && availableWidth > 0) {
    const lastChar = before[before.length - 1]
    if (lastChar !== '\n') {
      const lastNewline = before.lastIndexOf('\n')
      const lastLine = lastNewline >= 0 ? before.slice(lastNewline + 1) : before
      const w = getTextWidth(lastLine)
      overlapEnd = w > 0 && w % availableWidth === 0
    }
  }

  const displayBefore = overlapEnd ? before.slice(0, -1) : before
  const cursorChar = overlapEnd ? before[before.length - 1] : rawAt
  const atNewline = cursorChar === '\n'

  return (
    <text wrapMode="char">
      <span fg={C.text}>{displayBefore}</span>
      {cursorChar ? (
        atNewline ? (
          <>
            {cursorVisible && <span bg={C.accent} fg={C.cursorFg}>{' '}</span>}
            <span fg={C.text}>{'\n'}</span>
          </>
        ) : (
          cursorVisible
            ? <span bg={C.accent} fg={C.cursorFg}>{cursorChar}</span>
            : <span fg={C.text}>{cursorChar}</span>
        )
      ) : (
        cursorVisible
          ? <span bg={C.accent} fg={C.cursorFg}>{' '}</span>
          : <span>{' '}</span>
      )}
      {after && <span fg={C.text}>{after}</span>}
    </text>
  )
}
