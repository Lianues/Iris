import { useState } from "react"
import { Welcome } from "./steps/Welcome.js"
import { ProviderSelect } from "./steps/ProviderSelect.js"
import { ApiKeyInput } from "./steps/ApiKeyInput.js"
import { ModelConfig } from "./steps/ModelConfig.js"
import { PlatformSelect } from "./steps/PlatformSelect.js"
import { Summary } from "./steps/Summary.js"
import { writeConfigs, type OnboardConfig, type SkippedSteps } from "./utils/config-writer.js"
import { gracefulExit } from "./index.js"

type Step = "welcome" | "provider" | "apiKey" | "model" | "platform" | "summary"
type SkippableStep = "provider" | "apiKey" | "model" | "platform"

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
    wxworkBotId: "",
    wxworkSecret: "",
    telegramToken: "",
    larkAppId: "",
    larkAppSecret: "",
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

  // 统一记录“跳过此环节”的状态。
  // 这样做的目的是让汇总页能够明确提示哪些字段是用户主动跳过的，
  // 而不是把空值和默认值误判为用户已经完整填写。
  const setStepSkipped = (targetStep: SkippableStep, skipped: boolean) => {
    setSkippedSteps((prev) => ({
      ...prev,
      [targetStep]: skipped,
    }))
  }

  const handleConfirm = () => {
    try {
      // 将跳过状态传入 writeConfigs，被跳过的步骤不会写入对应配置文件
      writeConfigs(irisDir, config, skippedSteps as SkippedSteps)
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
            setStepSkipped("provider", false)
          }}
          onSkip={() => {
            // 跳过 provider：不修改 config，保留初始默认值 "gemini"
            // 写入时会检测到跳过，整个 llm 模型条目不写入
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
            // 跳过 apiKey：不修改 config，apiKey 和 baseUrl 保持原值
            // 写入时会检测到跳过，整个 llm 模型条目不写入
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
          onSubmit={({ model, modelName }) => {
            updateConfig({ model, modelName })
            setStep("platform")
            setStepSkipped("model", false)
          }}
          onSkip={() => {
            // 跳过 model：不修改 config，model 和 modelName 保持原值
            // 写入时会检测到跳过，整个 llm 模型条目不写入
            setStepSkipped("model", true)
            setStep("platform")
          }}
          onBack={() => setStep("apiKey")}
        />
      )}

      {step === "platform" && (
        <PlatformSelect
          onSelect={(platform, opts) => {
            updateConfig({
              platform,
              webPort: opts.port ?? 8192,
              wxworkBotId: opts.wxworkBotId ?? "",
              wxworkSecret: opts.wxworkSecret ?? "",
              telegramToken: opts.telegramToken ?? "",
              larkAppId: opts.larkAppId ?? "",
              larkAppSecret: opts.larkAppSecret ?? "",
            })
            setStep("summary")
            setStepSkipped("platform", false)
          }}
          onSkip={() => {
            // 跳过 platform：不修改 config，保留初始默认值 "console"
            // 写入时会检测到跳过，platform.yaml 不会被修改
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
          onConfirm={handleConfirm}
          onBack={() => setStep("platform")}
        />
      )}
    </box>
  )
}
