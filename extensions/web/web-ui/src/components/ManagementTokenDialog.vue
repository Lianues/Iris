<template>
  <Transition name="panel-modal">
    <div class="overlay" @click.self="emit('close')">
      <div class="settings-panel" style="max-width:680px;width:min(92vw,680px)">
        <div class="settings-header">
          <div class="settings-title-group">
            <span class="settings-kicker">Access Credentials</span>
            <h2>访问凭证</h2>
            <p>统一管理 Web GUI 所需的访问令牌。它们不同于设置中心里的模型 API Key，仅用于当前浏览器访问 Iris Web 接口。所有令牌仅保存在当前浏览器本地，不会自动同步到服务端。</p>
          </div>
          <button class="btn-close" type="button" aria-label="关闭" @click="emit('close')">
            <AppIcon :name="ICONS.common.close" />
          </button>
        </div>

        <div class="settings-body">
          <section class="settings-section">
            <div class="settings-section-head">
              <div>
                <h3>全局 API 访问令牌</h3>
                <p>对应后端 `platform.web.authToken`。保存后会自动作为 <code>Authorization: Bearer ...</code> 附加到所有 API 请求；这不是模型供应商的 API Key。</p>
              </div>
              <span class="settings-pill">{{ hasAuthToken ? '已保存' : '未保存' }}</span>
            </div>

            <div class="form-group">
              <label>API 访问令牌</label>
              <input
                type="password"
                v-model="authTokenInput"
                placeholder="请输入 platform.web.authToken"
                @keydown.enter="saveAuthTokenValue"
              />
              <p class="field-hint">如未启用全局 Bearer 鉴权，此项可留空。</p>
            </div>

            <div class="form-actions" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button class="btn-save" type="button" @click="saveAuthTokenValue">保存访问令牌</button>
              <button class="btn-cancel" type="button" @click="clearAuthTokenValue" style="padding:8px 14px">清除访问令牌</button>
              <span v-if="authStatusText" class="settings-status" :class="{ error: authStatusError }">{{ authStatusText }}</span>
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-head">
              <div>
                <h3>管理令牌</h3>
                <p>用于访问配置、部署、Cloudflare 等管理接口，请填写服务端 `platform.web.managementToken`；这同样不是模型供应商的 API Key。</p>
              </div>
              <span class="settings-pill">{{ hasManagementToken ? '已保存' : '未保存' }}</span>
            </div>

            <div class="form-group">
              <label>管理令牌（X-Management-Token）</label>
              <input
                type="password"
                v-model="managementTokenInput"
                placeholder="请输入 platform.web.managementToken"
                @keydown.enter="saveManagementTokenValue"
              />
              <p class="field-hint">保存后会自动附加到管理接口请求头。</p>
            </div>

            <div class="form-actions" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <button class="btn-save" type="button" @click="saveManagementTokenValue">保存管理令牌</button>
              <button class="btn-cancel" type="button" @click="clearManagementTokenValue" style="padding:8px 14px">清除管理令牌</button>
              <span v-if="managementStatusText" class="settings-status" :class="{ error: managementStatusError }">{{ managementStatusText }}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import {
  clearManagementToken,
  loadManagementToken,
  saveManagementToken,
  subscribeManagementTokenChange,
} from '../utils/managementToken'
import {
  clearAuthToken,
  loadAuthToken,
  saveAuthToken,
  subscribeAuthTokenChange,
} from '../utils/authToken'

const emit = defineEmits<{
  close: []
  updated: []
}>()

const authTokenInput = ref('')
const authStatusText = ref('')
const authStatusError = ref(false)
const hasAuthToken = ref(false)

const managementTokenInput = ref('')
const managementStatusText = ref('')
const managementStatusError = ref(false)
const hasManagementToken = ref(false)

let unsubscribeAuth: (() => void) | null = null
let unsubscribeManagement: (() => void) | null = null

function refreshTokenState() {
  hasAuthToken.value = !!loadAuthToken().trim()
  hasManagementToken.value = !!loadManagementToken().trim()
}

function saveAuthTokenValue() {
  const token = authTokenInput.value.trim()
  if (!token) {
    authStatusText.value = '请输入访问令牌'
    authStatusError.value = true
    return
  }

  saveAuthToken(token)
  authTokenInput.value = ''
  refreshTokenState()
  authStatusText.value = '访问令牌已保存'
  authStatusError.value = false
  emit('updated')
}

function clearAuthTokenValue() {
  clearAuthToken()
  authTokenInput.value = ''
  refreshTokenState()
  authStatusText.value = '访问令牌已清除'
  authStatusError.value = false
  emit('updated')
}

function saveManagementTokenValue() {
  const token = managementTokenInput.value.trim()
  if (!token) {
    managementStatusText.value = '请输入管理令牌'
    managementStatusError.value = true
    return
  }

  saveManagementToken(token)
  managementTokenInput.value = ''
  refreshTokenState()
  managementStatusText.value = '管理令牌已保存'
  managementStatusError.value = false
  emit('updated')
}

function clearManagementTokenValue() {
  clearManagementToken()
  managementTokenInput.value = ''
  refreshTokenState()
  managementStatusText.value = '管理令牌已清除'
  managementStatusError.value = false
  emit('updated')
}

onMounted(() => {
  refreshTokenState()
  unsubscribeAuth = subscribeAuthTokenChange(refreshTokenState)
  unsubscribeManagement = subscribeManagementTokenChange(refreshTokenState)
})

onUnmounted(() => {
  unsubscribeAuth?.()
  unsubscribeManagement?.()
})
</script>
