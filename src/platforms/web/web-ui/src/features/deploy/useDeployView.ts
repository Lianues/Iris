import { reactive, computed, ref, onMounted, onUnmounted, watch } from 'vue'
import {
  getDeployState,
  detectDeploy,
  previewDeploy,
  deployNginx,
  deployService,
  syncDeployCloudflare,
  getStatus,
} from '../../api/client'
import type {
  DetectResponse,
  DeployResponse,
  DeployFormOptions,
  DeployPreviewResponse,
  CloudflareSslMode,
  StatusInfo,
} from '../../api/types'
import { loadManagementToken, subscribeManagementTokenChange } from '../../utils/managementToken'
import { loadAuthToken, subscribeAuthTokenChange } from '../../utils/authToken'
import { useCopyFeedback } from '../../composables/useCopyFeedback'

function createDefaultDetectState(): DetectResponse {
  return {
    isLinux: false,
    isLocal: false,
    nginx: { installed: false, version: '', configDir: '', existingConfig: false },
    systemd: { available: false, existingService: false, serviceStatus: '' },
    sudo: { available: false, noPassword: false },
  }
}

export function useDeployView() {
  const form = reactive<DeployFormOptions>({
    domain: '',
    port: 8192,
    deployPath: '/opt/iris',
    user: 'iris',
    enableHttps: true,
    enableAuth: false,
  })

  const runtimeWeb = reactive({
    host: '127.0.0.1',
    port: 8192,
  })

  const activeTab = ref<'nginx' | 'service'>('nginx')
  const portInput = ref(String(form.port))
  const deployCopy = useCopyFeedback('复制', 2000)

  // 环境检测
  const detectLoaded = ref(false)
  const detectError = ref('')
  const detect = reactive<DetectResponse>(createDefaultDetectState())

  // 部署默认值加载
  const formReady = ref(false)
  const formDirty = ref(false)
  const stateError = ref('')

  // 统一预览
  const previewLoaded = ref(false)
  const previewLoading = ref(false)
  const lastLoadedDeployStateFingerprint = ref('')
  const preview = reactive<DeployPreviewResponse>({
    options: {
      domain: 'chat.example.com',
      port: 8192,
      deployPath: '/opt/iris',
      user: 'iris',
      enableHttps: true,
      enableAuth: false,
    },
    nginxConfig: '',
    serviceConfig: '',
    warnings: [],
    errors: [],
    recommendations: [],
    cloudflare: null,
  })

  // 部署令牌
  const deployToken = ref('')

  // 部署状态
  const showConfirm = ref(false)
  const deploying = ref(false)
  const deployResult = ref<DeployResponse | null>(null)
  const lastDeployTarget = ref<'nginx' | 'service' | null>(null)

  // Cloudflare 一键同步
  const cfSyncing = ref(false)
  const cfSyncMsg = ref('')
  const cfSyncError = ref(false)

  const runtimeHint = computed(() => {
    const base = `当前运行配置：${runtimeWeb.host}:${runtimeWeb.port}`
    return stateError.value ? `${base}（读取部署默认值失败，已回退到本地默认值）` : base
  })

  const previewDomain = computed(() => form.domain.trim() || preview.options.domain || 'chat.example.com')

  const managementTokenReady = ref(false)
  const authTokenReady = ref(false)
  const authProtected = ref(false)
  const managementProtected = ref(false)
  const accessRequirementLoaded = ref(false)
  let unsubscribeManagementToken: (() => void) | null = null
  let unsubscribeAuthToken: (() => void) | null = null

  function refreshCredentialState() {
    managementTokenReady.value = !!loadManagementToken().trim()
    authTokenReady.value = !!loadAuthToken().trim()
  }

  function applyAccessRequirements(status: StatusInfo) {
    authProtected.value = !!status.authProtected
    managementProtected.value = !!status.managementProtected
    accessRequirementLoaded.value = true
  }

  async function reloadProtectedStateAfterCredentialChange() {
    await Promise.all([
      loadDetect(),
      loadDeployState({ overwriteForm: !formDirty.value }),
      loadAccessRequirements(),
    ])
    await refreshPreview()
  }

  function handleCredentialStorageChange() {
    refreshCredentialState()
    void reloadProtectedStateAfterCredentialChange()
  }

  const managementNotice = computed(() => {
    if (!accessRequirementLoaded.value) {
      if (managementTokenReady.value && authTokenReady.value) return ''
      return '如果后端配置了 platform.web.authToken 或 platform.web.managementToken，请先在侧边栏“访问凭证”中保存对应令牌，否则部署预览与执行会返回 401。'
    }

    const missingTokens: string[] = []
    if (authProtected.value && !authTokenReady.value) missingTokens.push('API 访问令牌')
    if (managementProtected.value && !managementTokenReady.value) missingTokens.push('管理令牌')
    if (missingTokens.length === 0) return ''

    return `当前后端要求先录入${missingTokens.join('、')}，否则部署预览与执行会返回 401。`
  })

  const showCloudflareSync = computed(() => {
    return activeTab.value === 'nginx'
      && lastDeployTarget.value === 'nginx'
      && !!deployResult.value?.ok
      && !!preview.cloudflare?.connected
  })

  function getRecommendedAutoSyncMode(): 'flexible' | 'strict' | null {
    if (!preview.cloudflare?.connected) return null
    const expected = form.enableHttps ? 'strict' : 'flexible'
    return preview.cloudflare.sslMode === expected ? null : expected
  }

  async function promptAndSyncCloudflare(mode: 'flexible' | 'strict') {
    const current = cloudflareModeLabel(preview.cloudflare?.sslMode || null)
    const target = cloudflareModeLabel(mode)
    const hint = mode === 'strict'
      ? '源站已启用 HTTPS，建议 Cloudflare 使用 Full (Strict)。'
      : '源站为 HTTP-only，建议 Cloudflare 使用 Flexible。'

    const confirmed = window.confirm(
      `Nginx 部署成功。\n\n当前 Cloudflare SSL：${current}\n建议同步为：${target}\n\n${hint}\n\n是否立即同步？`,
    )

    if (!confirmed) return
    await handleSyncCloudflare(mode)
  }

  function cloudflareModeLabel(mode: CloudflareSslMode | null): string {
    if (!mode) return '未知'
    const map: Record<CloudflareSslMode, string> = {
      off: 'Off',
      flexible: 'Flexible',
      full: 'Full',
      strict: 'Full (Strict)',
      unknown: 'Unknown',
    }
    return map[mode] || mode
  }

  function clampPort(value: number): number {
    return Math.min(65535, Math.max(1, Math.trunc(value)))
  }

  function syncPortInput() {
    portInput.value = String(form.port)
  }

  function handlePortInput(event: Event) {
    const value = (event.target as HTMLInputElement).value
    portInput.value = value
    if (!value.trim()) return

    const parsed = Number(value)
    if (Number.isFinite(parsed)) form.port = clampPort(parsed)
  }

  function buildDeployOptions(): DeployFormOptions {
    return {
      domain: form.domain,
      port: clampPort(form.port),
      deployPath: form.deployPath,
      user: form.user,
      enableHttps: form.enableHttps,
      enableAuth: form.enableAuth,
    }
  }

  function serializeDeployOptions(options: DeployFormOptions): string {
    return JSON.stringify({
      domain: options.domain,
      port: clampPort(options.port),
      deployPath: options.deployPath,
      user: options.user,
      enableHttps: options.enableHttps,
      enableAuth: options.enableAuth,
    })
  }

  function syncFormDirtyState() {
    formDirty.value = serializeDeployOptions(buildDeployOptions()) !== lastLoadedDeployStateFingerprint.value
  }

  function applyLoadedDeployState(defaults: DeployFormOptions, overwriteForm: boolean) {
    const normalizedDefaults: DeployFormOptions = {
      domain: defaults.domain,
      port: clampPort(defaults.port),
      deployPath: defaults.deployPath,
      user: defaults.user,
      enableHttps: defaults.enableHttps,
      enableAuth: defaults.enableAuth,
    }

    lastLoadedDeployStateFingerprint.value = serializeDeployOptions(normalizedDefaults)
    if (!overwriteForm) return

    Object.assign(form, normalizedDefaults)
    syncPortInput()
    formDirty.value = false
  }

  lastLoadedDeployStateFingerprint.value = serializeDeployOptions(buildDeployOptions())

  let previewRequestId = 0
  let detectRequestId = 0
  let deployStateRequestId = 0
  let accessRequirementsRequestId = 0
  let previewTimer: ReturnType<typeof setTimeout> | null = null

  async function refreshPreview() {
    const requestId = ++previewRequestId
    previewLoading.value = true

    try {
      const result = await previewDeploy(buildDeployOptions())
      if (requestId !== previewRequestId) return
      Object.assign(preview, result)
    } catch (e: any) {
      if (requestId !== previewRequestId) return
      Object.assign(preview, {
        options: {
          domain: form.domain.trim() || 'chat.example.com',
          port: Number.isFinite(form.port) ? form.port : runtimeWeb.port,
          deployPath: form.deployPath.trim() || '/opt/iris',
          user: form.user.trim() || 'iris',
          enableHttps: form.enableHttps,
          enableAuth: form.enableAuth,
        },
        nginxConfig: '',
        serviceConfig: '',
        warnings: [],
        errors: [`生成预览失败: ${e.message || '未知错误'}`],
        recommendations: [],
        cloudflare: null,
      })
    } finally {
      if (requestId === previewRequestId) {
        previewLoaded.value = true
        previewLoading.value = false
      }
    }
  }

  function schedulePreview() {
    if (!formReady.value) return
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      void refreshPreview()
    }, 150)
  }

  watch(form, () => {
    if (formReady.value) {
      syncFormDirtyState()
    }
    schedulePreview()
  }, { deep: true })

  onUnmounted(() => {
    if (previewTimer) clearTimeout(previewTimer)
    unsubscribeManagementToken?.()
    unsubscribeAuthToken?.()
  })

  onMounted(async () => {
    refreshCredentialState()
    unsubscribeManagementToken = subscribeManagementTokenChange(handleCredentialStorageChange)
    unsubscribeAuthToken = subscribeAuthTokenChange(handleCredentialStorageChange)

    await Promise.all([loadDetect(), loadDeployState({ overwriteForm: true }), loadAccessRequirements()])
    formReady.value = true
    await refreshPreview()
  })

  async function loadDetect() {
    const requestId = ++detectRequestId
    detectLoaded.value = false
    detectError.value = ''

    try {
      const result = await detectDeploy()
      if (requestId !== detectRequestId) return
      Object.assign(detect, createDefaultDetectState(), result)
      detectError.value = ''
      detectLoaded.value = true
    } catch (e: any) {
      if (requestId !== detectRequestId) return
      Object.assign(detect, createDefaultDetectState())
      detectError.value = e.message || '未知错误'
      detectLoaded.value = false
    }
  }

  async function loadDeployState(options: { overwriteForm?: boolean } = {}) {
    const requestId = ++deployStateRequestId
    const overwriteForm = options.overwriteForm ?? true

    try {
      const result = await getDeployState()
      if (requestId !== deployStateRequestId) return
      runtimeWeb.host = result.web.host
      runtimeWeb.port = result.web.port
      stateError.value = ''
      applyLoadedDeployState(result.defaults, overwriteForm)
    } catch (e: any) {
      if (requestId !== deployStateRequestId) return
      stateError.value = e.message || '未知错误'
    }
  }

  async function loadAccessRequirements() {
    const requestId = ++accessRequirementsRequestId

    try {
      const status = await getStatus()
      if (requestId !== accessRequirementsRequestId) return
      applyAccessRequirements(status)
    } catch {
      if (requestId !== accessRequirementsRequestId) return
      accessRequirementLoaded.value = false
      authProtected.value = false
      managementProtected.value = false
    }
  }

  const sudoClass = computed(() => {
    if (!detect.sudo.available) return 'detect-fail'
    return detect.sudo.noPassword ? 'detect-ok' : 'detect-warn'
  })

  const environmentReady = computed(() => {
    if (!detectLoaded.value) return false
    if (!detect.isLinux || !detect.isLocal) return false
    if (!detect.sudo.available || !detect.sudo.noPassword) return false
    if (activeTab.value === 'nginx' && !detect.nginx.installed) return false
    if (activeTab.value === 'service' && !detect.systemd.available) return false
    return true
  })

  const environmentDisabledReason = computed(() => {
    if (detectError.value) return `环境检测失败: ${detectError.value}`
    if (!detectLoaded.value) return '环境检测中...'
    if (!detect.isLinux) return '仅支持 Linux 系统'
    if (!detect.isLocal) return '仅允许本地访问'
    if (!detect.sudo.available) return 'sudo 未安装'
    if (!detect.sudo.noPassword) return 'sudo 需要密码，请配置 NOPASSWD'
    if (activeTab.value === 'nginx' && !detect.nginx.installed) return 'Nginx 未安装'
    if (activeTab.value === 'service' && !detect.systemd.available) return 'Systemd 不可用'
    return ''
  })

  const previewDisabledReason = computed(() => {
    if (!previewLoaded.value || previewLoading.value) return '预览生成中...'
    if (preview.errors.length > 0) return preview.errors[0]
    return ''
  })

  const canDeploy = computed(() => {
    return environmentReady.value && !previewLoading.value && preview.errors.length === 0
  })

  const deployDisabledReason = computed(() => {
    return environmentDisabledReason.value || previewDisabledReason.value
  })

  const currentPreviewContent = computed(() => {
    if (previewLoading.value && !previewLoaded.value) return '正在生成预览...'
    return activeTab.value === 'nginx'
      ? (preview.nginxConfig || '暂无预览')
      : (preview.serviceConfig || '暂无预览')
  })

  function currentFilename() {
    return activeTab.value === 'nginx' ? 'nginx.conf' : 'iris.service'
  }

  async function executeDeploy() {
    if (!deployToken.value.trim()) {
      deployResult.value = { ok: false, steps: [], error: '请输入部署令牌' }
      showConfirm.value = false
      return
    }

    if (!canDeploy.value) {
      deployResult.value = { ok: false, steps: [], error: deployDisabledReason.value || '当前配置不可部署' }
      showConfirm.value = false
      return
    }

    deploying.value = true
    deployResult.value = null
    lastDeployTarget.value = activeTab.value
    cfSyncMsg.value = ''
    cfSyncError.value = false

    let autoSyncMode: 'flexible' | 'strict' | null = null

    try {
      const token = deployToken.value.trim()
      const options = buildDeployOptions()
      if (activeTab.value === 'nginx') {
        deployResult.value = await deployNginx(options, token)
        if (deployResult.value?.ok) {
          autoSyncMode = getRecommendedAutoSyncMode()
        }
      } else {
        deployResult.value = await deployService(options, token)
      }
    } catch (e: any) {
      deployResult.value = {
        ok: false,
        steps: [],
        error: e.message || '请求失败',
      }
    } finally {
      deploying.value = false
      showConfirm.value = false
    }

    if (autoSyncMode) {
      await promptAndSyncCloudflare(autoSyncMode)
    }
  }

  async function handleSyncCloudflare(mode: 'flexible' | 'full' | 'strict') {
    if (!preview.cloudflare?.connected) {
      cfSyncMsg.value = 'Cloudflare 未连接，无法同步'
      cfSyncError.value = true
      return
    }

    cfSyncing.value = true
    cfSyncMsg.value = ''
    cfSyncError.value = false

    try {
      const result = await syncDeployCloudflare(mode, preview.cloudflare.zoneId)
      if (!result.ok) {
        cfSyncMsg.value = result.error || '同步失败'
        cfSyncError.value = true
        return
      }

      const syncedMode = result.mode || mode
      if (preview.cloudflare) {
        preview.cloudflare.sslMode = syncedMode
      }
      cfSyncMsg.value = `已同步 Cloudflare SSL 模式为 ${cloudflareModeLabel(syncedMode)}`
      cfSyncError.value = false

      // 同步后刷新预览，让联动建议和校验结果即时更新
      await refreshPreview()
    } catch (e: any) {
      cfSyncMsg.value = e.message || '同步失败'
      cfSyncError.value = true
    } finally {
      cfSyncing.value = false
    }
  }

  async function handleCopy() {
    await deployCopy.copy(currentPreviewContent.value)
  }

  function handleDownload() {
    const blob = new Blob([currentPreviewContent.value], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = currentFilename()
    a.click()
    URL.revokeObjectURL(url)
  }

  return {
    form,
    activeTab,
    detectLoaded,
    canDeploy,
    managementNotice,
    detectError,
    detect,
    sudoClass,
    portInput,
    handlePortInput,
    syncPortInput,
    runtimeHint,
    previewDomain,
    preview,
    copyText: deployCopy.copyText,
    currentPreviewContent,
    handleCopy,
    handleDownload,
    deployDisabledReason,
    showConfirm,
    deployResult,
    showCloudflareSync,
    cloudflareModeLabel,
    cfSyncing,
    handleSyncCloudflare,
    cfSyncMsg,
    cfSyncError,
    deployToken,
    deploying,
    executeDeploy,
  }
}
