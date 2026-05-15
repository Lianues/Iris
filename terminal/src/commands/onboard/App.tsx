import { useMemo, useState } from "react"
import { Welcome } from "./steps/Welcome.js"
import { ProviderSelect } from "./steps/ProviderSelect.js"
import { ApiKeyInput } from "./steps/ApiKeyInput.js"
import { ModelConfig } from "./steps/ModelConfig.js"
import { PlatformSelect } from "./steps/PlatformSelect.js"
import { Summary } from "./steps/Summary.js"
import { writeConfigs, type OnboardConfig, type SkippedSteps } from "./utils/config-writer.js"
import { loadAvailableOnboardPlatforms } from "./utils/platform-catalog.js"
import { gracefulExit } from "../../shared/runtime.js"

type Step = "welcome" | "provider" | "apiKey" | "model" | "platform" | "summary"
type SkippableStep = "provider" | "apiKey" | "model" | "platform"

interface AppProps {
  installDir: string
}

export function App({ installDir }: AppProps) {
  const availablePlatforms = useMemo(() => loadAvailableOnboardPlatforms(installDir), [installDir])
  const [step, setStep] = useState<Step>("welcome")
  const [config, setConfig] = useState<OnboardConfig>({
    provider: "deepseek",
    apiKey: "",
    model: "",
    baseUrl: "",
    modelName: "",
    platform: "console",
    platformValues: {},
  })
  const [skippedSteps, setSkippedSteps] = useState<Record<SkippableStep, boolean>>({
    provider: false,
    apiKey: false,
    model: false,
    platform: false,
  })

  const updateConfig = (partial: Partial<OnboardConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }))
  }

  const setStepSkipped = (targetStep: SkippableStep, skipped: boolean) => {
    setSkippedSteps((prev) => ({
      ...prev,
      [targetStep]: skipped,
    }))
  }

  const handleConfirm = () => {
    try {
      writeConfigs(installDir, config, skippedSteps as SkippedSteps)
      setTimeout(() => gracefulExit(), 3000)
    } catch (err) {
      console.error("写入配置失败:", err)
      gracefulExit(1)
    }
  }

  return (
    <box flexDirection="column">
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
            setStepSkipped("provider", false)
          }}
          onSkip={() => {
            setStepSkipped("provider", true)
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
            setStepSkipped("apiKey", false)
          }}
          onSkip={() => {
            setStepSkipped("apiKey", true)
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
          initialModel={config.model}
          initialModelName={config.modelName}
          onSubmit={({ model, modelName }) => {
            updateConfig({ model, modelName })
            setStep("platform")
            setStepSkipped("model", false)
          }}
          onSkip={() => {
            setStepSkipped("model", true)
            setStep("platform")
          }}
          onBack={() => setStep("apiKey")}
        />
      )}

      {step === "platform" && (
        <PlatformSelect
          availablePlatforms={availablePlatforms}
          onSelect={(platform, platformValues) => {
            updateConfig({
              platform,
              platformValues,
            })
            setStep("summary")
            setStepSkipped("platform", false)
          }}
          onSkip={() => {
            setStepSkipped("platform", true)
            setStep("summary")
          }}
          onBack={() => setStep("model")}
        />
      )}

      {step === "summary" && (
        <Summary
          config={config}
          skippedSteps={skippedSteps}
          installDir={installDir}
          onConfirm={handleConfirm}
          onBack={() => setStep("platform")}
        />
      )}
    </box>
  )
}
