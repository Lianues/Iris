import { useEffect, useMemo, useState } from "react"
import { useKeyboard } from "@opentui/react"
import {
  InfoConfirmPage,
  OptionSelectPage,
  PageFrame,
  ScrollableInputPage,
  type InfoConfirmNotice,
  type InfoConfirmSection,
  type OptionSelectItem,
} from "../../shared/pages/index.js"
import { gracefulExit } from "../../shared/runtime.js"
import {
  deleteInstalledExtension,
  disableInstalledExtension,
  enableInstalledExtensionWithDependencies,
  getRemoteExtensionRequestTimeoutMs,
  getExtensionRuntimeDependencyStatus,
  inspectGitExtension,
  inspectGitExtensionUpdate,
  installGitExtension as installGitExtensionFromRuntime,
  installRemoteExtension,
  isGitExtensionUrlLike,
  listRemoteExtensions,
  loadInstalledExtensions,
  updateGitInstalledExtension,
  type ExtensionSummary,
  type GitExtensionInstallInput,
  type GitExtensionPreview,
  type GitExtensionUpdatePreview,
} from "../../shared/extensions/runtime.js"
import {
  describeScope,
  resolveInstallDirForScope,
  type InstallScope,
} from "../../shared/install-dir.js"
import { loadAgentList } from "../../shared/agents-registry.js"

interface ExtensionAppProps {
  installDir: string
  /** 由 index.tsx 解析 --global / --agent <name> 后传入；undefined 表示走 UI scope 选择 */
  initialScope?: InstallScope
}

type Step =
  | "home"
  | "scope-pick"          // 选择 global / agent
  | "agent-pick"          // scope=agent 时列出所有 agent
  | "git-input" | "git-inspect" | "git-confirm"
  | "manage-update-inspect" | "manage-update-confirm"
  | "download-platform-list" | "download-plugin-list" | "download-confirm"
  | "manage-platform-list" | "manage-plugin-list" | "manage-action" | "manage-confirm"
type ManageAction = "enable" | "disable" | "delete" | "update"
type DownloadCategory = "platform" | "plugin"
type ManageCategory = "platform" | "plugin"

/** scope-pick 后的下一步意图 */
type ScopeFollowup = "download-platform" | "download-plugin" | "install-git" | "manage-platform" | "manage-plugin"

type RemoteCatalogState =
  | { status: "idle" | "loading"; items: ExtensionSummary[]; error?: string }
  | { status: "ready"; items: ExtensionSummary[] }
  | { status: "error"; items: ExtensionSummary[]; error: string }

interface StatusPageProps {
  title: string
  description?: string
  lines: string[]
  primaryActionText?: string
  onPrimaryAction?: () => void
  onBack?: () => void
}

function StatusPage({
  title,
  description,
  lines,
  primaryActionText,
  onPrimaryAction,
  onBack,
}: StatusPageProps) {
  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      gracefulExit()
      return
    }

    if ((key.name === "return" || key.name === "r") && onPrimaryAction) {
      onPrimaryAction()
      return
    }

    if (key.name === "escape") {
      onBack?.()
    }
  })

  return (
    <PageFrame
      title={title}
      description={description}
      actions={[primaryActionText, onBack ? "Esc 返回" : undefined]}
    >
      <box flexDirection="column" borderStyle="rounded" borderColor="#636e72" padding={1} gap={0}>
        {lines.map((line, index) => (
          <text key={`${line}-${index}`} fg={index === lines.length - 1 ? "#636e72" : "#dfe6e9"}>
            {line}
          </text>
        ))}
      </box>
    </PageFrame>
  )
}

/** 4 类来源徽章 */
const SOURCE_BADGES: Record<string, string> = {
  installed: "[全局]",
  "agent-installed": "[Agent]",
  embedded: "[内嵌]",
  workspace: "[源码]",
}

function buildSourceBadge(summary: ExtensionSummary): string {
  if (!summary.localSource) return ""
  return SOURCE_BADGES[summary.localSource] ?? ""
}

function buildRemoteExtensionOption(summary: ExtensionSummary): OptionSelectItem {
  const parts = [
    summary.typeLabel,
    summary.distributionLabel,
    summary.version,
    summary.description,
  ]

  if (summary.localVersionHint) {
    parts.push(summary.localVersionHint)
  } else {
    parts.push(summary.stateLabel)
  }

  return {
    value: summary.requestedPath,
    label: summary.name,
    description: parts.join(" · "),
  }
}

function buildInstalledExtensionOption(summary: ExtensionSummary): OptionSelectItem {
  const badge = buildSourceBadge(summary)
  return {
    value: summary.requestedPath,
    label: badge ? `${badge} ${summary.name}` : summary.name,
    description: `${summary.typeLabel} · ${summary.stateLabel} · ${summary.statusDetail}`,
  }
}

function buildManageActionOptions(summary: ExtensionSummary): OptionSelectItem[] {
  // embedded 不可在 TUI 内删除/启用/关闭（属于发行包），只显示提示。
  // workspace 是源码仓库中的可选扩展，可通过 TUI 写 system.yaml 的 workspace allowlist 来开启/关闭。
  if (summary.localSource === "embedded") {
    return [{
      value: "noop",
      label: "（内嵌扩展不可在此操作）",
      description: "请通过对应层 plugins.yaml 设置 enabled: false 来禁用。",
    }]
  }

  const toggleOption: OptionSelectItem = summary.enabled
    ? {
        value: "disable",
        label: "关闭",
        description: "关闭该 extension。插件会停用，平台扩展也会停止自动加载。",
      }
    : {
        value: "enable",
        label: "开启",
        description: "开启该 extension。重新启用插件和平台扩展。",
      }

  return [
    toggleOption,
    ...(summary.installSource === "git" && summary.gitUrl
      ? [
          {
            value: "update",
            label: "升级",
            description: "按安装时记录的 Git 地址/ref/subdir 拉取最新发行包并覆盖本地版本。",
          } satisfies OptionSelectItem,
        ]
      : []),
    ...(summary.localSource === "workspace" ? [] : [{
      value: "delete",
      label: "删除",
      description: "从本地已安装目录删除该 extension。若包含插件入口，也会移除对应插件配置。",
    } satisfies OptionSelectItem]),
  ]
}

function buildActionTitle(action: ManageAction): string {
  switch (action) {
    case "enable":
      return "开启扩展"
    case "disable":
      return "关闭扩展"
    case "delete":
      return "删除扩展"
    case "update":
      return "升级扩展"
  }
}

function buildActionDescription(action: ManageAction, summary: ExtensionSummary): string {
  switch (action) {
    case "enable":
      return `将开启 ${summary.name}。`
    case "disable":
      return `将关闭 ${summary.name}，运行时会跳过该 extension。`
    case "delete":
      return `将删除 ${summary.name} 的本地安装目录，并移除相关本地插件配置。`
    case "update":
      return `将按已记录的 Git 来源拉取并升级 ${summary.name}。`
  }
}

function buildDependencyNotice(summary: ExtensionSummary): InfoConfirmNotice | undefined {
  let dependencyStatus: ReturnType<typeof getExtensionRuntimeDependencyStatus>
  try {
    dependencyStatus = getExtensionRuntimeDependencyStatus(summary)
  } catch {
    return undefined
  }
  if (dependencyStatus.missingDependencies.length === 0) return undefined
  const specs = dependencyStatus.missingDependencies.map((name) => {
    const spec = dependencyStatus.dependencySpecs[name]
    return spec ? `${name}@${spec}` : name
  })
  return {
    tone: "warning",
    title: "需要安装依赖",
    lines: [
      `该 extension 缺少运行时依赖：${specs.join(", ")}`,
      "确认后将执行 npm install，把缺失依赖安装到该 extension 的 node_modules 下。",
      "如不希望联网或执行第三方依赖安装脚本，请按 Esc / n 返回。",
    ],
  }
}

function categoryTitle(category: "platform" | "plugin", action: "download" | "manage"): string {
  const typeLabel = category === "platform" ? "平台" : "插件"
  return action === "download" ? `下载${typeLabel}` : `管理${typeLabel}`
}

function normalizeOptionalInput(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function buildGitInput(values: Record<string, string>): GitExtensionInstallInput {
  return {
    url: values.url.trim(),
    ref: normalizeOptionalInput(values.ref),
    subdir: normalizeOptionalInput(values.subdir),
  }
}

function validateGitUrl(value: string): string | undefined {
  if (!value.trim()) return "请填写 Git 地址"
  return isGitExtensionUrlLike(value.trim())
    ? undefined
    : "仅支持 https://、ssh:// 或 git@host:repo.git 格式"
}

function validateGitSubdir(value: string): string | undefined {
  if (!value.trim()) return undefined
  return value.includes("..") ? "子目录不能包含 .." : undefined
}

export function App({ installDir, initialScope }: ExtensionAppProps) {
  const [step, setStep] = useState<Step>("home")
  /** 当前 scope（管理列表/安装目标层）。默认 global；可由 initialScope 或 UI 选择覆盖 */
  const [currentScope, setCurrentScope] = useState<InstallScope>(initialScope ?? { kind: "global" })
  /** scope-pick 完成后要跳转的下一步意图 */
  const [scopeFollowup, setScopeFollowup] = useState<ScopeFollowup | null>(null)
  const [remoteCatalogState, setRemoteCatalogState] = useState<RemoteCatalogState>({ status: "idle", items: [] })
  const [remoteCatalogRefreshToken, setRemoteCatalogRefreshToken] = useState(0)
  const [installedRefreshToken, setInstalledRefreshToken] = useState(0)
  const installedExtensions = useMemo(() => {
    const opts = currentScope.kind === "agent"
      ? { installDir, agentExtensionsDir: resolveInstallDirForScope(currentScope), agentName: currentScope.agentName }
      : { installDir }
    return loadInstalledExtensions(opts)
  }, [installedRefreshToken, currentScope, installDir])
  const [selectedRemoteExtension, setSelectedRemoteExtension] = useState<ExtensionSummary | null>(null)
  const [selectedInstalledExtension, setSelectedInstalledExtension] = useState<ExtensionSummary | null>(null)
  const [selectedManageAction, setSelectedManageAction] = useState<ManageAction | null>(null)
  const [gitInstallInput, setGitInstallInput] = useState<GitExtensionInstallInput | null>(null)
  const [gitPreview, setGitPreview] = useState<GitExtensionPreview | null>(null)
  const [gitPreviewError, setGitPreviewError] = useState<string | null>(null)
  const [gitUpdatePreview, setGitUpdatePreview] = useState<GitExtensionUpdatePreview | null>(null)
  const [gitUpdateError, setGitUpdateError] = useState<string | null>(null)
  const [downloadCategory, setDownloadCategory] = useState<DownloadCategory>("platform")
  const [manageCategory, setManageCategory] = useState<ManageCategory>("platform")
  const remoteTimeoutMs = useMemo(() => getRemoteExtensionRequestTimeoutMs(), [])
  /** 缓存 agent 列表（agent-pick 页面用） */
  const agentList = useMemo(() => loadAgentList(), [])

  /** 把 scope-pick 后的意图转换成实际 step，并更新分类。 */
  const dispatchScopeFollowup = (followup: ScopeFollowup) => {
    switch (followup) {
      case "download-platform":
        setDownloadCategory("platform")
        setStep("download-platform-list")
        return
      case "download-plugin":
        setDownloadCategory("plugin")
        setStep("download-plugin-list")
        return
      case "install-git":
        setStep("git-input")
        return
      case "manage-platform":
        setManageCategory("platform")
        setStep("manage-platform-list")
        return
      case "manage-plugin":
        setManageCategory("plugin")
        setStep("manage-plugin-list")
        return
    }
  }

  /**
   * 进入需要 scope 的子流程。
   *   - 如果 agentList 为空 → 默认 global，跳过 scope-pick
   *   - 否则进入 scope-pick 页面
   */
  const beginScopedFlow = (followup: ScopeFollowup) => {
    setScopeFollowup(followup)
    if (agentList.length === 0) {
      setCurrentScope({ kind: "global" })
      dispatchScopeFollowup(followup)
    } else {
      setStep("scope-pick")
    }
  }

  // 按类型过滤
  const remotePlatforms = useMemo(() => remoteCatalogState.items.filter((e) => e.hasPlatforms), [remoteCatalogState.items])
  const remotePlugins = useMemo(() => remoteCatalogState.items.filter((e) => e.hasPlugin), [remoteCatalogState.items])
  const installedPlatforms = useMemo(() => installedExtensions.filter((e) => e.hasPlatforms), [installedExtensions])
  const installedPlugins = useMemo(() => installedExtensions.filter((e) => e.hasPlugin), [installedExtensions])

  const isDownloadStep = step === "download-platform-list" || step === "download-plugin-list"

  useEffect(() => {
    if (!isDownloadStep) return
    let cancelled = false
    setRemoteCatalogState({ status: "loading", items: [] })

    listRemoteExtensions(
      installDir,
      currentScope.kind === "agent"
        ? { agentExtensionsDir: resolveInstallDirForScope(currentScope), agentName: currentScope.agentName }
        : undefined,
    )
      .then((items) => {
        if (cancelled) return
        setRemoteCatalogState({ status: "ready", items })
      })
      .catch((error) => {
        if (cancelled) return
        setRemoteCatalogState({
          status: "error",
          items: [],
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [installDir, isDownloadStep, remoteCatalogRefreshToken, currentScope])

  useEffect(() => {
    if (step !== "git-inspect" || !gitInstallInput) return
    let cancelled = false
    setGitPreview(null)
    setGitPreviewError(null)

    inspectGitExtension(gitInstallInput, {}, currentScope)
      .then((preview) => {
        if (cancelled) return
        setGitPreview(preview)
        setStep("git-confirm")
      })
      .catch((error) => {
        if (cancelled) return
        setGitPreviewError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [step, gitInstallInput, currentScope])

  useEffect(() => {
    if (step !== "manage-update-inspect" || !selectedInstalledExtension) return
    let cancelled = false
    setGitUpdatePreview(null)
    setGitUpdateError(null)

    inspectGitExtensionUpdate(selectedInstalledExtension)
      .then((preview) => {
        if (cancelled) return
        setGitUpdatePreview(preview)
        setStep("manage-update-confirm")
      })
      .catch((error) => {
        if (cancelled) return
        setGitUpdateError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [step, selectedInstalledExtension])

  // ==================== 首页 ====================
  if (step === "home") {
    return (
      <OptionSelectPage
        title="扩展安装与管理"
        description={`当前 scope：${describeScope(currentScope)}。选择操作；下载/安装/管理时会再次确认目标 scope（全局或某 agent）。`}
        options={[
          {
            value: "download-platform",
            label: "下载平台",
            description: "从远程仓库浏览和下载平台类扩展（如 Telegram、Discord 等通信平台）。",
          },
          {
            value: "download-plugin",
            label: "下载插件",
            description: "从远程仓库浏览和下载插件类扩展（如 memory、cron 等功能增强）。",
          },
          {
            value: "install-git",
            label: "拉取 Git 扩展",
            description: "输入 Git 仓库地址拉取并安装第三方 extension 发行包，支持 branch/tag/commit 与子目录。",
          },
          {
            value: "manage-platform",
            label: "管理平台",
            description: "查看本地已安装的平台扩展，执行开启、关闭或删除。",
          },
          {
            value: "manage-plugin",
            label: "管理插件",
            description: "查看本地已安装的插件扩展，执行开启、关闭或删除。",
          },
        ]}
        onSelect={(value) => {
          switch (value) {
            case "download-platform":
              beginScopedFlow("download-platform")
              return
            case "download-plugin":
              beginScopedFlow("download-plugin")
              return
            case "install-git":
              beginScopedFlow("install-git")
              return
            case "manage-platform":
              beginScopedFlow("manage-platform")
              return
            case "manage-plugin":
              beginScopedFlow("manage-plugin")
              return
          }
        }}
        onBack={() => gracefulExit()}
      />
    )
  }

  // ==================== Scope 选择 ====================
  if (step === "scope-pick" && scopeFollowup) {
    return (
      <OptionSelectPage
        title="选择安装/管理范围"
        description={`选择「全局」会作用于 ~/.iris/extensions/，所有 agent 共享；选择某个 agent 会作用于 ~/.iris/agents/<id>/extensions/，仅该 agent 可见，且优先级高于全局。`}
        options={[
          {
            value: "__global__",
            label: "全局",
            description: "~/.iris/extensions/ — 所有 agent 共享可见",
          },
          {
            value: "__agent__",
            label: "指定 agent",
            description: `下一步选择具体 agent (~/.iris/agents/<id>/extensions/) — 共 ${agentList.length} 个可选`,
          },
        ]}
        onSelect={(value) => {
          if (value === "__global__") {
            setCurrentScope({ kind: "global" })
            const followup = scopeFollowup
            setScopeFollowup(null)
            dispatchScopeFollowup(followup)
          } else {
            setStep("agent-pick")
          }
        }}
        onBack={() => {
          setScopeFollowup(null)
          setStep("home")
        }}
      />
    )
  }

  // ==================== Agent 选择 ====================
  if (step === "agent-pick" && scopeFollowup) {
    return (
      <OptionSelectPage
        title="选择 agent"
        description="选择要操作的 agent。该 agent 的扩展位于 ~/.iris/agents/<id>/extensions/，仅对该 agent 生效。"
        options={agentList.map((a) => ({
          value: a.name,
          label: a.name,
          description: a.description ?? "(无描述)",
        }))}
        onSelect={(name) => {
          setCurrentScope({ kind: "agent", agentName: name })
          const followup = scopeFollowup
          setScopeFollowup(null)
          dispatchScopeFollowup(followup)
        }}
        onBack={() => setStep("scope-pick")}
      />
    )
  }

  // ==================== Git 安装输入 ====================
  if (step === "git-input") {
    return (
      <ScrollableInputPage
        title="从 Git 安装扩展"
        description="输入包含 manifest.json 与可运行入口（例如 dist/index.mjs）的 extension Git 仓库。默认不会执行第三方 install/build 脚本。"
        fields={[
          {
            key: "url",
            label: "Git 地址",
            description: "支持 https://github.com/user/repo.git、ssh://... 或 git@github.com:user/repo.git。",
            placeholder: "https://github.com/user/iris-extension-demo.git",
            required: true,
            validate: validateGitUrl,
            normalizePastedText: (text) => text.trim(),
          },
          {
            key: "ref",
            label: "Branch / Tag / Commit（可选）",
            description: "不填写时使用仓库默认分支。也可在 URL 后使用 #main 片段写法。",
            placeholder: "main / v1.0.0 / commit SHA",
            normalizePastedText: (text) => text.trim(),
          },
          {
            key: "subdir",
            label: "仓库子目录（可选）",
            description: "当 extension 不在仓库根目录时填写，例如 extensions/demo。也可在 URL 后使用 #main:extensions/demo。",
            placeholder: "extensions/demo",
            validate: validateGitSubdir,
            normalizePastedText: (text) => text.trim().replace(/^\.\//, ""),
          },
        ]}
        onSubmit={(values) => {
          setGitInstallInput(buildGitInput(values))
          setGitPreview(null)
          setGitPreviewError(null)
          setStep("git-inspect")
        }}
        onBack={() => setStep("home")}
        maxVisibleFields={3}
      />
    )
  }

  // ==================== Git 预检 ====================
  if (step === "git-inspect") {
    if (gitPreviewError) {
      return (
        <StatusPage
          title="从 Git 安装扩展"
          description="Git extension 预检失败。"
          lines={[
            gitPreviewError,
            "按 Enter 重试，或按 Esc 返回输入页。",
          ]}
          primaryActionText="Enter 重试"
          onPrimaryAction={() => {
            setGitPreviewError(null)
            if (gitInstallInput) setGitInstallInput({ ...gitInstallInput })
          }}
          onBack={() => setStep("git-input")}
        />
      )
    }

    return (
      <StatusPage
        title="从 Git 安装扩展"
        description="正在克隆仓库并读取 extension manifest。"
        lines={[
          gitInstallInput ? `Git 地址：${gitInstallInput.url}` : "Git 地址：未填写",
          gitInstallInput?.ref ? `Ref：${gitInstallInput.ref}` : "Ref：默认分支或 URL 片段",
          gitInstallInput?.subdir ? `子目录：${gitInstallInput.subdir}` : "子目录：仓库根目录或 URL 片段",
          "请稍候。不会执行第三方 install/build 脚本。",
        ]}
        onBack={() => setStep("git-input")}
      />
    )
  }

  // ==================== Git 安装确认 ====================
  if (step === "git-confirm" && gitPreview) {
    const summary = gitPreview.summary
    const sections: InfoConfirmSection[] = [
      {
        rows: [
          { label: "Git 地址", value: gitPreview.target.url, valueBold: true },
          { label: "Git ref", value: gitPreview.target.ref, emptyText: "默认分支" },
          { label: "Git commit", value: gitPreview.commit, emptyText: "未读取到 commit" },
          { label: "仓库子目录", value: gitPreview.target.subdir, emptyText: "仓库根目录" },
          { label: "类型", value: summary.typeLabel },
          { label: "类型说明", value: summary.typeDetail },
          { label: "分发形态", value: summary.distributionLabel, valueBold: true, valueTone: summary.distributionMode === "bundled" ? "success" : "warning" },
          { label: "分发表现", value: summary.distributionDetail },
          { label: "名称", value: summary.name, valueBold: true },
          { label: "版本", value: summary.version },
          { label: "描述", value: summary.description },
          { label: "运行入口", value: summary.runnableEntries.join(", ") || "未发现可运行入口" },
          { label: "当前状态", value: summary.stateLabel },
          { label: "状态说明", value: summary.statusDetail },
        ],
      },
    ]

    const notices: InfoConfirmNotice[] = [
      {
        tone: "warning",
        title: "安全提示",
        lines: [
          "Git extension 是第三方代码，会与 Iris 在同一进程中运行，拥有较高权限。",
          "当前安装流程只克隆并复制已构建发行包，不会执行第三方 install/build 脚本。",
          "请确认仓库来源可信，并优先使用固定 tag 或 commit。",
        ],
      },
      {
        tone: "warning",
        title: "依赖安装提示",
        lines: [
          "如果安装后的 extension 声明了未安装的运行时依赖，确认后会执行 npm install 安装缺失项。",
          "如不希望联网或执行第三方依赖安装脚本，请按 Esc / n 返回。",
        ],
      },
    ]

    return (
      <InfoConfirmPage
        title="确认从 Git 安装"
        description="确认无误后将 extension 安装到 ~/.iris/extensions/<manifest.name>/。"
        sections={sections}
        notices={notices}
        onConfirm={async () => {
          if (summary.distributionMode !== "bundled") {
            throw new Error("当前 Git 仓库缺少可运行入口，例如 dist/index.mjs，不可直接安装。")
          }
          const installed = await installGitExtensionFromRuntime({
            url: gitPreview.target.url,
            ref: gitPreview.target.ref,
            subdir: gitPreview.target.subdir,
          }, {}, currentScope)
          await enableInstalledExtensionWithDependencies(installed)
          setInstalledRefreshToken((value) => value + 1)
          setRemoteCatalogState({ status: "idle", items: [] })
          setTimeout(() => {
            setGitPreview(null)
            setGitInstallInput(null)
            setStep("home")
          }, 1200)
        }}
        onBack={() => setStep("git-input")}
        confirmActionText="Enter / y 开始安装"
        backActionText="Esc / n 返回输入"
        successTitle="✅ Git 扩展安装完成！"
        successLines={[
          `${summary.name} 已安装并自动注册。`,
          "若当前 Iris 已在运行，部分扩展可能需要重启或 reload 后完全生效。",
          "1.2 秒后将返回首页。",
        ]}
      />
    )
  }

  // ==================== 下载列表（平台 / 插件） ====================
  if (isDownloadStep) {
    const title = categoryTitle(downloadCategory, "download")
    const filteredItems = downloadCategory === "platform" ? remotePlatforms : remotePlugins
    const emptyLabel = downloadCategory === "platform" ? "平台" : "插件"

    if (remoteCatalogState.status === "idle" || remoteCatalogState.status === "loading") {
      return (
        <StatusPage
          title={title}
          description="正在从远程仓库读取 extension 目录。"
          lines={[
            "请稍候。",
            `单个远程请求超过 ${remoteTimeoutMs}ms 会自动超时。`,
            "读取完成后会显示类型、名称、描述和当前安装状态。",
          ]}
          onBack={() => setStep("home")}
        />
      )
    }

    if (remoteCatalogState.status === "error") {
      return (
        <StatusPage
          title={title}
          description="远程 extension 列表读取失败。"
          lines={[
            remoteCatalogState.error,
            "按 Enter 重试，或按 Esc 返回。",
          ]}
          primaryActionText="Enter 重试"
          onPrimaryAction={() => setRemoteCatalogRefreshToken((value) => value + 1)}
          onBack={() => setStep("home")}
        />
      )
    }

    if (filteredItems.length === 0) {
      return (
        <StatusPage
          title={title}
          description={`远程仓库中没有可用的${emptyLabel}扩展。`}
          lines={[
            `当前未发现可用的${emptyLabel}扩展。`,
            "请稍后再试，或检查远程仓库配置。",
          ]}
          onBack={() => setStep("home")}
        />
      )
    }

    return (
      <OptionSelectPage
        title={title}
        description={`从远程仓库选择一个${emptyLabel}扩展。列表中会显示更细的类型信息，以及本地已安装或源码内嵌版本提示。`}
        options={filteredItems.map(buildRemoteExtensionOption)}
        onSelect={(requestedPath) => {
          const selected = filteredItems.find((item) => item.requestedPath === requestedPath)
          if (!selected) return
          setSelectedRemoteExtension(selected)
          setStep("download-confirm")
        }}
        onBack={() => setStep("home")}
      />
    )
  }

  // ==================== 下载确认 ====================
  if (step === "download-confirm" && selectedRemoteExtension) {
    const title = categoryTitle(downloadCategory, "download")

    const sections: InfoConfirmSection[] = [
      {
        rows: [
          { label: "类型", value: selectedRemoteExtension.typeLabel },
          { label: "类型说明", value: selectedRemoteExtension.typeDetail },
          { label: "分发形态", value: selectedRemoteExtension.distributionLabel, valueBold: true },
          { label: "分发表现", value: selectedRemoteExtension.distributionDetail },
          { label: "名称", value: selectedRemoteExtension.name, valueBold: true },
          { label: "版本", value: selectedRemoteExtension.version },
          { label: "描述", value: selectedRemoteExtension.description },
          { label: "运行入口", value: selectedRemoteExtension.runnableEntries.join(", ") || "未发现可运行入口" },
          { label: "远程目录", value: `extensions/${selectedRemoteExtension.requestedPath}` },
          ...(selectedRemoteExtension.localVersionHint
            ? [{ label: "本地兼容", value: selectedRemoteExtension.localVersionHint }]
            : []),
          { label: "当前状态", value: selectedRemoteExtension.stateLabel },
        ],
      },
    ]

    const notices: InfoConfirmNotice[] = [
      {
        tone: "info",
        title: "说明",
        lines: [
          "安装目录：~/.iris/extensions/<manifest.name>/。",
          selectedRemoteExtension.localSource === "installed"
            ? `检测到本地已安装版本 ${selectedRemoteExtension.localVersion}。确认后会覆盖用户目录中的已安装版本。`
            : selectedRemoteExtension.localSource === "embedded"
              ? `检测到当前安装目录内嵌版本 ${selectedRemoteExtension.localVersion}。安装后，运行时会优先加载用户目录中的已安装版本。`
              : "当前本地未发现同名 extension。",
          selectedRemoteExtension.hasPlugin
            ? `该 extension 的可运行入口为：${selectedRemoteExtension.runnableEntries.join(", ") || "未发现"}。`
            : `该 extension 的平台运行入口为：${selectedRemoteExtension.runnableEntries.join(", ") || "未发现"}。`,
          selectedRemoteExtension.distributionMode === "bundled"
            ? "当前远程包已通过可直接安装校验。"
            : "当前远程包缺少可运行入口，例如 dist/index.mjs，因此不是可直接安装的发行包。",
          "安装成功后扩展将自动注册，无需手动配置。",
        ],
      },
      {
        tone: "warning",
        title: "依赖安装提示",
        lines: [
          "如果安装后的 extension 声明了未安装的运行时依赖，确认后会执行 npm install 安装缺失项。",
          "如不希望联网或执行第三方依赖安装脚本，请按 Esc / n 返回。",
        ],
      },
    ]

    const downloadListStep = downloadCategory === "platform" ? "download-platform-list" : "download-plugin-list"

    return (
      <InfoConfirmPage
        title={`确认${title}`}
        description="确认无误后开始下载安装。"
        sections={sections}
        notices={notices}
        onConfirm={async () => {
          if (selectedRemoteExtension.distributionMode !== "bundled") {
            throw new Error("当前远程包缺少可运行入口，例如 dist/index.mjs，不可直接安装。")
          }
          const installed = await installRemoteExtension(selectedRemoteExtension.requestedPath, currentScope)
          await enableInstalledExtensionWithDependencies(installed)
          setInstalledRefreshToken((value) => value + 1)
          setRemoteCatalogState({ status: "idle", items: [] })
          setTimeout(() => {
            setSelectedRemoteExtension(null)
            setStep(downloadListStep)
          }, 1200)
        }}
        onBack={() => setStep(downloadListStep)}
        confirmActionText="Enter / y 开始下载"
        backActionText="Esc / n 返回列表"
        successTitle="✅ 下载完成！"
        successLines={[
          `${selectedRemoteExtension.name} 已安装并自动注册。`,
          "1.2 秒后将返回列表。",
        ]}
      />
    )
  }

  // ==================== 管理列表（平台 / 插件） ====================
  if (step === "manage-platform-list" || step === "manage-plugin-list") {
    const title = categoryTitle(manageCategory, "manage")
    const filteredInstalled = manageCategory === "platform" ? installedPlatforms : installedPlugins
    const emptyLabel = manageCategory === "platform" ? "平台" : "插件"
    const downloadHint = manageCategory === "platform" ? "下载平台" : "下载插件"
    const scopeHint = describeScope(currentScope)

    if (filteredInstalled.length === 0) {
      return (
        <StatusPage
          title={`${title} · ${scopeHint}`}
          description={`当前 scope (${scopeHint}) 没有本地已安装的${emptyLabel}扩展。`}
          lines={[
            `尚未在 ${resolveInstallDirForScope(currentScope)} 下发现已安装的${emptyLabel}扩展。`,
            `请先进入「${downloadHint}」流程，或使用命令行安装。`,
          ]}
          onBack={() => setStep("home")}
        />
      )
    }

    return (
      <OptionSelectPage
        title={`${title} · ${scopeHint}`}
        description={`选择一个已发现的${emptyLabel}扩展，然后执行开启、关闭或删除。徽章 [全局]/[Agent]/[内嵌]/[源码] 标识其来源。`}
        options={filteredInstalled.map(buildInstalledExtensionOption)}
        onSelect={(requestedPath) => {
          const selected = filteredInstalled.find((item) => item.requestedPath === requestedPath)
          if (!selected) return
          setSelectedInstalledExtension(selected)
          setStep("manage-action")
        }}
        onBack={() => setStep("home")}
      />
    )
  }

  // ==================== 管理操作选择 ====================
  if (step === "manage-action" && selectedInstalledExtension) {
    const title = categoryTitle(manageCategory, "manage")
    const manageListStep = manageCategory === "platform" ? "manage-platform-list" : "manage-plugin-list"

    return (
      <OptionSelectPage
        title={title}
        description={`${buildSourceBadge(selectedInstalledExtension)} ${selectedInstalledExtension.name} · ${selectedInstalledExtension.typeLabel} · ${selectedInstalledExtension.stateLabel} · ${selectedInstalledExtension.statusDetail}`}
        options={buildManageActionOptions(selectedInstalledExtension)}
        onSelect={(value) => {
          if (value === "noop") return
          const action = value as ManageAction
          setSelectedManageAction(action)
          if (action === "update") {
            setGitUpdatePreview(null)
            setGitUpdateError(null)
            setStep("manage-update-inspect")
          } else {
            setStep("manage-confirm")
          }
        }}
        onBack={() => setStep(manageListStep)}
      />
    )
  }

  // ==================== Git 升级预检 ====================
  if (step === "manage-update-inspect" && selectedInstalledExtension) {
    if (gitUpdateError) {
      return (
        <StatusPage
          title="升级扩展"
          description="Git extension 升级预检失败。"
          lines={[
            gitUpdateError,
            "按 Enter 重试，或按 Esc 返回操作选择。",
          ]}
          primaryActionText="Enter 重试"
          onPrimaryAction={() => {
            setGitUpdateError(null)
            setGitUpdatePreview(null)
            setSelectedInstalledExtension({ ...selectedInstalledExtension })
          }}
          onBack={() => setStep("manage-action")}
        />
      )
    }

    return (
      <StatusPage
        title="升级扩展"
        description="正在按已记录的 Git 来源拉取并读取 extension manifest。"
        lines={[
          `名称：${selectedInstalledExtension.name}`,
          selectedInstalledExtension.gitUrl ? `Git 地址：${selectedInstalledExtension.gitUrl}` : "Git 地址：未记录",
          selectedInstalledExtension.gitRef ? `Ref：${selectedInstalledExtension.gitRef}` : "Ref：默认分支",
          selectedInstalledExtension.gitSubdir ? `子目录：${selectedInstalledExtension.gitSubdir}` : "子目录：仓库根目录",
          "请稍候。不会执行第三方 install/build 脚本。",
        ]}
        onBack={() => setStep("manage-action")}
      />
    )
  }

  // ==================== Git 升级确认 ====================
  if (step === "manage-update-confirm" && selectedInstalledExtension && gitUpdatePreview) {
    const nextSummary = gitUpdatePreview.summary
    const manageListStep = manageCategory === "platform" ? "manage-platform-list" : "manage-plugin-list"
    const sections: InfoConfirmSection[] = [
      {
        rows: [
          { label: "操作", value: "升级扩展", valueBold: true },
          { label: "名称", value: selectedInstalledExtension.name, valueBold: true },
          { label: "当前版本", value: selectedInstalledExtension.version },
          { label: "新版本", value: nextSummary.version, valueBold: true },
          { label: "当前 commit", value: gitUpdatePreview.previousCommit, emptyText: "未知" },
          { label: "远程 commit", value: gitUpdatePreview.commit, emptyText: "未知", valueBold: true },
          { label: "Git 地址", value: gitUpdatePreview.target.url },
          { label: "Git ref", value: gitUpdatePreview.target.ref, emptyText: "默认分支" },
          { label: "仓库子目录", value: gitUpdatePreview.target.subdir, emptyText: "仓库根目录" },
          { label: "类型", value: nextSummary.typeLabel },
          { label: "分发形态", value: nextSummary.distributionLabel, valueTone: nextSummary.distributionMode === "bundled" ? "success" : "warning" },
          { label: "分发表现", value: nextSummary.distributionDetail },
          { label: "运行入口", value: nextSummary.runnableEntries.join(", ") || "未发现可运行入口" },
          { label: "升级判断", value: gitUpdatePreview.sameCommit ? "远程 commit 与当前记录一致，仍可重新覆盖安装。" : "检测到远程 commit 与当前记录不同。" },
        ],
      },
    ]
    const notices: InfoConfirmNotice[] = [
      {
        tone: "warning",
        title: "升级说明",
        lines: [
          "升级会用 Git 仓库中的发行包覆盖本地 extension 目录。",
          "当前流程不会执行第三方 install/build 脚本；仓库必须已经包含可运行入口。",
          selectedInstalledExtension.enabled
            ? "升级完成后会保留当前启用状态。"
            : "升级完成后会保留当前关闭/未启用状态。",
        ],
      },
      ...(selectedInstalledExtension.enabled ? [{
        tone: "warning" as const,
        title: "依赖安装提示",
        lines: [
          "如果升级后的 extension 声明了未安装的运行时依赖，确认后会执行 npm install 安装缺失项。",
          "如不希望联网或执行第三方依赖安装脚本，请按 Esc / n 返回。",
        ],
      }] : []),
    ]

    return (
      <InfoConfirmPage
        title="确认升级扩展"
        description="确认后将拉取 Git 来源并覆盖本地安装目录。"
        sections={sections}
        notices={notices}
        onConfirm={async () => {
          if (nextSummary.distributionMode !== "bundled") {
            throw new Error("当前 Git 仓库缺少可运行入口，例如 dist/index.mjs，不可直接升级。")
          }
          await updateGitInstalledExtension(selectedInstalledExtension)
          setInstalledRefreshToken((value) => value + 1)
          setTimeout(() => {
            setGitUpdatePreview(null)
            setGitUpdateError(null)
            setSelectedManageAction(null)
            setSelectedInstalledExtension(null)
            setStep(manageListStep)
          }, 1200)
        }}
        onBack={() => setStep("manage-action")}
        confirmActionText="Enter / y 开始升级"
        backActionText="Esc / n 返回操作"
        successTitle="✅ 扩展升级完成！"
        successLines={[
          `${selectedInstalledExtension.name} 已按 Git 来源升级。`,
          "若当前 Iris 已在运行，部分扩展可能需要重启或 reload 后完全生效。",
          "1.2 秒后将返回列表。",
        ]}
      />
    )
  }

  // ==================== 管理确认 ====================
  if (step === "manage-confirm" && selectedInstalledExtension && selectedManageAction) {
    const manageListStep = manageCategory === "platform" ? "manage-platform-list" : "manage-plugin-list"
    const dependencyNotice = selectedManageAction === "enable" ? buildDependencyNotice(selectedInstalledExtension) : undefined
    const notices = dependencyNotice ? [dependencyNotice] : []

    const sections: InfoConfirmSection[] = [
      {
        rows: [
          { label: "操作", value: buildActionTitle(selectedManageAction), valueBold: true },
          { label: "类型", value: selectedInstalledExtension.typeLabel },
          { label: "分发形态", value: selectedInstalledExtension.distributionLabel },
          { label: "类型说明", value: selectedInstalledExtension.typeDetail },
          { label: "分发表现", value: selectedInstalledExtension.distributionDetail },
          { label: "名称", value: selectedInstalledExtension.name },
          { label: "版本", value: selectedInstalledExtension.version },
          { label: "当前状态", value: selectedInstalledExtension.stateLabel },
          { label: "运行入口", value: selectedInstalledExtension.runnableEntries.join(", ") || "未发现可运行入口" },
          { label: "状态说明", value: selectedInstalledExtension.statusDetail },
          { label: "说明", value: buildActionDescription(selectedManageAction, selectedInstalledExtension) },
        ],
      },
    ]

    return (
      <InfoConfirmPage
        title={buildActionTitle(selectedManageAction)}
        description="确认后将修改本地 extension 状态。"
        sections={sections}
        notices={notices}
        onConfirm={async () => {
          if (selectedManageAction === "enable") {
            await enableInstalledExtensionWithDependencies(selectedInstalledExtension)
          } else if (selectedManageAction === "disable") {
            disableInstalledExtension(selectedInstalledExtension)
          } else if (selectedManageAction === "delete") {
            deleteInstalledExtension(selectedInstalledExtension)
          } else {
            throw new Error("升级操作需要先完成 Git 预检")
          }

          setInstalledRefreshToken((value) => value + 1)
          setTimeout(() => {
            setSelectedManageAction(null)
            setSelectedInstalledExtension(null)
            setStep(manageListStep)
          }, 1200)
        }}
        onBack={() => setStep("manage-action")}
        confirmActionText={dependencyNotice ? "Enter / y 安装依赖并开启" : undefined}
        successTitle={`✅ ${buildActionTitle(selectedManageAction)}已完成！`}
        successLines={["1.2 秒后将返回列表。"]}
      />
    )
  }

  // ==================== 兜底 ====================
  return (
    <StatusPage
      title="扩展安装与管理"
      description="当前状态不可用。"
      lines={[
        "未找到可显示的页面状态。",
        "按 Esc 返回首页。",
      ]}
      onBack={() => setStep("home")}
    />
  )
}
