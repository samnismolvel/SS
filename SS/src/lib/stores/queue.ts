import { writable, derived } from 'svelte/store'
import type { QueueItem, ProgressStep, QueueItemMode } from '../types'

// ─── State ───────────────────────────────────────────────────────────────────

export const queue = writable<QueueItem[]>([])
export const processing = writable(false)
export const currentVideoIndex = writable(-1)
export const currentStep = writable<ProgressStep | ''>('')
export const currentMessage = writable('')

export type ProcessingPhase = 'idle' | 'transcribing' | 'editing' | 'burning'
export const processingPhase = writable<ProcessingPhase>('idle')

// ─── Derived ─────────────────────────────────────────────────────────────────

export const hasQueue = derived(queue, $q => $q.length > 0)
export const pendingCount = derived(queue, $q => $q.filter(i => i.status === 'pending').length)
export const manualCount = derived(queue, $q => $q.filter(i => i.mode === 'manual').length)
export const templateCount = derived(queue, $q => $q.filter(i => i.mode === 'template').length)

// ─── Actions ─────────────────────────────────────────────────────────────────

export function addToQueue(paths: string[]) {
  queue.update($q => [
    ...$q,
    ...paths.map(path => ({
      id: crypto.randomUUID(),
      inputPath: path,
      outputPath: path.replace(/\.[^/.]+$/, '_subtitled.mp4'),
      status: 'pending' as const,
      error: null,
      mode: 'manual' as QueueItemMode,
    }))
  ])
}

export function removeFromQueue(id: string) {
  queue.update($q => $q.filter(i => i.id !== id))
}

export function updateQueueItem(id: string, patch: Partial<QueueItem>) {
  queue.update($q => $q.map(i => i.id === id ? { ...i, ...patch } : i))
}

export function setItemMode(id: string, mode: QueueItemMode) {
  queue.update($q => $q.map(i => i.id === id ? { ...i, mode } : i))
}

export function setItemTemplate(id: string, templateId: string) {
  queue.update($q => $q.map(i =>
    i.id === id ? { ...i, templateId, mode: 'template' as QueueItemMode } : i
  ))
}

export function moveItem(index: number, direction: 'up' | 'down') {
  queue.update($q => {
    const next = [...$q]
    const swap = direction === 'up' ? index - 1 : index + 1
    if (swap < 0 || swap >= next.length) return next
    ;[next[index], next[swap]] = [next[swap], next[index]]
    return next
  })
}

export function clearCompleted() {
  queue.update($q => $q.filter(i => i.status !== 'done'))
}

export function resetProgress() {
  currentVideoIndex.set(-1)
  currentStep.set('')
  currentMessage.set('')
  processing.set(false)
  processingPhase.set('idle')
}