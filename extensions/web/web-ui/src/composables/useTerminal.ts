/**
 * 终端连接组合式函数
 *
 * 管理 xterm.js 终端实例和 WebSocket 连接。
 * 支持自动重连、resize、主题跟随。
 */

import { ref, watch, onUnmounted, onActivated, onDeactivated } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from './useTheme'
import { loadAuthToken } from '../utils/authToken'

function getThemeColors(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  return {
    terminalBg: style.getPropertyValue('--terminal-bg').trim(),
    bgCanvas: style.getPropertyValue('--bg-canvas').trim(),
    textPrimary: style.getPropertyValue('--text-primary').trim(),
    textSecondary: style.getPropertyValue('--text-secondary').trim(),
    textMuted: style.getPropertyValue('--text-muted').trim(),
    accent: style.getPropertyValue('--accent').trim(),
    accentCyan: style.getPropertyValue('--accent-cyan').trim(),
    success: style.getPropertyValue('--success').trim(),
    error: style.getPropertyValue('--error').trim(),
  }
}

/** 判断颜色是否为浅色（用于决定 ANSI 颜色映射方案） */
function isLightBackground(color: string): boolean {
  const h = color.replace('#', '')
  if (h.length < 6) return false
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  // 相对亮度
  return (r * 299 + g * 587 + b * 114) / 1000 > 160
}

function buildXtermTheme(colors: Record<string, string>) {
  // 如果定义了 --terminal-bg（浅色模式强制深底），使用它并走深色配色
  const bg = colors.terminalBg || colors.bgCanvas || '#090b16'
  const light = !colors.terminalBg && isLightBackground(bg)

  if (light) {
    // 浅色主题且无 terminal-bg 覆盖：ANSI 颜色重映射为深色
    return {
      background: bg,
      foreground: colors.textPrimary || '#1a1d2e',
      cursor: colors.accent || '#6e5eff',
      cursorAccent: bg,
      selectionBackground: (colors.accent || '#6e5eff') + '30',
      selectionForeground: colors.textPrimary || '#1a1d2e',
      black: '#1a1d2e',
      red: '#c0392b',
      green: '#0e7a4a',
      yellow: '#b8860b',
      blue: '#5a4ad4',
      magenta: '#7c3aed',
      cyan: '#0e6f8e',
      white: '#5a5f7a',
      brightBlack: '#6b7280',
      brightRed: '#e74c3c',
      brightGreen: '#16a34a',
      brightYellow: '#ca8a04',
      brightBlue: '#6e5eff',
      brightMagenta: '#8b5cf6',
      brightCyan: '#0891b2',
      brightWhite: '#374151',
    }
  }

  // 深色主题：保持原有配色
  return {
    background: bg,
    foreground: colors.textPrimary || '#f5f7ff',
    cursor: colors.accent || '#8b7cff',
    cursorAccent: bg,
    selectionBackground: (colors.accent || '#8b7cff') + '40',
    selectionForeground: colors.textPrimary || '#f5f7ff',
    black: '#1a1d2e',
    red: colors.error || '#ff7c7c',
    green: colors.success || '#59d69a',
    yellow: '#fdcb6e',
    blue: colors.accent || '#8b7cff',
    magenta: '#a78bfa',
    cyan: colors.accentCyan || '#74d7ff',
    white: colors.textPrimary || '#f5f7ff',
    brightBlack: colors.textMuted || '#727ca1',
    brightRed: '#ff9b9b',
    brightGreen: '#7ee6b8',
    brightYellow: '#ffe08a',
    brightBlue: '#a99bff',
    brightMagenta: '#c4a8ff',
    brightCyan: '#9ae3ff',
    brightWhite: '#ffffff',
  }
}

export function useTerminal() {
  const connected = ref(false)
  const connecting = ref(false)
  const error = ref('')

  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ws: WebSocket | null = null
  let container: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let wheelHandler: ((e: WheelEvent) => void) | null = null
  /** 进程异常退出时禁止自动重连，避免死循环 */
  let suppressReconnect = false

  const { resolvedTheme } = useTheme()

  function buildWsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL(`${proto}//${location.host}/ws/terminal`)
    const token = loadAuthToken()
    if (token) {
      url.searchParams.set('token', token)
    }
    // 传递初始终端尺寸，让服务端用正确尺寸创建 PTY
    if (terminal && fitAddon) {
      fitAddon.fit()
      url.searchParams.set('cols', String(terminal.cols))
      url.searchParams.set('rows', String(terminal.rows))
    }
    return url.toString()
  }

  function updateTheme() {
    if (!terminal) return
    const colors = getThemeColors()
    terminal.options.theme = buildXtermTheme(colors)
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    // 清理旧 WebSocket 的事件处理器，防止 CLOSING 状态的旧连接触发重连
    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws = null
    }

    error.value = ''
    connecting.value = true
    const url = buildWsUrl()

    try {
      ws = new WebSocket(url)
    } catch (err) {
      connecting.value = false
      error.value = `WebSocket 连接失败: ${err instanceof Error ? err.message : '未知错误'}`
      return
    }

    ws.onopen = () => {
      connected.value = true
      connecting.value = false
      error.value = ''
      // 连接建立后立即同步终端尺寸
      if (terminal && fitAddon) {
        fitAddon.fit()
      }
    }

    ws.onmessage = (event) => {
      if (!terminal || typeof event.data !== 'string') return

      // 服务端控制消息以 \x00 前缀区分，避免与终端输出混淆
      if (event.data.charCodeAt(0) === 0) {
        try {
          const parsed = JSON.parse(event.data.slice(1))
          if (parsed.type === 'exit') {
            error.value = parsed.code === 0
              ? '终端进程已正常退出'
              : `终端进程已退出 (code=${parsed.code})`
            connected.value = false
            // 收到明确的进程退出消息时，不论退出码都不自动重连
            suppressReconnect = true
            return
          }
        } catch { /* 忽略无法解析的控制消息 */ }
        return
      }

      terminal.write(event.data)
    }

    ws.onclose = () => {
      connected.value = false
      // 非主动关闭且非异常退出时尝试重连
      if (container && !suppressReconnect) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      error.value = '连接中断'
      connected.value = false
      connecting.value = false
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (container) {
        connectWs()
      }
    }, 3000)
  }

  function attach(el: HTMLElement) {
    container = el
    const colors = getThemeColors()

    terminal = new Terminal({
      theme: buildXtermTheme(colors),
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.35,
      cursorStyle: 'bar',
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    terminal.open(el)

    // 键盘事件策略：默认全部交给 xterm 处理，仅白名单放行给浏览器。
    // 对 Ctrl+C/V 做特殊处理（浏览器会拦截为复制/粘贴）。
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true

      // 白名单：放行给浏览器（return false = 不让 xterm 处理）
      const key = e.key
      if (key === 'F5' || key === 'F11' || key === 'F12') return false
      if (e.ctrlKey && e.shiftKey && (key === 'I' || key === 'i' || key === 'J' || key === 'j' || key === 'R' || key === 'r')) return false

      // Ctrl+V：手动从剪贴板粘贴到终端
      if (e.ctrlKey && !e.shiftKey && (key === 'v' || key === 'V')) {
        navigator.clipboard.readText().then((text) => {
          if (text && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(text)
          }
        }).catch(() => {})
        return false
      }

      // Ctrl+C：有选中文本→复制；无选中→让 xterm 发 \x03
      if (e.ctrlKey && !e.shiftKey && (key === 'c' || key === 'C')) {
        if (terminal!.hasSelection()) {
          navigator.clipboard.writeText(terminal!.getSelection()).catch(() => {})
          return false
        }
        return true
      }

      // 其余所有按键交给 xterm 处理
      return true
    })

    // 首次 fit
    requestAnimationFrame(() => {
      fitAddon?.fit()
    })

    // 鼠标滚轮：当 TUI 应用使用交替屏幕缓冲区时，将滚轮转为上/下箭头键序列
    wheelHandler = (e: WheelEvent) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      // 检查 xterm 是否在交替屏幕缓冲区（scrollback 不可用时即是交替屏幕）
      const buffer = terminal!.buffer
      if (buffer && buffer.active.type === 'alternate') {
        e.preventDefault()
        const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 40))
        const seq = e.deltaY < 0 ? '\x1b[A' : '\x1b[B' // 上/下箭头
        ws.send(seq.repeat(lines))
      }
      // 普通缓冲区：让 xterm 自身处理滚动（scrollback）
    }
    el.addEventListener('wheel', wheelHandler, { passive: false })

    // 终端输入 → WebSocket
    terminal.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    // 终端 resize → WebSocket
    terminal.onResize(({ cols, rows }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    // 容器尺寸变化自动 fit
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon?.fit()
      })
    })
    resizeObserver.observe(el)

    // 建立 WebSocket 连接
    connectWs()
  }

  function detach() {
    if (wheelHandler && container) {
      container.removeEventListener('wheel', wheelHandler)
    }
    wheelHandler = null
    container = null

    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }

    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws.close()
      ws = null
    }

    if (terminal) {
      terminal.dispose()
      terminal = null
    }

    fitAddon = null
    connected.value = false
    connecting.value = false
    error.value = ''
  }

  function reconnect() {
    suppressReconnect = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws.close()
      ws = null
    }

    connected.value = false
    connecting.value = false
    error.value = ''

    if (terminal) {
      terminal.clear()
    }

    connectWs()
  }

  // 主题切换时更新终端颜色
  watch(resolvedTheme, () => {
    // 延迟一帧让 CSS 变量生效
    requestAnimationFrame(updateTheme)
  })

  // KeepAlive 激活 — 恢复 resize 监听并 refit
  onActivated(() => {
    if (terminal && fitAddon && container) {
      // 恢复 resize 观察
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          requestAnimationFrame(() => fitAddon?.fit())
        })
        resizeObserver.observe(container)
      }
      // 重新 fit（容器尺寸可能在去激活期间变化）
      requestAnimationFrame(() => {
        fitAddon?.fit()
        terminal?.focus()
      })
    }
  })

  // KeepAlive 去激活 — 暂停 resize 监听，保持 WebSocket 连接
  onDeactivated(() => {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  })

  onUnmounted(detach)

  return {
    connected,
    connecting,
    error,
    attach,
    detach,
    reconnect,
  }
}
