import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useCursorBlink } from "../hooks/use-cursor-blink.js"
import { usePaste } from "../hooks/use-paste.js"
import { useTextInput } from "../hooks/use-text-input.js"
import { InputDisplay } from "../components/InputDisplay.js"
import { gracefulExit } from "../index.js"

const PLATFORMS = [
  {
    value: "console",
    label: "Console (TUI)",
    desc: "终端交互界面，适合本地开发和 SSH 使用",
  },
  {
    value: "web",
    label: "Web (HTTP + GUI)",
    desc: "浏览器访问，适合服务器部署和远程使用",
  },
  {
    value: "telegram",
    label: "Telegram Bot",
    desc: "Telegram 机器人，支持私聊和群聊 @触发",
  },
  {
    value: "lark",
    label: "飞书 (Lark)",
    desc: "飞书自建应用机器人，WebSocket 长连接模式",
  },
  {
    value: "wxwork",
    label: "企业微信 (WXWork)",
    desc: "企业微信智能机器人，WebSocket 长连接模式",
  },
] as const

type SubStep = "select" | "webPort" | "wxworkBotId" | "wxworkSecret" | "telegramToken" | "larkAppId" | "larkAppSecret"

interface PlatformSelectProps {
  onSelect: (platform: "console" | "web" | "wxwork" | "telegram" | "lark", opts: {
    port?: number
    wxworkBotId?: string
    wxworkSecret?: string
    telegramToken?: string
    larkAppId?: string
    larkAppSecret?: string
  }) => void
  // 跳过时不传递任何平台参数，App 侧不修改 config，
  // writeConfigs 检测到 platform 被跳过后会保留已有文件不做修改
  onSkip: () => void
  onBack: () => void
}

export function PlatformSelect({ onSelect, onSkip, onBack }: PlatformSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [subStep, setSubStep] = useState<SubStep>("select")

  // Web 端口输入
  const [portState, portActions] = useTextInput("8192")

  // 企业微信 Bot ID 输入
  const [botIdState, botIdActions] = useTextInput("")
  // 企业微信 Secret 输入
  const [secretState, secretActions] = useTextInput("")

  // Telegram token 输入
  const [tgTokenState, tgTokenActions] = useTextInput("")
  // 飞书 App ID / App Secret 输入
  const [larkAppIdState, larkAppIdActions] = useTextInput("")
  const [larkAppSecretState, larkAppSecretActions] = useTextInput("")

  const cursorVisible = useCursorBlink()

  // 将"跳过此环节"统一收敛到一个入口。
  // 跳过时不传递任何参数：config 不修改，保留已有文件不做修改。
  // 无论当前处于哪个子步骤（选择列表 / 凭证输入），跳过行为一致。
  const skipCurrentStep = () => {
    onSkip()
  }

  useKeyboard((key) => {
    if (key.name === "n" && key.ctrl) {
      skipCurrentStep()
      return
    }

    // ---- Web 端口输入 ----
    if (subStep === "webPort") {
      if (key.name === "return") {
        const portNum = parseInt(portState.value, 10)
        if (portNum > 0 && portNum < 65536) {
          onSelect("web", { port: portNum })
        }
        return
      }
      if (key.name === "escape") {
        setSubStep("select")
        return
      }
      // 只允许数字输入
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        if (/^\d$/.test(key.sequence)) {
          portActions.handleKey(key)
        }
        return
      }
      portActions.handleKey(key)
      return
    }

    // ---- 企业微信 Bot ID 输入 ----
    if (subStep === "wxworkBotId") {
      if (key.name === "return") {
        if (botIdState.value.trim().length > 0) {
          setSubStep("wxworkSecret")
        }
        return
      }
      if (key.name === "escape") {
        setSubStep("select")
        return
      }
      botIdActions.handleKey(key)
      return
    }

    // ---- 企业微信 Secret 输入 ----
    if (subStep === "wxworkSecret") {
      if (key.name === "return") {
        if (secretState.value.trim().length > 0) {
          onSelect("wxwork", {
            wxworkBotId: botIdState.value.trim(),
            wxworkSecret: secretState.value.trim(),
          })
        }
        return
      }
      if (key.name === "escape") {
        setSubStep("wxworkBotId")
        return
      }
      secretActions.handleKey(key)
      return
    }

    // ---- Telegram Token 输入 ----
    if (subStep === "telegramToken") {
      if (key.name === "return") {
        if (tgTokenState.value.trim().length > 0) {
          onSelect("telegram", { telegramToken: tgTokenState.value.trim() })
        }
        return
      }
      if (key.name === "escape") {
        setSubStep("select")
        return
      }
      tgTokenActions.handleKey(key)
      return
    }

    // ---- 飞书 App ID 输入 ----
    if (subStep === "larkAppId") {
      if (key.name === "return") {
        if (larkAppIdState.value.trim().length > 0) {
          setSubStep("larkAppSecret")
        }
        return
      }
      if (key.name === "escape") {
        setSubStep("select")
        return
      }
      larkAppIdActions.handleKey(key)
      return
    }

    // ---- 飞书 App Secret 输入 ----
    if (subStep === "larkAppSecret") {
      if (key.name === "return") {
        if (larkAppSecretState.value.trim().length >0) {
          onSelect("lark", {
            larkAppId: larkAppIdState.value.trim(),
            larkAppSecret: larkAppSecretState.value.trim(),
          })
        }
        return
      }
      if (key.name === "escape") {
        setSubStep("larkAppId")
        return
      }
      larkAppSecretActions.handleKey(key)
      return
    }

    // ---- 平台选择列表 ----
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1))
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => Math.min(PLATFORMS.length - 1, i + 1))
    }
    if (key.name === "return") {
      const selected = PLATFORMS[selectedIndex].value
      if (selected === "web") {
        setSubStep("webPort")
      } else if (selected === "wxwork") {
        setSubStep("wxworkBotId")
      } else if (selected === "telegram") {
        setSubStep("telegramToken")
      } else if (selected === "lark") {
        setSubStep("larkAppId")
      } else {
        onSelect("console", {})
      }
    }
    if (key.name === "escape") {
      onBack()
    }
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      gracefulExit()
    }
  })

  // 粘贴支持 —— PlatformSelect 包含多个文本输入子步骤（端口、各平台凭证），
  // 需要根据当前 subStep 将粘贴文本路由到对应的 input actions。
  usePaste((text) => {
    const cleaned = text.replace(/[\r\n]/g, "").trim()
    if (cleaned.length === 0) return

    switch (subStep) {
      case "webPort":
        // 端口只允许数字
        const digits = cleaned.replace(/\D/g, "")
        if (digits.length > 0) portActions.insert(digits)
        break
      case "wxworkBotId":
        botIdActions.insert(cleaned)
        break
      case "wxworkSecret":
        secretActions.insert(cleaned)
        break
      case "telegramToken":
        tgTokenActions.insert(cleaned)
        break
      case "larkAppId":
        larkAppIdActions.insert(cleaned)
        break
      case "larkAppSecret":
        larkAppSecretActions.insert(cleaned)
        break
      // "select" 列表阶段不需要粘贴
    }
  })

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg="#6c5ce7">
        <b>④ 选择运行平台</b>
      </text>
      <text fg="#636e72">使用 ↑↓ 选择，Enter 确认，Ctrl+N 跳过此环节，Esc 返回</text>

      {subStep === "select" && (
        <box flexDirection="column" gap={0}>
          {PLATFORMS.map((p, i) => {
            const isSelected = i === selectedIndex
            return (
              <box key={p.value} flexDirection="column" paddingLeft={1}>
                <text>
                  <span fg={isSelected ? "#00b894" : "#636e72"}>
                    {isSelected ? "❯ " : "  "}
                  </span>
                  <span fg={isSelected ? "#dfe6e9" : "#b2bec3"}>
                    {isSelected ? <b>{p.label}</b> : p.label}
                  </span>
                </text>
                <text>
                  <span fg="#636e72">{`    ${p.desc}`}</span>
                </text>
              </box>
            )
          })}
        </box>
      )}

      {subStep === "webPort" && (
        <box flexDirection="column" gap={1}>
          <text fg="#dfe6e9">Web 服务端口：</text>
          <box borderStyle="single" borderColor="#00b894" paddingLeft={1} paddingRight={1}>
            <InputDisplay
              value={portState.value}
              cursor={portState.cursor}
              isActive={true}
              cursorVisible={cursorVisible}
              placeholder="8192"
            />
          </box>
          <text fg="#636e72">Enter 确认  |  Ctrl+N 跳过此环节  |  Esc 返回选择</text>
        </box>
      )}

      {subStep === "wxworkBotId" && (
        <box flexDirection="column" gap={1}>
          <text fg="#dfe6e9">企业微信 Bot ID：</text>
          <text fg="#636e72">在企业微信管理后台 → 应用管理 → 智能机器人 中获取</text>
          <box borderStyle="single" borderColor="#00b894" paddingLeft={1} paddingRight={1}>
            <InputDisplay
              value={botIdState.value}
              cursor={botIdState.cursor}
              isActive={true}
              cursorVisible={cursorVisible}
              placeholder="aibXXXXXXXXXXXX"
            />
          </box>
          <text fg="#636e72">Enter 下一步  |  Ctrl+N 跳过此环节  |  Esc 返回选择</text>
        </box>
      )}

      {subStep === "wxworkSecret" && (
        <box flexDirection="column" gap={1}>
          <text fg="#dfe6e9">企业微信 Bot Secret：</text>
          <box borderStyle="single" borderColor="#00b894" paddingLeft={1} paddingRight={1}>
            <InputDisplay
              value={secretState.value}
              cursor={secretState.cursor}
              isActive={true}
              cursorVisible={cursorVisible}
              placeholder="your-bot-secret"
            />
          </box>
          <text fg="#636e72">Enter 确认  |  Ctrl+N 跳过此环节  |  Esc 返回 Bot ID</text>
        </box>
      )}

      {subStep === "telegramToken" && (
        <box flexDirection="column" gap={1}>
          <text fg="#dfe6e9">Telegram Bot Token：</text>
          <text fg="#636e72">从 @BotFather 获取，格式如 123456:ABC-DEF...</text>
          <box borderStyle="single" borderColor="#00b894" paddingLeft={1} paddingRight={1}>
            <InputDisplay
              value={tgTokenState.value}
              cursor={tgTokenState.cursor}
              isActive={true}
              cursorVisible={cursorVisible}
              placeholder="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            />
          </box>
          <text fg="#636e72">Enter 确认  |  Ctrl+N 跳过此环节  |  Esc 返回选择</text>
        </box>
      )}

      {subStep === "larkAppId" && (
        <box flexDirection="column" gap={1}>
          <text fg="#dfe6e9">飞书 App ID：</text>
          <text fg="#636e72">在飞书开放平台 → 自建应用 → 凭证与基础信息 中获取</text>
          <box borderStyle="single" borderColor="#00b894" paddingLeft={1} paddingRight={1}>
            <InputDisplay
              value={larkAppIdState.value}
              cursor={larkAppIdState.cursor}
              isActive={true}
              cursorVisible={cursorVisible}
              placeholder="cli_xxxxxxxxxxxx"
            />
          </box>
          <text fg="#636e72">Enter 下一步  |  Ctrl+N 跳过此环节  |  Esc 返回选择</text>
        </box>
      )}

      {subStep === "larkAppSecret" && (
        <box flexDirection="column" gap={1}>
          <text fg="#dfe6e9">飞书 App Secret：</text>
          <box borderStyle="single" borderColor="#00b894" paddingLeft={1} paddingRight={1}>
            <InputDisplay
              value={larkAppSecretState.value}
              cursor={larkAppSecretState.cursor}
              isActive={true}
              cursorVisible={cursorVisible}
              placeholder="your-app-secret"
            />
          </box>
          <text fg="#636e72">Enter 确认  |  Ctrl+N 跳过此环节  |  Esc 返回 App ID</text>
        </box>
      )}
    </box>
  )
}
