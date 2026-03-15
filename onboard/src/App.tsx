import { useState } from "react"
import { Welcome } from "./steps/Welcome.js"
import { ProviderSelect } from "./steps/ProviderSelect.js"
import { ApiKeyInput } from "./steps/ApiKeyInput.js"
import { ModelConfig } from "./steps/ModelConfig.js"
import { PlatformSelect } from "./steps/PlatformSelect.js"
import { Summary } from "./steps/Summary.js"
import { writeConfigs, type OnboardConfig } from "./utils/config-writer.js"
import { gracefulExit } from "./index.js"

type Step = "welcome" | "provider" | "apiKey" | "model" | "platform" | "summary"

interface AppProps {
  irisDir: string
}

export function App({ irisDir }: AppProps) {
  const [step, setStep] = useState<Step>("welcome")
  const [config, setConfig] = useState<OnboardConfig>({
    provider: "gemini",
    apiKey: "",
    model: "",
    baseUrl: "",
    modelName: "",
    platform: "console",
    webPort: 8192,
  })

  const updateConfig = (partial: Partial<OnboardConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }))
  }

  const handleConfirm = () => {
    try {
      writeConfigs(irisDir, config)
      // 延迟退出，让用户看到成功信息
      setTimeout(() => gracefulExit(), 3000)
    } catch (err) {
      console.error("写入配置失败:", err)
      gracefulExit(1)
    }
  }

  return (
    <box flexDirection="column">
      {/* 进度条 */}
      <box paddingLeft={1} paddingRight={1}>
        <text>
          <span fg={step === "welcome" ? "#6c5ce7" : "#636e72"}>{"● "}</span>
          <span fg={["provider", "apiKey", "model", "platform", "summary"].includes(step) ? "#6c5ce7" : "#636e72"}>{"● "}</span>
          <span fg={["apiKey", "model", "platform", "summary"].includes(step) ? "#6c5ce7" : "#636e72"}>{"● "}</span>
          <span fg={["model", "platform", "summary"].includes(step) ? "#6c5ce7" : "#636e72"}>{"● "}</span>
          <span fg={["platform", "summary"].includes(step) ? "#6c5ce7" : "#636e72"}>{"● "}</span>
          <span fg={step === "summary" ? "#6c5ce7" : "#636e72"}>{"●"}</span>
        </text>
      </box>

      {step === "welcome" && (
        <Welcome onNext={() => setStep("provider")} />
      )}

      {step === "provider" && (
        <ProviderSelect
          onSelect={(provider) => {
            updateConfig({ provider: provider as OnboardConfig["provider"] })
            setStep("apiKey")
          }}
          onBack={() => setStep("welcome")}
        />
      )}

      {step === "apiKey" && (
        <ApiKeyInput
          provider={config.provider}
          onSubmit={(apiKey, baseUrl) => {
            updateConfig({ apiKey, baseUrl })
            setStep("model")
          }}
          onBack={() => setStep("provider")}
        />
      )}

      {step === "model" && (
        <ModelConfig
          provider={config.provider}
          apiKey={config.apiKey}
          baseUrl={config.baseUrl}
          onSubmit={({ model, modelName }) => {
            updateConfig({ model, modelName })
            setStep("platform")
          }}
          onBack={() => setStep("apiKey")}
        />
      )}

      {step === "platform" && (
        <PlatformSelect
          onSelect={(platform, port) => {
            updateConfig({ platform, webPort: port })
            setStep("summary")
          }}
          onBack={() => setStep("model")}
        />
      )}

      {step === "summary" && (
        <Summary
          config={config}
          onConfirm={handleConfirm}
          onBack={() => setStep("platform")}
        />
      )}
    </box>
  )
}
