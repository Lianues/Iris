const LINE_HIGHLIGHT_PATTERN = /\{([\d,\s-]+)\}/

export function parseLineHighlights(info: string): Set<number> | null {
  const match = LINE_HIGHLIGHT_PATTERN.exec(info)
  if (!match) return null

  const result = new Set<number>()
  const parts = match[1].split(',')

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const rangeSep = trimmed.indexOf('-')
    if (rangeSep !== -1) {
      const start = parseInt(trimmed.slice(0, rangeSep), 10)
      const end = parseInt(trimmed.slice(rangeSep + 1), 10)
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        for (let i = start; i <= end; i++) {
          result.add(i)
        }
      }
    } else {
      const num = parseInt(trimmed, 10)
      if (!Number.isNaN(num)) {
        result.add(num)
      }
    }
  }

  return result.size > 0 ? result : null
}
