/**
 * Matrix 代码雨动画引擎
 *
 * 纯逻辑模块，不依赖 Vue。接收 canvas 元素和配置，管理动画生命周期。
 * 颜色从 CSS 自定义属性动态读取，自动适配当前主题。
 */

export interface MatrixRainConfig {
  /** 动画总持续时间（毫秒） */
  duration: number
  /** 字符字体大小（像素） */
  fontSize?: number
  /** 每列拖尾长度（字符数） */
  trailLength?: number
  /** 列宽（像素） */
  columnWidth?: number
}

interface Column {
  x: number
  y: number
  speed: number
  chars: string[]
  delay: number
}

interface ThemeColors {
  accent: string
  accentCyan: string
  bgCanvas: string
}

/** Matrix 代码雨始终使用深色配色，不跟随主题 */
function readThemeColors(): ThemeColors {
  return {
    accent: '#8b7cff',
    accentCyan: '#74d7ff',
    bgCanvas: '#090b16',
  }
}

/** 颜色字符串 → rgba（支持 #hex 和 rgb() 格式） */
function toRgba(color: string, alpha: number): string {
  // rgb(r, g, b) 或 rgba(r, g, b, a) 格式
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`
  }
  // #hex 格式
  const h = color.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(9, 11, 22, ${alpha})` // fallback to --bg-canvas dark
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function randomBinary(): string {
  return Math.random() < 0.5 ? '0' : '1'
}

function createColumns(width: number, columnWidth: number): Column[] {
  const count = Math.ceil(width / columnWidth)
  const result: Column[] = []
  for (let i = 0; i < count; i++) {
    result.push({
      x: i * columnWidth + columnWidth / 2,
      y: -(Math.random() * 600),
      speed: 2 + Math.random() * 4,
      chars: [],
      delay: Math.random() * 400,
    })
  }
  return result
}

/**
 * 创建并启动一个 Matrix 代码雨动画实例。
 *
 * @returns dispose 函数用于停止动画并清理资源
 */
export function startMatrixRain(
  canvas: HTMLCanvasElement,
  config: MatrixRainConfig,
  onComplete: () => void,
): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    onComplete()
    return () => {}
  }

  // prefers-reduced-motion 检查
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onComplete()
    return () => {}
  }

  const fontSize = config.fontSize ?? 22
  const trailLength = config.trailLength ?? 20
  const columnWidth = config.columnWidth ?? 26
  const colors = readThemeColors()
  const dpr = window.devicePixelRatio || 1

  let w = window.innerWidth
  let h = window.innerHeight
  let columns = createColumns(w, columnWidth)
  let animFrameId: number | null = null
  const startTime = performance.now()

  function sizeCanvas() {
    w = window.innerWidth
    h = window.innerHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function handleResize() {
    sizeCanvas()
    ctx!.fillStyle = colors.bgCanvas
    ctx!.fillRect(0, 0, w, h)
    columns = createColumns(w, columnWidth)
  }

  sizeCanvas()

  // 首帧填充背景
  ctx.fillStyle = colors.bgCanvas
  ctx.fillRect(0, 0, w, h)

  function draw(now: number) {
    const elapsed = now - startTime

    if (elapsed > config.duration) {
      animFrameId = null
      onComplete()
      return
    }

    // 淡出阶段
    const fadeStart = config.duration * 0.55
    let globalAlpha = 1
    if (elapsed > fadeStart) {
      globalAlpha = 1 - (elapsed - fadeStart) / (config.duration - fadeStart)
    }

    // 拖尾背景叠加
    ctx!.fillStyle = toRgba(colors.bgCanvas, 0.12)
    ctx!.fillRect(0, 0, w, h)

    ctx!.font = `${fontSize}px "JetBrains Mono", "Cascadia Code", Consolas, monospace`
    ctx!.textAlign = 'center'

    for (const col of columns) {
      if (elapsed < col.delay) continue

      col.y += col.speed
      col.chars.push(randomBinary())
      if (col.chars.length > trailLength) {
        col.chars.shift()
      }

      const len = col.chars.length
      for (let j = 0; j < len; j++) {
        const charY = col.y - (len - 1 - j) * fontSize
        if (charY < -fontSize || charY > h + fontSize) continue

        const isHead = j === len - 1
        const trailRatio = j / len

        if (isHead) {
          ctx!.globalAlpha = globalAlpha
          ctx!.shadowBlur = 14
          ctx!.shadowColor = colors.accentCyan
          ctx!.fillStyle = colors.accentCyan
        } else {
          ctx!.globalAlpha = globalAlpha * (0.15 + trailRatio * 0.65)
          ctx!.shadowBlur = 0
          ctx!.shadowColor = 'transparent'
          ctx!.fillStyle = colors.accent
        }

        ctx!.fillText(col.chars[j], col.x, charY)
      }

      if (col.y - trailLength * fontSize > h) {
        col.y = -(Math.random() * 200)
        col.chars = []
        col.speed = 2 + Math.random() * 4
      }
    }

    ctx!.globalAlpha = 1
    ctx!.shadowBlur = 0
    ctx!.shadowColor = 'transparent'

    animFrameId = requestAnimationFrame(draw)
  }

  window.addEventListener('resize', handleResize)
  animFrameId = requestAnimationFrame(draw)

  // 返回 dispose 函数
  return () => {
    window.removeEventListener('resize', handleResize)
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }
}
