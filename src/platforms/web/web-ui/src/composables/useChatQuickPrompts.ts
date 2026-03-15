import { computed, onMounted, ref, watch, type Ref } from 'vue'
import * as api from '../api/client'
import type { ChatSuggestion } from '../api/types'

const QUICK_PROMPTS_ENABLED_STORAGE_KEY = 'iris-chat-quick-prompts-enabled'
const QUICK_PROMPT_CACHE_FALLBACK_KEY = '__new__'

const fallbackQuickPrompts: ChatSuggestion[] = [
  { label: '继续推进', text: '请基于刚才的内容继续推进，并告诉我下一步最值得做什么。' },
  { label: '梳理关键点', text: '请先帮我梳理当前问题的关键点、风险和建议方案。' },
  { label: '校验结果', text: '请检查当前结论是否有遗漏，并给出我应该优先补充的内容。' },
]

interface UseChatQuickPromptsOptions {
  currentSessionId: Ref<string | null>
  disabled: Ref<boolean>
  interactionDisabled: Ref<boolean>
  text: Ref<string>
  hasAttachments: Ref<boolean>
  clearError: () => void
  focusComposer: () => void
}

function loadQuickPromptsEnabled(): boolean {
  try {
    return window.localStorage.getItem(QUICK_PROMPTS_ENABLED_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function cloneQuickPrompts(prompts: ChatSuggestion[]): ChatSuggestion[] {
  return prompts.map((prompt) => ({ ...prompt }))
}

function normalizeQuickPromptLabel(text: string, fallbackText = ''): string {
  const normalized = `${text} ${fallbackText}`.replace(/\s+/g, ' ').replace(/[。！？!?；;：:、,，]+$/g, '').trim()
  if (!normalized) return ''

  const labelRules: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(附件|文档|图片|资料|文件)/, label: '分析附件' },
    { pattern: /(继续|推进|下一步|优先)/, label: '继续推进' },
    { pattern: /(梳理|思路|关键点|脉络)/, label: '梳理思路' },
    { pattern: /(定位|排查|报错|异常|bug|问题)/i, label: '定位问题' },
    { pattern: /(遗漏|漏项|缺口)/, label: '检查遗漏' },
    { pattern: /(检查|校验|核对|验证)/, label: '校验结果' },
    { pattern: /(风险|隐患)/, label: '检查风险' },
    { pattern: /(方案|建议|实现|做法)/, label: '给出方案' },
    { pattern: /(总结|结论|提炼|归纳)/, label: '总结结论' },
  ]

  for (const rule of labelRules) {
    if (rule.pattern.test(normalized)) return rule.label
  }

  const compact = normalized
    .replace(/^(请先|请帮我先|请帮我|请你先|请你|请|先|帮我|麻烦你|麻烦|可以帮我|可以|能否)/, '')
    .replace(/^(基于刚才的内容|基于当前内容|基于上面的内容|围绕当前问题|针对当前问题)/, '')
    .replace(/(并告诉我.*|并给出.*|并说明.*|并列出.*)$/u, '')
    .trim()

  if (!compact) return ''
  return compact.length > 10 ? `${compact.slice(0, 10).trim()}…` : compact
}

function normalizeQuickPrompts(prompts: ChatSuggestion[] | undefined): ChatSuggestion[] {
  const result: ChatSuggestion[] = []
  const seen = new Set<string>()

  for (const prompt of [...(prompts ?? []), ...cloneQuickPrompts(fallbackQuickPrompts)]) {
    const textValue = typeof prompt?.text === 'string' ? prompt.text.replace(/\s+/g, ' ').trim() : ''
    const labelSource = typeof prompt?.label === 'string' && prompt.label.trim() ? prompt.label : textValue
    const labelValue = normalizeQuickPromptLabel(labelSource, textValue)
    if (!textValue || !labelValue || seen.has(textValue)) continue
    seen.add(textValue)
    result.push({ label: labelValue, text: textValue })
    if (result.length >= 3) break
  }

  return result
}

function persistQuickPromptsEnabled(value: boolean) {
  try {
    window.localStorage.setItem(QUICK_PROMPTS_ENABLED_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // 忽略存储失败，回退为当前会话内生效
  }
}

export function useChatQuickPrompts(options: UseChatQuickPromptsOptions) {
  const quickPromptsLoading = ref(false)
  const quickPromptsEnabled = ref(loadQuickPromptsEnabled())
  const quickPrompts = ref<ChatSuggestion[]>(cloneQuickPrompts(fallbackQuickPrompts))

  const quickPromptCache = new Map<string, ChatSuggestion[]>()
  let quickPromptLoadVersion = 0

  const showQuickPromptBar = computed(() => {
    return !options.interactionDisabled.value
      && !options.text.value.trim()
      && !options.hasAttachments.value
  })

  function getQuickPromptCacheKey(): string {
    const sessionId = options.currentSessionId.value?.trim()
    return sessionId || QUICK_PROMPT_CACHE_FALLBACK_KEY
  }

  function restoreQuickPromptsFromCache(): boolean {
    const cached = quickPromptCache.get(getQuickPromptCacheKey())
    if (!cached || cached.length === 0) {
      quickPrompts.value = cloneQuickPrompts(fallbackQuickPrompts)
      return false
    }

    quickPrompts.value = cloneQuickPrompts(cached)
    return true
  }

  async function loadQuickPrompts() {
    if (!quickPromptsEnabled.value) {
      quickPromptLoadVersion += 1
      quickPromptsLoading.value = false
      return
    }

    const requestVersion = ++quickPromptLoadVersion
    quickPromptsLoading.value = true

    try {
      const data = await api.getChatSuggestions(options.currentSessionId.value)
      if (requestVersion !== quickPromptLoadVersion) return
      const normalizedPrompts = normalizeQuickPrompts(data.suggestions)
      quickPrompts.value = normalizedPrompts
      quickPromptCache.set(getQuickPromptCacheKey(), cloneQuickPrompts(normalizedPrompts))
    } catch {
      if (requestVersion !== quickPromptLoadVersion) return
      const normalizedPrompts = normalizeQuickPrompts([])
      quickPrompts.value = normalizedPrompts
      quickPromptCache.set(getQuickPromptCacheKey(), cloneQuickPrompts(normalizedPrompts))
    } finally {
      if (requestVersion === quickPromptLoadVersion) {
        quickPromptsLoading.value = false
      }
    }
  }

  function applyQuickPrompt(prompt: string) {
    if (!quickPromptsEnabled.value) return
    options.text.value = prompt
    options.clearError()
    options.focusComposer()
  }

  function toggleQuickPrompts() {
    quickPromptsEnabled.value = !quickPromptsEnabled.value
  }

  onMounted(() => {
    const restored = restoreQuickPromptsFromCache()
    if (quickPromptsEnabled.value && !restored) {
      void loadQuickPrompts()
    }
  })

  watch(options.currentSessionId, () => {
    const restored = restoreQuickPromptsFromCache()
    if (quickPromptsEnabled.value && !restored) {
      void loadQuickPrompts()
    }
  })

  watch(options.disabled, (value, oldValue) => {
    if (!value && oldValue && quickPromptsEnabled.value) {
      void loadQuickPrompts()
    }
  })

  watch(quickPromptsEnabled, (value) => {
    persistQuickPromptsEnabled(value)
    if (value) {
      restoreQuickPromptsFromCache()
    } else {
      quickPromptLoadVersion += 1
      quickPromptsLoading.value = false
    }
  })

  return {
    quickPromptsLoading,
    quickPromptsEnabled,
    quickPrompts,
    showQuickPromptBar,
    applyQuickPrompt,
    toggleQuickPrompts,
  }
}
