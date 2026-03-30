export interface FenceRendererContext {
  source: string
  lang: string
  highlightedLines: Set<number> | null
  renderCodeBlock: (code: string, lang?: string | null) => string
  escapeHtml: (text: string) => string
}

export interface FenceRendererResult {
  html: string
}

export interface FenceRenderer {
  readonly id: string
  readonly languages: readonly string[]
  shouldHandle?: (source: string, lang: string) => boolean
  buildPreviewBlock: (ctx: FenceRendererContext) => FenceRendererResult
}
