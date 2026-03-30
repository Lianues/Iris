import { registerFenceRenderer } from './registry'
import type { FenceRenderer, FenceRendererContext, FenceRendererResult } from './types'

const HTML_MAX_SIZE = 128 * 1024
const HTML_TAG_PATTERN = /<[a-z][a-z0-9]*[\s>]/i

const MIN_IFRAME_HEIGHT = 120
const MAX_IFRAME_HEIGHT = 480
const LINE_HEIGHT_PX = 22
const PADDING_PX = 40

function estimateIframeHeight(source: string): number {
  const lineCount = source.split('\n').length
  const raw = lineCount * LINE_HEIGHT_PX + PADDING_PX
  return Math.min(MAX_IFRAME_HEIGHT, Math.max(MIN_IFRAME_HEIGHT, raw))
}

function escapeSrcdoc(html: string): string {
  return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function wrapFragmentHtml(source: string): string {
  const hasDoctype = /<!doctype\s+html/i.test(source)
  const hasHtmlTag = /<html[\s>]/i.test(source)
  if (hasDoctype || hasHtmlTag) return source

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1a1a2e;
    background: #ffffff;
  }
</style>
</head>
<body>
${source}
</body>
</html>`
}

const htmlRenderer: FenceRenderer = {
  id: 'html',
  languages: ['html'],

  shouldHandle(source: string): boolean {
    return source.length <= HTML_MAX_SIZE && HTML_TAG_PATTERN.test(source)
  },

  buildPreviewBlock(ctx: FenceRendererContext): FenceRendererResult {
    const wrappedHtml = wrapFragmentHtml(ctx.source)
    const height = estimateIframeHeight(ctx.source)
    const srcdoc = escapeSrcdoc(wrappedHtml)
    const sourceHtml = ctx.renderCodeBlock(ctx.source, 'html')

    const html = [
      '<div class="message-html-shell">',
      '<div class="message-html-header">',
      '<span class="message-html-badge">HTML 预览</span>',
      '<span class="message-html-meta">沙箱隔离渲染，脚本已禁用</span>',
      '</div>',
      `<div class="message-html-preview">`,
      `<iframe sandbox="" srcdoc="${srcdoc}" style="width:100%;height:${height}px;border:none;border-radius:12px;" loading="lazy"></iframe>`,
      '</div>',
      '<details class="message-html-source">',
      '<summary>查看源码</summary>',
      sourceHtml,
      '</details>',
      '</div>',
    ].join('')

    return { html }
  },
}

registerFenceRenderer(htmlRenderer)
