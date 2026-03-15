/**
 * Iris Onboard — 交互式配置引导工具
 *
 * 用法：iris-onboard <iris-dir>
 *       iris-onboard              (默认 /opt/iris)
 *
 * 使用 OpenTUI + React 构建 TUI 界面，
 * 通过 bun build --compile 编译成独立二进制。
 */
import { createCliRenderer, type CliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./App.js"

/** 全局 renderer 引用，供组件优雅退出 */
let _renderer: CliRenderer | null = null

export function getRenderer(): CliRenderer | null {
  return _renderer
}

/**
 * 优雅退出：先销毁 renderer（恢复终端状态），再退出进程。
 * 直接 process.exit() 会跳过 OpenTUI 的终端清理，
 * 导致 Kitty 键盘协议 / 鼠标模式 / raw mode 未被恢复，终端输出乱码。
 */
export function gracefulExit(code = 0): void {
  const renderer = _renderer
  if (renderer) {
    _renderer = null
    renderer.destroy()
  }
  // 给 destroy 一点时间刷新终端序列
  setTimeout(() => process.exit(code), 50)
}

async function main() {
  // 从命令行参数获取 Iris 安装目录
  const irisDir = process.argv[2] || "/opt/iris"

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })
  _renderer = renderer

  createRoot(renderer).render(<App irisDir={irisDir} />)
}

main().catch((err) => {
  console.error("Iris Onboard 启动失败:", err)
  process.exit(1)
})
