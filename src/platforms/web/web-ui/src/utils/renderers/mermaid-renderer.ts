import { registerFenceRenderer, registerPostRenderHydrator } from './registry'
import type { FenceRenderer, FenceRendererContext, FenceRendererResult } from './types'

const MERMAID_MAX_SIZE = 128 * 1024
let mermaidIdCounter = 0

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

function fromBase64(str: string): string {
  return decodeURIComponent(escape(atob(str)))
}

const mermaidRenderer: FenceRenderer = {
  id: 'mermaid',
  languages: ['mermaid'],

  shouldHandle(source: string): boolean {
    return source.length <= MERMAID_MAX_SIZE
  },

  buildPreviewBlock(ctx: FenceRendererContext): FenceRendererResult {
    const sourceBase64 = toBase64(ctx.source)
    const sourceHtml = ctx.renderCodeBlock(ctx.source, 'markdown')

    const html = [
      '<div class="message-mermaid-shell">',
      '<div class="message-mermaid-header">',
      '<span class="message-mermaid-badge">Mermaid 图表</span>',
      '<span class="message-mermaid-meta">图表渲染中…</span>',
      '</div>',
      `<div class="message-mermaid-preview">`,
      `<div class="message-mermaid-graph" data-mermaid-pending data-mermaid-source="${sourceBase64}">`,
      `<pre style="margin:0;padding:12px 14px;color:var(--text-secondary);font-size:0.85rem;white-space:pre-wrap;">${ctx.escapeHtml(ctx.source)}</pre>`,
      '</div>',
      '</div>',
      '<details class="message-mermaid-source">',
      '<summary>查看源码</summary>',
      sourceHtml,
      '</details>',
      '</div>',
    ].join('')

    return { html }
  },
}

registerFenceRenderer(mermaidRenderer)

function getCurrentTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark'
}

async function hydrateMermaidDiagrams(root: HTMLElement): Promise<void> {
  const pending = root.querySelectorAll<HTMLElement>('.message-mermaid-graph[data-mermaid-pending]')
  if (pending.length === 0) return

  const { default: mermaid } = await import('mermaid')

  mermaid.initialize({
    startOnLoad: false,
    theme: getCurrentTheme(),
    securityLevel: 'strict',
  })

  for (const el of pending) {
    const sourceBase64 = el.getAttribute('data-mermaid-source')
    if (!sourceBase64) continue

    let source: string
    try {
      source = fromBase64(sourceBase64)
    } catch {
      continue
    }

    const id = `mermaid-graph-${++mermaidIdCounter}`

    try {
      const { svg } = await mermaid.render(id, source)
      el.innerHTML = svg
      el.removeAttribute('data-mermaid-pending')

      const metaEl = el.closest('.message-mermaid-shell')?.querySelector('.message-mermaid-meta')
      if (metaEl) metaEl.textContent = '渲染完成'
    } catch (err) {
      const message = err instanceof Error ? err.message : '渲染失败'
      el.innerHTML =
        `<div style="padding:12px 14px;color:var(--error);font-size:0.85rem;">Mermaid 错误: ${message.replace(/</g, '&lt;')}</div>` +
        `<pre style="margin:0;padding:12px 14px;color:var(--text-secondary);font-size:0.85rem;white-space:pre-wrap;">${source.replace(/</g, '&lt;')}</pre>`
      el.removeAttribute('data-mermaid-pending')

      const metaEl = el.closest('.message-mermaid-shell')?.querySelector('.message-mermaid-meta')
      if (metaEl) metaEl.textContent = '渲染失败'

      // mermaid.render creates a temp SVG element on error; clean it up
      const tempSvg = document.getElementById(id)
      tempSvg?.remove()
    }
  }
}

registerPostRenderHydrator(hydrateMermaidDiagrams)
