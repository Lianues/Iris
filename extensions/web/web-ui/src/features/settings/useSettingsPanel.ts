import { ref, reactive, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { showConfirm } from '../../composables/useConfirmDialog'
import {
  getConfig,
  updateConfig,
  getStatus,
  fetchConfigModels,
  cfGetStatus,
  cfSetup,
  cfListDns,
  cfAddDns,
  cfRemoveDns,
  cfGetSsl,
  cfSetSsl,
} from '../../api/client'
import type { CfDnsRecord, ConfigModelOption, CloudflareSslMode, MCPServerInfo, RuntimeInfo } from '../../api/types'
import { useTheme, type ThemeMode } from '../../composables/useTheme'
import { loadManagementToken, subscribeManagementTokenChange } from '../../utils/managementToken'
import { loadAuthToken, subscribeAuthTokenChange } from '../../utils/authToken'

interface UseSettingsPanelOptions {
  onClose: () => void
}

export function useSettingsPanel(options: UseSettingsPanelOptions) {
  const managementEnabled = ref(false)
  const managementReady = ref(false)
  const authEnabled = ref(false)
  const authReady = ref(false)
  const accessRequirementLoaded = ref(false)

  let unsubscribeManagementToken: (() => void) | null = null
  let unsubscribeAuthToken: (() => void) | null = null

  function refreshAccessState() {
    managementReady.value = !!loadManagementToken().trim()
    authReady.value = !!loadAuthToken().trim()
  }

  function applyAccessRequirements(status: { authProtected?: boolean; managementProtected?: boolean }) {
    authEnabled.value = !!status.authProtected
    managementEnabled.value = !!status.managementProtected
    accessRequirementLoaded.value = true
  }

  function rememberAccessRequirementsFromError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '未知错误')

    if (message.includes('API 访问令牌')) {
      authEnabled.value = true
      accessRequirementLoaded.value = true
    }

    if (message.includes('管理令牌')) {
      managementEnabled.value = true
      accessRequirementLoaded.value = true
    }

    return message
  }

  // ============ 主题 ============
  const { theme: currentTheme, setTheme } = useTheme()

  const accessProtectionEnabled = computed(() => authEnabled.value || managementEnabled.value)
  const missingAccessTokens = computed(() => {
    const missing: string[] = []
    if (authEnabled.value && !authReady.value) missing.push('API 访问令牌')
    if (managementEnabled.value && !managementReady.value) missing.push('管理令牌')
    return missing
  })
  const accessLocked = computed(() => missingAccessTokens.value.length > 0)
  const accessStatusText = computed(() => {
    if (accessRequirementLoaded.value) {
      if (!accessProtectionEnabled.value) return '未启用'
      return accessLocked.value ? '未解锁' : '已解锁'
    }

    return authReady.value || managementReady.value ? '待检测' : '状态待检测'
  })
  const accessCredentialHint = computed(() => {
    if (accessRequirementLoaded.value) {
      if (!accessProtectionEnabled.value) return '当前后端未启用 Web 访问保护。'
      if (accessLocked.value) return `请先在侧边栏“访问凭证”中补全${missingAccessTokens.value.join('、')}。`
      return '当前所需访问凭证已就绪。'
    }

    if (authReady.value || managementReady.value) {
      return '已录入本地访问凭证，后端保护状态仍在检测；如相关操作返回 401，请检查访问令牌是否完整。'
    }

    return '如拉取模型、保存配置或 Cloudflare 管理返回 401，请先在侧边栏“访问凭证”中录入相应令牌。'
  })
  const accessLockMessage = computed(() => missingAccessTokens.value.length > 0 ? `当前后端要求先录入${missingAccessTokens.value.join('、')}` : '')

  function formatAccessLockedMessage(action: string): string {
    return accessLockMessage.value
      ? `${action}：${accessLockMessage.value}，请先在侧边栏“访问凭证”中补全。`
      : `${action}：访问凭证未就绪。`
  }

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: '暗色' },
    { value: 'light', label: '浅色' },
    { value: 'system', label: '跟随系统' },
  ]

  const themeHint = computed(() => {
    const hints: Record<ThemeMode, string> = {
      dark: '使用深色背景，适合夜间和低光环境。',
      light: '使用浅色背景，适合日间和明亮环境。',
      system: '自动跟随操作系统的主题偏好设置。',
    }
    return hints[currentTheme.value]
  })

  const config = reactive({
    systemPrompt: '',
    maxToolRounds: 10,
    stream: true,
  })

  const maxToolRoundsInput = ref(String(config.maxToolRounds))

  interface ModelCatalogState {
    loading: boolean
    error: string
    options: ConfigModelOption[]
    baseUrl: string
    usedStoredApiKey: boolean
  }

  interface ModelEntry {
    uid: number
    open: boolean
    originalModelName: string
    provider: string
    apiKey: string
    modelName: string
    modelId: string
    baseUrl: string
    contextWindow: string
    supportsVision: string // 'auto' | 'yes' | 'no'
    headers: string
    requestBody: string
    modelCatalog: ModelCatalogState
    modelCatalogRequestVersion: number
    lastProvider: string
  }

  let nextModelEntryUid = 1

  /** Provider 默认值，与 src/config/llm.ts DEFAULTS 保持一致 */
  const PROVIDER_DEFAULTS: Record<string, { model: string; baseUrl: string; contextWindow: number }> = {
    gemini: { model: 'gemini-2.0-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', contextWindow: 1048576 },
    'openai-compatible': { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', contextWindow: 128000 },
    'openai-responses': { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', contextWindow: 128000 },
    claude: { model: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com/v1', contextWindow: 200000 },
  }

  function createModelCatalogState(): ModelCatalogState {
    return {
      loading: false,
      error: '',
      options: [],
      baseUrl: '',
      usedStoredApiKey: false,
    }
  }

  function createModelEntry(provider = 'gemini', data: Partial<ModelEntry> = {}): ModelEntry {
    const defaults = PROVIDER_DEFAULTS[provider] ?? { model: '', baseUrl: '', contextWindow: 0 }
    return {
      uid: nextModelEntryUid++,
      open: data.open ?? true,
      originalModelName: data.originalModelName ?? '',
      provider,
      apiKey: data.apiKey ?? '',
      modelName: data.modelName ?? '',
      modelId: data.modelId ?? defaults.model,
      baseUrl: data.baseUrl ?? defaults.baseUrl,
      contextWindow: data.contextWindow ?? '',
      supportsVision: data.supportsVision ?? 'auto',
      headers: data.headers ?? '',
      requestBody: data.requestBody ?? '',
      modelCatalog: createModelCatalogState(),
      modelCatalogRequestVersion: 0,
      lastProvider: provider,
    }
  }

  /** 通用 number input 字符串同步：保持 reactive 字段始终为 string，避免 v-model type="number" 转为 number */
  function handleStringNumberInput(target: Record<string, any>, key: string, event: Event) {
    target[key] = (event.target as HTMLInputElement).value
  }

  function clampInteger(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.trunc(value)))
  }

  function syncMaxToolRoundsInput() {
    maxToolRoundsInput.value = String(config.maxToolRounds)
  }

  function handleMaxToolRoundsInput(event: Event) {
    const value = (event.target as HTMLInputElement).value
    maxToolRoundsInput.value = value

    if (!value.trim()) return

    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      config.maxToolRounds = clampInteger(parsed, 1, 50)
    }
  }

  const modelEntries = reactive<ModelEntry[]>([createModelEntry()])
  const defaultModelName = ref('')
  const modelOriginalNames = ref<string[]>([])

  /** 初始加载完成前抑制 provider watcher 的副作用 */
  let configLoaded = false

  function providerLabel(provider: string): string {
    const map: Record<string, string> = {
      gemini: 'Gemini',
      'openai-compatible': 'OpenAI 兼容',
      'openai-responses': 'OpenAI Responses',
      claude: 'Claude',
    }
    return map[provider] || provider
  }

  function contextWindowPlaceholder(entry: ModelEntry): string {
    const defaults = PROVIDER_DEFAULTS[entry.provider]
    return defaults?.contextWindow ? String(defaults.contextWindow) : ''
  }

  const defaultModelOptions = computed(() => {
    return modelEntries
      .map((entry, index) => {
        const value = entry.modelName.trim()
        return {
          value,
          label: value || `未命名模型 ${index + 1}`,
        }
      })
      .filter(option => !!option.value)
  })

  function syncDefaultModelName(newNames: string[], oldNames: string[] = []) {
    const normalizedNewNames = newNames.map(name => name.trim())
    if (normalizedNewNames.every(name => !name)) {
      defaultModelName.value = ''
      return
    }

    const current = defaultModelName.value.trim()
    if (current && normalizedNewNames.includes(current)) {
      defaultModelName.value = current
      return
    }

    const renamedIndex = oldNames.findIndex(name => name === current)
    if (renamedIndex >= 0 && normalizedNewNames[renamedIndex]) {
      defaultModelName.value = normalizedNewNames[renamedIndex]
      return
    }

    defaultModelName.value = normalizedNewNames.find(Boolean) || ''
  }

  watch(
    () => modelEntries.map(entry => entry.modelName.trim()),
    (newNames, oldNames) => {
      syncDefaultModelName(newNames, oldNames ?? [])
    },
  )

  function addModelEntry() {
    modelEntries.push(createModelEntry())
  }

  function removeModelEntry(index: number) {
    if (modelEntries.length <= 1) return
    const [removed] = modelEntries.splice(index, 1)
    if (removed && defaultModelName.value === removed.modelName.trim()) {
      syncDefaultModelName(modelEntries.map(entry => entry.modelName.trim()))
    }
  }

  function resetModelCatalog(entry: ModelEntry) {
    entry.modelCatalogRequestVersion += 1
    Object.assign(entry.modelCatalog, createModelCatalogState())
  }

  function handleModelProviderChange(entry: ModelEntry) {
    const oldDefaults = PROVIDER_DEFAULTS[entry.lastProvider] ?? { model: '', baseUrl: '', contextWindow: 0 }
    const newDefaults = PROVIDER_DEFAULTS[entry.provider] ?? { model: '', baseUrl: '', contextWindow: 0 }
    if (!entry.modelId || entry.modelId === oldDefaults.model) entry.modelId = newDefaults.model
    if (!entry.baseUrl || entry.baseUrl === oldDefaults.baseUrl) entry.baseUrl = newDefaults.baseUrl
    entry.lastProvider = entry.provider
    resetModelCatalog(entry)
  }

  function modelKeyHint(entry: ModelEntry): string {
    if (!entry.apiKey) return '未配置 API Key。'
    return 'API Key 已配置。'
  }

  function modelCatalogHint(entry: ModelEntry): string {
    const state = entry.modelCatalog
    if (accessLocked.value) return `${accessLockMessage.value}，请先在侧边栏“访问凭证”中补全。`
    if (state.error) return state.error
    if (state.options.length > 0) {
      return `已从 ${state.baseUrl} 拉取 ${state.options.length} 个模型${state.usedStoredApiKey ? '（使用已保存 API Key）' : ''}。也可继续手动输入。`
    }
    return '填写 API 地址与 Key 后，可拉取模型列表，也可继续手动输入模型 ID。'
  }

  function normalizeApiKeyForLookup(apiKey: string): string | undefined {
    const trimmed = apiKey.trim()
    return trimmed || undefined
  }

  async function fetchModelOptions(index: number) {
    const entry = modelEntries[index]
    if (!entry) return
    const state = entry.modelCatalog

    if (accessLocked.value) {
      state.error = formatAccessLockedMessage('拉取模型列表失败')
      return
    }

    const requestVersion = ++entry.modelCatalogRequestVersion

    state.loading = true
    state.error = ''

    try {
      const result = await fetchConfigModels({
        modelName: entry.modelName.trim() || undefined,
        provider: entry.provider,
        baseUrl: entry.baseUrl,
        apiKey: normalizeApiKeyForLookup(entry.apiKey),
      })

      if (requestVersion !== entry.modelCatalogRequestVersion) return

      state.options = result.models
      state.baseUrl = result.baseUrl
      state.usedStoredApiKey = result.usedStoredApiKey

      if (result.models.length === 0) {
        state.error = '接口已连接，但没有返回可用模型。你仍可手动输入模型 ID。'
        return
      }

      if (!entry.modelId) {
        entry.modelId = result.models[0].id
      }
    } catch (err: any) {
      if (requestVersion !== entry.modelCatalogRequestVersion) return
      state.error = '拉取失败：' + (err?.message || '未知错误')
    } finally {
      if (requestVersion === entry.modelCatalogRequestVersion) {
        state.loading = false
      }
    }
  }

  watch(() => JSON.stringify(modelEntries.map(entry => ({ provider: entry.provider, baseUrl: entry.baseUrl, apiKey: entry.apiKey, modelName: entry.modelName }))), () => {
    if (!configLoaded) return
    modelEntries.forEach(entry => resetModelCatalog(entry))
  })

  const tools = ref<string[]>([])
  const disabledTools = ref(new Set<string>())

  function toggleTool(name: string) {
    const next = new Set(disabledTools.value)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    disabledTools.value = next
  }

  const statusText = ref('')
  const statusError = ref(false)
  const saving = ref(false)
  const dirty = ref(false)

  // ============ MCP ============
  type MCPTransport = 'stdio' | 'sse' | 'streamable-http'

  interface MCPServerEntry {
    name: string
    transport: MCPTransport
    command: string
    args: string // 每行一个参数，保存时转为 string[]
    cwd: string
    url: string
    authHeader: string // Authorization header 值
    timeout: number
    timeoutInput: string
    enabled: boolean
    open: boolean // UI 展开状态
  }

  // ============ Sub-Agents ============
  type SubAgentToolMode = 'all' | 'allowed' | 'excluded'

  interface SubAgentEntry {
    uid: number
    open: boolean
    name: string
    description: string
    systemPrompt: string
    toolMode: SubAgentToolMode
    toolList: string
    modelName: string
    maxToolRounds: number
    maxToolRoundsInput: string
    parallel: boolean
  }

  let nextSubAgentUid = 1

  function createSubAgentEntry(data: Partial<SubAgentEntry> = {}): SubAgentEntry {
    return {
      uid: nextSubAgentUid++,
      open: data.open ?? true,
      name: data.name ?? '',
      description: data.description ?? '',
      systemPrompt: data.systemPrompt ?? '',
      toolMode: data.toolMode ?? 'all',
      toolList: data.toolList ?? '',
      modelName: data.modelName ?? '',
      maxToolRounds: data.maxToolRounds ?? 200,
      maxToolRoundsInput: String(data.maxToolRounds ?? 200),
      parallel: data.parallel ?? false,
    }
  }

  const subAgentEntries = reactive<SubAgentEntry[]>([])
  const subAgentOriginalNames = ref<string[]>([])

  const subAgentModelOptions = computed(() => {
    const options: Array<{ value: string; label: string; description?: string }> = [
      { value: '', label: '跟随当前活动模型', description: '使用与主对话相同的模型' },
    ]
    for (const entry of modelEntries) {
      const name = entry.modelName.trim()
      if (!name) continue
      options.push({
        value: name,
        label: name,
        description: `${providerLabel(entry.provider)} · ${entry.modelId || '未填写模型 ID'}`,
      })
    }
    return options
  })

  function addSubAgentEntry() {
    subAgentEntries.push(createSubAgentEntry())
  }

  function removeSubAgentEntry(index: number) {
    subAgentEntries.splice(index, 1)
  }

  function handleSubAgentMaxToolRoundsInput(entry: SubAgentEntry, event: Event) {
    const value = (event.target as HTMLInputElement).value
    entry.maxToolRoundsInput = value
    if (!value.trim()) return
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      entry.maxToolRounds = clampInteger(parsed, 1, 999)
    }
  }

  function syncSubAgentMaxToolRoundsInput(entry: SubAgentEntry) {
    entry.maxToolRoundsInput = String(entry.maxToolRounds)
  }

  function loadBuiltinSubAgentDefaults() {
    if (subAgentEntries.length > 0) return
    subAgentEntries.push(
      createSubAgentEntry({
        name: 'general-purpose',
        description: '执行需要多步工具操作的复杂子任务。适合承接相对独立的子任务。',
        systemPrompt: '你是一个通用子代理，负责独立完成委派给你的子任务。请专注于完成任务并返回清晰的结果。',
        toolMode: 'excluded',
        toolList: 'sub_agent',
        parallel: false,
        maxToolRounds: 200,
        open: false,
      }),
      createSubAgentEntry({
        name: 'explore',
        description: '只读搜索和阅读文件、执行查询命令。不做修改，只返回发现的信息。',
        systemPrompt: '你是一个只读探索代理，负责搜索和阅读信息。不要修改任何文件，只返回你发现的内容。',
        toolMode: 'allowed',
        toolList: 'read_file\nsearch_in_files\nshell',
        parallel: false,
        maxToolRounds: 200,
        open: false,
      }),
      createSubAgentEntry({
        name: 'recall',
        description: '从长期记忆中检索相关信息。当需要回忆用户偏好、历史事实或之前保存的内容时使用。',
        systemPrompt: '你是一个记忆召回代理。根据给定的查询，从长期记忆中尽可能全面地检索相关信息。\n\n策略：\n1. 先用原始查询搜索\n2. 如果结果不够，提取关键词重新搜索\n3. 尝试相关概念或同义词搜索\n\n将所有找到的记忆整理为清晰的摘要返回。如果没有找到任何相关记忆，明确说明。',
        toolMode: 'allowed',
        toolList: 'memory_search',
        parallel: false,
        maxToolRounds: 3,
        open: false,
      }),
    )
  }

  function findDuplicateSubAgentNames(): string[] {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const entry of subAgentEntries) {
      const normalized = entry.name.trim()
      if (!normalized) continue
      if (seen.has(normalized)) { duplicates.add(normalized); continue }
      seen.add(normalized)
    }
    return Array.from(duplicates)
  }

  function buildSubAgentPayload(): Record<string, any> | null {
    const types: Record<string, any> = {}
    for (const name of subAgentOriginalNames.value) {
      if (!subAgentEntries.some(e => e.name.trim() === name)) {
        types[name] = null
      }
    }
    for (const entry of subAgentEntries) {
      const name = entry.name.trim()
      if (!name) continue
      const def: any = {
        description: entry.description,
        systemPrompt: entry.systemPrompt,
        maxToolRounds: entry.maxToolRounds,
        parallel: entry.parallel,
      }
      if (entry.modelName.trim()) {
        def.modelName = entry.modelName.trim()
      } else {
        def.modelName = null
      }
      if (entry.toolMode === 'allowed') {
        def.allowedTools = entry.toolList.split('\n').map(s => s.trim()).filter(Boolean)
        def.excludedTools = null
      } else if (entry.toolMode === 'excluded') {
        def.excludedTools = entry.toolList.split('\n').map(s => s.trim()).filter(Boolean)
        def.allowedTools = null
      } else {
        def.allowedTools = null
        def.excludedTools = null
      }
      types[name] = def
    }
    return Object.keys(types).length > 0 ? { types } : null
  }

  function validateSubAgentEntries(): string | null {
    if (subAgentEntries.length === 0) return null
    const names = new Set<string>()
    for (const entry of subAgentEntries) {
      const name = entry.name.trim()
      if (!name) return '子代理类型名称不能为空'
      if (!entry.description.trim()) return `子代理类型「${name}」缺少描述`
      if (names.has(name)) return `子代理类型名称重复：${name}`
      names.add(name)
    }
    return null
  }

  // ============ Modes ============
  type ModeToolMode = 'all' | 'include' | 'exclude'

  interface ModeEntry {
    uid: number
    open: boolean
    name: string
    description: string
    systemPrompt: string
    toolMode: ModeToolMode
    toolList: string
  }

  let nextModeUid = 1

  function createModeEntry(data: Partial<ModeEntry> = {}): ModeEntry {
    return {
      uid: nextModeUid++,
      open: data.open ?? true,
      name: data.name ?? '',
      description: data.description ?? '',
      systemPrompt: data.systemPrompt ?? '',
      toolMode: data.toolMode ?? 'all',
      toolList: data.toolList ?? '',
    }
  }

  const modeEntries = reactive<ModeEntry[]>([])
  const modeOriginalNames = ref<string[]>([])

  function addModeEntry() {
    modeEntries.push(createModeEntry())
  }

  function removeModeEntry(index: number) {
    modeEntries.splice(index, 1)
  }

  function findDuplicateModeNames(): string[] {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const entry of modeEntries) {
      const normalized = entry.name.trim()
      if (!normalized) continue
      if (seen.has(normalized)) { duplicates.add(normalized); continue }
      seen.add(normalized)
    }
    return Array.from(duplicates)
  }

  function buildModesPayload(): Record<string, any> | null {
    const modes: Record<string, any> = {}
    for (const name of modeOriginalNames.value) {
      if (!modeEntries.some(e => e.name.trim() === name)) {
        modes[name] = null
      }
    }
    for (const entry of modeEntries) {
      const name = entry.name.trim()
      if (!name) continue
      const def: any = {}
      if (entry.description.trim()) def.description = entry.description.trim()
      if (entry.systemPrompt.trim()) def.systemPrompt = entry.systemPrompt.trim()
      if (entry.toolMode === 'include') {
        def.tools = { include: entry.toolList.split('\n').map(s => s.trim()).filter(Boolean), exclude: null }
      } else if (entry.toolMode === 'exclude') {
        def.tools = { exclude: entry.toolList.split('\n').map(s => s.trim()).filter(Boolean), include: null }
      } else {
        def.tools = null
      }
      modes[name] = def
    }
    return Object.keys(modes).length > 0 ? modes : null
  }

  function validateModeEntries(): string | null {
    if (modeEntries.length === 0) return null
    const names = new Set<string>()
    for (const entry of modeEntries) {
      const name = entry.name.trim()
      if (!name) return '模式名称不能为空'
      if (name === 'normal') return '模式名称不能使用保留名称「normal」'
      if (names.has(name)) return `模式名称重复：${name}`
      names.add(name)
    }
    return null
  }

  // ============ Plugins ============

  interface PluginEntry {
    uid: number
    open: boolean
    name: string
    type: 'local' | 'npm'
    enabled: boolean
    config: string
  }

  let nextPluginUid = 1

  function createPluginEntry(data: Partial<PluginEntry> = {}): PluginEntry {
    return {
      uid: nextPluginUid++,
      open: data.open ?? true,
      name: data.name ?? '',
      type: data.type ?? 'local',
      enabled: data.enabled ?? true,
      config: data.config ?? '',
    }
  }

  const pluginEntries = reactive<PluginEntry[]>([])

  function addPluginEntry() {
    pluginEntries.push(createPluginEntry())
  }

  function removePluginEntry(index: number) {
    pluginEntries.splice(index, 1)
  }

  function findDuplicatePluginNames(): string[] {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const entry of pluginEntries) {
      const normalized = entry.name.trim()
      if (!normalized) continue
      if (seen.has(normalized)) { duplicates.add(normalized); continue }
      seen.add(normalized)
    }
    return Array.from(duplicates)
  }

  function buildPluginsPayload(): any[] | null {
    if (pluginEntries.length === 0) return null
    const result: any[] = []
    for (const entry of pluginEntries) {
      const name = entry.name.trim()
      if (!name) continue
      const item: any = { name, type: entry.type, enabled: entry.enabled }
      if (entry.config.trim()) {
        try { item.config = JSON.parse(entry.config) } catch { /* ignore invalid JSON */ }
      }
      result.push(item)
    }
    return result.length > 0 ? result : null
  }

  function validatePluginEntries(): string | null {
    if (pluginEntries.length === 0) return null
    const names = new Set<string>()
    for (const entry of pluginEntries) {
      const name = entry.name.trim()
      if (!name) return '插件名称不能为空'
      if (names.has(name)) return `插件名称重复：${name}`
      names.add(name)
    }
    return null
  }

  // ============ Platform Config ============
  const platformConfig = reactive({
    types: [] as string[],
    web: { port: '', host: '', authToken: '', managementToken: '' },
    discord: { token: '' },
    telegram: { token: '', showToolStatus: false, groupMentionRequired: false },
    wxwork: { botId: '', secret: '', showToolStatus: false },
    lark: { appId: '', appSecret: '', verificationToken: '', encryptKey: '', showToolStatus: false },
    qq: { wsUrl: '', accessToken: '', selfId: '', groupMode: 'at' as string, showToolStatus: false },
  })

  function buildPlatformPayload(): Record<string, any> {
    const p: Record<string, any> = {}
    p.types = platformConfig.types.length > 0 ? [...platformConfig.types] : null
    // Web
    const web: Record<string, any> = {}
    const webPort = String(platformConfig.web.port).trim()
    web.port = webPort ? (Number(webPort) || null) : null
    web.host = platformConfig.web.host.trim() || null
    web.authToken = platformConfig.web.authToken.trim() || null
    web.managementToken = platformConfig.web.managementToken.trim() || null
    p.web = web
    // Discord
    const discord: Record<string, any> = { token: platformConfig.discord.token.trim() || null }
    p.discord = discord
    // Telegram
    const telegram: Record<string, any> = {
      showToolStatus: platformConfig.telegram.showToolStatus,
      groupMentionRequired: platformConfig.telegram.groupMentionRequired,
    }
    telegram.token = platformConfig.telegram.token.trim() || null
    p.telegram = telegram
    // 企业微信
    const wxwork: Record<string, any> = {
      botId: platformConfig.wxwork.botId.trim() || null,
      showToolStatus: platformConfig.wxwork.showToolStatus,
    }
    wxwork.secret = platformConfig.wxwork.secret.trim() || null
    p.wxwork = wxwork
    // 飞书
    const lark: Record<string, any> = {
      appId: platformConfig.lark.appId.trim() || null,
      verificationToken: platformConfig.lark.verificationToken.trim() || null,
      encryptKey: platformConfig.lark.encryptKey.trim() || null,
      showToolStatus: platformConfig.lark.showToolStatus,
    }
    lark.appSecret = platformConfig.lark.appSecret.trim() || null
    p.lark = lark
    // QQ
    const qq: Record<string, any> = {
      wsUrl: platformConfig.qq.wsUrl.trim() || null,
      selfId: platformConfig.qq.selfId.trim() || null,
      groupMode: platformConfig.qq.groupMode || null,
      showToolStatus: platformConfig.qq.showToolStatus,
    }
    qq.accessToken = platformConfig.qq.accessToken.trim() || null
    p.qq = qq
    return p
  }

  const mcpServers = reactive<MCPServerEntry[]>([])
  /** 加载时记录的原始服务器名，用于保存时识别被删除的服务器 */
  const mcpOriginalNames = ref<string[]>([])
  /** MCP 服务器运行时状态 */
  const mcpStatus = ref<MCPServerInfo[]>([])
  /** 运行环境信息 */
  const runtimeInfo = ref<RuntimeInfo | null>(null)

  function mcpStatusLabel(server: MCPServerEntry): { text: string; color: string } {
    if (!server.enabled) return { text: '已禁用', color: 'var(--text-muted)' }
    const info = mcpStatus.value.find(s => s.name === server.name)
    if (!info) return { text: '未应用', color: 'var(--text-tertiary)' }
    if (info.status === 'connected') return { text: `已连接 · ${info.toolCount} 工具`, color: 'var(--success)' }
    if (info.error) return { text: info.error, color: 'var(--error)' }
    return { text: info.status === 'connecting' ? '连接中...' : '未连接', color: 'var(--text-tertiary)' }
  }

  function normalizeMcpTransport(transport: unknown): MCPTransport {
    if (transport === 'sse' || transport === 'streamable-http') {
      return transport
    }

    if (transport === 'http') {
      return 'streamable-http'
    }

    return 'stdio'
  }

  function transportLabel(transport: MCPTransport): string {
    return transport === 'stdio' ? '本地进程' : (transport === 'sse' ? 'SSE 事件流' : 'Streamable HTTP')
  }

  function addMcpServer() {
    mcpServers.push({
      name: '', transport: 'stdio', command: '', args: '', cwd: '',
      url: '', authHeader: '', timeout: 30000, timeoutInput: '30000', enabled: true, open: true,
    })
  }

  function removeMcpServer(idx: number) {
    mcpServers.splice(idx, 1)
  }

  function syncMcpTimeoutInput(server: MCPServerEntry) {
    server.timeoutInput = String(server.timeout)
  }

  function handleMcpTimeoutInput(server: MCPServerEntry, event: Event) {
    const value = (event.target as HTMLInputElement).value
    server.timeoutInput = value

    if (!value.trim()) return

    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      server.timeout = clampInteger(parsed, 1000, 120000)
    }
  }

  function sanitizeMcpName(server: MCPServerEntry) {
    server.name = server.name.replace(/[^a-zA-Z0-9_]/g, '_')
  }

  function findDuplicateMcpNames(): string[] {
    const seen = new Set<string>()
    const duplicates = new Set<string>()

    for (const server of mcpServers) {
      const normalized = server.name.trim()
      if (!normalized) continue

      if (seen.has(normalized)) {
        duplicates.add(normalized)
        continue
      }

      seen.add(normalized)
    }

    return Array.from(duplicates)
  }

  function buildMCPPayload(): { payload: any; currentNames: string[] } {
    const servers: Record<string, any> = {}
    // 被删除的服务器发送 null（deepMerge 会删除该键）
    for (const name of mcpOriginalNames.value) {
      if (!mcpServers.some(s => s.name === name)) {
        servers[name] = null
      }
    }
    const currentNames: string[] = []
    for (const s of mcpServers) {
      if (!s.name.trim()) continue
      currentNames.push(s.name)
      const entry: any = {
        transport: s.transport,
        enabled: s.enabled,
        timeout: clampInteger(s.timeout || 30000, 1000, 120000),
      }
      if (s.transport === 'stdio') {
        entry.command = s.command
        entry.args = s.args.split('\n').map((a: string) => a.trim()).filter(Boolean)
        entry.cwd = s.cwd || null // 空值发 null 让 deepMerge 删除旧值
        entry.url = null
        entry.headers = null
      } else {
        entry.url = s.url
        entry.command = null
        entry.args = null
        entry.cwd = null
        if (s.authHeader.trim()) {
          entry.headers = { Authorization: s.authHeader.trim() }
        } else {
          entry.headers = null
        }
      }
      servers[s.name] = entry
    }

    return {
      payload: Object.keys(servers).length > 0 ? { servers } : null,
      currentNames,
    }
  }

  // ============ Cloudflare ============
  const cf = reactive({
    connected: false,
    configured: false,
    loading: false,
    tokenInput: '',
    error: '',
    zones: [] as { id: string; name: string; status: string }[],
    activeZoneId: null as string | null,
    tokenSource: null as 'inline' | 'env' | 'file' | null,
    // SSL
    sslMode: 'full' as CloudflareSslMode,
    sslSaving: false,
    sslLoading: false,
    sslMsg: '',
    sslError: false,
    // DNS
    dnsRecords: [] as CfDnsRecord[],
    dnsLoading: false,
    dnsSaving: false,
    dnsDeletingId: null as string | null,
    dnsMsg: '',
    dnsError: false,
    newDns: { type: 'A', name: '', content: '', proxied: true },
  })

  let cfDnsRequestVersion = 0
  let cfSslRequestVersion = 0
  let cfSslMutationVersion = 0

  const streamHint = computed(() => {
    return config.stream
      ? '回复会实时逐字显示，更适合长内容阅读。'
      : '回复会完整生成后一次性返回。'
  })

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      void requestClose()
    }
  }

  const overlayCloseArmed = ref(false)

  function resetOverlayCloseIntent() {
    overlayCloseArmed.value = false
  }

  function handleOverlayPointerDown(event: PointerEvent) {
    if (event.button !== 0) {
      overlayCloseArmed.value = false
      return
    }

    overlayCloseArmed.value = true
  }

  function handleOverlayPointerUp(event: PointerEvent) {
    const shouldClose = event.button === 0 && overlayCloseArmed.value
    overlayCloseArmed.value = false
    if (shouldClose) void requestClose()
  }

  async function requestClose() {
    if (saving.value) return

    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }

    if (dirty.value) {
      await handleSave()
      if (saving.value) return
      if (dirty.value && !saving.value) {
        const confirmedDiscard = await showConfirm({
          title: '放弃未保存的更改？',
          description: `${statusText.value || '当前更改尚未成功保存。'}<br>关闭后未保存的更改将丢失。`,
          confirmText: '放弃更改',
          cancelText: '继续编辑',
          danger: true,
        })
        if (!confirmedDiscard) return
      }
    }

    options.onClose()
  }

  onMounted(async () => {
    window.addEventListener('keydown', onKeydown)
    refreshAccessState()
    unsubscribeManagementToken = subscribeManagementTokenChange(refreshAccessState)
    unsubscribeAuthToken = subscribeAuthTokenChange(refreshAccessState)
    await loadConfigData()
    // 主配置加载完成后再加载非关键数据，不阻塞首屏
    loadCfStatus()
    loadAgentStatus()
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    unsubscribeManagementToken?.()
    unsubscribeAuthToken?.()
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
  })

  // ============ 自动保存 ============
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleAutoSave() {
    if (!configLoaded) return
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    dirty.value = true
    if (accessLocked.value) return
    autoSaveTimer = setTimeout(() => {
      if (saving.value) {
        scheduleAutoSave()
        return
      }
      handleSave()
    }, 1000)
  }

  watch(
    [
      () => config.systemPrompt,
      () => config.maxToolRounds,
      () => config.stream,
      () => defaultModelName.value,
      () => JSON.stringify(modelEntries.map(entry => ({ modelName: entry.modelName, provider: entry.provider, apiKey: entry.apiKey, modelId: entry.modelId, baseUrl: entry.baseUrl, contextWindow: entry.contextWindow, supportsVision: entry.supportsVision, headers: entry.headers, requestBody: entry.requestBody }))),
      // 排除 open（纯 UI 状态）
      () => JSON.stringify(mcpServers, (key, value) => (key === 'open' || key === 'timeoutInput') ? undefined : value),
      () => JSON.stringify(subAgentEntries.map(e => ({ name: e.name, description: e.description, systemPrompt: e.systemPrompt, toolMode: e.toolMode, toolList: e.toolList, modelName: e.modelName, maxToolRounds: e.maxToolRounds, parallel: e.parallel }))),
      () => JSON.stringify(modeEntries.map(e => ({ name: e.name, description: e.description, systemPrompt: e.systemPrompt, toolMode: e.toolMode, toolList: e.toolList }))),
      () => JSON.stringify(pluginEntries.map(e => ({ name: e.name, type: e.type, enabled: e.enabled, config: e.config }))),
      () => JSON.stringify(platformConfig),
      () => JSON.stringify([...disabledTools.value].sort()),
    ],
    scheduleAutoSave,
  )

  function loadModelEntriesFromConfig(llm: any) {
    modelEntries.splice(0, modelEntries.length)
    modelOriginalNames.value = []

    if (llm?.models && typeof llm.models === 'object' && !Array.isArray(llm.models)) {
      for (const [name, cfg] of Object.entries(llm.models) as [string, any][]) {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue
        const provider = typeof cfg.provider === 'string' ? cfg.provider : 'gemini'
        modelEntries.push(createModelEntry(provider, {
          originalModelName: name,
          modelName: name,
          apiKey: cfg.apiKey || '',
          modelId: cfg.model || '',
          baseUrl: cfg.baseUrl || '',
          contextWindow: cfg.contextWindow != null ? String(cfg.contextWindow) : '',
          supportsVision: cfg.supportsVision === true ? 'yes' : cfg.supportsVision === false ? 'no' : 'auto',
          headers: cfg.headers && typeof cfg.headers === 'object' ? JSON.stringify(cfg.headers, null, 2) : '',
          requestBody: cfg.requestBody && typeof cfg.requestBody === 'object' ? JSON.stringify(cfg.requestBody, null, 2) : '',
          open: name === llm.defaultModel,
        }))
        modelOriginalNames.value.push(name)
      }
    }

    if (modelEntries.length === 0) {
      modelEntries.push(createModelEntry())
    }

    defaultModelName.value = typeof llm?.defaultModel === 'string' ? llm.defaultModel.trim() : ''
    syncDefaultModelName(modelEntries.map(entry => entry.modelName.trim()))
  }

  // ---- 多 Agent 编辑切换 ----
  const editingAgent = ref<string | null>(null)

  function clearConfigState() {
    modelEntries.splice(0)
    mcpServers.splice(0)
    subAgentEntries.splice(0)
    modeEntries.splice(0)
    pluginEntries.splice(0)
    mcpOriginalNames.value = []
    subAgentOriginalNames.value = []
    modeOriginalNames.value = []
    config.systemPrompt = ''
    config.maxToolRounds = 10
    config.stream = true
    defaultModelName.value = ''
    // Platform
    platformConfig.types = []
    platformConfig.web = { port: '', host: '', authToken: '', managementToken: '' }
    platformConfig.discord = { token: '' }
    platformConfig.telegram = { token: '', showToolStatus: false, groupMentionRequired: false }
    platformConfig.wxwork = { botId: '', secret: '', showToolStatus: false }
    platformConfig.lark = { appId: '', appSecret: '', verificationToken: '', encryptKey: '', showToolStatus: false }
    platformConfig.qq = { wsUrl: '', accessToken: '', selfId: '', groupMode: 'at', showToolStatus: false }
    // Tools
    tools.value = []
    disabledTools.value = new Set()
    dirty.value = false
  }

  async function loadConfigData() {
    refreshAccessState()

    // 并行发起 getConfig 和 getStatus，避免串行等待
    const [configResult, statusResult] = await Promise.allSettled([
      getConfig(),
      getStatus(),
    ])

    // 处理 config
    if (configResult.status === 'fulfilled') {
      try {
        const data = configResult.value
        loadModelEntriesFromConfig(data.llm || {})

        config.systemPrompt = data.system?.systemPrompt || ''
        config.maxToolRounds = data.system?.maxToolRounds ?? 10
        syncMaxToolRoundsInput()
        config.stream = data.system?.stream ?? true

        // MCP
        if (data.mcp?.servers && typeof data.mcp.servers === 'object') {
          mcpOriginalNames.value = Object.keys(data.mcp.servers)
          for (const [name, cfg] of Object.entries(data.mcp.servers) as [string, any][]) {
            mcpServers.push({
              name,
              transport: normalizeMcpTransport(cfg.transport),
              command: cfg.command || '',
              args: Array.isArray(cfg.args) ? cfg.args.join('\n') : '',
              cwd: cfg.cwd || '',
              url: cfg.url || '',
              authHeader: cfg.headers?.Authorization || '',
              timeout: cfg.timeout ?? 30000,
              timeoutInput: String(cfg.timeout ?? 30000),
              enabled: cfg.enabled !== false,
              open: false,
            })
          }
        }

        // Sub-Agents
        if (data.sub_agents?.types && typeof data.sub_agents.types === 'object') {
          for (const [name, cfg] of Object.entries(data.sub_agents.types) as [string, any][]) {
            if (!cfg || typeof cfg !== 'object') continue
            let toolMode: SubAgentToolMode = 'all'
            let toolList = ''
            if (Array.isArray(cfg.allowedTools) && cfg.allowedTools.length > 0) {
              toolMode = 'allowed'
              toolList = cfg.allowedTools.join('\n')
            } else if (Array.isArray(cfg.excludedTools) && cfg.excludedTools.length > 0) {
              toolMode = 'excluded'
              toolList = cfg.excludedTools.join('\n')
            }
            subAgentEntries.push(createSubAgentEntry({
              name,
              description: cfg.description || '',
              systemPrompt: cfg.systemPrompt || '',
              toolMode,
              toolList,
              modelName: cfg.modelName || '',
              maxToolRounds: cfg.maxToolRounds ?? 200,
              parallel: cfg.parallel ?? false,
              open: false,
            }))
          }
          subAgentOriginalNames.value = subAgentEntries.map(e => e.name)
        }

        // Modes
        if (data.modes && typeof data.modes === 'object' && !Array.isArray(data.modes)) {
          for (const [name, cfg] of Object.entries(data.modes) as [string, any][]) {
            if (name === 'normal') continue
            if (!cfg || typeof cfg !== 'object') continue
            let toolMode: ModeToolMode = 'all'
            let toolList = ''
            if (Array.isArray(cfg.tools?.include) && cfg.tools.include.length > 0) {
              toolMode = 'include'
              toolList = cfg.tools.include.join('\n')
            } else if (Array.isArray(cfg.tools?.exclude) && cfg.tools.exclude.length > 0) {
              toolMode = 'exclude'
              toolList = cfg.tools.exclude.join('\n')
            }
            modeEntries.push(createModeEntry({
              name,
              description: cfg.description || '',
              systemPrompt: cfg.systemPrompt || '',
              toolMode,
              toolList,
              open: false,
            }))
          }
          modeOriginalNames.value = modeEntries.map(e => e.name)
        }

        // Plugins
        if (Array.isArray(data.plugins)) {
          for (const p of data.plugins) {
            if (!p || typeof p !== 'object') continue
            pluginEntries.push(createPluginEntry({
              name: p.name || '',
              type: p.type === 'npm' ? 'npm' : 'local',
              enabled: p.enabled !== false,
              config: p.config ? JSON.stringify(p.config, null, 2) : '',
              open: false,
            }))
          }
        }

        // Platform
        if (data.platform && typeof data.platform === 'object') {
          const pl = data.platform
          if (Array.isArray(pl.types)) platformConfig.types = [...pl.types]
          if (pl.web) {
            platformConfig.web.port = pl.web.port != null ? String(pl.web.port) : ''
            platformConfig.web.host = pl.web.host || ''
            platformConfig.web.authToken = pl.web.authToken || ''
            platformConfig.web.managementToken = pl.web.managementToken || ''
          }
          if (pl.discord) platformConfig.discord.token = pl.discord.token || ''
          if (pl.telegram) {
            platformConfig.telegram.token = pl.telegram.token || ''
            platformConfig.telegram.showToolStatus = !!pl.telegram.showToolStatus
            platformConfig.telegram.groupMentionRequired = !!pl.telegram.groupMentionRequired
          }
          if (pl.wxwork) {
            platformConfig.wxwork.botId = pl.wxwork.botId || ''
            platformConfig.wxwork.secret = pl.wxwork.secret || ''
            platformConfig.wxwork.showToolStatus = !!pl.wxwork.showToolStatus
          }
          if (pl.lark) {
            platformConfig.lark.appId = pl.lark.appId || ''
            platformConfig.lark.appSecret = pl.lark.appSecret || ''
            platformConfig.lark.verificationToken = pl.lark.verificationToken || ''
            platformConfig.lark.encryptKey = pl.lark.encryptKey || ''
            platformConfig.lark.showToolStatus = !!pl.lark.showToolStatus
          }
          if (pl.qq) {
            platformConfig.qq.wsUrl = pl.qq.wsUrl || ''
            platformConfig.qq.accessToken = pl.qq.accessToken || ''
            platformConfig.qq.selfId = pl.qq.selfId || ''
            platformConfig.qq.groupMode = pl.qq.groupMode || 'at'
            platformConfig.qq.showToolStatus = !!pl.qq.showToolStatus
          }
        }

        // 等待 provider watcher 的异步回调执行完毕后再启用副作用
        await nextTick()
        configLoaded = true
        dirty.value = false
        syncMaxToolRoundsInput()
      } catch (err: any) {
        const detail = rememberAccessRequirementsFromError(err)
        statusText.value = accessLocked.value
          ? formatAccessLockedMessage('加载配置失败')
          : '加载配置失败: ' + (detail || '未知错误')
        statusError.value = true
        dirty.value = false
      }
    } else {
      const detail = rememberAccessRequirementsFromError(configResult.reason)
      statusText.value = accessLocked.value
        ? formatAccessLockedMessage('加载配置失败')
        : '加载配置失败: ' + (detail || '未知错误')
      statusError.value = true
      dirty.value = false
    }
    syncMaxToolRoundsInput()

    // 处理 status
    if (statusResult.status === 'fulfilled') {
      const status = statusResult.value
      tools.value = status.tools || []
      disabledTools.value = new Set(status.disabledTools || [])
      mcpStatus.value = status.mcpStatus ?? []
      runtimeInfo.value = status.runtime ?? null
      applyAccessRequirements(status)
    } else {
      rememberAccessRequirementsFromError(statusResult.reason)
      tools.value = []
    }
  }

  async function switchEditingAgent(agentName: string | null) {
    const { setCurrentAgentName } = await import('../../api/client')
    const previousAgent = editingAgent.value
    editingAgent.value = agentName
    setCurrentAgentName(agentName)
    configLoaded = false
    clearConfigState()
    await loadConfigData()
    // 如果切换失败，回退并重新加载之前的配置
    if (!configLoaded && agentName) {
      editingAgent.value = previousAgent
      setCurrentAgentName(previousAgent)
      clearConfigState()
      await loadConfigData()
    }
  }


  function buildModelEntryPayload(entry: ModelEntry): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      provider: entry.provider,
      model: entry.modelId,
      baseUrl: entry.baseUrl,
    }
    payload.apiKey = entry.apiKey || null
    // contextWindow
    const cw = String(entry.contextWindow).trim()
    if (cw) {
      const parsed = Number(cw)
      if (Number.isFinite(parsed) && parsed > 0) payload.contextWindow = parsed
    } else {
      payload.contextWindow = null
    }
    // supportsVision
    if (entry.supportsVision === 'yes') payload.supportsVision = true
    else if (entry.supportsVision === 'no') payload.supportsVision = false
    else payload.supportsVision = null
    // headers
    if (entry.headers.trim()) {
      payload.headers = JSON.parse(entry.headers.trim())
    } else {
      payload.headers = null
    }
    // requestBody
    if (entry.requestBody.trim()) {
      payload.requestBody = JSON.parse(entry.requestBody.trim())
    } else {
      payload.requestBody = null
    }
    return payload
  }

  function validateModelEntries(): string | null {
    if (modelEntries.length === 0) return '至少需要保留一个模型'

    const names = new Set<string>()
    for (const entry of modelEntries) {
      const modelName = entry.modelName.trim()
      if (!modelName) return '模型名称不能为空'
      if (names.has(modelName)) return `模型名称重复：${modelName}`
      if (!entry.modelId.trim()) return `模型「${modelName}」缺少模型 ID`
      if (entry.headers.trim()) {
        try { JSON.parse(entry.headers.trim()) } catch { return `模型「${modelName}」的自定义请求头不是合法 JSON` }
      }
      if (entry.requestBody.trim()) {
        try { JSON.parse(entry.requestBody.trim()) } catch { return `模型「${modelName}」的自定义请求体不是合法 JSON` }
      }
      names.add(modelName)
    }

    if (!defaultModelName.value.trim()) return '默认模型不能为空'
    if (!names.has(defaultModelName.value.trim())) return `默认模型不存在：${defaultModelName.value}`

    return null
  }

  function buildLLMPayload(): { payload: Record<string, unknown>; currentNames: string[] } {
    const models: Record<string, unknown> = {}

    for (const originalName of modelOriginalNames.value) {
      if (!modelEntries.some(entry => entry.modelName.trim() === originalName)) {
        models[originalName] = null
      }
    }

    const currentNames: string[] = []
    for (const entry of modelEntries) {
      const modelName = entry.modelName.trim()
      if (!modelName) continue
      currentNames.push(modelName)
      if (entry.originalModelName && entry.originalModelName !== modelName) {
        models[entry.originalModelName] = null
      }
      models[modelName] = buildModelEntryPayload(entry)
    }

    return {
      payload: { defaultModel: defaultModelName.value.trim(), models },
      currentNames,
    }
  }

  async function handleSave() {
    if (saving.value) return

    saving.value = true
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }

    statusText.value = ''
    statusError.value = false

    if (accessLocked.value) {
      statusText.value = formatAccessLockedMessage('保存失败')
      statusError.value = true
      saving.value = false
      return
    }

    const duplicateMcpNames = findDuplicateMcpNames()
    if (duplicateMcpNames.length > 0) {
      statusText.value = `保存失败: MCP 服务器名称重复（${duplicateMcpNames.join('、')}）`
      statusError.value = true
      saving.value = false
      return
    }

    const duplicateSubAgentNames = findDuplicateSubAgentNames()
    if (duplicateSubAgentNames.length > 0) {
      statusText.value = `保存失败: 子代理类型名称重复（${duplicateSubAgentNames.join('、')}）`
      statusError.value = true
      saving.value = false
      return
    }

    const duplicateModeNamesArr = findDuplicateModeNames()
    if (duplicateModeNamesArr.length > 0) {
      statusText.value = `保存失败: 模式名称重复（${duplicateModeNamesArr.join('、')}）`
      statusError.value = true
      saving.value = false
      return
    }

    const modelValidationError = validateModelEntries()
    if (modelValidationError) {
      statusText.value = '保存失败: ' + modelValidationError
      statusError.value = true
      saving.value = false
      return
    }

    const subAgentValidationError = validateSubAgentEntries()
    if (subAgentValidationError) {
      statusText.value = '保存失败: ' + subAgentValidationError
      statusError.value = true
      saving.value = false
      return
    }

    const modeValidationError = validateModeEntries()
    if (modeValidationError) {
      statusText.value = '保存失败: ' + modeValidationError
      statusError.value = true
      saving.value = false
      return
    }

    const pluginValidationError = validatePluginEntries()
    if (pluginValidationError) {
      statusText.value = '保存失败: ' + pluginValidationError
      statusError.value = true
      saving.value = false
      return
    }

    const duplicatePluginNamesArr = findDuplicatePluginNames()
    if (duplicatePluginNamesArr.length > 0) {
      statusText.value = `保存失败: 插件名称重复（${duplicatePluginNamesArr.join('、')}）`
      statusError.value = true
      saving.value = false
      return
    }

    try {
      const { payload: llmPayload, currentNames: currentModelNames } = buildLLMPayload()

      const { payload: mcpPayload, currentNames } = buildMCPPayload()
      const subAgentPayload = buildSubAgentPayload()
      const modesPayload = buildModesPayload()
      const payload: Record<string, any> = {
        llm: llmPayload,
        system: {
          systemPrompt: config.systemPrompt,
          maxToolRounds: config.maxToolRounds,
          stream: config.stream,
        },
      }
      if (mcpPayload !== null) {
        payload.mcp = mcpPayload
      }
      if (subAgentPayload !== null) {
        payload.sub_agents = subAgentPayload
      }
      if (modesPayload !== null) {
        payload.modes = modesPayload
      }
      const pluginsPayload = buildPluginsPayload()
      if (pluginsPayload !== null) {
        payload.plugins = pluginsPayload
      }
      payload.platform = buildPlatformPayload()
      const disabledArr = [...disabledTools.value]
      payload.tools = { disabledTools: disabledArr.length > 0 ? disabledArr : null }
      const result = await updateConfig(payload)

      if (result.ok) {
        statusText.value = result.restartRequired ? '已保存，需要重启生效' : '已保存并生效'
        statusError.value = false
        modelOriginalNames.value = currentModelNames
        mcpOriginalNames.value = currentNames
        subAgentOriginalNames.value = subAgentEntries.map(e => e.name.trim()).filter(Boolean)
        modeOriginalNames.value = modeEntries.map(e => e.name.trim()).filter(Boolean)
        dirty.value = false
        for (const entry of modelEntries) {
          entry.originalModelName = entry.modelName.trim()
        }

        // 热重载后刷新工具列表与 MCP 状态
        try {
          const st = await getStatus()
          tools.value = st.tools || []
          disabledTools.value = new Set(st.disabledTools || [])
          mcpStatus.value = st.mcpStatus ?? []
        } catch {
          // 静默
        }
      } else {
        statusText.value = '保存失败: ' + (result.error || '未知错误')
        statusError.value = true
        dirty.value = true
      }
    } catch (err: any) {
      const detail = rememberAccessRequirementsFromError(err)
      statusText.value = accessLocked.value ? formatAccessLockedMessage('保存失败') : ('保存失败: ' + detail)
      statusError.value = true
      dirty.value = true
    } finally {
      saving.value = false
    }
  }

  // ============ Cloudflare 辅助 ============

  const sslHints: Record<string, string> = {
    off: '所有连接均不加密，不推荐使用。',
    flexible: '浏览器到 Cloudflare 加密，Cloudflare 到源站不加密。适合源站无证书时临时使用。',
    full: '全程 HTTPS，但不验证源站证书。适合自签名证书场景。',
    strict: '全程 HTTPS 且验证源站证书合法性。推荐生产环境使用。',
  }

  const dnsNamePlaceholder = computed(() => {
    const m: Record<string, string> = {
      A: '例如：www 或 @ (根域名)',
      AAAA: '例如：www 或 @ (根域名)',
      CNAME: '例如：blog',
      MX: '例如：@ (根域名)',
      TXT: '例如：@ (根域名)',
    }
    return m[cf.newDns.type] || '子域名或 @'
  })

  const dnsContentPlaceholder = computed(() => {
    const m: Record<string, string> = {
      A: '例如：1.2.3.4 (IPv4 地址)',
      AAAA: '例如：2001:db8::1 (IPv6 地址)',
      CNAME: '例如：example.com',
      MX: '例如：mail.example.com',
      TXT: '例如：v=spf1 include:...',
    }
    return m[cf.newDns.type] || '记录值'
  })

  const dnsProxySupported = computed(() => ['A', 'AAAA', 'CNAME'].includes(cf.newDns.type))

  watch(() => cf.newDns.type, (type) => {
    if (!['A', 'AAAA', 'CNAME'].includes(type)) cf.newDns.proxied = false
  })

  // ============ Cloudflare 方法 ============

  async function loadCfStatus() {
    try {
      const status = await cfGetStatus()
      cf.configured = status.configured
      cf.error = status.error || ''
      cf.connected = status.connected
      cf.zones = status.zones || []
      cf.activeZoneId = status.activeZoneId
      cf.tokenSource = status.tokenSource || null

      // 多 zone 且未指定时，自动选第一个
      if (!cf.activeZoneId && cf.zones.length > 0) {
        cf.activeZoneId = cf.zones[0].id
      }

      if (status.connected) {
        await Promise.all([loadCfDns(), loadCfSsl()])
      } else {
        cfDnsRequestVersion += 1
        cfSslRequestVersion += 1
        cfSslMutationVersion += 1
        cf.dnsRecords = []
        cf.dnsSaving = false
        cf.dnsDeletingId = null
        cf.dnsMsg = ''
        cf.dnsError = false
        cf.sslMode = 'unknown'
        cf.sslSaving = false
        committedSslMode = 'unknown'
        cf.sslLoading = false
        cf.sslMsg = ''
        cf.sslError = false
      }
    } catch (err: any) {
      rememberAccessRequirementsFromError(err)
      cfDnsRequestVersion += 1
      cfSslRequestVersion += 1
      cfSslMutationVersion += 1
      cf.connected = false
      cf.error = accessLocked.value ? formatAccessLockedMessage('加载 Cloudflare 状态失败') : (err?.message || '加载 Cloudflare 状态失败')
      cf.dnsRecords = []
      cf.dnsSaving = false
      cf.dnsDeletingId = null
      cf.sslMode = 'unknown'
      cf.sslSaving = false
      committedSslMode = 'unknown'
      cf.sslLoading = false
    }
  }

  async function loadCfDns() {
    const requestVersion = ++cfDnsRequestVersion
    const zoneId = cf.activeZoneId
    cf.dnsMsg = ''
    cf.dnsError = false
    cf.dnsLoading = true
    try {
      const result = await cfListDns(zoneId)
      if (requestVersion !== cfDnsRequestVersion) return
      cf.dnsRecords = result.records || []
    } catch (err: any) {
      rememberAccessRequirementsFromError(err)
      if (requestVersion !== cfDnsRequestVersion) return
      cf.dnsRecords = []
      cf.dnsMsg = accessLocked.value ? formatAccessLockedMessage('加载 DNS 记录失败') : ('加载 DNS 记录失败: ' + err.message)
      cf.dnsError = true
    } finally {
      if (requestVersion === cfDnsRequestVersion) {
        cf.dnsLoading = false
      }
    }
  }

  let committedSslMode: CloudflareSslMode = 'full'

  async function loadCfSsl() {
    const requestVersion = ++cfSslRequestVersion
    const zoneId = cf.activeZoneId
    cf.sslLoading = true
    cf.sslMsg = ''
    cf.sslError = false
    try {
      const result = await cfGetSsl(zoneId)
      if (requestVersion !== cfSslRequestVersion) return

      const nextMode = ['off', 'flexible', 'full', 'strict', 'unknown'].includes(result.mode)
        ? (result.mode as CloudflareSslMode)
        : 'full'

      cf.sslMode = nextMode
      committedSslMode = nextMode
    } catch (err: any) {
      rememberAccessRequirementsFromError(err)
      if (requestVersion !== cfSslRequestVersion) return
      cf.sslMode = 'unknown'
      committedSslMode = 'unknown'
      cf.sslMsg = accessLocked.value ? formatAccessLockedMessage('读取当前 SSL 模式失败') : ('读取当前 SSL 模式失败：' + (err?.message || '未知错误'))
      cf.sslError = true
    } finally {
      if (requestVersion === cfSslRequestVersion) {
        cf.sslLoading = false
      }
    }
  }

  async function handleCfSetup() {
    if (accessLocked.value) {
      cf.error = formatAccessLockedMessage('连接 Cloudflare 失败')
      return
    }

    if (!cf.tokenInput.trim()) {
      cf.error = '请输入 Token'
      return
    }
    cf.loading = true
    cf.error = ''
    try {
      const result = await cfSetup(cf.tokenInput.trim())
      if (result.ok) {
        cf.tokenInput = ''
        await loadCfStatus()
      } else {
        cf.error = result.error || '连接失败'
      }
    } catch (err: any) {
      rememberAccessRequirementsFromError(err)
      cf.error = err.message
    } finally {
      cf.loading = false
    }
  }

  async function handleSslChange() {
    if (accessLocked.value || cf.sslMode === 'unknown' || cf.sslLoading || cf.sslSaving) return
    const requestVersion = ++cfSslMutationVersion
    const zoneId = cf.activeZoneId
    const targetMode = cf.sslMode as CloudflareSslMode
    const previousMode = committedSslMode
    cf.sslMsg = ''
    cf.sslError = false
    cf.sslSaving = true
    try {
      await cfSetSsl(targetMode, zoneId)
      if (requestVersion !== cfSslMutationVersion || zoneId !== cf.activeZoneId) return
      committedSslMode = targetMode
      cf.sslMode = targetMode
      cf.sslMsg = 'SSL 模式已更新'
    } catch (err: any) {
      rememberAccessRequirementsFromError(err)
      if (requestVersion !== cfSslMutationVersion) return
      committedSslMode = previousMode
      if (zoneId === cf.activeZoneId) {
        cf.sslMode = previousMode
      }
      cf.sslMsg = accessLocked.value ? formatAccessLockedMessage('更新 SSL 模式失败') : ('更新失败: ' + err.message)
      cf.sslError = true
    } finally {
      if (requestVersion === cfSslMutationVersion) cf.sslSaving = false
    }
  }

  async function handleDnsAdd() {
    if (accessLocked.value) {
      cf.dnsMsg = formatAccessLockedMessage('添加 DNS 记录失败')
      cf.dnsError = true
      return
    }

    if (cf.dnsSaving || cf.dnsDeletingId) return
    if (!dnsProxySupported.value) cf.newDns.proxied = false
    if (!cf.newDns.name || !cf.newDns.content) {
      cf.dnsMsg = '名称和内容不能为空'
      cf.dnsError = true
      return
    }
    cf.dnsMsg = ''
    cf.dnsError = false
    cf.dnsSaving = true
    try {
      await cfAddDns({ ...cf.newDns }, cf.activeZoneId)
      cf.newDns.name = ''
      cf.newDns.content = ''
      await loadCfDns()
      if (!cf.dnsError) {
        cf.dnsMsg = '添加成功'
      }
    } catch (err: any) {
      rememberAccessRequirementsFromError(err)
      cf.dnsMsg = '添加失败: ' + err.message
      cf.dnsError = true
    } finally {
      cf.dnsSaving = false
    }
  }

  async function confirmDnsDelete(rec: CfDnsRecord) {
    const confirmed = await showConfirm({
      title: '删除 DNS 记录',
      description: `确认删除以下 DNS 记录？<br><br><strong>${rec.type}</strong>&nbsp;&nbsp;${rec.name}&nbsp;&nbsp;→&nbsp;&nbsp;${rec.content}`,
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    handleDnsDelete(rec.id)
  }

  async function handleDnsDelete(id: string) {
    if (accessLocked.value) {
      cf.dnsMsg = formatAccessLockedMessage('删除 DNS 记录失败')
      cf.dnsError = true
      return
    }

    if (cf.dnsSaving || cf.dnsDeletingId) return
    cf.dnsMsg = ''
    cf.dnsError = false
    cf.dnsDeletingId = id
    try {
      await cfRemoveDns(id, cf.activeZoneId)
      cf.dnsRecords = cf.dnsRecords.filter(r => r.id !== id)
      cf.dnsMsg = '已删除'
    } catch (err: any) {
      rememberAccessRequirementsFromError(err)
      cf.dnsMsg = '删除失败: ' + err.message
      cf.dnsError = true
    } finally {
      if (cf.dnsDeletingId === id) {
        cf.dnsDeletingId = null
      }
    }
  }

  async function handleZoneChange() {
    // 多 zone 场景下切换 zone 后重新加载 DNS 和 SSL
    cf.dnsMsg = ''
    cf.dnsError = false
    cfSslMutationVersion += 1
    cf.sslSaving = false
    cf.sslMsg = ''
    cf.sslError = false
    await Promise.all([loadCfDns(), loadCfSsl()])
  }

  // CF 状态由主 onMounted 在 loadConfigData 完成后加载

  // ---- 多 Agent 管理 ----

  const agentStatus = reactive({
    exists: false,
    enabled: false,
    agents: [] as Array<{ name: string; description?: string }>,
    manifestPath: '',
  })

  async function loadAgentStatus() {
    try {
      const { getAgentStatus } = await import('../../api/client')
      const status = await getAgentStatus()
      agentStatus.exists = status.exists
      agentStatus.enabled = status.enabled
      agentStatus.agents = status.agents
      agentStatus.manifestPath = status.manifestPath
    } catch {
      // 旧版后端不支持
    }
  }

  async function handleToggleAgent() {
    const newEnabled = !agentStatus.enabled
    try {
      const { toggleAgentEnabled } = await import('../../api/client')
      const result = await toggleAgentEnabled(newEnabled)
      if (result.success) {
        agentStatus.enabled = newEnabled
        statusText.value = result.message
        statusError.value = false
      } else {
        statusText.value = result.message
        statusError.value = true
      }
    } catch (err) {
      statusText.value = `操作失败: ${err instanceof Error ? err.message : String(err)}`
      statusError.value = true
    }
  }

  // Agent 状态由主 onMounted 在 loadConfigData 完成后加载

  async function handleInitAgentManifest() {
    try {
      const { initAgentManifest } = await import('../../api/client')
      const result = await initAgentManifest()
      if (result.success) {
        await loadAgentStatus()
        statusText.value = result.message
        statusError.value = false
      } else {
        statusText.value = result.message
        statusError.value = true
      }
    } catch (err) {
      statusText.value = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
      statusError.value = true
    }
  }

  const newAgentName = ref('')
  const newAgentDesc = ref('')

  async function handleCreateAgent() {
    const name = newAgentName.value.trim()
    if (!name) return
    try {
      const { createAgentDef } = await import('../../api/client')
      const result = await createAgentDef(name, newAgentDesc.value.trim() || undefined)
      if (result.success) {
        newAgentName.value = ''
        newAgentDesc.value = ''
        await loadAgentStatus()
        statusText.value = result.message
        statusError.value = false
      } else {
        statusText.value = result.message
        statusError.value = true
      }
    } catch (err) {
      statusText.value = `创建失败: ${err instanceof Error ? err.message : String(err)}`
      statusError.value = true
    }
  }

  async function handleDeleteAgent(name: string) {
    const confirmed = await showConfirm({
      title: '确认删除 Agent',
      description: `确定要删除 Agent「${name}」吗？<br>仅移除配置条目，数据目录将保留。`,
      confirmText: '确认删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      const { deleteAgentDef } = await import('../../api/client')
      const result = await deleteAgentDef(name)
      if (result.success) {
        if (editingAgent.value === name) {
          await switchEditingAgent(null)
        }
        await loadAgentStatus()
        statusText.value = result.message
        statusError.value = false
      } else {
        statusText.value = result.message
        statusError.value = true
      }
    } catch (err) {
      statusText.value = `删除失败: ${err instanceof Error ? err.message : String(err)}`
      statusError.value = true
    }
  }

  // ---- 重置配置 ----

  const resetPending = ref(false)

  async function handleResetConfig() {
    const confirmed = await showConfirm({
      title: '确认重置配置',
      description: '此操作将把所有配置文件恢复为默认模板。<br>当前的 API 密钥、模型、MCP 等设置将<strong>永久丢失</strong>，且无法撤销。',
      confirmText: '确认重置',
      danger: true,
    })
    if (!confirmed) return

    resetPending.value = true
    try {
      const { resetConfig } = await import('../../api/client')
      const result = await resetConfig()
      if (result.success) {
        statusText.value = '配置已重置为默认值，页面即将刷新...'
        statusError.value = false
        setTimeout(() => window.location.reload(), 1200)
      } else {
        statusText.value = `重置失败: ${result.message}`
        statusError.value = true
      }
    } catch (err) {
      statusText.value = `重置失败: ${err instanceof Error ? err.message : String(err)}`
      statusError.value = true
    } finally {
      resetPending.value = false
    }
  }

  return {
    managementEnabled,
    managementReady,
    authEnabled,
    authReady,
    currentTheme,
    setTheme,
    accessProtectionEnabled,
    accessLocked,
    accessStatusText,
    accessCredentialHint,
    themeOptions,
    themeHint,
    config,
    maxToolRoundsInput,
    handleMaxToolRoundsInput,
    syncMaxToolRoundsInput,
    defaultModelName,
    defaultModelOptions,
    modelEntries,
    providerLabel,
    addModelEntry,
    removeModelEntry,
    transportLabel,
    handleModelProviderChange,
    fetchModelOptions,
    modelCatalogHint,
    modelKeyHint,
    tools,
    disabledTools,
    toggleTool,
    statusText,
    statusError,
    saving,
    mcpServers,
    mcpStatusLabel,
    addMcpServer,
    removeMcpServer,
    syncMcpTimeoutInput,
    handleMcpTimeoutInput,
    sanitizeMcpName,
    runtimeInfo,
    subAgentEntries,
    subAgentModelOptions,
    addSubAgentEntry,
    removeSubAgentEntry,
    loadBuiltinSubAgentDefaults,
    handleSubAgentMaxToolRoundsInput,
    syncSubAgentMaxToolRoundsInput,
    modeEntries,
    addModeEntry,
    removeModeEntry,
    pluginEntries,
    addPluginEntry,
    removePluginEntry,
    platformConfig,
    contextWindowPlaceholder,
    handleStringNumberInput,
    cf,
    streamHint,
    resetOverlayCloseIntent,
    handleOverlayPointerDown,
    handleOverlayPointerUp,
    requestClose,
    sslHints,
    dnsNamePlaceholder,
    dnsContentPlaceholder,
    dnsProxySupported,
    handleCfSetup,
    handleSslChange,
    handleDnsAdd,
    confirmDnsDelete,
    handleZoneChange,
    handleResetConfig,
    resetPending,
    agentStatus,
    handleToggleAgent,
    editingAgent,
    switchEditingAgent,
    handleInitAgentManifest,
    newAgentName,
    newAgentDesc,
    handleCreateAgent,
    handleDeleteAgent,
  }
}
