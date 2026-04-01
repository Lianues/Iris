import extensionCommand from "./extension/index.js"
import modelsCommand from "./models/index.js"
import onboardCommand from "./onboard/index.js"
import platformsCommand from "./platforms/index.js"
import settingsCommand from "./settings/index.js"
import type { TerminalCommandDefinition } from "./types.js"

const commandList: TerminalCommandDefinition[] = [
  onboardCommand,
  platformsCommand,
  modelsCommand,
  extensionCommand,
  settingsCommand,
]

const commandMap = new Map(commandList.map((command) => [command.name, command]))

export function hasTerminalCommand(name: string | undefined): boolean {
  return !!name && commandMap.has(name)
}

export function listTerminalCommands(): string[] {
  return commandList.map((command) => command.name)
}

export function resolveTerminalCommand(name: string): TerminalCommandDefinition {
  const command = commandMap.get(name)
  if (!command) {
    throw new Error(`未知的终端命令界面: ${name}。当前可用命令: ${listTerminalCommands().join(", ")}`)
  }
  return command
}
