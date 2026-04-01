import fs from "node:fs"
import path from "node:path"
import childProcess from "node:child_process"
import YAML from "yaml"
import { resolveRuntimeDataDir, resolveRuntimeConfigDir } from "../../../shared/runtime-paths.js"

// ── 类型 ──

export interface ConfigFileInfo {
  filename: string
  source: "runtime" | "example"
}

export interface EditorInfo {
  command: string
  args: string[]
  label: string
}

export interface ConfigScope {
  /** 显示名称 */
  label: string
  /** 配置目录（运行时） */
  configDir: string
  /** 示例配置目录（用于回退复制） */
  exampleDir: string
}

export interface AgentInfo {
  name: string
  description?: string
}

// ── Scope：全局 + 多 Agent ──

export function getGlobalScope(installDir: string): ConfigScope {
  return {
    label: "全局配置",
    configDir: resolveRuntimeConfigDir(),
    exampleDir: path.join(installDir, "data/configs.example"),
  }
}

export function getAgentScope(installDir: string, agentName: string): ConfigScope {
  const dataDir = resolveRuntimeDataDir()
  return {
    label: agentName,
    configDir: path.join(dataDir, "agents", agentName, "configs"),
    exampleDir: path.join(installDir, "data/configs.example"),
  }
}

/** 读取 agents.yaml，返回是否启用多 Agent 及 Agent 列表 */
export function loadAgentList(): { enabled: boolean; agents: AgentInfo[] } {
  const agentsPath = path.join(resolveRuntimeDataDir(), "agents.yaml")
  if (!fs.existsSync(agentsPath)) {
    return { enabled: false, agents: [] }
  }

  try {
    const data = YAML.parse(fs.readFileSync(agentsPath, "utf-8")) ?? {}
    if (!data.enabled) return { enabled: false, agents: [] }

    const agents: AgentInfo[] = []
    if (data.agents && typeof data.agents === "object") {
      for (const [name, def] of Object.entries(data.agents)) {
        agents.push({ name, description: (def as any)?.description })
      }
    }
    return { enabled: true, agents }
  } catch {
    return { enabled: false, agents: [] }
  }
}

// ── 列出配置文件（通用，按 scope 动态） ──

export function listConfigFiles(scope: ConfigScope): ConfigFileInfo[] {
  const files = new Map<string, ConfigFileInfo>()

  // 示例文件先加入（优先级低）
  try {
    for (const f of fs.readdirSync(scope.exampleDir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        files.set(f, { filename: f, source: "example" })
      }
    }
  } catch { /* 目录不存在 */ }

  // 运行时文件覆盖（优先级高）
  try {
    for (const f of fs.readdirSync(scope.configDir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        files.set(f, { filename: f, source: "runtime" })
      }
    }
  } catch { /* 目录不存在 */ }

  return Array.from(files.values()).sort((a, b) => a.filename.localeCompare(b.filename))
}

// ── 确保配置文件存在 ──

export function ensureConfigFile(scope: ConfigScope, filename: string): string {
  fs.mkdirSync(scope.configDir, { recursive: true })
  const targetPath = path.join(scope.configDir, filename)

  if (fs.existsSync(targetPath)) {
    return targetPath
  }

  const examplePath = path.join(scope.exampleDir, filename)
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, targetPath)
    return targetPath
  }

  fs.writeFileSync(targetPath, "", "utf-8")
  return targetPath
}

// ── 解析编辑器 ──

export function resolveEditor(): EditorInfo {
  const editorEnv = process.env.VISUAL || process.env.EDITOR
  if (editorEnv) {
    const parts = editorEnv.trim().split(/\s+/)
    return { command: parts[0], args: parts.slice(1), label: editorEnv.trim() }
  }

  if (process.platform === "win32") {
    return { command: "notepad", args: [], label: "notepad" }
  }

  try {
    childProcess.execSync("which nano", { stdio: "ignore" })
    return { command: "nano", args: [], label: "nano" }
  } catch { /* nano 不可用 */ }

  return { command: "vi", args: [], label: "vi" }
}

// ── 启动编辑器 ──

export function launchEditor(filepath: string, editor: EditorInfo): { success: boolean; error?: string } {
  const result = childProcess.spawnSync(
    editor.command,
    [...editor.args, filepath],
    { stdio: "inherit" },
  )

  if (result.error) {
    return { success: false, error: result.error.message }
  }

  return { success: true }
}
