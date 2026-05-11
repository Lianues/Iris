import { useEffect, useMemo, useState } from "react"
import {
  SuggestableInputPage,
  type SuggestableInputFieldDefinition,
  type SuggestableInputSuggestion,
} from "../pages/index.js"
import { fetchModelList, type ModelEntry } from "./model-fetcher.js"
import { DEEPSEEK_MODEL_OPTIONS, normalizeDeepSeekModelId, PROVIDER_DEFAULTS, PROVIDER_LABELS } from "./provider-config.js"

export interface ModelsPanelProps {
  provider: string
  apiKey: string
  baseUrl: string
  initialModel?: string
  initialModelName?: string
  title?: string
  description?: string
  onSubmit: (config: { model: string; modelName: string }) => void
  onSkip?: () => void
  onBack?: () => void
}

export function ModelsPanel({
  provider,
  apiKey,
  baseUrl,
  initialModel,
  initialModelName,
  title = "模型配置",
  description,
  onSubmit,
  onSkip,
  onBack,
}: ModelsPanelProps) {
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini
  const isDeepSeek = provider === "deepseek"
  const [allModels, setAllModels] = useState<ModelEntry[]>([])
  const [fetchStatus, setFetchStatus] = useState<"loading" | "done" | "error">("loading")

  useEffect(() => {
    if (isDeepSeek) {
      setAllModels(DEEPSEEK_MODEL_OPTIONS.map((option) => ({ id: option.id, label: option.label })))
      setFetchStatus("done")
      return
    }

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
  }, [provider, apiKey, baseUrl, isDeepSeek])

  const fields = useMemo<SuggestableInputFieldDefinition[]>(() => {
    const modelSuggestions = ({ value }: { value: string }): SuggestableInputSuggestion[] => {
      if (isDeepSeek) return allModels.map((model) => ({ value: model.id, label: model.label }))
      const keyword = value.trim().toLowerCase()
      const matchedModels = keyword.length === 0
        ? allModels
        : allModels.filter((model) =>
            model.id.toLowerCase().includes(keyword)
            || model.label.toLowerCase().includes(keyword),
          )

      return matchedModels.map((model) => ({
        value: model.id,
        label: model.label,
      }))
    }

    return [
      {
        key: "model",
        label: "模型 ID",
        placeholder: defaults.model ? `${defaults.model} (默认)` : "输入模型 ID...",
        description: ({ suggestions }) => {
          if (isDeepSeek) return "DeepSeek 模型 ID 只能在 Flash / Pro 中二选一。"
          if (fetchStatus === "loading") return "正在获取模型列表..."
          if (fetchStatus === "error" && allModels.length === 0) return "未获取到模型列表，可直接手动输入。"
          if (suggestions.length > 0) return "可从下方建议中选择，也可直接手动输入。"
          return "输入提供商真实模型 ID。"
        },
        defaultValue: isDeepSeek
          ? normalizeDeepSeekModelId(initialModel ?? defaults.model)
          : initialModel ?? defaults.model,
        suggestions: modelSuggestions,
        selectionOnly: isDeepSeek,
        validate: isDeepSeek
          ? (value) => DEEPSEEK_MODEL_OPTIONS.some((option) => option.id === value.trim()) ? undefined : "DeepSeek 模型 ID 只能选择 deepseek-v4-flash 或 deepseek-v4-pro"
          : undefined,
        suggestionEmptyText: ({ value }) => {
          if (isDeepSeek) return undefined
          if (fetchStatus === "loading") return undefined
          if (fetchStatus === "error" && allModels.length === 0) return undefined
          if (value.trim().length === 0) return undefined
          return "没有匹配的模型，可继续手动输入。"
        },
      },
      {
        key: "modelName",
        label: "模型别名",
        description: "配置文件中的模型别名。留空时将使用提供商名称。",
        placeholder: "输入模型别名...",
        defaultValue: initialModelName ?? provider.replace(/-/g, "_"),
      },
    ]
  }, [allModels, defaults.model, fetchStatus, initialModel, initialModelName, isDeepSeek, provider])

  return (
    <SuggestableInputPage
      title={title}
      description={description ?? `提供商: ${PROVIDER_LABELS[provider] || provider}`}
      fields={fields}
      onSubmit={(values) => {
        const finalModel = isDeepSeek ? normalizeDeepSeekModelId(values.model) : values.model.trim() || defaults.model
        const finalName = values.modelName.trim() || provider.replace(/-/g, "_")
        onSubmit({ model: finalModel, modelName: finalName })
      }}
      onSkip={onSkip}
      onBack={onBack}
      maxVisibleFields={2}
      maxVisibleSuggestions={8}
    />
  )
}
