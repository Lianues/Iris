import { useEffect, useMemo, useState } from "react"
import { useKeyboard } from "@opentui/react"
import {
  InfoConfirmPage,
  OptionSelectPage,
  PageFrame,
  type InfoConfirmNotice,
  type InfoConfirmSection,
  type OptionSelectItem,
} from "../../shared/pages/index.js"
import { gracefulExit } from "../../shared/runtime.js"
import {
  deleteInstalledExtension,
  disableInstalledExtension,
  enableInstalledExtension,
  getRemoteExtensionRequestTimeoutMs,
  installRemoteExtension,
  listRemoteExtensions,
  loadInstalledExtensions,
  type ExtensionSummary,
} from "../../shared/extensions/runtime.js"

interface ExtensionAppProps {
  installDir: string
}

type Step = "home" | "download-list" | "download-confirm" | "manage-list" | "manage-action" | "manage-confirm"
type ManageAction = "enable" | "disable" | "delete"

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
  return {
    value: summary.requestedPath,
    label: summary.name,
    description: `${summary.typeLabel} · ${summary.stateLabel} · ${summary.statusDetail}`,
  }
}

function buildManageActionOptions(summary: ExtensionSummary): OptionSelectItem[] {
  const toggleOption: OptionSelectItem = summary.enabled
    ? {
        value: "disable",
        label: "关闭",
        description: "关闭该 extension。插件会停用，平台扩展也会停止自动加载。",
      }
    : {
        value: "enable",
        label: "开启",
        description: "开启该 extension。若包含插件入口，也会同时写入 plugins.yaml。",
      }

  return [
    toggleOption,
    {
      value: "delete",
      label: "删除",
      description: "从本地已安装目录删除该 extension。若包含插件入口，也会移除对应插件配置。",
    },
  ]
}

function buildActionTitle(action: ManageAction): string {
  switch (action) {
    case "enable":
      return "开启插件"
    case "disable":
      return "关闭插件"
    case "delete":
      return "删除插件"
  }
}

function buildActionDescription(action: ManageAction, summary: ExtensionSummary): string {
  switch (action) {
    case "enable":
      return summary.stateLabel === "平台已启用，插件未启用"
        ? `将为 ${summary.name} 补启用插件入口。`
        : `将开启 ${summary.name}。`
    case "disable":
      return `将关闭 ${summary.name}，运行时会跳过该 extension。`
    case "delete":
      return `将删除 ${summary.name} 的本地安装目录，并移除相关本地插件配置。`
  }
}

export function App({ installDir }: ExtensionAppProps) {
  const [step, setStep] = useState<Step>("home")
  const [remoteCatalogState, setRemoteCatalogState] = useState<RemoteCatalogState>({ status: "idle", items: [] })
  const [remoteCatalogRefreshToken, setRemoteCatalogRefreshToken] = useState(0)
  const [installedRefreshToken, setInstalledRefreshToken] = useState(0)
  const installedExtensions = useMemo(() => loadInstalledExtensions(), [installedRefreshToken])
  const [selectedRemoteExtension, setSelectedRemoteExtension] = useState<ExtensionSummary | null>(null)
  const [selectedInstalledExtension, setSelectedInstalledExtension] = useState<ExtensionSummary | null>(null)
  const [selectedManageAction, setSelectedManageAction] = useState<ManageAction | null>(null)
  const remoteTimeoutMs = useMemo(() => getRemoteExtensionRequestTimeoutMs(), [])

  useEffect(() => {
    if (step !== "download-list") return
    let cancelled = false
    setRemoteCatalogState({ status: "loading", items: [] })

    listRemoteExtensions(installDir)
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
  }, [installDir, step, remoteCatalogRefreshToken])

  if (step === "home") {
    return (
      <OptionSelectPage
        title="插件安装与管理"
        description="选择要进行的操作。可从远程仓库下载 extension，也可管理本地已安装的 extension。"
        options={[
          {
            value: "download",
            label: "下载插件",
            description: "从远程仓库读取 extensions 目录，查看类型、名称、描述并下载安装。",
          },
          {
            value: "manage",
            label: "管理插件",
            description: "查看本地已安装的 extension，执行开启、关闭或删除。",
          },
        ]}
        onSelect={(value) => {
          if (value === "download") {
            setStep("download-list")
            return
          }
          setStep("manage-list")
        }}
        onBack={() => gracefulExit()}
      />
    )
  }

  if (step === "download-list") {
    if (remoteCatalogState.status === "idle" || remoteCatalogState.status === "loading") {
      return (
        <StatusPage
          title="下载插件"
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
          title="下载插件"
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

    if (remoteCatalogState.items.length === 0) {
      return (
        <StatusPage
          title="下载插件"
          description="远程仓库中没有可显示的 extension。"
          lines={[
            "当前未发现可用 extension。",
            "请稍后再试，或检查远程仓库配置。",
          ]}
          onBack={() => setStep("home")}
        />
      )
    }

    return (
      <OptionSelectPage
        title="下载插件"
        description="从远程仓库选择一个 extension。列表中会显示更细的类型信息，以及本地已安装或源码内嵌版本提示。"
        options={remoteCatalogState.items.map(buildRemoteExtensionOption)}
        onSelect={(requestedPath) => {
          const selected = remoteCatalogState.items.find((item) => item.requestedPath === requestedPath)
          if (!selected) return
          setSelectedRemoteExtension(selected)
          setStep("download-confirm")
        }}
        onBack={() => setStep("home")}
      />
    )
  }

  if (step === "download-confirm" && selectedRemoteExtension) {
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
          selectedRemoteExtension.hasPlugin
            ? "该 extension 包含插件入口。安装成功后会自动写入 plugins.yaml 并设为启用。"
            : "该 extension 不包含插件入口，安装后只会参与平台或其他扩展能力加载。",
        ],
      },
    ]

    return (
      <InfoConfirmPage
        title="确认下载插件"
        description="确认无误后开始下载安装。"
        sections={sections}
        notices={notices}
        onConfirm={async () => {
          if (selectedRemoteExtension.distributionMode !== "bundled") {
            throw new Error("当前远程包缺少可运行入口，例如 dist/index.mjs，不可直接安装。")
          }
          const installed = await installRemoteExtension(selectedRemoteExtension.requestedPath)
          enableInstalledExtension(installed)
          setInstalledRefreshToken((value) => value + 1)
          setRemoteCatalogState({ status: "idle", items: [] })
          setTimeout(() => {
            setSelectedRemoteExtension(null)
            setStep("download-list")
          }, 1200)
        }}
        onBack={() => setStep("download-list")}
        confirmActionText="Enter / y 开始下载"
        backActionText="Esc / n 返回列表"
        successTitle="✅ 插件下载完成！"
        successLines={[
          `${selectedRemoteExtension.name} 已安装。`,
          "1.2 秒后将返回远程列表。",
        ]}
      />
    )
  }

  if (step === "manage-list") {
    if (installedExtensions.length === 0) {
      return (
        <StatusPage
          title="管理插件"
          description="当前没有本地已安装 extension。"
          lines={[
            "尚未在 ~/.iris/extensions/ 下发现已安装 extension。",
            "请先进入“下载插件”流程，或使用命令行安装。",
          ]}
          onBack={() => setStep("home")}
        />
      )
    }

    return (
      <OptionSelectPage
        title="管理插件"
        description="选择一个已安装 extension，然后执行开启、关闭或删除。状态会区分已开启、已关闭、平台已启用而插件未启用等情况。"
        options={installedExtensions.map(buildInstalledExtensionOption)}
        onSelect={(requestedPath) => {
          const selected = installedExtensions.find((item) => item.requestedPath === requestedPath)
          if (!selected) return
          setSelectedInstalledExtension(selected)
          setStep("manage-action")
        }}
        onBack={() => setStep("home")}
      />
    )
  }

  if (step === "manage-action" && selectedInstalledExtension) {
    return (
      <OptionSelectPage
        title="管理插件"
        description={`${selectedInstalledExtension.name} · ${selectedInstalledExtension.typeLabel} · ${selectedInstalledExtension.stateLabel} · ${selectedInstalledExtension.statusDetail}`}
        options={buildManageActionOptions(selectedInstalledExtension)}
        onSelect={(value) => {
          setSelectedManageAction(value as ManageAction)
          setStep("manage-confirm")
        }}
        onBack={() => setStep("manage-list")}
      />
    )
  }

  if (step === "manage-confirm" && selectedInstalledExtension && selectedManageAction) {
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
        onConfirm={async () => {
          if (selectedManageAction === "enable") {
            enableInstalledExtension(selectedInstalledExtension)
          } else if (selectedManageAction === "disable") {
            disableInstalledExtension(selectedInstalledExtension)
          } else {
            deleteInstalledExtension(selectedInstalledExtension)
          }

          setInstalledRefreshToken((value) => value + 1)
          setTimeout(() => {
            setSelectedManageAction(null)
            setSelectedInstalledExtension(null)
            setStep("manage-list")
          }, 1200)
        }}
        onBack={() => setStep("manage-action")}
        successTitle={`✅ ${buildActionTitle(selectedManageAction)}已完成！`}
        successLines={["1.2 秒后将返回已安装列表。"]}
      />
    )
  }

  return (
    <StatusPage
      title="插件安装与管理"
      description="当前状态不可用。"
      lines={[
        "未找到可显示的页面状态。",
        "按 Esc 返回首页。",
      ]}
      onBack={() => setStep("home")}
    />
  )
}
