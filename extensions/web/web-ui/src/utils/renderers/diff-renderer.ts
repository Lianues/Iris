import { registerFenceRenderer } from './registry'
import type { FenceRenderer, FenceRendererContext, FenceRendererResult } from './types'

const DIFF_MAX_SIZE = 256 * 1024

type DiffLineType = 'header' | 'hunk' | 'add' | 'del' | 'ctx'

function classifyDiffLine(line: string): DiffLineType {
  if (line.startsWith('---') || line.startsWith('+++')) return 'header'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

function looksLikeDiff(source: string): boolean {
  let hasAdd = false
  let hasDel = false
  const lines = source.split('\n')
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) hasAdd = true
    if (line.startsWith('-') && !line.startsWith('---')) hasDel = true
    if (hasAdd || hasDel) return true
  }
  return false
}

function renderDiffLines(source: string, escapeHtml: (s: string) => string): { html: string; added: number; removed: number } {
  const lines = source.split('\n')
  let added = 0
  let removed = 0
  const parts: string[] = []

  for (const line of lines) {
    const type = classifyDiffLine(line)
    if (type === 'add') added++
    if (type === 'del') removed++

    let prefix: string
    let text: string
    if (type === 'header' || type === 'hunk') {
      prefix = ''
      text = line
    } else {
      prefix = line.length > 0 ? line[0] : ' '
      text = line.length > 1 ? line.slice(1) : ''
    }

    parts.push(
      `<span class="diff-line diff-line-${type}">` +
      `<span class="diff-line-prefix">${escapeHtml(prefix)}</span>` +
      `<span class="diff-line-text">${escapeHtml(text)}</span>` +
      `</span>`,
    )
  }

  return { html: parts.join(''), added, removed }
}

const diffRenderer: FenceRenderer = {
  id: 'diff',
  languages: ['diff', 'patch'],

  shouldHandle(source: string): boolean {
    return source.length <= DIFF_MAX_SIZE && looksLikeDiff(source)
  },

  buildPreviewBlock(ctx: FenceRendererContext): FenceRendererResult {
    const { html: diffHtml, added, removed } = renderDiffLines(ctx.source, ctx.escapeHtml)
    const sourceHtml = ctx.renderCodeBlock(ctx.source, 'diff')
    const meta = `+${added} −${removed}`

    const html = [
      '<div class="message-diff-shell">',
      '<div class="message-diff-header">',
      '<span class="message-diff-badge">Diff 预览</span>',
      `<span class="message-diff-meta">${ctx.escapeHtml(meta)}</span>`,
      '</div>',
      `<div class="message-diff-preview"><pre><code>${diffHtml}</code></pre></div>`,
      '<details class="message-diff-source">',
      '<summary>查看源码</summary>',
      sourceHtml,
      '</details>',
      '</div>',
    ].join('')

    return { html }
  },
}

registerFenceRenderer(diffRenderer)
