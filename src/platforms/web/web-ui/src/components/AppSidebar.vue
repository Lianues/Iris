<template>
  <aside class="sidebar" :class="{ open: mobileOpen }">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span class="sidebar-badge">Control Hub</span>
        <div class="logo">Iris</div>
        <p class="sidebar-subtitle">集中管理会话、部署与系统配置。</p>
      </div>

      <button class="btn-new-chat" type="button" @click="handleNewChat">
        <span class="btn-new-icon"><AppIcon :name="ICONS.common.add" /></span>
        <span>新建会话</span>
      </button>
    </div>

    <nav class="sidebar-nav">
      <RouterLink class="sidebar-nav-link" to="/" @click="emit('toggle')">
        <span class="sidebar-nav-icon"><AppIcon :name="ICONS.sidebar.chat" /></span>
        <span class="sidebar-nav-copy">
          <span class="sidebar-nav-label">Workspace</span>
          <strong>聊天控制台</strong>
        </span>
      </RouterLink>

      <RouterLink class="sidebar-nav-link" to="/deploy" @click="emit('toggle')">
        <span class="sidebar-nav-icon"><AppIcon :name="ICONS.sidebar.deploy" /></span>
        <span class="sidebar-nav-copy">
          <span class="sidebar-nav-label">Delivery</span>
          <strong>部署生成器</strong>
        </span>
      </RouterLink>
    </nav>

    <div class="sidebar-route-context">
      <div class="session-list" v-if="route.path === '/'">
        <div class="sidebar-section-label">会话列表</div>

        <div v-if="sessionActionError" class="sidebar-inline-status error">
          <span>{{ sessionActionError }}</span>
          <button class="sidebar-inline-action" type="button" @click="clearSessionActionError">
            知道了
          </button>
        </div>

        <div v-if="sessionsError && sessions.length > 0" class="sidebar-inline-status error">
          <span>会话刷新失败：{{ sessionsError }}</span>
          <button class="sidebar-inline-action" type="button" :disabled="sessionsLoading" @click="handleReloadSessions">
            重试
          </button>
        </div>

        <div class="sidebar-empty sidebar-empty-error" v-if="sessionsError && sessions.length === 0 && !sessionsLoading">
          <span class="sidebar-empty-icon"><AppIcon :name="ICONS.status.warn" /></span>
          <p>会话加载失败</p>
          <span>{{ sessionsError }}</span>
          <button class="sidebar-inline-action" type="button" @click="handleReloadSessions">
            重新加载
          </button>
        </div>

        <div class="sidebar-empty" v-else-if="sessionsLoading && sessions.length === 0">
          <span class="sidebar-empty-icon"><AppIcon :name="ICONS.status.loading" /></span>
          <p>正在加载会话</p>
          <span>稍候片刻，Iris 正在同步你的工作记录。</span>
        </div>

        <div class="sidebar-empty" v-else-if="sessions.length === 0">
          <span class="sidebar-empty-icon"><AppIcon :name="ICONS.sidebar.empty" /></span>
          <p>暂无会话</p>
          <span>点击“新建会话”开始第一次对话。</span>
        </div>

        <div class="session-items" v-else>
          <div
            v-for="session in sessions"
            :key="session.id"
            class="session-item"
            :class="{ active: session.id === currentSessionId }"
          >
            <button class="session-button" type="button" @click="handleSwitchSession(session.id)">
              <span class="session-caption">{{ formatSessionTime(session.updatedAt) }}</span>
              <span class="session-name">{{ displaySessionTitle(session) }}</span>
            </button>
            <button
              class="btn-delete-session"
              type="button"
              title="删除会话"
              :disabled="deletingSessionId === session.id"
              @click.stop="handleDeleteSession(session.id, displaySessionTitle(session))"
            >
              <AppIcon :name="ICONS.common.close" />
            </button>
          </div>
        </div>
      </div>

      <div class="sidebar-context-card" v-else>
        <span class="sidebar-context-kicker">Deploy Focus</span>
        <h3>发布前检查</h3>
        <ul class="sidebar-context-list">
          <li>确认域名解析到当前服务器</li>
          <li>检查 Nginx 与 systemd 环境检测状态</li>
          <li>按需配置 Cloudflare DNS 与 SSL 模式</li>
        </ul>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="status-card">
        <span class="status-dot" :style="{ background: accessStateColor }"></span>
        <div class="status-copy">
          <span class="status-label">访问凭证</span>
          <span class="status-value">API 访问令牌：{{ authCredentialStatus }}</span>
          <span class="status-value">管理令牌：{{ managementCredentialStatus }}</span>
          <span class="status-value">提示：{{ accessCredentialHint }}</span>
        </div>
      </div>

      <button class="btn-settings" type="button" @click="handleOpenManagementToken">
        <AppIcon :name="ICONS.sidebar.key" />
        <span>访问凭证</span>
      </button>

      <button class="btn-settings" type="button" @click="handleOpenSettings">
        <AppIcon :name="ICONS.common.settings" />
        <span>设置中心</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useSessions } from '../composables/useSessions'
import { getStatus } from '../api/client'
import type { SessionSummary, StatusInfo } from '../api/types'
import { loadManagementToken, subscribeManagementTokenChange } from '../utils/managementToken'
import { loadAuthToken, subscribeAuthTokenChange } from '../utils/authToken'

const props = defineProps<{
  mobileOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'open-settings'): void
  (e: 'open-management-token'): void
}>()

const route = useRoute()
const router = useRouter()
const {
  sessions,
  currentSessionId,
  sessionsLoading,
  sessionsError,
  loadSessions,
  newChat,
  switchSession,
  removeSession,
} = useSessions()

const deletingSessionId = ref<string | null>(null)
const sessionActionError = ref('')
const managementReady = ref(false)
const authReady = ref(false)
const authProtected = ref<boolean | null>(null)
const managementProtected = ref<boolean | null>(null)
const accessRequirementLoaded = ref(false)
const accessRequirementError = ref('')

function hasMissingRequiredCredential(): boolean {
  return (authProtected.value === true && !authReady.value)
    || (managementProtected.value === true && !managementReady.value)
}

const accessStateColor = computed(() => {
  if (accessRequirementLoaded.value) {
    return hasMissingRequiredCredential() ? 'var(--error)' : 'var(--success)'
  }
  if (authReady.value || managementReady.value) {
    return 'var(--success)'
  }
  return 'var(--accent-cyan, var(--accent))'
})

const authCredentialStatus = computed(() => describeCredentialStatus(
  authProtected.value,
  authReady.value,
  'platform.web.authToken',
))

const managementCredentialStatus = computed(() => describeCredentialStatus(
  managementProtected.value,
  managementReady.value,
  'platform.web.managementToken',
))

const accessCredentialHint = computed(() => {
  if (accessRequirementLoaded.value) {
    if (!authProtected.value && !managementProtected.value) {
      return '这是 Web GUI 访问凭证，不是模型 API Key。当前后端未启用这两项。'
    }

    const missing: string[] = []
    if (authProtected.value && !authReady.value) missing.push('API 访问令牌')
    if (managementProtected.value && !managementReady.value) missing.push('管理令牌')

    if (missing.length > 0) {
      return `这是 Web GUI 访问凭证，不是模型 API Key。当前后端要求先录入${missing.join('、')}。`
    }

    return '这是 Web GUI 访问凭证，不是模型 API Key。当前所需凭证已就绪。'
  }

  if (accessRequirementError.value) {
    return '这是 Web GUI 访问凭证，不是模型 API Key。暂未检测到后端是否启用，如接口返回 401 再录入。'
  }

  return '这是 Web GUI 访问凭证，不是模型 API Key。正在检测后端是否启用。'
})

let unsubscribeManagementToken: (() => void) | null = null
let unsubscribeAuthToken: (() => void) | null = null

function refreshAccessState() {
  managementReady.value = !!loadManagementToken().trim()
  authReady.value = !!loadAuthToken().trim()
}

function applyAccessRequirements(status: StatusInfo) {
  authProtected.value = !!status.authProtected
  managementProtected.value = !!status.managementProtected
  accessRequirementLoaded.value = true
  accessRequirementError.value = ''
}

async function loadAccessRequirements() {
  try {
    const status = await getStatus()
    applyAccessRequirements(status)
  } catch (err) {
    authProtected.value = null
    managementProtected.value = null
    accessRequirementLoaded.value = false
    accessRequirementError.value = err instanceof Error ? err.message : '未知错误'
  }
}

function handleCredentialStorageChange() {
  refreshAccessState()
  void loadAccessRequirements()
}

function describeCredentialStatus(protectedFlag: boolean | null, ready: boolean, configKey: string): string {
  if (protectedFlag === true) {
    return ready ? '已保存（后端要求）' : `需要录入（后端已启用 ${configKey}）`
  }

  if (protectedFlag === false) {
    return ready ? '已保存（当前后端未要求，可保留）' : '未启用（当前后端未要求）'
  }

  return ready ? '已保存（后端要求状态未检测）' : '状态未知（尚未检测后端是否启用）'
}

function formatSessionTime(updatedAt?: string): string {
  if (!updatedAt) return '会话'
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return '会话'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function displaySessionTitle(session: SessionSummary): string {
  const title = session.title?.trim() || ''
  const looksLikeRawSessionId = /^web-[0-9a-f-]+$/i.test(title)

  if (title && title !== session.id && !looksLikeRawSessionId) {
    return title
  }

  return '未命名会话'
}

async function handleReloadSessions() {
  sessionActionError.value = ''
  await loadSessions()
}

function clearSessionActionError() {
  sessionActionError.value = ''
}

async function handleNewChat() {
  sessionActionError.value = ''
  if (route.path !== '/') await router.push('/')
  newChat()
  emit('toggle')
}

async function handleSwitchSession(id: string) {
  sessionActionError.value = ''
  if (route.path !== '/') await router.push('/')
  switchSession(id)
  emit('toggle')
}

async function handleDeleteSession(id: string, title: string) {
  if (deletingSessionId.value) return
  const confirmed = window.confirm(`确认删除会话？\n\n${title}`)
  if (!confirmed) return

  deletingSessionId.value = id
  try {
    sessionActionError.value = ''
    await removeSession(id)
  } catch (err) {
    sessionActionError.value = `删除会话失败：${err instanceof Error ? err.message : '未知错误'}`
  } finally {
    deletingSessionId.value = null
  }
}

function handleOpenSettings() {
  emit('open-settings')
  emit('toggle')
}

function handleOpenManagementToken() {
  emit('open-management-token')
  emit('toggle')
}

onMounted(async () => {
  await Promise.all([loadSessions(), loadAccessRequirements()])
  refreshAccessState()
  unsubscribeManagementToken = subscribeManagementTokenChange(handleCredentialStorageChange)
  unsubscribeAuthToken = subscribeAuthTokenChange(handleCredentialStorageChange)
})

onUnmounted(() => {
  unsubscribeManagementToken?.()
  unsubscribeAuthToken?.()
})

watch(() => route.fullPath, async () => {
  await loadSessions()
  refreshAccessState()
})

watch(() => props.mobileOpen, () => {
  refreshAccessState()
})
</script>
