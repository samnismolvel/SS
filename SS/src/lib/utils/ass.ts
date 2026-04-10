import type { Template, Subtitle, AnimationMode } from '../types'

// ─── Color helpers ────────────────────────────────────────────────────────────

export function hexToAss(hex: string, alpha = 0): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '&H00FFFFFF'
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  const a = alpha.toString(16).padStart(2, '0').toUpperCase()
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

export function srtTimeToAss(srtTime: string): string {
  const [timePart, msPart] = srtTime.trim().split(',')
  const ms = parseInt(msPart ?? '0', 10)
  const cs = Math.floor(ms / 10)
  const parts = timePart.split(':')
  const h = parseInt(parts[0], 10)
  const m = parts[1].padStart(2, '0')
  const s = parts[2].padStart(2, '0')
  return `${h}:${m}:${s}.${cs.toString().padStart(2, '0')}`
}

export function assTimeToMs(assTime: string): number {
  const parts = assTime.split(':')
  if (parts.length !== 3) return 0
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const [secStr, csStr] = parts[2].split('.')
  const sec = parseInt(secStr, 10)
  const cs  = parseInt(csStr ?? '0', 10)
  return h * 3600000 + m * 60000 + sec * 1000 + cs * 10
}

export function msToAssTime(ms: number): string {
  const clamped = Math.max(0, ms)
  const h    = Math.floor(clamped / 3600000)
  const rem1 = clamped % 3600000
  const m    = Math.floor(rem1 / 60000)
  const rem2 = rem1 % 60000
  const s    = Math.floor(rem2 / 1000)
  const cs   = Math.floor((rem2 % 1000) / 10)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

// ─── SRT timestamp helpers ────────────────────────────────────────────────────

function srtToMs(srt: string): number {
  return assTimeToMs(srtTimeToAss(srt))
}

function msToSrt(ms: number): string {
  const clamped = Math.max(0, ms)
  const h      = Math.floor(clamped / 3600000)
  const rem1   = clamped % 3600000
  const m      = Math.floor(rem1 / 60000)
  const rem2   = rem1 % 60000
  const s      = Math.floor(rem2 / 1000)
  const millis = rem2 % 1000
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`
}

// ─── Whisper timing correction ────────────────────────────────────────────────
//
// Whisper timestamps word onsets slightly early. A positive shift on start
// times makes subtitles feel synchronised rather than anticipatory.
//
// syncOffset  — how many ms to push start times forward (user-tunable, default 120)
// Applied ONLY at burn time (buildAss), never written back into the stored SRT,
// so re-burning never double-applies the offset.

function applyTimingCorrection(lines: Line[], syncOffsetMs: number): Line[] {
  let prevEndMs = 0
  return lines.map(line => {
    const startMs = Math.max(line.startMs + syncOffsetMs, prevEndMs)
    const endMs   = Math.max(line.endMs + syncOffsetMs, startMs + 100)
    prevEndMs     = endMs
    return {
      ...line,
      startMs,
      endMs,
      startSrt: msToSrt(startMs),
      endSrt:   msToSrt(endMs),
    }
  })
}

// ─── Token type ───────────────────────────────────────────────────────────────

export interface Token {
  word: string
  rawWord: string
  startSrt: string
  endSrt: string
  startMs: number
  endMs: number
}

// ─── Line type ────────────────────────────────────────────────────────────────

interface Line {
  text: string
  startSrt: string
  endSrt: string
  startMs: number
  endMs: number
}

// ─── Clean a single word token ────────────────────────────────────────────────

function cleanWord(w: string): string {
  return w.replace(/^[^\w]+/, '').replace(/[^\w']+$/, '').trim()
}

function isValidWord(w: string): boolean {
  return w.length > 0 && /\w/.test(w)
}

// ─── Length-weighted word timing ──────────────────────────────────────────────
// Used only by the preview (activeWordIndex in Editor.svelte).
// At burn time, every subtitle coming from parseSRT is already a single word
// with its own real timestamp, so distributeWordTimings is a no-op there.
// For the preview we still need it because the stored subtitle spans the whole
// grouped line and we must estimate which word is current.

const MIN_WORD_MS = 250   // >= browser timeupdate interval so no word is missed
const MAX_WORD_MS = 1500

export function distributeWordTimings(
  words: string[],
  startMs: number,
  endMs: number
): Array<{ startMs: number; endMs: number }> {
  if (words.length === 0) return []
  if (words.length === 1) return [{ startMs, endMs }]

  const totalMs  = endMs - startMs
  const lengths  = words.map(w => Math.max(w.length, 1))
  const totalLen = lengths.reduce((a, b) => a + b, 0)

  const durations = lengths.map(len => (len / totalLen) * totalMs)

  let surplus = 0
  const clamped = durations.map(d => {
    const c = Math.max(MIN_WORD_MS, Math.min(MAX_WORD_MS, d))
    surplus += d - c
    return c
  })

  let iterations = 0
  while (Math.abs(surplus) > 1 && iterations++ < 5) {
    const unclamped = clamped
      .map((c, i) =>
        (surplus > 0 && c < MAX_WORD_MS) || (surplus < 0 && c > MIN_WORD_MS) ? i : -1
      )
      .filter(i => i >= 0)
    if (unclamped.length === 0) break
    const share = surplus / unclamped.length
    surplus = 0
    for (const i of unclamped) {
      const next = Math.max(MIN_WORD_MS, Math.min(MAX_WORD_MS, clamped[i] + share))
      surplus += clamped[i] + share - next
      clamped[i] = next
    }
  }

  const result: Array<{ startMs: number; endMs: number }> = []
  let cursor = startMs
  for (let i = 0; i < words.length; i++) {
    const wStart = Math.round(cursor)
    const wEnd   = i === words.length - 1 ? endMs : Math.round(cursor + clamped[i])
    result.push({ startMs: wStart, endMs: wEnd })
    cursor += clamped[i]
  }
  return result
}

// ─── Build token list from raw subtitles ──────────────────────────────────────
// buildTokens treats each subtitle's text as a single token.
// When called from buildPlainEvents, each subtitle IS a single word (raw SRT).
// Contraction merging handles "'s", "'t", "'re" etc.

function buildTokens(subtitles: Subtitle[]): Token[] {
  const raw: Token[] = subtitles.map(sub => ({
    word:     sub.text.trim(),
    rawWord:  sub.text.trim(),
    startSrt: sub.start,
    endSrt:   sub.end,
    startMs:  srtToMs(sub.start),
    endMs:    srtToMs(sub.end),
  }))

  // Merge contraction suffixes ("'s", "'t", "'re", etc.)
  const merged: Token[] = []
  for (const token of raw) {
    const isContraction = /^'[a-z]+$/i.test(token.word)
    if (isContraction && merged.length > 0) {
      const prev = merged[merged.length - 1]
      merged[merged.length - 1] = {
        ...prev,
        word:   prev.word + token.word,
        endSrt: token.endSrt,
        endMs:  token.endMs,
      }
    } else {
      merged.push(token)
    }
  }

  return merged
    .map(t => ({ ...t, rawWord: t.word, word: cleanWord(t.word) }))
    .filter(t => isValidWord(t.word))
}

// ─── Grouping options ─────────────────────────────────────────────────────────

interface GroupOptions {
  maxWords?:   number   // hard cap on words per line           (default 6)
  maxMs?:      number   // hard cap on line duration ms         (default 4000)
  minMs?:      number   // merge forward if shorter             (default 600)
  breathMs?:   number   // gap: ignore (mid-thought breath)     (default 250)
  clauseMs?:   number   // gap: soft break if line long enough  (default 500)
  cutMs?:      number   // gap: always hard break               (default 800)
}

// ─── Core grouping ────────────────────────────────────────────────────────────
//
// Break rules, in priority order:
//   1. Gap >= cutMs      → hard break (speaker pause / edit cut)
//   2. Gap >= clauseMs   → soft break when we already have ≥3 words banked
//   3. Sentence-ending punctuation  . ! ?
//   4. Capital letter when group is non-empty (whisper capitalises after cuts)
//   5. Clause punctuation  , ; :  after ≥4 words  (skip numeric commas)
//   6. Duration cap  (only after ≥3 words to avoid 1-word flash lines)
//   7. Word-count cap

function groupTokens(tokens: Token[], opts: GroupOptions = {}): Line[] {
  const {
    maxWords = 6,
    maxMs    = 4000,
    minMs    = 600,
    breathMs = 250,
    clauseMs = 500,
    cutMs    = 800,
  } = opts

  const lines: Line[] = []
  let i = 0

  while (i < tokens.length) {
    const group: Token[] = []

    while (i < tokens.length && group.length < maxWords) {
      const token     = tokens[i]
      const lastEndMs = group.length > 0 ? group[group.length - 1].endMs : -Infinity
      const gap       = token.startMs - lastEndMs
      const lastRaw   = group.length > 0 ? group[group.length - 1].rawWord : ''

      // Rule 1 — hard cut pause
      if (group.length > 0 && gap >= cutMs) break

      // Rule 2 — clause pause with enough words already banked
      if (group.length >= 3 && gap >= clauseMs) break

      // Rule 4 — capital letter (any non-empty group)
      if (group.length > 0 && /^[A-Z]/.test(token.word)) break

      group.push(token)
      i++

      const currentRaw = group[group.length - 1].rawWord

      // Rule 3 — sentence-ending punctuation
      if (/[.!?]$/.test(currentRaw)) break

      // Rule 5 — clause punctuation after ≥4 words (skip numeric commas)
      const isNumericComma = /\d,\d/.test(currentRaw)
      if (!isNumericComma && group.length >= 4 && /[,;:]$/.test(currentRaw)) break

      // Rule 6 — duration cap (only once we have ≥3 words)
      if (group.length >= 3) {
        const dur = group[group.length - 1].endMs - group[0].startMs
        if (dur > maxMs) break
      }
    }

    // Safety: stalled → force-consume one token
    if (group.length === 0 && i < tokens.length) group.push(tokens[i++])
    if (group.length === 0) continue

    // Minimum duration guard: absorb one more token when line is very short
    // and the next follows without a hard pause — prevents flash subtitles.
    const lineDur = group[group.length - 1].endMs - group[0].startMs
    const nextGap = i < tokens.length ? tokens[i].startMs - group[group.length - 1].endMs : Infinity
    if (lineDur < minMs && group.length < maxWords && nextGap < cutMs) {
      if (i < tokens.length) group.push(tokens[i++])
    }

    lines.push({
      text:     group.map(t => t.word).join(' '),
      startSrt: group[0].startSrt,
      endSrt:   group[group.length - 1].endSrt,
      startMs:  group[0].startMs,
      endMs:    group[group.length - 1].endMs,
    })
  }

  return lines
}

// ─── Style helpers ────────────────────────────────────────────────────────────

type EffectiveStyle = Omit<Template, 'id' | 'name'>

export function resolveStyle(template: Template, overrides?: Subtitle['overrides']): EffectiveStyle {
  if (!overrides) return template
  return { ...template, ...overrides }
}

function buildStyleLine(name: string, t: EffectiveStyle): string {
  const primary   = hexToAss(t.primaryColor)
  const secondary = hexToAss(t.secondaryColor)
  const outline   = hexToAss(t.outlineColor)
  const back      = hexToAss(t.backColor, 128)
  const bold      = t.bold ? -1 : 0
  const italic    = t.italic ? -1 : 0
  return [
    'Style: ' + name,
    t.fontName, t.fontSize,
    primary, secondary, outline, back,
    bold, italic, 0, 0,
    t.scaleX, t.scaleY, t.spacing, 0,
    1, t.outline, t.shadow, t.alignment,
    t.marginL, t.marginR, t.marginV, 1,
  ].join(',')
}

function buildInlineTags(style: EffectiveStyle, base: Template): string {
  const tags: string[] = []
  if (style.fontName     !== base.fontName)     tags.push('\\fn' + style.fontName)
  if (style.fontSize     !== base.fontSize)     tags.push('\\fs' + style.fontSize)
  if (style.bold         !== base.bold)         tags.push(style.bold ? '\\b1' : '\\b0')
  if (style.italic       !== base.italic)       tags.push(style.italic ? '\\i1' : '\\i0')
  if (style.primaryColor !== base.primaryColor) tags.push('\\c' + hexToAss(style.primaryColor))
  if (style.outlineColor !== base.outlineColor) tags.push('\\3c' + hexToAss(style.outlineColor))
  if (style.outline      !== base.outline)      tags.push('\\bord' + style.outline)
  if (style.shadow       !== base.shadow)       tags.push('\\shad' + style.shadow)
  if (style.alignment    !== base.alignment)    tags.push('\\an' + style.alignment)
  return tags.length > 0 ? '{' + tags.join('') + '}' : ''
}

// ─── Main ASS builder ─────────────────────────────────────────────────────────

export function buildAss(subtitles: Subtitle[], template: Template): string {
  const lines: string[] = []
  lines.push('[Script Info]')
  lines.push('Title: Subtitles')
  lines.push('ScriptType: v4.00+')
  lines.push('Collisions: Normal')
  lines.push('WrapStyle: 0')
  lines.push('')
  lines.push('[V4+ Styles]')
  lines.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, ' +
    'OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ' +
    'ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, ' +
    'Alignment, MarginL, MarginR, MarginV, Encoding'
  )
  lines.push(buildStyleLine('Default', template))
  lines.push('')
  lines.push('[Events]')
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')
  lines.push(...buildPlainEvents(subtitles, template))
  return lines.join('\n')
}

// ─── Animation tag builder ───────────────────────────────────────────────────
//
// Returns ASS override tag string(s) to prepend to each dialogue event's text.
// All tags are self-contained per-event and work cleanly with libass/FFmpeg.
//
// fade:     \fad(inMs, outMs)  — cross-fade in/out, clamped to half event duration
//
// pop:      \fscx50\fscy50 + \t(0,150,\fscx100\fscy100)
//           Scale from 50%→100% over 150ms with a short fade-in to smooth the edge.
//
// slide-up: \move(x, yStart, x, yEnd, 0, slideMs)
//           Moves the line from (yStart = natural Y + slideOffsetPx) to its natural
//           Y position over slideMs. PlayResX/Y are set to 1920×1080 in the header;
//           libass scales these coords to the actual video resolution automatically.
//           X is fixed at the horizontal centre (960). Y is derived from alignment:
//             bottom (an1-3): natural Y = 1080 - marginV, slides up from +slideOffset
//             middle (an4-6): natural Y = 540,            slides up from +slideOffset
//             top    (an7-9): natural Y = marginV,        slides down from -slideOffset
//           A fade-in is added so the start frame isn't a hard cut.

// Script resolution constants (libass native 384x288)
// Font sizes defined by the user are relative to this resolution.
// All \pos/\move coords must be converted from video pixels to script coords.
const SCRIPT_W = 384
const SCRIPT_H = 288
function toScriptX(px: number, videoWidth:  number): number { return Math.round(px * SCRIPT_W / videoWidth)  }
function toScriptY(px: number, videoHeight: number): number { return Math.round(px * SCRIPT_H / videoHeight) }

function buildAnimationTag(
  animation: AnimationMode,
  eventDurationMs: number,
  alignment: number = 2,
  marginV: number = 20,
  fontSize: number = 24,
): string {
  if (animation === 'none' || !animation) return ''

  if (animation === 'fade') {
    const half    = Math.floor(eventDurationMs / 2)
    const fadeIn  = Math.min(80, half)
    const fadeOut = Math.min(80, half)
    return `{\\fad(${fadeIn},${fadeOut})}`
  }

  if (animation === 'pop') {
    const popMs  = Math.min(150, eventDurationMs)
    const fadeIn = Math.min(60, Math.floor(eventDurationMs / 2))
    return `{\\fad(${fadeIn},0)\\fscx50\\fscy50\\t(0,${popMs},\\fscx100\\fscy100)}`
  }

  if (animation === 'slide-up') {
    const slideMs    = Math.min(180, eventDurationMs)
    const fadeIn     = Math.min(80, Math.floor(eventDurationMs / 2))
    // All coords in 384x288 script space (libass default, no PlayRes override).
    // marginV in the style is also in script units so it maps directly.
    const slideOffset = 12  // ~40px at 1080p equivalent in 288p script space
    const lineHeight  = Math.round(fontSize * 1.4)
    const cx          = 192  // horizontal centre of 384px script width
    const row = alignment <= 3 ? 'bottom' : alignment <= 6 ? 'middle' : 'top'

    let yEnd: number, yStart: number
    if (row === 'bottom') {
      yEnd   = SCRIPT_H - marginV - lineHeight
      yStart = yEnd + slideOffset
    } else if (row === 'middle') {
      yEnd   = Math.round(SCRIPT_H / 2)
      yStart = yEnd + slideOffset
    } else {
      yEnd   = marginV + lineHeight
      yStart = yEnd - slideOffset
    }

    return `{\\fad(${fadeIn},0)\\move(${cx},${yStart},${cx},${yEnd},0,${slideMs})}`
  }

  return ''
}

// ─── Typewriter event builder ─────────────────────────────────────────────────
//
// Typewriter cannot be expressed as a single per-event tag — it requires one
// dialogue event per character, each starting charDelayMs after the previous,
// all ending at the line's natural end time. The result is a classic left-to-right
// character reveal. charDelayMs is clamped so the full reveal fits within the
// event duration (min 30ms, max 80ms per character).

function buildTypewriterEvents(
  text: string,
  startAss: string,
  endAss: string,
  startMs: number,
  endMs: number,
  tags: string
): string[] {
  const chars = [...text]  // spread handles multi-byte / emoji correctly
  if (chars.length === 0) return []

  const totalMs     = endMs - startMs
  const rawDelay    = Math.floor(totalMs / chars.length)
  const charDelayMs = Math.max(30, Math.min(80, rawDelay))
  const events: string[] = []

  for (let i = 0; i < chars.length; i++) {
    const charStartMs = Math.min(startMs + i * charDelayMs, endMs - 1)
    // Each event ends when the NEXT character starts, except the last which
    // holds until the full line ends. This prevents all partial states from
    // being visible simultaneously (which caused the reverse-stack visual).
    const charEndMs = i === chars.length - 1
      ? endMs
      : Math.min(startMs + (i + 1) * charDelayMs, endMs)
    const charStart = msToAssTime(charStartMs)
    const charEnd   = msToAssTime(charEndMs)
    const partial   = chars.slice(0, i + 1).join('')
    events.push(
      'Dialogue: 0,' + charStart + ',' + charEnd + ',Default,,0,0,0,,' + tags + partial
    )
  }

  return events
}

// ─── Plain events─────────────────────────────────────────

// ─── posX/posY → \pos tag ────────────────────────────────────────────────────
// posX/posY are stored as % (0–100) of the video frame.
// ASS script space is 384×288 (SCRIPT_W × SCRIPT_H).
// We convert directly: posX% → script X, posY% → script Y.
// When set, emit \an5 (centre-anchor) + \pos so the subtitle is centred on
// the dragged point. When not set, the style's alignment + margins apply.

function buildPosTag(template: Template): string {
  const px = (template as any).posX as number | undefined
  const py = (template as any).posY as number | undefined
  if (px == null || py == null) return ''
  const x = Math.round((px / 100) * SCRIPT_W)
  const y = Math.round((py / 100) * SCRIPT_H)
  // \an5 = centre-anchor so the subtitle centres on the given point
  return `{\an5\pos(${x},${y})}`
}

// ─── Plain events ────────────────────────────────────────────────────────────
// Iterates the already-grouped display subtitles directly.
// Grouping is done upstream (applyDensityRatio / manual merge), NOT here.
// Timing correction (syncOffset) is the only transformation applied at burn time.

function buildPlainEvents(subtitles: Subtitle[], template: Template): string[] {
  const events: string[] = []
  const syncOffset = template.syncOffset ?? 50

  // Convert each display subtitle into a Line for timing correction.
  const lines: Line[] = subtitles
    .filter(sub => sub.text.trim().length > 0)
    .map(sub => ({
      text:     sub.text.trim(),
      startSrt: sub.start,
      endSrt:   sub.end,
      startMs:  srtToMs(sub.start),
      endMs:    srtToMs(sub.end),
    }))

  const corrected = applyTimingCorrection(lines, syncOffset)

  // Build override lookup keyed by original (pre-correction) start timestamp.
  const overrideMap = new Map<string, Subtitle['overrides']>()
  for (const sub of subtitles) {
    if (sub.overrides) overrideMap.set(sub.start, sub.overrides)
  }

  for (let i = 0; i < corrected.length; i++) {
    const line       = corrected[i]
    const origStart  = subtitles.filter(s => s.text.trim().length > 0)[i]?.start ?? line.startSrt
    const overrides  = overrideMap.get(origStart)
    const style      = resolveStyle(template, overrides)
    const start      = srtTimeToAss(line.startSrt)
    const end        = srtTimeToAss(line.endSrt)
    const text       = line.text.replace(/\{/g, '\\{').replace(/\}/g, '\\}')
    const durationMs = line.endMs - line.startMs
    const posTag     = buildPosTag(template)
    const tags       = posTag + buildInlineTags(style, template)
    const animTag    = buildAnimationTag(
      template.animation,
      durationMs,
      style.alignment ?? template.alignment,
      style.marginV   ?? template.marginV,
      style.fontSize  ?? template.fontSize,
    )
    if (template.animation === 'typewriter') {
      events.push(...buildTypewriterEvents(
        text, start, end,
        line.startMs, line.endMs,
        tags
      ))
    } else {
      events.push('Dialogue: 0,' + start + ',' + end + ',Default,,0,0,0,,' + animTag + tags + text)
    }
  }

  return events
}


// ─── SRT parser (raw — word per block) ───────────────────────────────────────
// Parses the raw whisper SRT into one Subtitle per word-token.
// Does NOT group. Used to store the original tokens for re-processing.

export function parseSRT(content: string): Subtitle[] {
  const blocks = content.trim().split(/\n\n+/)
  return blocks
    .map((block, i) => {
      const lines = block.trim().split('\n')
      if (lines.length < 3) return null
      const timingParts = lines[1].split(' --> ')
      if (timingParts.length !== 2) return null
      const [start, end] = timingParts
      const text = lines.slice(2).join(' ').trim()
      if (!text) return null
      return { index: i + 1, start: start.trim(), end: end.trim(), text, originalText: text } as Subtitle
    })
    .filter((s): s is Subtitle => s !== null)
}

// ─── Pause group extraction ───────────────────────────────────────────────────
// Groups raw word-tokens (one per whisper block) into pause groups.
// A pause group is a sequence of words with no gap >= cutMs between them.
// Capital letters and punctuation are NOT used as break signals here —
// those are presentation concerns handled by density grouping.

export function extractPauseGroups(rawSubs: Subtitle[], cutMs = 800): Token[][] {
  const tokens = buildTokens(rawSubs)
  if (tokens.length === 0) return []

  const groups: Token[][] = []
  let current: Token[] = [tokens[0]]

  for (let i = 1; i < tokens.length; i++) {
    const gap = tokens[i].startMs - tokens[i - 1].endMs
    if (gap >= cutMs) {
      groups.push(current)
      current = [tokens[i]]
    } else {
      current.push(tokens[i])
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

// ─── Density-based grouping ───────────────────────────────────────────────────
// Takes pause groups and a density ratio (0–1).
//   ratio = 0 → one word per segment (maximum granularity)
//   ratio = 1 → one segment per pause group (minimum granularity)
// In between, each pause group is subdivided proportionally.
// Default ratio 0.4 gives roughly 2–3 words per segment.

export function applyDensityRatio(pauseGroups: Token[][], ratio: number): Subtitle[] {
  const r = Math.max(0, Math.min(1, ratio))
  const subtitles: Subtitle[] = []
  let idx = 1

  for (const group of pauseGroups) {
    if (group.length === 0) continue

    // Compute words per segment for this group.
    // At ratio=0: 1 word. At ratio=1: all words.
    // Use ceil so we always include all words.
    const wordsPerSeg = Math.max(1, Math.ceil(r * group.length))

    for (let i = 0; i < group.length; i += wordsPerSeg) {
      const slice = group.slice(i, i + wordsPerSeg)
      const text  = slice.map(t => t.word).join(' ')
      subtitles.push({
        index:        idx++,
        start:        slice[0].startSrt,
        end:          slice[slice.length - 1].endSrt,
        text,
        originalText: text,
      })
    }
  }

  return subtitles
}

// ─── Merge two adjacent segments ─────────────────────────────────────────────
// Returns a new subtitles array with segment at index i merged into i+1.

export function mergeSegments(subtitles: Subtitle[], i: number): Subtitle[] {
  if (i < 0 || i >= subtitles.length - 1) return subtitles
  const a = subtitles[i], b = subtitles[i + 1]
  const merged: Subtitle = {
    index:        a.index,
    start:        a.start,
    end:          b.end,
    text:         (a.text + ' ' + b.text).trim(),
    originalText: (a.originalText + ' ' + b.originalText).trim(),
  }
  const result = [...subtitles.slice(0, i), merged, ...subtitles.slice(i + 2)]
  return result.map((s, j) => ({ ...s, index: j + 1 }))
}

// ─── Insert empty segment after index i ──────────────────────────────────────
// Inserts a blank segment after i, inheriting the boundary time of the next segment.

export function insertSegmentAfter(subtitles: Subtitle[], i: number): Subtitle[] {
  const prev = subtitles[i]
  const next = subtitles[i + 1]
  // New segment occupies a thin slice of time right after prev
  const prevEndMs  = assTimeToMs(srtTimeToAss(prev.end))
  const nextStartMs = next ? assTimeToMs(srtTimeToAss(next.start)) : prevEndMs + 2000
  // Give it a 500ms window, or half the gap, whichever is smaller
  const gapMs      = nextStartMs - prevEndMs
  const newEndMs   = prevEndMs + Math.min(500, Math.max(100, Math.floor(gapMs / 2)))
  const newSub: Subtitle = {
    index:        0,
    start:        msToSrt(prevEndMs),
    end:          msToSrt(newEndMs),
    text:         '',
    originalText: '',
  }
  const result = [...subtitles.slice(0, i + 1), newSub, ...subtitles.slice(i + 1)]
  return result.map((s, j) => ({ ...s, index: j + 1 }))
}

export function serializeSRT(subtitles: Subtitle[]): string {
  return subtitles
    .map(s => `${s.index}\n${s.start} --> ${s.end}\n${s.text}`)
    .join('\n\n') + '\n'
}