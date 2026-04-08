// ─── Template ────────────────────────────────────────────────────────────────
// posX / posY are intentionally NOT part of Template.
// Position is a separate, optional, dragged value stored outside the template
// so that presets never override user drag, and undragged subtitles fall back
// to the ASS alignment + margin system automatically.

export interface Template {
  id: string
  name: string
  fontName: string
  fontSize: number
  bold: boolean
  italic: boolean
  primaryColor: string
  secondaryColor: string
  outlineColor: string
  backColor: string
  outline: number
  shadow: number
  scaleX: number
  scaleY: number
  spacing: number
  marginV: number
  marginL: number
  marginR: number
  wordByWord: boolean
  wordMode: WordMode
  highlightColor: string
  syncOffset: number
  pauseThreshold: number
  animation: AnimationMode
}

// ─── Drag position ────────────────────────────────────────────────────────────
// Stored as % of the video frame (0–100). Kept separate from Template so it is
// never serialised into a preset and never interferes with ASS alignment when
// no drag has occurred.
export interface DragPosition {
  posX: number  // 0–100, horizontal %
  posY: number  // 0–100, vertical %
}

// ─── Enums / Literals ────────────────────────────────────────────────────────

export type Alignment =
  | 1 | 2 | 3
  | 4 | 5 | 6
  | 7 | 8 | 9

export type WordMode = 'highlight' | 'solo' | 'none'

export type AnimationMode = 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter'

export type SubtitleStatus = 'pending' | 'processing' | 'done' | 'failed'

// ─── Aspect ratio ─────────────────────────────────────────────────────────────
export type AspectRatio = 'original' | '1:1' | '9:16' | '16:9' | '4:3' | '3:4'

export function parseRatio(r: AspectRatio): [number, number] | null {
  switch (r) {
    case '1:1':  return [1, 1]
    case '9:16': return [9, 16]
    case '16:9': return [16, 9]
    case '4:3':  return [4, 3]
    case '3:4':  return [3, 4]
    default:     return null
  }
}

// ─── Subtitle Segment ────────────────────────────────────────────────────────
export interface Subtitle {
  index: number
  start: string
  end: string
  text: string
  originalText: string
  overrides?: Partial<Omit<Template, 'id' | 'name' | 'wordByWord' | 'wordMode' | 'highlightColor'>>
}

// ─── Queue ───────────────────────────────────────────────────────────────────
export type QueueItemMode = 'template' | 'manual'

export interface QueueItem {
  id: string
  inputPath: string
  outputPath: string
  status: SubtitleStatus
  error: string | null
  mode: QueueItemMode
  templateId?: string
  srtContent?: string
}

// ─── Editor Session ──────────────────────────────────────────────────────────
export interface EditorSession {
  queueItemId: string
  videoPath: string
  outputPath: string
  subtitles: Subtitle[]
  selectedIndex: number | null
  isDirty: boolean
}

// ─── Progress ────────────────────────────────────────────────────────────────
export type ProgressStep = 'extracting' | 'transcribing' | 'editing' | 'burning' | 'done'

export interface ProgressEvent {
  step: ProgressStep
  message: string
}

// ─── Built-in template presets ────────────────────────────────────────────────
export const PRESET_IDS = {
  DEFAULT:   'preset-default',
  TIKTOK:    'preset-tiktok',
  CINEMATIC: 'preset-cinematic',
  MINIMAL:   'preset-minimal',
  KARAOKE:   'preset-karaoke',
} as const

export type PresetId = typeof PRESET_IDS[keyof typeof PRESET_IDS]