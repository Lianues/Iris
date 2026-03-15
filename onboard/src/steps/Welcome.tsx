import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { gracefulExit } from "../index.js"

interface WelcomeProps {
  onNext: () => void
}

export function Welcome({ onNext }: WelcomeProps) {
  useKeyboard((key) => {
    if (key.name === "return") {
      onNext()
    }
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      gracefulExit()
    }
  })

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <box flexDirection="column" borderStyle="rounded" padding={2} borderColor="#6c5ce7">
        <text fg="#6c5ce7" decoration="bold">
          {"  ╦╦═╗╦╔═╗"}
        </text>
        <text fg="#6c5ce7" decoration="bold">
          {"  ║╠╦╝║╚═╗"}
        </text>
        <text fg="#6c5ce7" decoration="bold">
          {"  ╩╩╚═╩╚═╝"}
        </text>
        <text> </text>
        <text fg="#a29bfe">模块化 AI 智能代理框架</text>
      </box>

      <text fg="#dfe6e9">
        欢迎使用 Iris！本向导将帮助你完成初始配置：
      </text>

      <box flexDirection="column" paddingLeft={2}>
        <text>
          <span fg="#00b894">①</span>
          <span fg="#dfe6e9"> 选择 LLM 提供商</span>
        </text>
        <text>
          <span fg="#00b894">②</span>
          <span fg="#dfe6e9"> 配置 API Key 和模型</span>
        </text>
        <text>
          <span fg="#00b894">③</span>
          <span fg="#dfe6e9"> 选择运行平台 (TUI / Web)</span>
        </text>
      </box>

      <text fg="#636e72">按 Enter 开始  |  按 q 退出</text>
    </box>
  )
}
