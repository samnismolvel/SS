// ─── Template ────────────────────────────────────────────────────────────────
// A full style definition. All fields required at the template level,
// but Partial<Template> is used for per-segment overrides.

export interface Template {
  id: string
  name: string
  // Typography
  fontName: string
  fontSize: number
  bold: boolean
  italic: boolean
  // Colors (hex strings e.g. "#FFFFFF")
  primaryColor: string
  secondaryColor: string
  outlineColor: string
  backColor: string
  // Geometry
  outline: number        // outline thickness 0–4
  shadow: number         // shadow depth 0–4
  scaleX: number         // horizontal scale % (100 = normal)
  scaleY: number         // vertical scale % (100 = normal)
  spacing: number        // extra letter spacing
  // Layout
  alignment: Alignment
  marginV: number        // vertical margin in pixels
  marginL: number
  marginR: number
  // Animation mode
  wordByWord: boolean
  wordMode: WordMode
  highlightColor: string // color used for the active word
  // Timing tuning (user-adjustable in Advanced panel)
  syncOffset: number      // ms to shift subtitle starts forward (whisper early-onset correction)
  pauseThreshold: number  // inter-word gap ms that triggers a line break (clause boundary)
  animation: AnimationMode  // entrance/transition animation applied at burn time
}

// ─── Enums / Literals ────────────────────────────────────────────────────────

// ASS alignment grid (numpad layout)
export type Alignment =
  | 1 | 2 | 3   // bottom-left, bottom-center, bottom-right
  | 4 | 5 | 6   // middle-left, middle-center, middle-right
  | 7 | 8 | 9   // top-left,    top-center,    top-right

export type WordMode = 'highlight' | 'solo' | 'none'

export type AnimationMode = 'none' | 'fade'

export type SubtitleStatus = 'pending' | 'processing' | 'done' | 'failed'

// ─── Subtitle Segment ────────────────────────────────────────────────────────
// One SRT block. overrides is a sparse partial — only fields the user
// has explicitly changed from the active template are stored here.

export interface Subtitle {
  index: number
  start: string           // SRT format: "00:00:01,000"
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
  mode: QueueItemMode       // template = auto-burn, manual = open editor
  templateId?: string       // which template to use if mode === 'template'
  srtContent?: string       // stored after transcription, before burn/edit
}

// ─── Editor Session ──────────────────────────────────────────────────────────
// Transient state while the user is editing subtitles for one video.

export interface EditorSession {
  queueItemId: string
  videoPath: string
  outputPath: string
  subtitles: Subtitle[]
  selectedIndex: number | null   // which segment is open in the inspector
  isDirty: boolean               // any unsaved changes
}

// ─── Progress ────────────────────────────────────────────────────────────────

export type ProgressStep = 'extracting' | 'transcribing' | 'editing' | 'burning' | 'done'

export interface ProgressEvent {
  step: ProgressStep
  message: string
}

// ─── Built-in template presets (ids are stable constants) ────────────────────

export const PRESET_IDS = {
  DEFAULT:    'preset-default',
  TIKTOK:     'preset-tiktok',
  CINEMATIC:  'preset-cinematic',
  MINIMAL:    'preset-minimal',
  KARAOKE:    'preset-karaoke',
} as const

export type PresetId = typeof PRESET_IDS[keyof typeof PRESET_IDS]