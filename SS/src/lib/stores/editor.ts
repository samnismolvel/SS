import { writable, derived, get } from 'svelte/store'
import type { EditorSession, Subtitle } from '../types'
import { parseSRT } from '../utils/ass'

// ─── Session ──────────────────────────────────────────────────────────────────

export const session = writable<EditorSession | null>(null)

// ─── Derived ──────────────────────────────────────────────────────────────────

export const subtitles = derived(session, $s => $s?.subtitles ?? [])

export const selectedIndex = derived(session, $s => $s?.selectedIndex ?? null)

export const selectedSubtitle = derived(session, $s =>
  $s && $s.selectedIndex !== null ? $s.subtitles[$s.selectedIndex] : null
)

export const isDirty = derived(session, $s => $s?.isDirty ?? false)

// ─── Actions ──────────────────────────────────────────────────────────────────

export function openSession(queueItemId: string, videoPath: string, outputPath: string, srtContent: string) {
  session.set({
    queueItemId,
    videoPath,
    outputPath,
    subtitles: parseSRT(srtContent),
    selectedIndex: null,
    isDirty: false,
  })
}

export function closeSession() {
  session.set(null)
}

export function selectSegment(index: number | null) {
  session.update($s => $s ? { ...$s, selectedIndex: index } : null)
}

export function updateSubtitleText(index: number, text: string) {
  session.update($s => {
    if (!$s) return null
    const subtitles = [...$s.subtitles]
    subtitles[index] = { ...subtitles[index], text }
    return { ...$s, subtitles, isDirty: true }
  })
}

export function updateSubtitleTiming(index: number, start: string, end: string) {
  session.update($s => {
    if (!$s) return null
    const subtitles = [...$s.subtitles]
    subtitles[index] = { ...subtitles[index], start, end }
    return { ...$s, subtitles, isDirty: true }
  })
}

export function updateSubtitleOverrides(index: number, overrides: Subtitle['overrides']) {
  session.update($s => {
    if (!$s) return null
    const subtitles = [...$s.subtitles]
    subtitles[index] = {
      ...subtitles[index],
      overrides: { ...subtitles[index].overrides, ...overrides }
    }
    return { ...$s, subtitles, isDirty: true }
  })
}

export function clearSubtitleOverrides(index: number) {
  session.update($s => {
    if (!$s) return null
    const subtitles = [...$s.subtitles]
    const { overrides: _, ...rest } = subtitles[index]
    subtitles[index] = rest
    return { ...$s, subtitles, isDirty: true }
  })
}

export function resetSubtitleText(index: number) {
  session.update($s => {
    if (!$s) return null
    const subtitles = [...$s.subtitles]
    subtitles[index] = { ...subtitles[index], text: subtitles[index].originalText }
    return { ...$s, subtitles, isDirty: true }
  })
}

export function findAndReplace(search: string, replace: string, mode: 'all' | 'single'): number {
  let count = 0
  session.update($s => {
    if (!$s) return null
    const subtitles = $s.subtitles.map(sub => {
      if (mode === 'all') {
        const regex = new RegExp(search, 'gi')
        if (regex.test(sub.text)) {
          count++
          return { ...sub, text: sub.text.replace(new RegExp(search, 'gi'), replace) }
        }
      } else {
        if (sub.text.includes(search)) {
          count++
          return { ...sub, text: sub.text.replace(search, replace) }
        }
      }
      return sub
    })
    return { ...$s, subtitles, isDirty: count > 0 }
  })
  return count
}