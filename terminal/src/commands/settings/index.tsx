import { App } from "./App.js"
import { resolveTerminalInstallDir } from "../../shared/install-dir.js"
import type { TerminalCommandContext, TerminalCommandDefinition } from "../types.js"

const settingsCommand: TerminalCommandDefinition = {
  name: "settings",
  title: "Iris Settings",
  description: "配置文件查看与编辑",
  render(context: TerminalCommandContext) {
    return <App installDir={resolveTerminalInstallDir(context.commandArgs, context.executablePath)} />
  },
}

export default settingsCommand
