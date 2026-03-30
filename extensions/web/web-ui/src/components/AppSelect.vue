<template>
  <div ref="rootEl" class="app-select" :class="[size, { open, disabled }]">
    <button
      ref="triggerEl"
      class="app-select-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="listbox"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span class="app-select-trigger-copy">
        <span class="app-select-trigger-value" :class="{ placeholder: !selectedOption }">
          {{ selectedOption?.label || placeholder }}
        </span>
        <span v-if="selectedOption?.description" class="app-select-trigger-description">
          {{ selectedOption.description }}
        </span>
      </span>

      <span class="app-select-trigger-indicator" :class="{ open }" aria-hidden="true">
        <AppIcon :name="ICONS.common.arrowDown" />
      </span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="menuEl"
        class="app-select-menu"
        :class="size"
        :style="menuStyle"
        role="listbox"
      >
        <button
          v-for="(option, index) in options"
          :key="`${index}-${String(option.value)}`"
          class="app-select-option"
          :class="{
            active: activeIndex === index,
            selected: isSelected(option),
            disabled: !!option.disabled,
          }"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="isSelected(option) ? 'true' : 'false'"
          :disabled="!!option.disabled"
          :data-option-index="index"
          @click="handleOptionClick(option)"
          @mouseenter="setActiveIndex(index)"
        >
          <span class="app-select-option-copy">
            <span class="app-select-option-label">{{ option.label }}</span>
            <span v-if="option.description" class="app-select-option-description">{{ option.description }}</span>
          </span>
          <AppIcon v-if="isSelected(option)" :name="ICONS.status.ok" class="app-select-option-check" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

type AppSelectValue = string | number | null

interface AppSelectOption {
  value: AppSelectValue
  label: string
  description?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue?: AppSelectValue
  options: AppSelectOption[]
  placeholder?: string
  disabled?: boolean
  size?: 'md' | 'sm'
  maxMenuHeight?: number
}>(), {
  modelValue: null,
  placeholder: '请选择',
  disabled: false,
  size: 'md',
  maxMenuHeight: 320,
})

const emit = defineEmits<{
  'update:modelValue': [value: AppSelectValue]
  change: [value: AppSelectValue]
}>()

const rootEl = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)
const menuStyle = ref<Record<string, string>>({})

const selectedIndex = computed(() => props.options.findIndex((option) => Object.is(option.value, props.modelValue)))
const selectedOption = computed(() => (selectedIndex.value >= 0 ? props.options[selectedIndex.value] : null))

function isSelected(option: AppSelectOption): boolean {
  return Object.is(option.value, props.modelValue)
}

function findFirstEnabledIndex(): number {
  return props.options.findIndex((option) => !option.disabled)
}

function findLastEnabledIndex(): number {
  for (let index = props.options.length - 1; index >= 0; index -= 1) {
    if (!props.options[index]?.disabled) {
      return index
    }
  }
  return -1
}

function resolveEnabledIndex(preferredIndex: number): number {
  if (props.options.length === 0) return -1

  if (preferredIndex >= 0 && preferredIndex < props.options.length && !props.options[preferredIndex]?.disabled) {
    return preferredIndex
  }

  for (let offset = 1; offset < props.options.length; offset += 1) {
    const forward = preferredIndex + offset
    if (forward < props.options.length && !props.options[forward]?.disabled) {
      return forward
    }

    const backward = preferredIndex - offset
    if (backward >= 0 && !props.options[backward]?.disabled) {
      return backward
    }
  }

  return findFirstEnabledIndex()
}

function setActiveIndex(index: number) {
  if (props.options[index]?.disabled) return
  activeIndex.value = index
}

function scrollActiveOptionIntoView() {
  const element = menuEl.value?.querySelector<HTMLElement>(`[data-option-index="${activeIndex.value}"]`)
  element?.scrollIntoView({ block: 'nearest' })
}

function moveActive(step: 1 | -1) {
  if (props.options.length === 0) return

  if (activeIndex.value < 0) {
    activeIndex.value = step > 0 ? findFirstEnabledIndex() : findLastEnabledIndex()
    nextTick(scrollActiveOptionIntoView)
    return
  }

  for (let offset = 1; offset <= props.options.length; offset += 1) {
    const nextIndex = (activeIndex.value + step * offset + props.options.length) % props.options.length
    if (!props.options[nextIndex]?.disabled) {
      activeIndex.value = nextIndex
      nextTick(scrollActiveOptionIntoView)
      return
    }
  }
}

function updateMenuPosition() {
  if (typeof window === 'undefined') return
  const trigger = triggerEl.value
  if (!trigger) return

  const rect = trigger.getBoundingClientRect()
  const viewportPadding = 10
  const gap = 8
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
  const spaceAbove = rect.top - viewportPadding
  const estimatedHeight = Math.min(props.maxMenuHeight, Math.max(160, props.options.length * (props.size === 'sm' ? 38 : 46) + 20))
  const shouldOpenAbove = spaceBelow < Math.min(estimatedHeight, 220) && spaceAbove > spaceBelow
  const maxHeight = Math.max(120, Math.min(props.maxMenuHeight, shouldOpenAbove ? spaceAbove - gap : spaceBelow - gap))
  const width = Math.max(rect.width, props.size === 'sm' ? 92 : 220)
  const left = Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - width - viewportPadding)

  menuStyle.value = shouldOpenAbove
    ? {
        position: 'fixed',
        left: `${left}px`,
        bottom: `${window.innerHeight - rect.top + gap}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
        zIndex: '240',
      }
    : {
        position: 'fixed',
        left: `${left}px`,
        top: `${rect.bottom + gap}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
        zIndex: '240',
      }
}

function openMenu(preferredIndex?: number) {
  if (props.disabled || props.options.length === 0 || findFirstEnabledIndex() < 0) return

  open.value = true
  activeIndex.value = resolveEnabledIndex(
    typeof preferredIndex === 'number'
      ? preferredIndex
      : (selectedIndex.value >= 0 ? selectedIndex.value : 0),
  )

  nextTick(() => {
    updateMenuPosition()
    scrollActiveOptionIntoView()
  })
}

function closeMenu(focusTrigger = false) {
  if (!open.value) return
  open.value = false
  activeIndex.value = -1
  if (focusTrigger) {
    nextTick(() => triggerEl.value?.focus())
  }
}

function toggleMenu() {
  if (open.value) {
    closeMenu()
    return
  }

  openMenu()
}

function commitActiveSelection() {
  if (activeIndex.value < 0) return
  const option = props.options[activeIndex.value]
  if (!option || option.disabled) return
  handleOptionClick(option)
}

function handleOptionClick(option: AppSelectOption) {
  if (option.disabled) return

  const changed = !Object.is(option.value, props.modelValue)
  if (changed) {
    emit('update:modelValue', option.value)
    emit('change', option.value)
  }

  closeMenu(true)
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      if (!open.value) {
        openMenu(selectedIndex.value >= 0 ? selectedIndex.value + 1 : 0)
      } else {
        moveActive(1)
      }
      break
    case 'ArrowUp':
      event.preventDefault()
      if (!open.value) {
        openMenu(selectedIndex.value >= 0 ? selectedIndex.value - 1 : props.options.length - 1)
      } else {
        moveActive(-1)
      }
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (!open.value) {
        openMenu()
      } else {
        commitActiveSelection()
      }
      break
    case 'Escape':
      if (open.value) {
        event.preventDefault()
        closeMenu(true)
      }
      break
    case 'Tab':
      closeMenu(false)
      break
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return
  const target = event.target as Node | null
  if (target && (rootEl.value?.contains(target) || menuEl.value?.contains(target))) {
    return
  }
  closeMenu(false)
}

function handleDocumentScroll() {
  if (!open.value) return
  updateMenuPosition()
}

function attachGlobalListeners() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('scroll', handleDocumentScroll, true)
  window.addEventListener('resize', handleDocumentScroll)
}

function detachGlobalListeners() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  document.removeEventListener('scroll', handleDocumentScroll, true)
  window.removeEventListener('resize', handleDocumentScroll)
}

watch(open, (value) => {
  if (value) {
    attachGlobalListeners()
    return
  }
  detachGlobalListeners()
})

watch(() => props.disabled, (value) => {
  if (value) {
    closeMenu(false)
  }
})

watch(() => props.options, () => {
  if (!open.value) return
  nextTick(() => {
    activeIndex.value = resolveEnabledIndex(activeIndex.value >= 0 ? activeIndex.value : selectedIndex.value)
    updateMenuPosition()
    scrollActiveOptionIntoView()
  })
}, { deep: true })

onBeforeUnmount(() => {
  detachGlobalListeners()
})
</script>
