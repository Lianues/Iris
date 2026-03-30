import { registerPostRenderHydrator } from './registry'

/**
 * 为 decorateImageLinks 生成的 <img> 绑定 error 回退逻辑：
 * 图片加载失败时，替换为原始 <a> 链接，避免显示破碎图标。
 */
function fallbackToLink(img: HTMLImageElement): void {
  const href = img.getAttribute('data-original-href')
  if (!href) return

  const link = document.createElement('a')
  link.href = href
  link.textContent = href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'

  const shell = img.closest('.message-image-link-shell')
  if (shell) {
    // 独占段落模式：整个 shell 替换为链接段落
    const p = document.createElement('p')
    p.appendChild(link)
    shell.replaceWith(p)
  } else {
    // 行内模式：img 直接替换为链接
    img.replaceWith(link)
  }
}

async function hydrateImageLinks(root: HTMLElement): Promise<void> {
  const images = root.querySelectorAll<HTMLImageElement>(
    'img.message-image-link-preview, img.message-image-link-inline',
  )
  if (images.length === 0) return

  for (const img of images) {
    // 已经绑定过的跳过
    if (img.dataset.imageLinkHydrated) continue
    img.dataset.imageLinkHydrated = '1'

    // 如果图片在 hydrator 运行之前就已经加载失败（竞态），立即回退
    // img.complete === true && img.naturalWidth === 0 表示加载已结束但失败
    if (img.complete && img.naturalWidth === 0 && img.src) {
      fallbackToLink(img)
      continue
    }

    img.addEventListener('error', () => fallbackToLink(img), { once: true })
  }
}

registerPostRenderHydrator(hydrateImageLinks)
