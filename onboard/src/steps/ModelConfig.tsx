import { useState, useEffect } from "react"
import { useKeyboard } from "@opentui/react"
import { PROVIDER_DEFAULTS, PROVIDER_LABELS } from "../utils/config-writer.js"
import { fetchModelList, type ModelEntry } from "../utils/model-fetcher.js"
import { usePaste } from "../hooks/use-paste.js"
import { useCursorBlink } from "../hooks/use-cursor-blink.js"
import { useTextInput } from "../hooks/use-text-input.js"
import { InputDisplay } from "../components/InputDisplay.js"
import { gracefulExit } from "../index.js"

interface ModelConfigProps {
  provider: string
  apiKey: string
  baseUrl: string
  onSubmit: (config: { model: string; modelName: string }) => void
  onBack: () => void
}

type Field = "modelName" | "model"

export function ModelConfig({ provider, apiKey, baseUrl, onSubmit, onBack }: ModelConfigProps) {
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini

  const [modelState, modelActions] = useTextInput("")
  const [modelNameState, modelNameActions] = useTextInput(provider.replace(/-/g, "_"))
  const [activeField, setActiveField] = useState<Field>("model")
  const cursorVisible = useCursorBlink()

  // ── 模型列表相关状态 ──
  const [allModels, setAllModels] = useState<ModelEntry[]>([])
  const [fetchStatus, setFetchStatus] = useState<"loading" | "done" | "error">("loading")
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)

  // 进入时自动拉取模型列表
  useEffect(() => {
    setFetchStatus("loading")
    fetchModelList(provider, apiKey, baseUrl)
      .then((models) => {
        setAllModels(models)
        setFetchStatus(models.length > 0 ? "done" : "error")
      })
      .catch(() => {
        setAllModels([])
        setFetchStatus("error")
      })
  }, [provider, apiKey, baseUrl])

  // 根据输入过滤建议列表
  const suggestions = modelState.value.trim().length === 0
    ? allModels
    : allModels.filter((m) =>
        m.id.toLowerCase().includes(modelState.value.toLowerCase()) ||
        m.label.toLowerCase().includes(modelState.value.toLowerCase())
      )

  // 确保选中项不越界
  const safeSelection = Math.min(selectedSuggestion, Math.max(0, suggestions.length - 1))

  // 输入变化时重置选中项
  useEffect(() => {
    setSelectedSuggestion(0)
  }, [modelState.value])

  const MAX_VISIBLE = 8

  useKeyboard((key) => {
    const currentActions = activeField === "model" ? modelActions : modelNameActions

    // ── Tab 切换字段 ──
    if (key.name === "tab") {
      setActiveField((f) => (f === "model" ? "modelName" : "model"))
      return
    }

    // ── 模型 ID 字段：上下键选择建议 ──
    if (activeField === "model" && suggestions.length > 0) {
      if (key.name === "down") {
        setSelectedSuggestion((i) => Math.min(suggestions.length - 1, i + 1))
        return
      }
      if (key.name === "up") {
        setSelectedSuggestion((i) => Math.max(0, i - 1))
        return
      }
    }

    // ── 模型别名字段：上下键切换字段 ──
    if (activeField === "modelName") {
      if (key.name === "down" || key.name === "up") {
        setActiveField("model")
        return
      }
    }

    // ── Enter 补全或提交 ──
    if (key.name === "return") {
      if (activeField === "model" && suggestions.length > 0 && modelState.value.trim() !== suggestions[safeSelection]?.id) {
        // 补全选中的建议
        modelActions.setValue(suggestions[safeSelection].id)
        return
      }
      // 提交
      const finalModel = modelState.value.trim() || defaults.model
      const finalName = modelNameState.value.trim() || provider.replace(/-/g, "_")
      if (finalModel) {
        onSubmit({ model: finalModel, modelName: finalName })
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

    // 委托给 useTextInput 处理
    currentActions.handleKey(key)
  })

  // 粘贴支持
  usePaste((text) => {
    const cleaned = text.replace(/[\r\n]/g, "").trim()
    if (cleaned.length > 0) {
      const actions = activeField === "model" ? modelActions : modelNameActions
      actions.insert(cleaned)
    }
  })

  // ── 计算可见的建议窗口 ──
  let scrollStart = 0
  if (suggestions.length > MAX_VISIBLE) {
    scrollStart = Math.max(0, Math.min(safeSelection - Math.floor(MAX_VISIBLE / 2), suggestions.length - MAX_VISIBLE))
  }
  const visibleSuggestions = suggestions.slice(scrollStart, scrollStart + MAX_VISIBLE)

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg="#6c5ce7" decoration="bold">
        ③ 模型配置
      </text>
      <text fg="#636e72">
        {`提供商: ${PROVIDER_LABELS[provider] || provider}`}
      </text>

      {/* ── 模型 ID 输入 + 自动补全 ── */}
      <box flexDirection="column">
        <text>
          <span fg={activeField === "model" ? "#00b894" : "#636e72"}>
            {activeField === "model" ? "❯ " : "  "}
          </span>
          <span fg="#dfe6e9">模型 ID:</span>
          {fetchStatus === "loading" && <span fg="#fdcb6e">{" ⟳ 正在获取模型列表..."}</span>}
          {fetchStatus === "error" && allModels.length === 0 && <span fg="#636e72">{" (手动输入)"}</span>}
        </text>
        <box
          borderStyle="single"
          borderColor={activeField === "model" ? "#00b894" : modelState.value.length > 0 ? "#6c5ce7" : "#636e72"}
          paddingLeft={1}
          paddingRight={1}
          marginLeft={2}
        >
          <InputDisplay
            value={modelState.value}
            cursor={modelState.cursor}
            isActive={activeField === "model"}
            cursorVisible={cursorVisible}
            placeholder={defaults.model ? `${defaults.model} (默认)` : "输入模型 ID..."}
          />
        </box>

        {/* 建议列表 */}
        {activeField === "model" && suggestions.length > 0 && (
          <box flexDirection="column" marginLeft={3} marginTop={0}>
            {scrollStart > 0 && (
              <text fg="#636e72">{`  ↑ 还有 ${scrollStart} 项...`}</text>
            )}
            {visibleSuggestions.map((s, i) => {
              const realIndex = scrollStart + i
              const isSelected = realIndex === safeSelection
              return (
                <box key={s.id} paddingLeft={1}>
                  <text>
                    <span fg={isSelected ? "#00b894" : "#636e72"}>
                      {isSelected ? "❯ " : "  "}
                    </span>
                    <span fg={isSelected ? "#dfe6e9" : "#b2bec3"} decoration={isSelected ? "bold" : undefined}>
                      {s.label}
                    </span>
                  </text>
                </box>
              )
            })}
            {scrollStart + MAX_VISIBLE < suggestions.length && (
              <text fg="#636e72">{`  ↓ 还有 ${suggestions.length - scrollStart - MAX_VISIBLE} 项...`}</text>
            )}
          </box>
        )}
      </box>

      {/* ── 模型别名 ── */}
      <box flexDirection="column">
        <text>
          <span fg={activeField === "modelName" ? "#00b894" : "#636e72"}>
            {activeField === "modelName" ? "❯ " : "  "}
          </span>
          <span fg="#dfe6e9">模型别名:</span>
        </text>
        <box
          borderStyle="single"
          borderColor={activeField === "modelName" ? "#00b894" : modelNameState.value.length > 0 ? "#6c5ce7" : "#636e72"}
          paddingLeft={1}
          paddingRight={1}
          marginLeft={2}
        >
          <InputDisplay
            value={modelNameState.value}
            cursor={modelNameState.cursor}
            isActive={activeField === "modelName"}
            cursorVisible={cursorVisible}
            placeholder="输入模型别名..."
          />
        </box>
      </box>

      <text fg="#636e72">↑↓ 选择模型  |  Enter 补全/确认  |  Tab 切换字段  |  Esc 返回</text>
    </box>
  )
}
