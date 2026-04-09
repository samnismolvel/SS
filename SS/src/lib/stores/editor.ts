import { writable, derived } from 'svelte/store'
import type { EditorSession, Subtitle } from '../types'
import {
  parseSRT,
  extractPauseGroups,
  applyDensityRatio,
  mergeSegments as _mergeSegments,
  insertSegmentAfter as _insertSegmentAfter,
} from '../utils/ass'
import type { Token } from '../utils/ass'

// ─── Session ──────────────────────────────────────────────────────────────────

// EditorSession is extended with rawSubs (original whisper word-tokens)
// and densityRatio (0–1 slider value). These are kept separate from the
// displayed subtitles so the slider can re-process from scratch at any time.

interface ExtendedSession extends EditorSession {
  rawSubs:      Subtitle[]   // original one-word-per-block whisper output
  pauseGroups:  Token[][]    // pause groups derived from rawSubs
  densityRatio: number       // 0 = one word per seg, 1 = one seg per pause group
}

export const session = writable<ExtendedSession | null>(null)

// ─── Derived ──────────────────────────────────────────────────────────────────

export const subtitles    = derived(session, $s => $s?.subtitles ?? [])
export const selectedIndex = derived(session, $s => $s?.selectedIndex ?? null)
export const selectedSubtitle = derived(session, $s =>
  $s && $s.selectedIndex !== null ? $s.subtitles[$s.selectedIndex] : null
)
export const isDirty      = derived(session, $s => $s?.isDirty ?? false)
export const densityRatio = derived(session, $s => $s?.densityRatio ?? 0.4)

// ─── Actions ──────────────────────────────────────────────────────────────────

export function openSession(
  queueItemId: string,
  videoPath: string,
  outputPath: string,
  srtContent: string,
  ratio = 0.4
) {
  const rawSubs    = parseSRT(srtContent)
  const pauseGroups = extractPauseGroups(rawSubs)
  const subtitles  = applyDensityRatio(pauseGroups, ratio)
  session.set({
    queueItemId,
    videoPath,
    outputPath,
    rawSubs,
    pauseGroups,
    densityRatio: ratio,
    subtitles,
    selectedIndex: null,
    isDirty: false,
  })
}

export function closeSession() { session.set(null) }

export function selectSegment(index: number | null) {
  session.update($s => $s ? { ...$s, selectedIndex: index } : null)
}

// ─── Density slider ───────────────────────────────────────────────────────────
// Re-processes ALL segments from the original whisper tokens.
// Any manual merges/edits are discarded — the slider is a global re-layout.

export function setDensityRatio(ratio: number) {
  session.update($s => {
    if (!$s) return null
    const subtitles = applyDensityRatio($s.pauseGroups, ratio)
    return { ...$s, densityRatio: ratio, subtitles, selectedIndex: null, isDirty: true }
  })
}

// ─── Merge two adjacent segments ─────────────────────────────────────────────

export function mergeWithNext(index: number) {
  session.update($s => {
    if (!$s) return null
    const subtitles = _mergeSegments($s.subtitles, index)
    return { ...$s, subtitles, selectedIndex: null, isDirty: true }
  })
}

// ─── Insert empty segment after index ────────────────────────────────────────

export function insertAfter(index: number) {
  session.update($s => {
    if (!$s) return null
    const subtitles = _insertSegmentAfter($s.subtitles, index)
    return { ...$s, subtitles, selectedIndex: index + 1, isDirty: true }
  })
}

// ─── Text / overrides ─────────────────────────────────────────────────────────

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