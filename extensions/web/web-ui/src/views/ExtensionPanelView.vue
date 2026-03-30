<template>
  <div class="extension-panel">
    <div v-if="loading" class="extension-panel-loading">加载中…</div>
    <div v-else-if="!panel" class="extension-panel-empty">
      <p>未找到面板「{{ panelId }}」</p>
      <RouterLink to="/extensions">返回扩展管理</RouterLink>
    </div>
    <iframe
      v-else
      :src="panel.contentPath"
      class="extension-panel-frame"
      :title="panel.title"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getWebPanels, type WebPanelInfo } from '../api/client'

const route = useRoute()
const panels = ref<WebPanelInfo[]>([])
const loading = ref(true)

const panelId = computed(() => route.params.id as string)
const panel = computed(() => panels.value.find(p => p.id === panelId.value))

onMounted(async () => {
  try {
    panels.value = await getWebPanels()
  } catch { /* ignore */ }
  loading.value = false
})
</script>

<style scoped>
.extension-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.extension-panel-frame {
  flex: 1;
  width: 100%;
  border: none;
}
.extension-panel-loading,
.extension-panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  gap: 12px;
}
.extension-panel-empty a {
  color: var(--accent);
}
</style>
