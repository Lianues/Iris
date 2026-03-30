<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div v-if="visible" class="confirm-overlay" @click.self="cancel">
        <div class="confirm-dialog">
          <div class="confirm-icon" :class="{ danger: options.danger }">
            <AppIcon :name="options.danger ? ICONS.status.warn : ICONS.status.ok" />
          </div>
          <h3 class="confirm-title">{{ options.title }}</h3>
          <p class="confirm-desc" v-html="options.description"></p>
          <div class="confirm-actions">
            <button class="confirm-btn cancel" type="button" @click="cancel">
              {{ options.cancelText || '取消' }}
            </button>
            <button
              class="confirm-btn"
              :class="options.danger ? 'danger' : 'primary'"
              type="button"
              @click="confirm"
            >
              {{ options.confirmText || '确认' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useConfirmDialog } from '../composables/useConfirmDialog'

const { visible, options, confirm, cancel } = useConfirmDialog()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) {
    cancel()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>
