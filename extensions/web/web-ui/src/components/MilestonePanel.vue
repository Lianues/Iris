<template>
  <section v-if="snapshot && snapshot.items.length > 0" class="milestone-panel" aria-label="Milestone 进度">
    <div class="milestone-header">
      <span class="milestone-kicker">Iris 进度</span>
      <span class="milestone-stats">
        <strong>{{ snapshot.stats.completed }}</strong>/<strong>{{ snapshot.stats.total }}</strong> 已完成
        <template v-if="snapshot.stats.inProgress > 0"> · {{ snapshot.stats.inProgress }} 进行中</template>
        <template v-if="snapshot.stats.blocked > 0"> · {{ snapshot.stats.blocked }} 阻塞</template>
      </span>
    </div>

    <div class="milestone-groups">
      <section
        v-for="group in visibleGroups"
        :key="group.owner"
        class="milestone-owner-group"
      >
        <div v-if="showOwnerHeadings" class="milestone-owner-heading">
          <span class="milestone-owner-chevron">▸</span>
          <span class="milestone-owner-name">{{ group.owner }}</span>
          <span class="milestone-owner-stats">
            {{ group.stats.completed }}/{{ group.stats.total }} 已完成
            <template v-if="group.stats.inProgress > 0"> · {{ group.stats.inProgress }} 进行中</template>
            <template v-if="group.stats.blocked > 0"> · {{ group.stats.blocked }} 阻塞</template>
          </span>
        </div>
        <ol class="milestone-list">
          <li
            v-for="item in group.items"
            :key="`${group.owner}:${item.id}`"
            class="milestone-item"
            :class="`status-${item.status}`"
          >
            <span class="milestone-icon">{{ iconFor(item.status) }}</span>
            <span class="milestone-id">{{ displayMilestoneId(item.id) }}.</span>
            <span class="milestone-title">{{ item.title }}</span>
            <span v-if="item.blockedBy?.length" class="milestone-blocked">↳ 依赖 {{ item.blockedBy.map(id => `#${displayMilestoneId(id)}`).join(', ') }}</span>
            <span v-if="item.status === 'in_progress' && item.activeForm" class="milestone-active">{{ item.activeForm }}…</span>
          </li>
        </ol>
      </section>
    </div>

    <div v-if="hiddenCount > 0" class="milestone-hidden">另有 {{ hiddenCount }} 项未显示</div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MilestoneItem, MilestoneSnapshot, MilestoneStatus } from '../api/types'

const props = defineProps<{
  snapshot: MilestoneSnapshot | null
  maxItems?: number
}>()

interface OwnerStats {
  total: number
  completed: number
  inProgress: number
  blocked: number
}

interface OwnerGroup {
  owner: string
  items: MilestoneItem[]
  stats: OwnerStats
}

function compareById(a: MilestoneItem, b: MilestoneItem): number {
  const an = Number.parseInt(a.id.replace(/^m/i, ''), 10)
  const bn = Number.parseInt(b.id.replace(/^m/i, ''), 10)
  if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

function ownerLabel(item: MilestoneItem, fallback?: string): string {
  return (item.owner || fallback || '未分配').trim()
}

function displayMilestoneId(id: string): string {
  return id.replace(/^m(?=\d+$)/i, '')
}

function createOwnerStats(): OwnerStats {
  return { total: 0, completed: 0, inProgress: 0, blocked: 0 }
}

const sortedItems = computed(() => {
  const items = props.snapshot?.items ?? []
  return [...items].sort(compareById)
})

const visibleItems = computed(() => sortedItems.value.slice(0, props.maxItems ?? 8))
const hiddenCount = computed(() => Math.max(0, sortedItems.value.length - visibleItems.value.length))

const ownerStatsByLabel = computed(() => {
  const preferredOwner = props.snapshot?.routeAgent
  const map = new Map<string, OwnerStats>()
  for (const item of props.snapshot?.items ?? []) {
    const owner = ownerLabel(item, preferredOwner)
    let stats = map.get(owner)
    if (!stats) {
      stats = createOwnerStats()
      map.set(owner, stats)
    }
    stats.total += 1
    if (item.status === 'completed') stats.completed += 1
    if (item.status === 'in_progress') stats.inProgress += 1
    if (item.status === 'blocked') stats.blocked += 1
  }
  return map
})

const visibleGroups = computed<OwnerGroup[]>(() => {
  const preferredOwner = props.snapshot?.routeAgent
  const map = new Map<string, OwnerGroup>()
  for (const item of visibleItems.value) {
    const owner = ownerLabel(item, preferredOwner)
    let group = map.get(owner)
    if (!group) {
      group = { owner, items: [], stats: ownerStatsByLabel.value.get(owner) ?? createOwnerStats() }
      map.set(owner, group)
    }
    group.items.push(item)
  }

  return Array.from(map.values()).sort((a, b) => {
    if (preferredOwner) {
      if (a.owner === preferredOwner && b.owner !== preferredOwner) return -1
      if (b.owner === preferredOwner && a.owner !== preferredOwner) return 1
    }
    const firstA = a.items[0]
    const firstB = b.items[0]
    if (firstA && firstB) return compareById(firstA, firstB)
    return a.owner.localeCompare(b.owner)
  })
})

const showOwnerHeadings = computed(() => visibleGroups.value.length > 1)

function iconFor(status: MilestoneStatus): string {
  switch (status) {
    case 'completed': return '✓'
    case 'in_progress': return '✦'
    case 'blocked': return '◆'
    case 'cancelled': return '⊘'
    default: return '○'
  }
}
</script>
