<template>
  <main class="terminal-area">
    <section class="terminal-frame">
      <header class="terminal-topbar">
        <div class="terminal-topbar-main">
          <span class="terminal-kicker">Terminal Session</span>
          <h2>TUI 终端</h2>
        </div>
        <div class="terminal-topbar-aside">
          <span
            class="terminal-status"
            :class="{
              connected,
              connecting: connecting,
              disconnected: !connected && !connecting,
            }"
          >
            {{ connecting ? '正在连接...' : connected ? '已连接' : '未连接' }}
          </span>
          <button
            class="topbar-icon-btn"
            type="button"
            title="重新连接"
            @click="reconnect"
          >
            <AppIcon :name="ICONS.common.retry" />
          </button>
        </div>
      </header>

      <div class="terminal-body">
        <div ref="terminalContainer" class="terminal-container"></div>

        <!-- 连接中遮罩 -->
        <Transition name="fade-veil">
          <div v-if="connecting && !connected" class="terminal-overlay">
            <div class="terminal-overlay-content">
              <span class="terminal-spinner"></span>
              <span>正在连接终端...</span>
            </div>
          </div>
        </Transition>
      </div>

      <Transition name="fade-veil">
        <div v-if="error" class="terminal-error">
          <span>{{ error }}</span>
          <button type="button" class="terminal-error-action" @click="reconnect">
            重新连接
          </button>
        </div>
      </Transition>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useTerminal } from '../composables/useTerminal'

defineOptions({ name: 'TerminalView' })

const terminalContainer = ref<HTMLElement | null>(null)
const { connected, connecting, error, attach, reconnect } = useTerminal()

onMounted(() => {
  if (terminalContainer.value) {
    attach(terminalContainer.value)
  }
})
// detach 由 useTerminal 内部 onUnmounted 自动处理
// KeepAlive 激活/去激活由 useTerminal 内部 onActivated/onDeactivated 处理
</script>
