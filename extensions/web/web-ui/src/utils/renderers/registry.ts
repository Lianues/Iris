import type { FenceRenderer } from './types'

const renderers: FenceRenderer[] = []

export function registerFenceRenderer(renderer: FenceRenderer): void {
  renderers.push(renderer)
}

export function findFenceRenderer(lang: string, source: string): FenceRenderer | null {
  for (const renderer of renderers) {
    if (!renderer.languages.includes(lang)) continue
    if (renderer.shouldHandle && !renderer.shouldHandle(source, lang)) continue
    return renderer
  }
  return null
}

type PostRenderHydrator = (root: HTMLElement) => void | Promise<void>
const hydrators: PostRenderHydrator[] = []

export function registerPostRenderHydrator(fn: PostRenderHydrator): void {
  hydrators.push(fn)
}

export async function hydrateRenderedContent(root: HTMLElement | null): Promise<void> {
  if (!root || hydrators.length === 0) return
  for (const hydrator of hydrators) {
    await hydrator(root)
  }
}
