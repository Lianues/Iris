<template>
  <span
    class="material-symbols-outlined app-icon"
    :aria-hidden="ariaLabel ? 'false' : 'true'"
    :aria-label="ariaLabel || undefined"
    :role="ariaLabel ? 'img' : undefined"
  >
    {{ name }}
  </span>
</template>

<script setup lang="ts">
import type { IconName } from '../constants/icons'

defineProps<{
  name: IconName
  ariaLabel?: string
}>()
</script>
