let dialog: HTMLDialogElement | null = null
let img: HTMLImageElement | null = null

function clearImage(): void {
  if (img) {
    img.src = ''
    img.alt = ''
  }
}

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog

  dialog = document.createElement('dialog')
  dialog.className = 'iris-lightbox'

  img = document.createElement('img')
  img.className = 'iris-lightbox-img'
  dialog.appendChild(img)

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target === img) {
      closeLightbox()
    }
  })

  dialog.addEventListener('close', clearImage)

  document.body.appendChild(dialog)
  return dialog
}

export function openLightbox(src: string, alt?: string): void {
  const d = ensureDialog()
  if (img) {
    img.src = src
    img.alt = alt ?? ''
  }
  d.showModal()
}

export function closeLightbox(): void {
  if (!dialog) return
  dialog.close()
}
