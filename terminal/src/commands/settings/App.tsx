import { useEffect, useMemo, useState } from "react"
import {
  OptionSelectPage,
  PageFrame,
  type OptionSelectItem,
} from "../../shared/pages/index.js"
import { gracefulExit, getRenderer, setRenderer } from "../../shared/runtime.js"
import { CONFIG_FILE_META, getConfigFileMeta } from "./config-meta.js"
import {
  getGlobalScope,
  getAgentScope,
  loadAgentList,
  listConfigFiles,
  ensureConfigFile,
  resolveEditor,
  launchEditor,
  type ConfigScope,
} from "./utils/config-io.js"

interface SettingsAppProps {
  installDir: string
}

type Step = "scope-select" | "file-select"

export function App({ installDir }: SettingsAppProps) {
  const agentInfo = useMemo(() => loadAgentList(), [installDir])
  const hasAgents = agentInfo.enabled && agentInfo.agents.length > 0

  const [step, setStep] = useState<Step>(hasAgents ? "scope-select" : "file-select")
  const [scope, setScope] = useState<ConfigScope>(() => getGlobalScope(installDir))
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // ── Scope 选项 ──

  const scopeOptions = useMemo<OptionSelectItem[]>(() => {
    const globalScope = getGlobalScope(installDir)
    const options: OptionSelectItem[] = [
      {
        value: "global",
        label: "全局配置",
        description: globalScope.configDir,
      },
    ]

    for (const agent of agentInfo.agents) {
      const agentScope = getAgentScope(installDir, agent.name)
      options.push({
        value: `agent:${agent.name}`,
        label: `Agent: ${agent.name}`,
        description: agent.description
          ? `${agent.description}  (${agentScope.configDir})`
          : agentScope.configDir,
      })
    }

    return options
  }, [installDir, agentInfo])

  // ── 文件选项 ──

  const fileOptions = useMemo<OptionSelectItem[]>(() => {
    const available = listConfigFiles(scope)
    const availableSet = new Set(available.map((f) => f.filename))

    const ordered: OptionSelectItem[] = []
    for (const meta of CONFIG_FILE_META) {
      const info = available.find((f) => f.filename === meta.filename)
      if (info) {
        const sourceTag = info.source === "runtime" ? "已配置" : "默认"
        ordered.push({
          value: meta.filename,
          label: `${meta.label}  (${meta.filename})`,
          description: `${meta.description}  [\u200b${sourceTag}]`,
        })
        availableSet.delete(meta.filename)
      }
    }

    for (const filename of availableSet) {
      const info = available.find((f) => f.filename === filename)!
      const meta = getConfigFileMeta(filename)
      const sourceTag = info.source === "runtime" ? "已配置" : "默认"
      ordered.push({
        value: filename,
        label: `${meta.label}  (${filename})`,
        description: `${meta.description}  [\u200b${sourceTag}]`,
      })
    }

    return ordered
  }, [scope])

  // ── 启动编辑器 ──

  useEffect(() => {
    if (!selectedFile) return

    const filepath = ensureConfigFile(scope, selectedFile)
    const editor = resolveEditor()

    const renderer = getRenderer()
    if (renderer) {
      setRenderer(null)
      renderer.destroy()
    }

    process.stdout.write("\x1b[?1049l")
    process.stdout.write("\x1b[?25h")

    console.log()
    console.log(`  范围: ${scope.label}`)
    console.log(`  文件: ${filepath}`)
    console.log(`  编辑器: ${editor.label}`)
    console.log()

    const result = launchEditor(filepath, editor)

    console.log()
    if (result.success) {
      console.log("  ✅ 编辑完成。修改会在下次启动 Iris 时生效。")
    } else {
      console.error(`  ❌ 无法启动编辑器: ${result.error}`)
      console.error(`  提示: 设置 EDITOR 环境变量指定编辑器`)
      console.error(`    Windows:  set EDITOR=notepad`)
      console.error(`    Linux:    export EDITOR=nano`)
    }
    console.log()
    console.log("  后续命令：")
    console.log("    iris start      — 启动 Iris（使用新配置）")
    console.log("    iris settings   — 继续编辑其他配置")
    console.log()

    process.exit(result.success ? 0 : 1)
  }, [selectedFile, scope, installDir])

  // ── 正在打开编辑器 ──

  if (selectedFile) {
    return (
      <PageFrame title="配置管理">
        <text fg="#636e72">正在打开编辑器...</text>
      </PageFrame>
    )
  }

  // ── Step 1: Scope 选择（多 Agent 时） ──

  if (step === "scope-select") {
    return (
      <OptionSelectPage
        title="配置管理"
        description="选择要编辑的配置范围。全局配置作用于所有 Agent，Agent 配置仅作用于指定 Agent。"
        options={scopeOptions}
        onSelect={(value) => {
          if (value === "global") {
            setScope(getGlobalScope(installDir))
          } else {
            const agentName = value.replace(/^agent:/, "")
            setScope(getAgentScope(installDir, agentName))
          }
          setStep("file-select")
        }}
        onBack={() => gracefulExit()}
      />
    )
  }

  // ── Step 2: 文件选择 ──

  if (fileOptions.length === 0) {
    return (
      <OptionSelectPage
        title={`配置管理 — ${scope.label}`}
        description="未找到任何配置文件。请先运行 iris onboard 初始化配置。"
        options={[{ value: "back", label: "返回" }]}
        onSelect={() => hasAgents ? setStep("scope-select") : gracefulExit()}
      />
    )
  }

  return (
    <OptionSelectPage
      title={`配置管理 — ${scope.label}`}
      description="选择配置文件，将使用编辑器打开。可通过 EDITOR 环境变量指定编辑器。"
      options={fileOptions}
      onSelect={(filename) => setSelectedFile(filename)}
      onBack={() => hasAgents ? setStep("scope-select") : gracefulExit()}
    />
  )
}
