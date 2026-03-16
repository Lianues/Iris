import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { PROVIDER_LABELS, type OnboardConfig } from "../utils/config-writer.js"
import { gracefulExit } from "../index.js"

interface SummaryProps {
  config: OnboardConfig
  onConfirm: () => void
  onBack: () => void
}

export function Summary({ config, onConfirm, onBack }: SummaryProps) {
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

  const maskedSecret = config.wxworkSecret.length > 8
    ? config.wxworkSecret.slice(0, 4) + "••••" + config.wxworkSecret.slice(-4)
    : config.wxworkSecret.length > 0 ? "••••••••" : ""

  const platformDisplay = () => {
    switch (config.platform) {
      case "web":
        return `Web (端口 ${config.webPort})`
      case "wxwork":
        return "企业微信 (WXWork)"
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
        </text>
        <text>
          <span fg="#636e72">{"API Key:  "}</span>
          <span fg="#dfe6e9">{maskedKey}</span>
        </text>
        <text>
          <span fg="#636e72">{"模型别名: "}</span>
          <span fg="#dfe6e9">{config.modelName}</span>
        </text>
        <text>
          <span fg="#636e72">{"模型 ID:  "}</span>
          <span fg="#dfe6e9">{config.model}</span>
        </text>
        <text>
          <span fg="#636e72">{"Base URL: "}</span>
          <span fg="#dfe6e9">{config.baseUrl}</span>
        </text>
        <text>
          <span fg="#636e72">{"平台:     "}</span>
          <span fg="#dfe6e9">{platformDisplay()}</span>
        </text>
        {config.platform === "wxwork" && (
          <box flexDirection="column">
            <text>
              <span fg="#636e72">{"Bot ID:   "}</span>
              <span fg="#dfe6e9">{config.wxworkBotId}</span>
            </text>
            <text>
              <span fg="#636e72">{"Secret:   "}</span>
              <span fg="#dfe6e9">{maskedSecret}</span>
            </text>
          </box>
        )}
      </box>

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
