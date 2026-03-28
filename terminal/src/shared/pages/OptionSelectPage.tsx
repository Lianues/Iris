import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { gracefulExit } from "../runtime.js"
import { PageFrame } from "./PageFrame.js"

export interface OptionSelectItem {
  value: string
  label: string
  description?: string
}

interface OptionSelectPageProps {
  title: string
  description?: string
  options: OptionSelectItem[]
  onSelect: (value: string) => void
  onSkip?: () => void
  onBack?: () => void
  maxVisibleOptions?: number
  initialSelectedIndex?: number
}

function getCharacterDisplayWidth(char: string): number {
  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char)
    ? 2
    : 1
}

function getWrapWidth(indentWidth: number): number {
  const terminalWidth = typeof process.stdout.columns === "number" && process.stdout.columns > 0
    ? process.stdout.columns
    : 80
  return Math.max(8, terminalWidth - indentWidth)
}

function wrapTextByDisplayWidth(input: string, maxWidth: number): string[] {
  if (!input) return [""]
  if (maxWidth <= 0) return [input]

  const lines: string[] = []

  for (const rawLine of input.split(/\r?\n/)) {
    if (!rawLine) {
      lines.push("")
      continue
    }

    let current = ""
    let currentWidth = 0

    for (const char of rawLine) {
      const charWidth = getCharacterDisplayWidth(char)
      if (currentWidth + charWidth > maxWidth && current.length > 0) {
        lines.push(current)
        current = char
        currentWidth = charWidth
        continue
      }

      current += char
      currentWidth += charWidth
    }

    lines.push(current)
  }

  return lines.length > 0 ? lines : [""]
}

export function OptionSelectPage({
  title,
  description,
  options,
  onSelect,
  onSkip,
  onBack,
  maxVisibleOptions = 7,
  initialSelectedIndex = 0,
}: OptionSelectPageProps) {
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex)

  let scrollStart = 0
  if (options.length > maxVisibleOptions) {
    scrollStart = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisibleOptions / 2), options.length - maxVisibleOptions))
  }
  const visibleOptions = options.slice(scrollStart, scrollStart + maxVisibleOptions)
  const labelWrapWidth = getWrapWidth(4)
  const descriptionWrapWidth = getWrapWidth(6)

  useKeyboard((key) => {
    if (key.name === "n" && key.ctrl) {
      onSkip?.()
      return
    }

    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((index) => Math.max(0, index - 1))
      return
    }

    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((index) => Math.min(options.length - 1, index + 1))
      return
    }

    if (key.name === "return") {
      const selected = options[selectedIndex]
      if (selected) {
        onSelect(selected.value)
      }
      return
    }

    if (key.name === "escape") {
      onBack?.()
      return
    }

    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      gracefulExit()
    }
  })

  return (
    <PageFrame
      title={title}
      description={description}
      actions={[
        "↑↓ 选择",
        "Enter 确认",
        onSkip ? "Ctrl+N 跳过此环节" : undefined,
        onBack ? "Esc 返回" : undefined,
      ]}
    >
      <box flexDirection="column" gap={0}>
        {scrollStart > 0 && (
          <text fg="#636e72">{`↑ 上方还有 ${scrollStart} 项`}</text>
        )}

        {visibleOptions.map((option, index) => {
          const realIndex = scrollStart + index
          const isSelected = realIndex === selectedIndex
          const labelLines = wrapTextByDisplayWidth(option.label, labelWrapWidth)
          const descriptionLines = option.description
            ? wrapTextByDisplayWidth(option.description, descriptionWrapWidth)
            : []

          return (
            <box key={option.value} flexDirection="column" paddingLeft={1}>
              {labelLines.map((line, lineIndex) => (
                <text key={`${option.value}-label-${lineIndex}`} fg={isSelected ? "#dfe6e9" : "#b2bec3"}>
                  {lineIndex === 0
                    ? `${isSelected ? "❯ " : "  "}${line}`
                    : `  ${line}`}
                </text>
              ))}
              {descriptionLines.map((line, lineIndex) => (
                <text key={`${option.value}-description-${lineIndex}`} fg="#636e72">
                  {`    ${line}`}
                </text>
              ))}
            </box>
          )
        })}

        {scrollStart + maxVisibleOptions < options.length && (
          <text fg="#636e72">{`↓ 下方还有 ${options.length - scrollStart - maxVisibleOptions} 项`}</text>
        )}
      </box>
    </PageFrame>
  )
}
