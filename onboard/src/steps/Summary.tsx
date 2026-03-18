import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { PROVIDER_LABELS, type OnboardConfig } from "../utils/config-writer.js"
import { gracefulExit } from "../index.js"

interface SummaryProps {
  config: OnboardConfig
  skippedSteps: Record<"provider" | "apiKey" | "model" | "platform", boolean>
  onConfirm: () => void
  onBack: () => void
}

export function Summary({ config, skippedSteps, onConfirm, onBack }: SummaryProps) {
  const [confirmed, setConfirmed] = useState(false)

  useKeyboard((key) => {
    if (confirmed) return

    if (key.name === "return" || key.name === "y") {
      setConfirmed(true)
      onConfirm()
    }
    if (key.name === "escape" || key.name === "n") {
      onBack()
    }
    if (key.name === "c" && key.ctrl) {
      gracefulExit()
    }
  })

  const maskedKey = config.apiKey.length > 8
    ? config.apiKey.slice(0, 4) + "••••" + config.apiKey.slice(-4)
    : "••••••••"

  const maskedTelegramToken = config.telegramToken.length > 8
    ? config.telegramToken.slice(0, 4) + "••••" + config.telegramToken.slice(-4)
    : config.telegramToken.length > 0 ? "••••••••" : ""

  const maskedSecret = config.wxworkSecret.length > 8
    ? config.wxworkSecret.slice(0, 4) + "••••" + config.wxworkSecret.slice(-4)
    : config.wxworkSecret.length > 0 ? "••••••••" : ""

  const maskedLarkSecret = config.larkAppSecret.length > 8
    ? config.larkAppSecret.slice(0, 4) + "••••" + config.larkAppSecret.slice(-4)
    : config.larkAppSecret.length > 0 ? "••••••••" : ""

  const hasSkippedSteps = Object.values(skippedSteps).some(Boolean)

  const renderSkipSuffix = (skipped: boolean, message = "已跳过") => (
    skipped ? <span fg="#fdcb6e">{`（${message}）`}</span> : null
  )

  const renderValue = (value: string | number, options?: { skipped?: boolean; emptyText?: string }) => {
    const text = String(value).trim()
    if (text.length > 0) {
      return <span fg="#dfe6e9">{text}</span>
    }
    if (options?.skipped) {
      return <span fg="#fdcb6e">{options.emptyText || "未填写"}</span>
    }
    return <span fg="#636e72">未填写</span>
  }

  const platformDisplay = () => {
    switch (config.platform) {
      case "web":
        return `Web (端口 ${config.webPort})`
      case "wxwork":
        return "企业微信 (WXWork)"
      case "telegram":
        return "Telegram Bot"
      case "lark":
        return "飞书 (Lark)"
      default:
        return "Console (TUI)"
    }
  }

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg="#6c5ce7">
        <b>⑤ 确认配置</b>
      </text>

      <box flexDirection="column" borderStyle="rounded" borderColor="#636e72" padding={1} gap={0}>
        <text>
          <span fg="#636e72">{"提供商:   "}</span>
          <b><span fg="#dfe6e9">{PROVIDER_LABELS[config.provider] || config.provider}</span></b>
          {renderSkipSuffix(skippedSteps.provider, "已跳过，沿用默认值")}
        </text>
        <text>
          <span fg="#636e72">{"API Key:  "}</span>
          {config.apiKey.trim().length > 0 ? <span fg="#dfe6e9">{maskedKey}</span> : renderValue("", { skipped: skippedSteps.apiKey, emptyText: "已跳过，待手动填写" })}
        </text>
        <text>
          <span fg="#636e72">{"模型别名: "}</span>
          {renderValue(config.modelName, { skipped: skippedSteps.model, emptyText: "已跳过，沿用默认值" })}
        </text>
        <text>
          <span fg="#636e72">{"模型 ID:  "}</span>
          {renderValue(config.model, { skipped: skippedSteps.model, emptyText: "已跳过，沿用默认值" })}
        </text>
        <text>
          <span fg="#636e72">{"Base URL: "}</span>
          {renderValue(config.baseUrl, { skipped: skippedSteps.apiKey, emptyText: "已跳过，沿用默认值" })}
        </text>
        <text>
          <span fg="#636e72">{"平台:     "}</span>
          <span fg="#dfe6e9">{platformDisplay()}</span>
          {renderSkipSuffix(skippedSteps.platform, "已跳过，沿用默认值或暂存输入")}
        </text>
        {config.platform === "web" && (
          <text>
            <span fg="#636e72">{"端口:     "}</span>
            {renderValue(config.webPort)}
          </text>
        )}
        {config.platform === "wxwork" && (
          <box flexDirection="column">
            <text>
              <span fg="#636e72">{"Bot ID:   "}</span>
              {renderValue(config.wxworkBotId, { skipped: skippedSteps.platform, emptyText: "已跳过，待手动填写" })}
            </text>
            <text>
              <span fg="#636e72">{"Secret:   "}</span>
              {config.wxworkSecret.trim().length > 0 ? <span fg="#dfe6e9">{maskedSecret}</span> : renderValue("", { skipped: skippedSteps.platform, emptyText: "已跳过，待手动填写" })}
            </text>
          </box>
        )}
        {config.platform === "telegram" && (
          <box flexDirection="column">
            <text>
              <span fg="#636e72">{"Token:    "}</span>
              {config.telegramToken.trim().length > 0 ? <span fg="#dfe6e9">{maskedTelegramToken}</span> : renderValue("", { skipped: skippedSteps.platform, emptyText: "已跳过，待手动填写" })}
            </text>
          </box>
        )}
        {config.platform === "lark" && (
          <box flexDirection="column">
            <text>
              <span fg="#636e72">{"App ID:   "}</span>
              {renderValue(config.larkAppId, { skipped: skippedSteps.platform, emptyText: "已跳过，待手动填写" })}
            </text>
            <text>
              <span fg="#636e72">{"Secret:   "}</span>
              {config.larkAppSecret.trim().length > 0 ? <span fg="#dfe6e9">{maskedLarkSecret}</span> : renderValue("", { skipped: skippedSteps.platform, emptyText: "已跳过，待手动填写" })}
            </text>
          </box>
        )}
      </box>

      {hasSkippedSteps && !confirmed && (
        <box flexDirection="column" borderStyle="rounded" borderColor="#fdcb6e" padding={1}>
          <text fg="#fdcb6e"><b>提示</b></text>
          <text fg="#dfe6e9">你跳过了部分环节。写入后，相关字段可能使用默认值，或暂时保持为空。</text>
          <text fg="#636e72">若后续启动失败，可直接编辑 data/configs/*.yaml 补全。</text>
        </box>
      )}

      {!confirmed ? (
        <text fg="#636e72">Enter / y 确认写入  |  Esc / n 返回修改</text>
      ) : (
        <box flexDirection="column" gap={1}>
          <text fg="#00b894"><b>✅ 配置已写入！</b></text>
          <box flexDirection="column" paddingLeft={2}>
            <text fg="#dfe6e9">启动方式：</text>
            <text>
              <span fg="#00b894">  iris service start</span>
              <span fg="#636e72">  — 后台运行（systemd 服务）</span>
            </text>
            <text>
              <span fg="#00b894">  iris start</span>
              <span fg="#636e72">          — 前台运行</span>
            </text>
          </box>
        </box>
      )}
    </box>
  )
}
