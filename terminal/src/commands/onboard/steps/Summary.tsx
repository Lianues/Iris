import path from "node:path"
import {
  InfoConfirmPage,
  type InfoConfirmNotice,
  type InfoConfirmRow,
  type InfoConfirmSection,
} from "../../../shared/pages/index.js"
import { buildPlatformSummaryRows, maskPlatformFieldValue } from "../../../shared/platforms/summary.js"
import { type OnboardConfig, PROVIDER_LABELS } from "../utils/config-writer.js"
import { resolveOnboardPlatformOption } from "../utils/platform-catalog.js"
import { resolveRuntimeConfigDir } from "../utils/runtime-paths.js"

interface SummaryProps {
  config: OnboardConfig
  skippedSteps: Record<"provider" | "apiKey" | "model" | "platform", boolean>
  installDir: string
  onConfirm: () => void
  onBack: () => void
}

function buildSkipSuffix(skipped: boolean, message = "已跳过"): Pick<InfoConfirmRow, "suffix" | "suffixTone"> {
  if (!skipped) {
    return {}
  }

  return {
    suffix: `（${message}）`,
    suffixTone: "warning",
  }
}

function buildValueState(
  value: string | number,
  options?: {
    skipped?: boolean
    emptyText?: string
    valueTone?: InfoConfirmRow["valueTone"]
    valueBold?: boolean
  },
): Pick<InfoConfirmRow, "value" | "valueTone" | "valueBold" | "emptyText" | "emptyTone"> {
  const text = String(value).trim()

  if (text.length > 0) {
    return {
      value: text,
      valueTone: options?.valueTone,
      valueBold: options?.valueBold,
    }
  }

  if (options?.skipped) {
    return {
      emptyText: options.emptyText || "未填写",
      emptyTone: "warning",
    }
  }

  return {
    emptyText: "未填写",
    emptyTone: "muted",
  }
}

export function Summary({ config, skippedSteps, installDir, onConfirm, onBack }: SummaryProps) {
  const configDir = resolveRuntimeConfigDir()
  const binaryPath = path.join(installDir, "bin", process.platform === "win32" ? "iris.exe" : "iris")
  const platformOption = resolveOnboardPlatformOption(installDir, config.platform)
  const platformLabel = platformOption?.label ?? config.platform

  const baseRows: InfoConfirmRow[] = [
    {
      label: "提供商",
      value: PROVIDER_LABELS[config.provider] || config.provider,
      valueBold: true,
      ...buildSkipSuffix(skippedSteps.provider, "已跳过，沿用默认值"),
    },
    {
      label: "API Key",
      ...buildValueState(config.apiKey.trim().length > 0 ? maskPlatformFieldValue(config.apiKey, true) : "", {
        skipped: skippedSteps.apiKey,
        emptyText: "已跳过，待手动填写",
      }),
    },
    {
      label: "模型别名",
      ...buildValueState(config.modelName, {
        skipped: skippedSteps.model,
        emptyText: "已跳过，沿用默认值",
      }),
    },
    {
      label: "模型 ID",
      ...buildValueState(config.model, {
        skipped: skippedSteps.model,
        emptyText: "已跳过，沿用默认值",
      }),
    },
  ]

  if (config.provider !== "deepseek") {
    baseRows.push({
      label: "Base URL",
      ...buildValueState(config.baseUrl, {
        skipped: skippedSteps.apiKey,
        emptyText: "已跳过，沿用默认值",
      }),
    })
  }

  baseRows.push({
    label: "平台",
    value: platformLabel,
    ...buildSkipSuffix(skippedSteps.platform, "已跳过，沿用默认值或暂存输入"),
  })

  const platformRows = buildPlatformSummaryRows(platformOption, config.platformValues, skippedSteps.platform)

  const sections: InfoConfirmSection[] = [
    { rows: baseRows },
    ...(platformRows.length > 0 ? [{ title: "平台参数", rows: platformRows }] : []),
  ]

  const hasSkippedSteps = Object.values(skippedSteps).some(Boolean)
  const notices: InfoConfirmNotice[] = hasSkippedSteps
    ? [
        {
          tone: "warning",
          title: "提示",
          lines: [
            "你跳过了部分环节。写入后，相关字段可能使用默认值，或暂时保持为空。",
            `若后续启动失败，可直接编辑 ${configDir} 下的 YAML 文件补全。`,
          ],
        },
      ]
    : []

  return (
    <InfoConfirmPage
      title="⑤ 确认配置"
      description="确认下面的信息无误后写入配置。"
      sections={sections}
      notices={notices}
      onConfirm={onConfirm}
      onBack={onBack}
      confirmActionText="Enter / y 确认写入"
      backActionText="Esc / n 返回修改"
      successTitle="✅ 配置已写入！"
      successLines={[`配置目录：${configDir}`]}
      successActionsTitle="启动方式："
      successActions={[
        {
          command: "iris start",
          description: "已加入 PATH 或 npm 安装时使用",
        },
        {
          command: `${binaryPath} start`,
          description: "直接运行当前发行包",
        },
      ]}
    />
  )
}
