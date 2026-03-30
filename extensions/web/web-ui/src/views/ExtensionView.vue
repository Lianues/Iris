<template>
  <main class="ext-area">
    <section class="ext-frame">
      <header class="ext-topbar">
        <div class="ext-topbar-main">
          <span class="ext-kicker">Extensions</span>
          <h2>扩展管理</h2>
          <p>从远程仓库下载扩展，或管理已安装的扩展插件。</p>
        </div>
      </header>

      <div class="ext-tabs">
        <button
          class="ext-tab" :class="{ active: tab === 'remote' }"
          @click="tab = 'remote'"
        >远程仓库</button>
        <button
          class="ext-tab" :class="{ active: tab === 'installed' }"
          @click="tab = 'installed'"
        >已安装</button>
      </div>

      <div class="ext-body">
        <!-- 远程仓库 -->
        <template v-if="tab === 'remote'">
          <div v-if="remoteLoading" class="ext-status-msg">正在加载远程扩展列表…</div>
          <div v-else-if="remoteError" class="ext-status-msg error">
            <span>{{ remoteError }}</span>
            <button class="ext-retry-btn" @click="loadRemote">重试</button>
          </div>
          <div v-else-if="remoteExtensions.length === 0" class="ext-status-msg">远程仓库暂无可用扩展。</div>
          <div v-else class="ext-list">
            <div v-for="ext in remoteExtensions" :key="ext.name" class="ext-card">
              <div class="ext-card-header">
                <span class="ext-card-name">{{ ext.name }}</span>
                <span class="ext-card-version">v{{ ext.version }}</span>
                <span class="ext-badge" :class="ext.distributionMode">{{ ext.distributionLabel }}</span>
                <span class="ext-badge type">{{ ext.typeLabel }}</span>
              </div>
              <p class="ext-card-desc">{{ ext.description }}</p>
              <div class="ext-card-footer">
                <span v-if="ext.localVersionHint" class="ext-card-hint">{{ ext.localVersionHint }}</span>
                <button
                  v-if="!ext.installed"
                  class="ext-action-btn install"
                  :disabled="installingSet.has(ext.requestedPath || ext.name) || ext.distributionMode !== 'bundled'"
                  @click="handleInstall(ext)"
                >
                  {{ installingSet.has(ext.requestedPath || ext.name) ? '安装中…' : '安装' }}
                </button>
                <span v-else class="ext-badge installed">已安装</span>
              </div>
            </div>
          </div>
        </template>

        <!-- 已安装 -->
        <template v-else>
          <div v-if="localLoading" class="ext-status-msg">正在加载已安装扩展…</div>
          <div v-else-if="localError" class="ext-status-msg error">
            <span>{{ localError }}</span>
            <button class="ext-retry-btn" @click="loadLocal">重试</button>
          </div>
          <div v-else-if="localExtensions.length === 0" class="ext-status-msg">暂无已安装扩展。前往「远程仓库」下载。</div>
          <div v-else class="ext-list">
            <div v-for="ext in localExtensions" :key="ext.name" class="ext-card">
              <div class="ext-card-header">
                <span class="ext-card-name">{{ ext.name }}</span>
                <span class="ext-card-version">v{{ ext.version }}</span>
                <span class="ext-badge type">{{ ext.typeLabel }}</span>
                <span class="ext-badge" :class="ext.enabled ? 'enabled' : 'disabled'">{{ ext.stateLabel }}</span>
              </div>
              <p class="ext-card-desc">{{ ext.description }}</p>
              <div v-if="ext.localSource === 'embedded'" class="ext-card-footer">
                <span class="ext-card-hint">源码内嵌，无法删除。</span>
              </div>
              <div v-else class="ext-card-footer">
                <label class="toggle-switch">
                  <input type="checkbox" :checked="ext.enabled" @change="handleToggle(ext)" />
                  <span class="toggle-switch-ui"></span>
                </label>
                <button
                  class="ext-action-btn delete"
                  :class="{ armed: armedDelete === ext.name }"
                  @click="handleDelete(ext)"
                >
                  {{ armedDelete === ext.name ? '确认删除' : '删除' }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <footer class="ext-footer">
        <span v-if="actionError" class="settings-status error">{{ actionError }}</span>
      </footer>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import type { ExtensionSummary } from '../api/types'
import {
  getInstalledExtensions,
  getRemoteExtensions,
  installExtension,
  enableExtension,
  disableExtension,
  deleteExtension,
} from '../api/client'

const tab = ref<'remote' | 'installed'>('remote')

// 远程列表
const remoteExtensions = ref<ExtensionSummary[]>([])
const remoteLoading = ref(false)
const remoteError = ref('')

// 已安装列表
const localExtensions = ref<ExtensionSummary[]>([])
const localLoading = ref(false)
const localError = ref('')

const installingSet = reactive(new Set<string>())
const armedDelete = ref<string | null>(null)
const actionError = ref('')

async function loadRemote() {
  remoteLoading.value = true
  remoteError.value = ''
  try {
    const res = await getRemoteExtensions()
    remoteExtensions.value = res.extensions
  } catch (err) {
    remoteError.value = err instanceof Error ? err.message : '未知错误'
  } finally {
    remoteLoading.value = false
  }
}

async function loadLocal() {
  localLoading.value = true
  localError.value = ''
  try {
    const res = await getInstalledExtensions()
    localExtensions.value = res.extensions
  } catch (err) {
    localError.value = err instanceof Error ? err.message : '未知错误'
  } finally {
    localLoading.value = false
  }
}

async function handleInstall(ext: ExtensionSummary) {
  const key = ext.requestedPath || ext.name
  if (installingSet.has(key)) return
  installingSet.add(key)
  actionError.value = ''
  try {
    await installExtension(key)
    // 刷新两个列表
    await Promise.all([loadRemote(), loadLocal()])
  } catch (err) {
    actionError.value = `安装失败: ${err instanceof Error ? err.message : '未知错误'}`
  } finally {
    installingSet.delete(key)
  }
}

async function handleToggle(ext: ExtensionSummary) {
  actionError.value = ''
  try {
    if (ext.enabled) {
      await disableExtension(ext.name)
    } else {
      await enableExtension(ext.name)
    }
    await loadLocal()
  } catch (err) {
    actionError.value = `操作失败: ${err instanceof Error ? err.message : '未知错误'}`
  }
}

async function handleDelete(ext: ExtensionSummary) {
  if (armedDelete.value !== ext.name) {
    armedDelete.value = ext.name
    return
  }
  armedDelete.value = null
  actionError.value = ''
  try {
    await deleteExtension(ext.name)
    await Promise.all([loadRemote(), loadLocal()])
  } catch (err) {
    actionError.value = `删除失败: ${err instanceof Error ? err.message : '未知错误'}`
  }
}

onMounted(() => {
  loadRemote()
  loadLocal()
})
</script>

<style scoped>
.ext-area {
  display: flex;
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-width: var(--chat-surface-max-width);
  margin: 0 auto;
}

.ext-frame {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  background: var(--surface-shell);
  border: 1px solid var(--shell-stroke);
  border-radius: var(--radius-xl);
  box-shadow: 0 30px 74px rgba(4, 8, 20, 0.34);
  backdrop-filter: blur(var(--backdrop-blur-shell));
  overflow: hidden;
}

.ext-topbar {
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--shell-stroke);
}

.ext-topbar-main { flex: 1; min-width: 0; }

.ext-kicker {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.ext-topbar h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.ext-topbar p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}

/* Tabs */
.ext-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--shell-stroke);
  padding: 0 24px;
}

.ext-tab {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.ext-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.ext-tab:hover:not(.active) {
  color: var(--text-primary);
}

/* Body */
.ext-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.ext-status-msg {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-secondary);
  font-size: 14px;
}

.ext-status-msg.error {
  color: var(--error);
}

.ext-retry-btn {
  margin-left: 8px;
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--shell-stroke);
  border-radius: var(--radius-sm);
  background: var(--surface-elevated);
  color: var(--text-primary);
  cursor: pointer;
}

/* Card list */
.ext-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ext-card {
  padding: 14px 16px;
  background: var(--surface-elevated);
  border: 1px solid var(--shell-stroke);
  border-radius: var(--radius-lg);
  transition: border-color 0.15s;
}

.ext-card:hover {
  border-color: var(--accent);
}

.ext-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ext-card-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary);
}

.ext-card-version {
  font-size: 12px;
  color: var(--text-tertiary);
}

.ext-card-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.ext-card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.ext-card-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  flex: 1;
}

/* Badges */
.ext-badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  line-height: 1.4;
}

.ext-badge.bundled {
  background: rgba(var(--accent-rgb, 100, 180, 255), 0.15);
  color: var(--accent);
}

.ext-badge.source {
  background: rgba(255, 180, 50, 0.15);
  color: #d4a017;
}

.ext-badge.type {
  background: rgba(var(--accent-rgb, 100, 180, 255), 0.08);
  color: var(--text-secondary);
}

.ext-badge.installed {
  background: rgba(80, 200, 120, 0.15);
  color: #2d9e5a;
}

.ext-badge.enabled {
  background: rgba(80, 200, 120, 0.15);
  color: #2d9e5a;
}

.ext-badge.disabled {
  background: rgba(255, 100, 100, 0.12);
  color: var(--error);
}

/* Action buttons */
.ext-action-btn {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--radius-sm);
  border: 1px solid var(--shell-stroke);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.ext-action-btn.install {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.ext-action-btn.install:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ext-action-btn.delete {
  background: transparent;
  color: var(--text-secondary);
}

.ext-action-btn.delete:hover,
.ext-action-btn.delete.armed {
  background: rgba(255, 80, 80, 0.12);
  color: var(--error);
  border-color: var(--error);
}

/* Footer */
.ext-footer {
  padding: 10px 24px;
  border-top: 1px solid var(--shell-stroke);
  min-height: 20px;
}
</style>
