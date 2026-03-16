import { writable, derived } from 'svelte/store'
import type { QueueItem, ProgressStep } from '../types'

// ─── Queue items ─────────────────────────────────────────────────────────────

export const queue = writable<QueueItem[]>([])

export const processing = writable(false)

export const currentVideoIndex = writable(-1)

export const currentStep = writable<ProgressStep | ''>('')

export const currentMessage = writable('')

// ─── Derived helpers ──────────────────────────────────────────────────────────

export const hasQueue = derived(queue, $q => $q.length > 0)

export const allDone = derived(queue, $q =>
  $q.length > 0 && $q.every(item => item.status === 'done')
)

export const pendingCount = derived(queue, $q =>
  $q.filter(item => item.status === 'pending').length
)

// ─── Actions ──────────────────────────────────────────────────────────────────

export function addToQueue(paths: string[]) {
  queue.update($q => [
    ...$q,
    ...paths.map(path => ({
      id: crypto.randomUUID(),
      inputPath: path,
      outputPath: path.replace(/\.[^/.]+$/, '_subtitled.mp4'),
      status: 'pending' as const,
      error: null,
    }))
  ])
}

export function removeFromQueue(id: string) {
  queue.update($q => $q.filter(item => item.id !== id))
}

export function updateQueueItem(id: string, patch: Partial<QueueItem>) {
  queue.update($q => $q.map(item => item.id === id ? { ...item, ...patch } : item))
}

export function moveItem(index: number, direction: 'up' | 'down') {
  queue.update($q => {
    const next = [...$q]
    const swap = direction === 'up' ? index - 1 : index + 1
    if (swap < 0 || swap >= next.length) return next;
    [next[index], next[swap]] = [next[swap], next[index]]
    return next
  })
}

export function clearCompleted() {
  queue.update($q => $q.filter(item => item.status !== 'done'))
}

export function resetProgress() {
  currentVideoIndex.set(-1)
  currentStep.set('')
  currentMessage.set('')
  processing.set(false)
}