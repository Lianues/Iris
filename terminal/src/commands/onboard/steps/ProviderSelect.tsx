import { OptionSelectPage, type OptionSelectItem } from "../../../shared/pages/index.js"

const PROVIDERS: OptionSelectItem[] = [
  { value: "deepseek", label: "DeepSeek", description: "DeepSeek Chat Completions API" },
  { value: "gemini", label: "Google Gemini", description: "Google AI Studio / Vertex AI" },
  { value: "openai-compatible", label: "OpenAI Compatible", description: "任何兼容 OpenAI Chat Completions 的 API" },
  { value: "claude", label: "Anthropic Claude", description: "Anthropic 官方 API" },
  { value: "openai-responses", label: "OpenAI Responses", description: "OpenAI Responses API 格式" },
]

interface ProviderSelectProps {
  onSelect: (provider: string) => void
  onSkip: () => void
  onBack: () => void
}

export function ProviderSelect({ onSelect, onSkip, onBack }: ProviderSelectProps) {
  return (
    <OptionSelectPage
      title="① 选择 LLM 提供商"
      description="选择你要接入的模型提供商。后续将继续填写凭证和模型配置。"
      options={PROVIDERS}
      onSelect={onSelect}
      onSkip={onSkip}
      onBack={onBack}
    />
  )
}
