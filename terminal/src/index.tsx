import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { hasTerminalCommand, resolveTerminalCommand } from "./commands/index.js"
import { gracefulExit, setRenderer } from "./shared/runtime.js"
import { CLI_SUBCOMMANDS, runExtensionCli } from "./commands/extension/cli.js"
import { resolveTerminalInstallDir } from "./shared/install-dir.js"

function resolveRequestedCommand(argv: string[]): { commandName: string; commandArgs: string[] } {
  const args = argv.slice(2)
  const firstArg = args[0]?.trim()

  if (firstArg && hasTerminalCommand(firstArg)) {
    return {
      commandName: firstArg,
      commandArgs: args.slice(1),
    }
  }

  return {
    commandName: "onboard",
    commandArgs: args,
  }
}

async function main() {
  const { commandName, commandArgs } = resolveRequestedCommand(process.argv)

  // ── 提前 CLI 子命令分支：iris extension <subcommand> 不进 OpenTUI ──
  if (commandName === "extension" && commandArgs[0] && CLI_SUBCOMMANDS.has(commandArgs[0])) {
    // commandArgs 的位置参数是 extension 子命令/目标名，不是 install-dir 覆盖。
    // 如需覆盖安装目录，使用 IRIS_DIR；常规发行包/npm 场景会从可执行文件或 __IRIS_PKG_DIR 推导。
    const installDir = resolveTerminalInstallDir(commandArgs, process.execPath, { allowPositionalOverride: false })
    const result = await runExtensionCli(commandArgs, installDir)
    if (result.message) console.log(result.message)
    process.exit(result.exitCode ?? (result.ok ? 0 : 1))
  }

  const command = resolveTerminalCommand(commandName)
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  setRenderer(renderer)

  createRoot(renderer).render(command.render({
    commandArgs,
    executablePath: process.execPath,
  }))
}

main().catch((err) => {
  console.error("Iris Terminal 启动失败:", err)
  gracefulExit(1)
})
