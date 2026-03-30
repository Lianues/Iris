<template>
  <div class="message-stack" :class="`message-stack-${role}`">
    <div class="message-meta-row">
      <div class="message-meta">{{ roleLabel }}</div>
    </div>

    <div
      class="doc-bubble"
      :class="[`doc-bubble-${role}`, { clickable: hasPreview }]"
      @click="hasPreview && (previewOpen = true)"
    >
      <AppIcon :name="ICONS.common.document" class="doc-bubble-icon" />
      <div class="doc-bubble-info">
        <span class="doc-bubble-name">{{ displayName }}</span>
        <span class="doc-bubble-type">{{ typeLabel }}</span>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="doc-preview">
        <div v-if="previewOpen" class="doc-preview-overlay" @click.self="previewOpen = false">
          <div class="doc-preview-card">
            <div class="doc-preview-header">
              <span class="doc-preview-title">{{ displayName }}</span>
              <button class="doc-preview-close" type="button" aria-label="关闭" @click="previewOpen = false">
                <AppIcon :name="ICONS.common.close" />
              </button>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div ref="contentEl" class="doc-preview-content message-rich" v-if="renderedHtml" v-html="renderedHtml" @click="handleCodeCopyClick"></div>
            <pre ref="contentEl" class="doc-preview-content" v-else>{{ previewText }}</pre>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { getRoleLabel } from '../utils/role'
import { copyTextToClipboard } from '../utils/clipboard'

type RenderFn = (text: string) => string
let renderRichText: RenderFn | null = null
let rendererLoader: Promise<void> | null = null

async function ensureRenderer(): Promise<RenderFn> {
  if (renderRichText) return renderRichText
  if (!rendererLoader) {
    rendererLoader = import('../utils/markdown').then(m => { renderRichText = m.renderRichText })
  }
  await rendererLoader
  return renderRichText!
}

const props = defineProps<{
  role: 'user' | 'model'
  mimeType: string
  data?: string
  fileName?: string
  text?: string
}>()

const roleLabel = computed(() => getRoleLabel(props.role))
const previewOpen = ref(false)
const renderedHtml = ref('')
const contentEl = ref<HTMLElement | null>(null)
let codeCopyResetTimer: ReturnType<typeof setTimeout> | null = null

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF 文档',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word 文档',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint 演示文稿',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel 表格',
  'application/vnd.ms-excel': 'Excel 表格',
}

const typeLabel = computed(() => MIME_LABELS[props.mimeType] ?? '文档')

const EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
}

const displayName = computed(() => {
  if (props.fileName) return props.fileName
  const ext = EXT_MAP[props.mimeType] ?? ''
  return `文档${ext}`
})

const fileExt = computed(() => {
  const name = props.fileName ?? ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
})

/** 二进制格式不适合文本预览 */
const BINARY_MIMES = new Set(Object.keys(MIME_LABELS))

const isTextDocument = computed(() => !BINARY_MIMES.has(props.mimeType))

const MAX_PREVIEW_LENGTH = 200_000

const previewText = computed(() => {
  let raw = ''
  if (props.text) {
    raw = props.text
  } else if (props.data && isTextDocument.value) {
    try {
      const bytes = Uint8Array.from(atob(props.data), c => c.charCodeAt(0))
      raw = new TextDecoder('utf-8').decode(bytes)
    } catch {
      return '(无法解码文档内容)'
    }
  } else {
    return '(无内容)'
  }
  return raw.length > MAX_PREVIEW_LENGTH
    ? raw.slice(0, MAX_PREVIEW_LENGTH) + '\n\n... (内容过长，已截断)'
    : raw
})

const hasPreview = computed(() => {
  if (props.text) return true
  if (props.data && isTextDocument.value) return true
  return false
})

/** 将文本内容根据扩展名包装为 markdown 源码 */
const CODE_EXTS: Record<string, string> = {
  json: 'json', js: 'javascript', ts: 'typescript', py: 'python',
  css: 'css', html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
  sh: 'bash', bash: 'bash', sql: 'sql', java: 'java', go: 'go',
  rs: 'rust', c: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby',
  php: 'php', swift: 'swift', kt: 'kotlin', r: 'r', lua: 'lua',
  toml: 'toml', ini: 'ini', csv: 'csv',
}

const MARKDOWN_EXTS = new Set(['md', 'markdown'])

function buildMarkdownSource(text: string, ext: string): string {
  if (MARKDOWN_EXTS.has(ext)) return text
  const lang = CODE_EXTS[ext] ?? ''
  // 用足够多的反引号包裹，防止内容中的反引号破坏代码块
  let fence = '```'
  while (text.includes(fence)) fence += '`'
  return fence + lang + '\n' + text + '\n' + fence
}

/** 当预览打开时异步渲染 */
let renderVersion = 0

watch(previewOpen, async (open) => {
  if (open) {
    const version = ++renderVersion
    document.addEventListener('keydown', handleKeydown)
    const text = previewText.value
    if (text === '(无内容)' || text === '(无法解码文档内容)') {
      renderedHtml.value = ''
      return
    }
    try {
      const render = await ensureRenderer()
      if (renderVersion !== version) return // 竞态保护
      const source = buildMarkdownSource(text, fileExt.value)
      renderedHtml.value = render(source)
      await nextTick()
      requestAnimationFrame(() => {
        if (contentEl.value) contentEl.value.scrollTop = 0
      })
    } catch {
      if (renderVersion === version) renderedHtml.value = ''
    }
  } else {
    ++renderVersion
    document.removeEventListener('keydown', handleKeydown)
    renderedHtml.value = ''
  }
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    previewOpen.value = false
  }
}

async function handleCodeCopyClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const button = target?.closest<HTMLButtonElement>('.message-code-copy')
  if (!button) return

  const codeShell = button.closest('.message-code-shell')
  const numberedLines = Array.from(codeShell?.querySelectorAll<HTMLElement>('.message-code-line-text') ?? [])
  const codeText = numberedLines.length > 0
    ? numberedLines.map(line => line.textContent ?? '').join('\n')
    : codeShell?.querySelector('pre code')?.textContent ?? ''
  if (!codeText) return

  try {
    await copyTextToClipboard(codeText)
    button.textContent = '已复制'
    button.classList.remove('error')
    button.classList.add('copied')
  } catch {
    button.textContent = '复制失败'
    button.classList.remove('copied')
    button.classList.add('error')
  }

  if (codeCopyResetTimer) clearTimeout(codeCopyResetTimer)
  codeCopyResetTimer = setTimeout(() => {
    codeCopyResetTimer = null
    button.textContent = '复制代码'
    button.classList.remove('copied', 'error')
  }, 1800)
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (codeCopyResetTimer) { clearTimeout(codeCopyResetTimer); codeCopyResetTimer = null }
})
</script>
