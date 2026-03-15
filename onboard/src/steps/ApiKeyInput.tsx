import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { PROVIDER_LABELS, PROVIDER_DEFAULTS } from "../utils/config-writer.js"
import { usePaste } from "../hooks/use-paste.js"
import { useCursorBlink } from "../hooks/use-cursor-blink.js"
import { useTextInput } from "../hooks/use-text-input.js"
import { InputDisplay } from "../components/InputDisplay.js"
import { gracefulExit } from "../index.js"

interface ApiKeyInputProps {
  provider: string
  onSubmit: (apiKey: string, baseUrl: string) => void
  onBack: () => void
}

type Field = "apiKey" | "baseUrl"

export function ApiKeyInput({ provider, onSubmit, onBack }: ApiKeyInputProps) {
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini
  const [apiKeyState, apiKeyActions] = useTextInput("")
  const [baseUrlState, baseUrlActions] = useTextInput(defaults.baseUrl)
  const [showKey, setShowKey] = useState(false)
  const [activeField, setActiveField] = useState<Field>("apiKey")
  const cursorVisible = useCursorBlink()

  const inputs = {
    apiKey: { state: apiKeyState, actions: apiKeyActions },
    baseUrl: { state: baseUrlState, actions: baseUrlActions },
  }
  const fieldOrder: Field[] = ["apiKey", "baseUrl"]

  useKeyboard((key) => {
    const { actions } = inputs[activeField]

    // ── 字段切换：Tab / 上下方向键 ──
    // 上下键只在非左右操作时用于字段切换
    if (key.name === "tab" || key.name === "down") {
      const idx = fieldOrder.indexOf(activeField)
      setActiveField(fieldOrder[(idx + 1) % fieldOrder.length])
      return
    }
    if (key.name === "up") {
      const idx = fieldOrder.indexOf(activeField)
      setActiveField(fieldOrder[(idx - 1 + fieldOrder.length) % fieldOrder.length])
      return
    }

    if (key.name === "return") {
      if (apiKeyState.value.trim().length > 0 && baseUrlState.value.trim().length > 0) {
        onSubmit(apiKeyState.value.trim(), baseUrlState.value.trim())
      }
      return
    }

    if (key.name === "escape") {
      onBack()
      return
    }

    if (key.name === "c" && key.ctrl) {
      gracefulExit()
      return
    }

    if (key.name === "h" && key.ctrl) {
      setShowKey((s) => !s)
      return
    }

    // 委托给 useTextInput 处理（左右移动、编辑、字符输入等）
    actions.handleKey(key)
  })

  // 粘贴支持
  usePaste((text) => {
    const cleaned = text.replace(/[\r\n]/g, "").trim()
    if (cleaned.length > 0) {
      inputs[activeField].actions.insert(cleaned)
    }
  })

  const maskValue = (v: string) =>
    v.length === 0 ? "" : v.slice(0, 4) + "•".repeat(Math.max(0, v.length - 4))

  const fields = [
    { key: "apiKey" as Field, label: "API Key", state: apiKeyState, masked: true },
    { key: "baseUrl" as Field, label: "Base URL", state: baseUrlState, masked: false },
  ]

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg="#6c5ce7" decoration="bold">
        ② 输入 API 凭证
      </text>
      <text fg="#636e72">
        {`提供商: ${PROVIDER_LABELS[provider] || provider}`}
      </text>

      <box flexDirection="column" gap={1}>
        {fields.map((f) => {
          const isActive = f.key === activeField
          return (
            <box key={f.key} flexDirection="column">
              <text>
                <span fg={isActive ? "#00b894" : "#636e72"}>{isActive ? "❯ " : "  "}</span>
                <span fg="#dfe6e9">{f.label}:</span>
              </text>
              <box
                borderStyle="single"
                borderColor={isActive ? "#00b894" : f.state.value.length > 0 ? "#6c5ce7" : "#636e72"}
                paddingLeft={1}
                paddingRight={1}
                marginLeft={2}
              >
                <InputDisplay
                  value={f.state.value}
                  cursor={f.state.cursor}
                  isActive={isActive}
                  cursorVisible={cursorVisible}
                  placeholder={`输入 ${f.label}...`}
                  transform={f.masked && !showKey ? maskValue : undefined}
                />
              </box>
            </box>
          )
        })}
      </box>

      <text fg="#636e72">↑↓ 切换字段  |  Ctrl+H 显示/隐藏 Key  |  Enter 确认  |  Esc 返回</text>
    </box>
  )
}
