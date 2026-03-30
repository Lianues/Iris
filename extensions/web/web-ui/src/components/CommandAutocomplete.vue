<template>
  <Transition name="autocomplete">
    <div v-if="visible && filtered.length > 0" class="command-autocomplete">
      <div
        v-for="(cmd, idx) in filtered"
        :key="cmd.name"
        class="command-autocomplete-item"
        :class="{ active: idx === selectedIndex }"
        @mousedown.prevent="select(cmd)"
        @mouseenter="selectedIndex = idx"
      >
        <span class="command-autocomplete-name">{{ cmd.name }}</span>
        <span class="command-autocomplete-desc">{{ cmd.description }}</span>
        <span class="command-autocomplete-usage">{{ cmd.usage }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSlashCommands } from '../composables/useSlashCommands'
import type { SlashCommand } from '../composables/useSlashCommands'

const props = defineProps<{
  input: string
  visible: boolean
}>()

const emit = defineEmits<{
  select: [command: SlashCommand]
}>()

const { matchingCommands } = useSlashCommands()
const selectedIndex = ref(0)

const filtered = computed(() => matchingCommands(props.input))

watch(() => props.input, () => {
  selectedIndex.value = 0
})

function select(cmd: SlashCommand) {
  emit('select', cmd)
}

function moveSelection(delta: number) {
  if (filtered.value.length === 0) return
  selectedIndex.value = (selectedIndex.value + delta + filtered.value.length) % filtered.value.length
}

function confirmSelection(): boolean {
  if (filtered.value.length > 0) {
    select(filtered.value[selectedIndex.value])
    return true
  }
  return false
}

function hasItems(): boolean {
  return filtered.value.length > 0
}

defineExpose({ moveSelection, confirmSelection, hasItems })
</script>
