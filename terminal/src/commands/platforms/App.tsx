import { useMemo, useState } from "react"
import {
  InfoConfirmPage,
  type InfoConfirmNotice,
  type InfoConfirmSection,
} from "../../shared/pages/index.js"
import { gracefulExit } from "../../shared/runtime.js"
import { resolveRuntimeConfigDir } from "../../shared/runtime-paths.js"
import { PlatformsPanel } from "../../shared/platforms/PlatformsPanel.js"
import {
  buildPlatformSummaryRows,
} from "../../shared/platforms/summary.js"
import {
  loadAvailablePlatforms,
  resolvePlatformOption,
} from "../../shared/platforms/catalog.js"
import { writeConfigs, type OnboardConfig } from "../onboard/utils/config-writer.js"

interface PlatformsAppProps {
  installDir: string
}

type Step = "panel" | "summary"

export function App({ installDir }: PlatformsAppProps) {
  const availablePlatforms = useMemo(() => loadAvailablePlatforms(installDir), [installDir])
  const [step, setStep] = useState<Step>("panel")
  const [config, setConfig] = useState<OnboardConfig>({
    provider: "deepseek",
    apiKey: "",
    model: "",
    baseUrl: "",
    modelName: "",
    platform: "console",
    platformValues: {},
  })

  const configDir = resolveRuntimeConfigDir()
  const platformOption = resolvePlatformOption(installDir, config.platform)

  const handleConfirm = () => {
    try {
      writeConfigs(installDir, config, {
        provider: true,
        apiKey: true,
        model: true,
        platform: false,
      })
      setTimeout(() => gracefulExit(), 3000)
    } catch (error) {
      console.error("写入平台配置失败:", error)
      gracefulExit(1)
    }
  }

  if (step === "panel") {
    return (
      <PlatformsPanel
        availablePlatforms={availablePlatforms}
        title="平台配置"
        description="选择要启用的平台，并按平台面板填写参数。"
        configTitle="平台参数配置"
        onSelect={(platform, values) => {
          setConfig((prev) => ({
            ...prev,
            platform,
            platformValues: values,
          }))
          setStep("summary")
        }}
        onBack={() => gracefulExit()}
      />
    )
  }

  const platformRows = buildPlatformSummaryRows(platformOption, config.platformValues, false)

  const sections: InfoConfirmSection[] = [
    {
      rows: [
        {
          label: "平台",
          value: platformOption?.label ?? config.platform,
          valueBold: true,
        },
      ],
    },
    ...(platformRows.length > 0 ? [{ title: "平台参数", rows: platformRows }] : []),
  ]

  const notices: InfoConfirmNotice[] = [
    {
      tone: "info",
      title: "说明",
      lines: [
        `配置将写入 ${configDir}/platform.yaml。`,
        "仅修改平台相关配置，不会覆盖 LLM 配置。",
      ],
    },
  ]

  return (
    <InfoConfirmPage
      title="平台配置确认"
      description="确认平台配置无误后写入。"
      sections={sections}
      notices={notices}
      onConfirm={handleConfirm}
      onBack={() => setStep("panel")}
      confirmActionText="Enter / y 确认写入"
      backActionText="Esc / n 返回修改"
      successTitle="✅ 平台配置已写入！"
      successLines={[`配置目录：${configDir}`]}
      successActionsTitle="后续可使用以下命令："
      successActions={[
        {
          command: "iris start",
          description: "启动当前平台配置",
        },
        {
          command: "iris platforms",
          description: "重新打开平台配置界面",
        },
      ]}
    />
  )
}
