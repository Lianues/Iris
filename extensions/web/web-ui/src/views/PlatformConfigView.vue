<template>
  <main class="plat-area">
    <section class="plat-frame">
      <header class="plat-topbar">
        <div class="plat-topbar-main">
          <span class="plat-kicker">Platform</span>
          <h2>平台配置</h2>
          <p>配置 Iris 运行在哪些平台上。除 console 与 web 外，其他平台均来自已安装的扩展。</p>
        </div>
      </header>

      <div class="plat-body">
        <div v-if="loading" class="settings-section" style="text-align:center;padding:32px">加载中...</div>
        <template v-else>
          <section class="settings-section">
            <div
              v-for="platform in platforms"
              :key="platform.value"
              class="tier-block"
            >
              <div class="tier-header" @click="toggleOpen(platform.value)">
                <span class="tier-arrow" :class="{ open: openMap[platform.value] }"></span>
                <span class="tier-label">{{ platform.label }}</span>
                <span class="tier-desc">{{ platform.desc }}</span>
                <label class="toggle-switch tier-toggle" @click.stop>
                  <input type="checkbox" :checked="enabledTypes.includes(platform.value)" @change="togglePlatformType(platform.value)" />
                  <span class="toggle-switch-ui"></span>
                </label>
              </div>
              <div v-show="openMap[platform.value] && platform.panelFields.length > 0" class="tier-body">
                <p v-if="platform.panelDescription" class="tier-panel-desc">{{ platform.panelDescription }}</p>
                <div class="settings-grid two-columns">
                  <div
                    v-for="field in platform.panelFields"
                    :key="field.key"
                    class="form-group"
                    :class="{ 'full-width': platform.panelFields.length <= 2 }"
                  >
                    <label>{{ field.label }}</label>
                    <input
                      :type="field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'"
                      :value="getFieldValue(platform.value, field.configKey)"
                      :placeholder="field.placeholder || field.example || (field.defaultValue != null ? String(field.defaultValue) : '')"
                      @input="setFieldValue(platform.value, field.configKey, ($event.target as HTMLInputElement).value)"
                    />
                    <p v-if="field.description" class="field-hint">{{ field.description }}</p>
                    <p v-if="field.type === 'password' && String(getFieldValue(platform.value, field.configKey)).startsWith('****')" class="field-hint">已读取已保存值，保持不变则不会覆盖。</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
      </div>

      <footer class="plat-footer">
        <span v-if="saving" class="settings-status">自动保存中...</span>
        <span v-else-if="statusError" class="settings-status error">{{ statusText }}</span>
        <span v-else class="settings-status">已自动保存</span>
      </footer>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { getConfig, updateConfig, getAvailablePlatforms } from '../api/client'
import type { PlatformOption } from '../api/types'

const loading = ref(true)
const saving = ref(false)
const statusText = ref('')
const statusError = ref(false)

const platforms = ref<PlatformOption[]>([])
const enabledTypes = ref<string[]>([])
const openMap = reactive<Record<string, boolean>>({})

// 动态配置存储：platformName -> { configKey: value }
const platformValues = reactive<Record<string, Record<string, string | number>>>({})

function toggleOpen(name: string) {
  openMap[name] = !openMap[name]
}

function togglePlatformType(value: string) {
  const idx = enabledTypes.value.indexOf(value)
  if (idx === -1) enabledTypes.value.push(value)
  else enabledTypes.value.splice(idx, 1)
}

function getFieldValue(platformName: string, configKey: string): string | number {
  return platformValues[platformName]?.[configKey] ?? ''
}

function setFieldValue(platformName: string, configKey: string, value: string) {
  if (!platformValues[platformName]) platformValues[platformName] = {}
  platformValues[platformName][configKey] = value
}

// 从后端配置加载平台值
function loadPlatformFromData(data: any) {
  if (!data.platform || typeof data.platform !== 'object') return
  const pl = data.platform
  if (Array.isArray(pl.types)) enabledTypes.value = [...pl.types]

  // 为每个平台提取已保存的配置值
  for (const platform of platforms.value) {
    const section = pl[platform.value]
    if (!section || typeof section !== 'object') continue
    if (!platformValues[platform.value]) platformValues[platform.value] = {}
    for (const field of platform.panelFields) {
      const val = section[field.configKey]
      if (val != null) {
        platformValues[platform.value][field.configKey] = val
      }
    }
  }
}

// 构建保存 payload
function buildPayload(): Record<string, any> {
  const p: Record<string, any> = {}
  p.types = enabledTypes.value.length > 0 ? [...enabledTypes.value] : null

  for (const platform of platforms.value) {
    // 无配置字段的平台（如 console）跳过，不写入空节点
    if (platform.panelFields.length === 0) continue
    const section: Record<string, any> = {}
    const values = platformValues[platform.value] ?? {}

    for (const field of platform.panelFields) {
      const raw = values[field.configKey]
      if (raw == null || raw === '') {
        section[field.configKey] = null
        continue
      }
      // password 字段如果不变，不发送
      if (field.type === 'password' && String(raw).startsWith('****')) continue
      // number 字段转型
      if (field.type === 'number') {
        const num = Number(raw)
        section[field.configKey] = Number.isFinite(num) ? num : null
      } else {
        section[field.configKey] = String(raw).trim() || null
      }
    }

    p[platform.value] = section
  }

  return p
}

async function handleSave() {
  if (saving.value) return
  saving.value = true
  statusText.value = ''
  statusError.value = false
  try {
    const result = await updateConfig({ platform: buildPayload() })
    if (result.ok) {
      statusText.value = result.restartRequired ? '已保存，需要重启生效' : '已保存并生效'
      statusError.value = false
    } else {
      statusText.value = '保存失败: ' + (result.error || '未知错误')
      statusError.value = true
    }
  } catch (err: any) {
    statusText.value = '保存失败: ' + (err instanceof Error ? err.message : '未知错误')
    statusError.value = true
  } finally {
    saving.value = false
  }
}

let configLoaded = false
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutoSave() {
  if (!configLoaded) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    if (saving.value) { scheduleAutoSave(); return }
    handleSave()
  }, 1000)
}

watch([enabledTypes, platformValues], scheduleAutoSave, { deep: true })

async function loadData() {
  configLoaded = false
  loading.value = true
  statusText.value = ''
  statusError.value = false
  try {
    // 并行加载平台目录和当前配置
    const [platformsRes, configData] = await Promise.all([
      getAvailablePlatforms(),
      getConfig(),
    ])
    platforms.value = platformsRes.platforms
    // 初始化 openMap
    for (const p of platforms.value) {
      if (!(p.value in openMap)) openMap[p.value] = false
    }
    loadPlatformFromData(configData)
  } catch (err: any) {
    statusText.value = '加载失败: ' + (err instanceof Error ? err.message : '未知错误')
    statusError.value = true
  } finally {
    loading.value = false
    configLoaded = true
  }
}

onMounted(() => { loadData() })

onBeforeUnmount(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
})
</script>

<style scoped>
.plat-area {
  display: flex;
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-width: var(--chat-surface-max-width);
  margin: 0 auto;
}

.plat-frame {
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
  transition:
    transform var(--transition-medium),
    box-shadow var(--transition-medium),
    border-color var(--transition-medium),
    background var(--transition-slow);
}

.plat-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--shell-stroke);
}

.plat-topbar-main { flex: 1; min-width: 0; }

.plat-kicker {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.plat-topbar h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-primary);
}

.plat-topbar p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.plat-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.plat-footer {
  padding: 10px 24px;
  border-top: 1px solid var(--shell-stroke);
  text-align: right;
}

.tier-panel-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
