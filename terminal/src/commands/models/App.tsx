import { useMemo, useState } from "react"
import {
  InfoConfirmPage,
  OptionSelectPage,
  type InfoConfirmNotice,
  type InfoConfirmRow,
  type InfoConfirmSection,
  type OptionSelectItem,
} from "../../shared/pages/index.js"
import { gracefulExit } from "../../shared/runtime.js"
import { resolveRuntimeConfigDir } from "../../shared/runtime-paths.js"
import { ModelsPanel } from "../../shared/models/ModelsPanel.js"
import {
  loadEditableModelRegistry,
  writeEditableModelConfig,
  type EditableModelConfig,
  type EditableModelEntry,
} from "../../shared/models/config.js"
import { maskPlatformFieldValue } from "../../shared/platforms/summary.js"
import { PROVIDER_LABELS } from "../../shared/models/provider-config.js"

interface ModelsAppProps {
  installDir: string
}

type Step = "select" | "panel" | "summary"

function toEditableModelConfig(entry: EditableModelEntry): EditableModelConfig {
  return {
    provider: entry.provider,
    apiKey: entry.apiKey,
    baseUrl: entry.baseUrl,
    model: entry.model,
    modelName: entry.modelName,
  }
}

function buildModelOptionItem(entry: EditableModelEntry): OptionSelectItem {
  const providerLabel = PROVIDER_LABELS[entry.provider] || entry.provider
  const parts = [providerLabel, entry.model]
  if (entry.isDefault) {
    parts.push("当前默认")
  }

  return {
    value: entry.originalModelName,
    label: entry.modelName,
    description: parts.join(" · "),
  }
}

export function App({ installDir }: ModelsAppProps) {
  const registry = useMemo(() => loadEditableModelRegistry(installDir), [installDir])
  const defaultEntry = registry.models.find((item) => item.isDefault) ?? registry.models[0]
  const [step, setStep] = useState<Step>("select")
  const [selectedEntry, setSelectedEntry] = useState<EditableModelEntry>(defaultEntry)
  const [config, setConfig] = useState<EditableModelConfig>(() => toEditableModelConfig(defaultEntry))

  const configDir = resolveRuntimeConfigDir()
  const options = useMemo<OptionSelectItem[]>(() => registry.models.map(buildModelOptionItem), [registry.models])
  const initialSelectedIndex = Math.max(0, registry.models.findIndex((item) => item.originalModelName === selectedEntry.originalModelName))

  const handleConfirm = () => {
    try {
      writeEditableModelConfig(installDir, {
        originalModelName: selectedEntry.originalModelName,
        ...config,
      })
      setTimeout(() => gracefulExit(), 3000)
    } catch (error) {
      console.error("写入模型配置失败:", error)
      gracefulExit(1)
    }
  }

  if (step === "select") {
    return (
      <OptionSelectPage
        title="模型配置"
        description="先选择一个已配置模型，再进入模型参数配置。当前默认模型会带有标记。"
        options={options}
        initialSelectedIndex={initialSelectedIndex}
        onSelect={(originalModelName) => {
          const entry = registry.models.find((item) => item.originalModelName === originalModelName)
          if (!entry) return
          setSelectedEntry(entry)
          setConfig(toEditableModelConfig(entry))
          setStep("panel")
        }}
        onBack={() => gracefulExit()}
      />
    )
  }

  if (step === "panel") {
    return (
      <ModelsPanel
        provider={config.provider}
        apiKey={config.apiKey}
        baseUrl={config.baseUrl}
        initialModel={config.model}
        initialModelName={config.modelName}
        title="模型配置"
        description={`条目: ${selectedEntry.originalModelName} · 提供商: ${PROVIDER_LABELS[config.provider] || config.provider}`}
        onSubmit={({ model, modelName}) => {
          setConfig((prev) => ({
            ...prev,
            model,
            modelName,
          }))
          setStep("summary")
        }}
        onBack={() => setStep("select")}
      />
    )
  }

  const rows: InfoConfirmRow[] = [
    {
      label: "原模型别名",
      value: selectedEntry.originalModelName,
      valueBold: true,
    },
    {
      label: "提供商",
      value: PROVIDER_LABELS[config.provider] || config.provider,
    },
    {
      label: "API Key",
      value: config.apiKey.trim().length > 0 ? maskPlatformFieldValue(config.apiKey, true) : undefined,
      emptyText: "未填写",
      emptyTone: "warning",
    },
    {
      label: "新模型别名",
      value: config.modelName,
      valueBold: true,
    },
    {
      label: "模型 ID",
      value: config.model,
    },
  ]

  if (config.provider !== "deepseek") {
    rows.push({
      label: "Base URL",
      value: config.baseUrl,
    })
  }

  const sections: InfoConfirmSection[] = [
    {
      rows,
    },
  ]

  const renameNotice = selectedEntry.originalModelName !== config.modelName
    ? "如果当前编辑的是默认模型条目，defaultModel 会同步更新为新的模型别名。"
    : "若当前编辑的是默认模型条目，defaultModel 不会改变。"

  const notices: InfoConfirmNotice[] = [
    {
      tone: "info",
      title: "说明",
      lines: [
        `配置将写入 ${configDir}/llm.yaml。`,
        "当前命令会修改你所选中的模型条目，不会修改平台配置。",
        renameNotice,
      ],
    },
  ]

  return (
    <InfoConfirmPage
      title="模型配置确认"
      description="确认模型配置无误后写入。"
      sections={sections}
      notices={notices}
      onConfirm={handleConfirm}
      onBack={() => setStep("panel")}
      confirmActionText="Enter / y 确认写入"
      backActionText="Esc / n 返回修改"
      successTitle="✅ 模型配置已写入！"
      successLines={[`配置目录：${configDir}`]}
      successActionsTitle="后续可使用以下命令："
      successActions={[
        {
          command: "iris start",
          description: "使用当前默认模型启动",
        },
        {
          command: "iris models",
          description: "重新打开模型配置界面",
        },
      ]}
    />
  )
}
