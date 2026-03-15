/**
 * InputDisplay — 带光标的文本渲染组件
 *
 * 将文本分为 光标前 | 光标字符 | 光标后 三段渲染，
 * 光标字符使用反色（背景高亮）模拟终端光标效果。
 */

interface InputDisplayProps {
  value: string
  cursor: number
  isActive: boolean
  cursorVisible: boolean
  placeholder?: string
  /** 对 value 做显示转换（如掩码），但光标位置不变 */
  transform?: (value: string) => string
}

export function InputDisplay({ value, cursor, isActive, cursorVisible, placeholder, transform }: InputDisplayProps) {
  const display = transform ? transform(value) : value

  if (!display && !isActive) {
    return <text fg="#636e72">{placeholder || ""}</text>
  }

  if (!display) {
    // 空值 + 活跃：光标 + placeholder
    return (
      <text>
        {cursorVisible && <span bg="#00b894" fg="#1e1e1e">{" "}</span>}
        {!cursorVisible && <span fg="#00b894">{" "}</span>}
        {placeholder && <span fg="#636e72">{` ${placeholder}`}</span>}
      </text>
    )
  }

  if (!isActive) {
    return <text fg="#b2bec3">{display}</text>
  }

  // 活跃：分三段，光标位置用反色
  const before = display.slice(0, cursor)
  const at = cursor < display.length ? display[cursor] : ""
  const after = cursor < display.length ? display.slice(cursor + 1) : ""

  return (
    <text>
      <span fg="#dfe6e9">{before}</span>
      {at ? (
        cursorVisible
          ? <span bg="#00b894" fg="#1e1e1e">{at}</span>
          : <span fg="#dfe6e9">{at}</span>
      ) : (
        cursorVisible
          ? <span bg="#00b894" fg="#1e1e1e">{" "}</span>
          : <span>{" "}</span>
      )}
      {after && <span fg="#dfe6e9">{after}</span>}
    </text>
  )
}
