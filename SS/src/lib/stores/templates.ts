import { writable, derived } from 'svelte/store'
import type { Template, AnimationMode } from '../types'
import { PRESET_IDS } from '../types'

// ─── Built-in presets ─────────────────────────────────────────────────────────

export const PRESETS: Template[] = [
  {
    id: PRESET_IDS.DEFAULT,
    name: 'Default',
    fontName: 'Arial',
    fontSize: 24,
    bold: false,
    italic: false,
    primaryColor: '#FFFFFF',
    secondaryColor: '#FFFFFF',
    outlineColor: '#000000',
    backColor: '#000000',
    outline: 2,
    shadow: 0,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    marginV: 20,
    marginL: 10,
    marginR: 10,
    wordByWord: false,
    wordMode: 'none',
    highlightColor: '#FFFF00',
    syncOffset: 50,
    pauseThreshold: 500,
    animation: 'none' as AnimationMode,
  },
  {
    id: PRESET_IDS.TIKTOK,
    name: 'TikTok',
    fontName: 'Impact',
    fontSize: 32,
    bold: true,
    italic: false,
    primaryColor: '#FFFFFF',
    secondaryColor: '#FFFFFF',
    outlineColor: '#000000',
    backColor: '#000000',
    outline: 3,
    shadow: 1,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    marginV: 0,
    marginL: 10,
    marginR: 10,
    wordByWord: true,
    wordMode: 'highlight',
    highlightColor: '#FF2D55',
    syncOffset: 50,
    pauseThreshold: 500,
    animation: 'none' as AnimationMode,
  },
  {
    id: PRESET_IDS.CINEMATIC,
    name: 'Cinematic',
    fontName: 'Georgia',
    fontSize: 22,
    bold: false,
    italic: true,
    primaryColor: '#F5F5DC',
    secondaryColor: '#F5F5DC',
    outlineColor: '#1A1A1A',
    backColor: '#000000',
    outline: 1,
    shadow: 2,
    scaleX: 100,
    scaleY: 100,
    spacing: 1,
    marginV: 40,
    marginL: 10,
    marginR: 10,
    wordByWord: false,
    wordMode: 'none',
    highlightColor: '#F5F5DC',
    syncOffset: 50,
    pauseThreshold: 500,
    animation: 'none' as AnimationMode,
  },
  {
    id: PRESET_IDS.MINIMAL,
    name: 'Minimal',
    fontName: 'Helvetica Neue',
    fontSize: 20,
    bold: false,
    italic: false,
    primaryColor: '#FFFFFF',
    secondaryColor: '#FFFFFF',
    outlineColor: '#000000',
    backColor: '#000000',
    outline: 1,
    shadow: 0,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    marginV: 30,
    marginL: 10,
    marginR: 10,
    wordByWord: false,
    wordMode: 'none',
    highlightColor: '#FFFFFF',
    syncOffset: 50,
    pauseThreshold: 500,
    animation: 'none' as AnimationMode,
  },
  {
    id: PRESET_IDS.KARAOKE,
    name: 'Karaoke',
    fontName: 'Arial',
    fontSize: 28,
    bold: true,
    italic: false,
    primaryColor: '#FFFFFF',
    secondaryColor: '#FFFFFF',
    outlineColor: '#000080',
    backColor: '#000000',
    outline: 2,
    shadow: 1,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    marginV: 20,
    marginL: 10,
    marginR: 10,
    wordByWord: true,
    wordMode: 'highlight',
    highlightColor: '#00BFFF',
    syncOffset: 50,
    pauseThreshold: 500,
    animation: 'none' as AnimationMode,
  },
]

// ─── Store ────────────────────────────────────────────────────────────────────

// User-created templates (loaded from / saved to disk via Tauri)
export const userTemplates = writable<Template[]>([])

// All templates combined
export const allTemplates = derived(
  userTemplates,
  $user => [...PRESETS, ...$user]
)

// The currently active template
export const activeTemplate = writable<Template>({ ...PRESETS[0] })

// ─── Actions ──────────────────────────────────────────────────────────────────

export function setActiveTemplate(template: Template) {
  activeTemplate.set({ ...template })
}

export function updateActiveTemplate(patch: Partial<Template>) {
  activeTemplate.update($t => ({ ...$t, ...patch }))
}

export function addUserTemplate(template: Omit<Template, 'id'>) {
  const newTemplate: Template = {
    ...template,
    id: `user-${crypto.randomUUID()}`,
  }
  userTemplates.update($t => [...$t, newTemplate])
  return newTemplate
}

export function updateUserTemplate(id: string, patch: Partial<Template>) {
  userTemplates.update($t =>
    $t.map(t => t.id === id ? { ...t, ...patch } : t)
  )
}

export function deleteUserTemplate(id: string) {
  userTemplates.update($t => $t.filter(t => t.id !== id))
}

/** Save the current active template as a new user template */
export function saveActiveAsTemplate(name: string) {
  activeTemplate.update($t => {
    addUserTemplate({ ...$t, name })
    return $t
  })
}