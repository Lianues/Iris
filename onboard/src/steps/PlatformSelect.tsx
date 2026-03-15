import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useCursorBlink } from "../hooks/use-cursor-blink.js"
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
] as const

interface PlatformSelectProps {
  onSelect: (platform: "console" | "web", port: number) => void
  onBack: () => void
}

export function PlatformSelect({ onSelect, onBack }: PlatformSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showPortInput, setShowPortInput] = useState(false)
  const [portState, portActions] = useTextInput("8192")
  const cursorVisible = useCursorBlink()

  useKeyboard((key) => {
    if (showPortInput) {
      if (key.name === "return") {
        const portNum = parseInt(portState.value, 10)
        if (portNum > 0 && portNum < 65536) {
          onSelect("web", portNum)
        }
        return
      }
      if (key.name === "escape") {
        setShowPortInput(false)
        return
      }
      // 只允许数字输入——拦截字符，只放行数字
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        if (/^\d$/.test(key.sequence)) {
          portActions.handleKey(key)
        }
        return
      }
      // 其他编辑键（左右移动、backspace 等）正常委托
      portActions.handleKey(key)
      return
    }

    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1))
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => Math.min(PLATFORMS.length - 1, i + 1))
    }
    if (key.name === "return") {
      const selected = PLATFORMS[selectedIndex].value
      if (selected === "web") {
        setShowPortInput(true)
      } else {
        onSelect("console", 8192)
      }
    }
    if (key.name === "escape") {
      onBack()
    }
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      gracefulExit()
    }
  })

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg="#6c5ce7" decoration="bold">
        ④ 选择运行平台
      </text>
      <text fg="#636e72">使用 ↑↓ 选择，Enter 确认，Esc 返回</text>

      {!showPortInput ? (
        <box flexDirection="column" gap={0}>
          {PLATFORMS.map((p, i) => {
            const isSelected = i === selectedIndex
            return (
              <box key={p.value} flexDirection="column" paddingLeft={1}>
                <text>
                  <span fg={isSelected ? "#00b894" : "#636e72"}>
                    {isSelected ? "❯ " : "  "}
                  </span>
                  <span fg={isSelected ? "#dfe6e9" : "#b2bec3"} decoration={isSelected ? "bold" : undefined}>
                    {p.label}
                  </span>
                </text>
                <text>
                  <span fg="#636e72">{`    ${p.desc}`}</span>
                </text>
              </box>
            )
          })}
        </box>
      ) : (
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
          <text fg="#636e72">Enter 确认  |  Esc 返回选择</text>
        </box>
      )}
    </box>
  )
}
