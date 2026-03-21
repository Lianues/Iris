<template>
  <div class="app-root">
    <div class="app-background" aria-hidden="true">
      <div class="app-glow glow-primary"></div>
      <div class="app-glow glow-secondary"></div>
      <div class="app-grid"></div>
    </div>

    <AppSidebar
      :mobile-open="sidebarOpen"
      @toggle="sidebarOpen = false"
      @open-settings="handleOpenSettings"
      @open-management-token="handleOpenManagementToken"
    />

    <div class="app-main">
      <button
        class="toggle-sidebar"
        type="button"
        :aria-expanded="sidebarOpen"
        aria-label="切换会话侧边栏"
        @click="sidebarOpen = !sidebarOpen"
      >
        <AppIcon :name="ICONS.common.menu" class="toggle-sidebar-icon" />
        <span class="toggle-sidebar-text">会话</span>
      </button>

      <Transition name="fade-veil">
        <button
          v-if="sidebarOpen"
          class="sidebar-backdrop"
          type="button"
          aria-label="关闭侧边栏"
          @click="sidebarOpen = false"
        ></button>
      </Transition>

      <router-view v-slot="{ Component, route }">
        <Transition name="view-fade" mode="out-in">
          <div class="app-view-host" :key="route.fullPath">
            <component :is="Component" />
          </div>
        </Transition>
      </router-view>
    </div>

    <Transition name="panel-modal">
      <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
    </Transition>

    <ManagementTokenDialog
      v-if="managementTokenOpen"
      @close="managementTokenOpen = false"
      @updated="handleManagementTokenUpdated"
    />

    <ConfirmDialog />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import AppIcon from './components/AppIcon.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { ICONS } from './constants/icons'

const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'))
const ManagementTokenDialog = defineAsyncComponent(() => import('./components/ManagementTokenDialog.vue'))

const sidebarOpen = ref(false)
const settingsOpen = ref(false)
const managementTokenOpen = ref(false)

function handleOpenSettings() {
  settingsOpen.value = true
  sidebarOpen.value = false
}

function handleOpenManagementToken() {
  managementTokenOpen.value = true
  sidebarOpen.value = false
}

function handleManagementTokenUpdated() {
  // 当前无需额外处理，保留钩子便于后续统一刷新管理态
}
</script>
