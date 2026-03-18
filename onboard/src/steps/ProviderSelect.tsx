import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { PROVIDER_LABELS } from "../utils/config-writer.js"
import { gracefulExit } from "../index.js"

const PROVIDERS = [
  { value: "gemini", label: "Google Gemini", desc: "Google AI Studio / Vertex AI" },
  { value: "openai-compatible", label: "OpenAI Compatible", desc: "任何兼容 OpenAI Chat Completions 的 API" },
  { value: "claude", label: "Anthropic Claude", desc: "Anthropic 官方 API" },
  { value: "openai-responses", label: "OpenAI Responses", desc: "OpenAI Responses API 格式" },
] as const

interface ProviderSelectProps {
  onSelect: (provider: string) => void
  onSkip: () => void
  onBack: () => void
}

export function ProviderSelect({ onSelect, onSkip, onBack }: ProviderSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useKeyboard((key) => {
    if (key.name === "n" && key.ctrl) {
      onSkip()
    }
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1))
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1))
    }
    if (key.name === "return") {
      onSelect(PROVIDERS[selectedIndex].value)
    }
    if (key.name === "escape") {
      onBack()
    }
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      gracefulExit()
    }
  })

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg="#6c5ce7">
        <b>① 选择 LLM 提供商</b>
      </text>
      <text fg="#636e72">使用 ↑↓ 选择，Enter 确认，Ctrl+N 跳过此环节，Esc 返回</text>

      <box flexDirection="column" gap={0}>
        {PROVIDERS.map((p, i) => {
          const isSelected = i === selectedIndex
          return (
            <box key={p.value} paddingLeft={1}>
              <text>
                <span fg={isSelected ? "#00b894" : "#636e72"}>
                  {isSelected ? "❯ " : "  "}
                </span>
                <span fg={isSelected ? "#dfe6e9" : "#b2bec3"}>
                  {isSelected ? <b>{p.label}</b> : p.label}
                </span>
                <span fg="#636e72">{`  ${p.desc}`}</span>
              </text>
            </box>
          )
        })}
      </box>
    </box>
  )
}
