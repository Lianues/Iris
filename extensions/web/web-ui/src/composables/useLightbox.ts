import { ref } from 'vue'

export const lightboxOpen = ref(false)
export const lightboxSrc = ref('')
export const lightboxAlt = ref('')

export function openLightbox(src: string, alt?: string): void {
  lightboxSrc.value = src
  lightboxAlt.value = alt ?? ''
  lightboxOpen.value = true
}

export function closeLightbox(): void {
  lightboxOpen.value = false
  lightboxSrc.value = ''
  lightboxAlt.value = ''
}
