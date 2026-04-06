<template>
  <div v-if="multiAgentEnabled" class="agent-selector">
    <!-- 当前 Agent 指示器 -->
    <button class="agent-current" type="button" @click="panelOpen = true">
      <span class="agent-current-icon">
        <AppIcon :name="ICONS.sidebar.chat" />
      </span>
      <span class="agent-current-copy">
        <span class="agent-current-label">Agent</span>
        <strong class="agent-current-name">{{ currentDisplayName }}</strong>
      </span>
      <span class="agent-current-switch">
        <AppIcon :name="ICONS.common.chevronRight" />
      </span>
    </button>

    <!-- 全屏选择面板 -->
    <Teleport to="body">
      <Transition name="agent-panel">
        <div v-if="panelOpen" class="agent-panel-overlay" @click.self="panelOpen = false">
          <div class="agent-panel">
            <div class="agent-panel-header">
              <span class="agent-panel-title">选择 Agent</span>
              <button class="agent-panel-close" type="button" @click="panelOpen = false">
                <AppIcon :name="ICONS.common.close" />
              </button>
            </div>

            <div class="agent-panel-list">
              <!-- 多 Agent 配置分层重构：移除 __global__ 特判，所有 agent 统一显示 -->
              <button
                v-for="agent in agents"
                :key="agent.name"
                class="agent-card"
                :class="{
                  active: agent.name === currentAgent,
                }"
                type="button"
                @click="selectAgent(agent.name)"
              >
                <span class="agent-card-icon">
                  <AppIcon :name="ICONS.sidebar.chat" />
                </span>
                <span class="agent-card-copy">
                  <strong class="agent-card-name">
                    {{ agent.name }}
                  </strong>
                  <span v-if="agent.description" class="agent-card-desc">{{ agent.description }}</span>
                </span>
                <span v-if="agent.name === currentAgent" class="agent-card-check">
                  <AppIcon :name="ICONS.status.ok" />
                </span>
              </button>
            </div>

            <div class="agent-panel-hint">点击选择 · Esc 关闭</div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useAgents } from '../composables/useAgents'

const emit = defineEmits<{
  (e: 'switch'): void
}>()

const { agents, currentAgent, multiAgentEnabled, switchAgent } = useAgents()

const panelOpen = ref(false)

// 多 Agent 配置分层重构：移除 isGlobalAgent / __global__ 特判
const currentDisplayName = computed(() => {
  if (!currentAgent.value) return '未选择'
  return currentAgent.value
})

function selectAgent(name: string) {
  if (name !== currentAgent.value) {
    switchAgent(name)
    emit('switch')
  }
  panelOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && panelOpen.value) {
    panelOpen.value = false
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* ── 当前 Agent 按钮 ── */
.agent-selector {
  padding: 0 12px 8px;
}

.agent-current {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: rgba(var(--tint-rgb), 0.04);
  border: 1px solid rgba(var(--tint-rgb), 0.08);
  border-radius: 10px;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
  text-align: left;
  color: inherit;
  font: inherit;
}

.agent-current:hover {
  background: rgba(var(--tint-rgb), 0.08);
  border-color: rgba(var(--tint-rgb), 0.14);
}

.agent-current-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 16px;
  flex-shrink: 0;
}

.agent-current-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.agent-current-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}

.agent-current-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-current-switch {
  color: var(--text-tertiary);
  font-size: 18px;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity var(--transition-fast);
}

.agent-current:hover .agent-current-switch {
  opacity: 1;
}

/* ── 选择面板 ── */
.agent-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(var(--backdrop-blur-overlay));
}

.agent-panel {
  width: min(420px, calc(100vw - 32px));
  max-height: min(520px, calc(100vh - 64px));
  background: var(--surface-shell-strong);
  border: 1px solid var(--shell-stroke);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.agent-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}

.agent-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.agent-panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 18px;
  transition: background var(--transition-fast);
}

.agent-panel-close:hover {
  background: rgba(var(--tint-rgb), 0.08);
  color: var(--text-primary);
}

/* ── Agent 卡片列表 ── */
.agent-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
  text-align: left;
  color: inherit;
  font: inherit;
}

.agent-card:hover {
  background: rgba(var(--tint-rgb), 0.06);
  border-color: rgba(var(--tint-rgb), 0.08);
}

.agent-card.active {
  background: var(--accent-soft);
  border-color: var(--accent-soft-strong);
}

/* ── Agent 卡片图标 ── */
.agent-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--tint-rgb), 0.06);
  color: var(--accent-cyan);
  font-size: 20px;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.agent-card.active .agent-card-icon {
  background: var(--accent-soft-strong);
  color: var(--accent);
}

/* ── Agent 卡片文字 ── */
.agent-card-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-card-name {
  font-size: 14px;
  color: var(--text-primary);
}

.agent-card-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card-check {
  color: var(--accent);
  font-size: 20px;
  flex-shrink: 0;
}

/* ── 底部提示 ── */
.agent-panel-hint {
  padding: 10px 20px;
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
  border-top: 1px solid var(--border);
}

/* ── 过渡动画（与 panel-modal 主题一致） ── */
.agent-panel-enter-active,
.agent-panel-leave-active {
  transition: opacity var(--transition-medium), transform var(--transition-medium);
}

.agent-panel-enter-from,
.agent-panel-leave-to {
  opacity: 0;
}

.agent-panel-enter-from .agent-panel,
.agent-panel-leave-to .agent-panel {
  transform: translateY(var(--motion-modal-y)) scale(0.985);
  opacity: 0;
  filter: blur(8px);
}
</style>
