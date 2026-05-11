import { PROVIDER_DEFAULTS, PROVIDER_LABELS } from "../utils/config-writer.js"
import { ScrollableInputPage, type ScrollableInputFieldDefinition } from "../../../shared/pages/index.js"

interface ApiKeyInputProps {
  provider: string
  onSubmit: (apiKey: string, baseUrl: string) => void
  onSkip: () => void
  onBack: () => void
}

export function ApiKeyInput({ provider, onSubmit, onSkip, onBack }: ApiKeyInputProps) {
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini
  const isDeepSeek = provider === "deepseek"

  const fields: ScrollableInputFieldDefinition[] = [
    {
      key: "apiKey",
      label: "API Key",
      description: "提供商访问密钥。此字段会默认隐藏显示。",
      placeholder: "输入 API Key...",
      required: true,
      masked: true,
    },
  ]

  if (!isDeepSeek) {
    fields.push({
      key: "baseUrl",
      label: "Base URL",
      description: "提供商 API 基础地址。",
      placeholder: defaults.baseUrl,
      defaultValue: defaults.baseUrl,
      required: true,
    })
  }

  return (
    <ScrollableInputPage
      title="② 输入 API 凭证"
      description={`提供商: ${PROVIDER_LABELS[provider] || provider}`}
      fields={fields}
      onSubmit={(values) => {
        onSubmit(values.apiKey.trim(), isDeepSeek ? defaults.baseUrl : values.baseUrl.trim())
      }}
      onSkip={onSkip}
      onBack={onBack}
    />
  )
}
