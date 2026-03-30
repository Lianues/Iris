import DOMPurify from 'dompurify'
import { registerFenceRenderer } from './registry'
import type { FenceRenderer, FenceRendererContext, FenceRendererResult } from './types'

const SVG_MAX_SIZE = 256 * 1024

const SVG_VIEWBOX_PATTERN = /viewBox=["']([^"']+)["']/i
const SVG_WIDTH_PATTERN = /(?:^|[\s<;])width=["']([^"']+)["']/i
const SVG_HEIGHT_PATTERN = /(?:^|[\s<;])height=["']([^"']+)["']/i

function extractSvgMeta(source: string): string {
  const parts: string[] = []

  const viewBoxMatch = SVG_VIEWBOX_PATTERN.exec(source)
  if (viewBoxMatch) {
    parts.push(`viewBox: ${viewBoxMatch[1]}`)
  }

  const widthMatch = SVG_WIDTH_PATTERN.exec(source)
  const heightMatch = SVG_HEIGHT_PATTERN.exec(source)
  if (widthMatch || heightMatch) {
    const dims: string[] = []
    if (widthMatch) dims.push(widthMatch[1])
    if (heightMatch) dims.push(heightMatch[1])
    parts.push(dims.join(' × '))
  }

  return parts.length > 0 ? parts.join('  ') : 'SVG 图形'
}

function sanitizeSvg(source: string): string {
  return DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: [
      'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
      'text', 'tspan', 'textPath', 'defs', 'use', 'symbol', 'clipPath', 'mask',
      'linearGradient', 'radialGradient', 'stop', 'pattern', 'image',
      'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode',
      'feFlood', 'feComposite', 'feBlend', 'feColorMatrix',
      'marker', 'title', 'desc', 'animate', 'animateTransform',
    ],
    ADD_ATTR: [
      'viewBox', 'xmlns', 'xmlns:xlink', 'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
      'stroke-opacity', 'fill-opacity', 'opacity', 'transform', 'x', 'y',
      'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2',
      'width', 'height', 'd', 'points', 'dx', 'dy',
      'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight',
      'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end',
      'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity',
      'patternUnits', 'patternTransform', 'preserveAspectRatio',
      'filterUnits', 'stdDeviation', 'result', 'in', 'in2', 'mode', 'values', 'type',
      'xlink:href', 'href', 'id', 'class', 'style',
      'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
      'flood-color', 'flood-opacity', 'color-interpolation-filters',
      'attributeName', 'begin', 'dur', 'from', 'to', 'repeatCount',
    ],
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  })
}

const svgRenderer: FenceRenderer = {
  id: 'svg',
  languages: ['svg'],

  shouldHandle(source: string): boolean {
    return source.length <= SVG_MAX_SIZE
  },

  buildPreviewBlock(ctx: FenceRendererContext): FenceRendererResult {
    const sanitizedSvg = sanitizeSvg(ctx.source)
    const meta = ctx.escapeHtml(extractSvgMeta(ctx.source))
    const sourceHtml = ctx.renderCodeBlock(ctx.source, 'svg')

    const html = [
      '<div class="message-svg-shell">',
      '<div class="message-svg-header">',
      '<span class="message-svg-badge">SVG 预览</span>',
      `<span class="message-svg-meta">${meta}</span>`,
      '</div>',
      `<div class="message-svg-preview">${sanitizedSvg}</div>`,
      '<details class="message-svg-source">',
      '<summary>查看源码</summary>',
      sourceHtml,
      '</details>',
      '</div>',
    ].join('')

    return { html }
  },
}

registerFenceRenderer(svgRenderer)
