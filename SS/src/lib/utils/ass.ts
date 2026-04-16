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

// ─── Build token list from raw subtitles ──────────────────────────────────────
// Treats each subtitle's text as a single token.
// Contraction merging handles "'s", "'t", "'re" etc.
// Used by extractPauseGroups to split raw whisper output into typed tokens.

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
  const bold      = t.bold ? -1 : 0
  const italic    = t.italic ? -1 : 0

  if ((t as any).lineBgEnabled) {
    // BorderStyle 3 = opaque box behind the text.
    // BackColour (field 8) is the box fill color.
    // In BorderStyle=3, \bord controls the size of the box padding on all sides
    // (libass extends the box by \bord pixels in every direction around the glyphs).
    // We bake a base \bord=0 here and apply the real padding per-event via inline \bord.
    const bgColor = hexToAss((t as any).lineBgColor ?? '#000000', 0)
    return [
      'Style: ' + name,
      t.fontName, t.fontSize,
      primary, secondary, outline, bgColor,
      bold, italic, 0, 0,
      t.scaleX, t.scaleY, t.spacing, 0,
      3, 0, 0, t.alignment,
      t.marginL, t.marginR, t.marginV, 1,
    ].join(',')
  }

  const back = hexToAss(t.backColor, 128)
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

// ─── Text pre-processing ────────────────────────────────────────────────────────────────────────────
//
// Applies textTransform, hidePunctuation, and wordSpacing to segment text
// before it is written into a Dialogue event.
//
// wordSpacing: ASS has no word-spacing property. We approximate it by inserting
// extra ASS hard-space characters (\h) between words. Each \h is one em-width
// non-breaking space in libass. wordSpacing (0–20 from the UI slider) is rounded
// to a whole number of \h chars, clamped to 8 maximum.
//
// lineSpacing: No ASS equivalent exists. Affecting line height in libass requires
// \fscx/\fscy which distorts glyphs. lineSpacing is therefore preview-only.

function applyTextTransforms(rawText: string, style: EffectiveStyle): string {
  let t = rawText

  if (style.textTransform === 'uppercase') t = t.toUpperCase()
  else if (style.textTransform === 'lowercase') t = t.toLowerCase()

  if (style.hidePunctuation) t = t.replace(/[.!?,;:]/g, '')

  const extraSpaces = Math.min(8, Math.max(0, Math.round(style.wordSpacing ?? 0)))
  if (extraSpaces > 0) {
    const pad = '\\h'.repeat(extraSpaces)
    t = t.split(/\s+/).join(' ' + pad)
  }

  return t
}

// ─── Main ASS builder ─────────────────────────────────────────────────────────

export function buildAss(subtitles: Subtitle[], template: Template, rawSubs: Subtitle[] = []): string {
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
  lines.push(...buildPlainEvents(subtitles, template, rawSubs))
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
  return `{\\an5\\pos(${x},${y})}`
}

// ─── Plain events ────────────────────────────────────────────────────────────
// Iterates the already-grouped display subtitles directly.
// Grouping is done upstream (applyDensityRatio / manual merge), NOT here.
// Timing correction (syncOffset) is the only transformation applied at burn time.
//
// Active word color highlight:
// When activeWordColor differs from primaryColor, each segment emits a Layer 0
// base event plus one Layer 1 event per word, both anchored with identical \pos
// to prevent libass collision avoidance from displacing them.
//
// Line background:
// When lineBgEnabled, the Default style uses BorderStyle 3 (opaque box).
// The \bord inline tag per-event controls the padding around the text.

function buildPlainEvents(subtitles: Subtitle[], template: Template, rawSubs: Subtitle[] = []): string[] {
  const events: string[] = []
  const syncOffset = template.syncOffset ?? 50

  const needsWordHighlight = (template.activeWordColor !== template.primaryColor)
  const lineBgEnabled      = (template as any).lineBgEnabled as boolean | undefined

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

  // Pre-apply the same syncOffset to rawSubs so word windows stay aligned
  // with the corrected display lines.
  const rawLines: Line[] = rawSubs
    .filter(sub => sub.text.trim().length > 0)
    .map(sub => ({
      text:     sub.text.trim(),
      startSrt: sub.start,
      endSrt:   sub.end,
      startMs:  srtToMs(sub.start),
      endMs:    srtToMs(sub.end),
    }))
  // Simple offset shift for word-level tokens used in active word highlight.
  const correctedRaw: Line[] = needsWordHighlight
    ? rawLines.map(r => ({ ...r, startMs: r.startMs + syncOffset, endMs: r.endMs + syncOffset }))
    : []

  for (let i = 0; i < corrected.length; i++) {
    const line       = corrected[i]
    const origStart  = subtitles.filter(s => s.text.trim().length > 0)[i]?.start ?? line.startSrt
    const overrides  = overrideMap.get(origStart)
    const style      = resolveStyle(template, overrides)
    const start      = srtTimeToAss(line.startSrt)
    const end        = srtTimeToAss(line.endSrt)
    const transformed = applyTextTransforms(line.text, style)
    const text        = transformed.replace(/\{/g, '\\{').replace(/\}/g, '\\}')
    const durationMs  = line.endMs - line.startMs
    const posTag      = buildPosTag(template)
    const durationMs_ = durationMs  // alias for clarity

    // Line background padding: when lineBgEnabled, the style has BorderStyle=3.
    // In BorderStyle=3, \bord N expands the opaque box by N script-pixels on all
    // sides around the glyphs — this IS the padding. We compute it from the
    // user's paddingX/Y sliders (em-relative), converting to script-space pixels.
    // \be N blurs the box edges: \be0 = sharp corners, \be2+ = soft/rounded look.
    const lineBgPad = lineBgEnabled
      ? (() => {
          const fs   = style.fontSize ?? template.fontSize ?? 24
          const padX = Math.max(1, Math.round(((template as any).lineBgPaddingX ?? 0.5) * fs))
          const padY = Math.max(1, Math.round(((template as any).lineBgPaddingY ?? 0.2) * fs))
          // Use the average for a single uniform \bord value (ASS BorderStyle=3
          // does not support independent X/Y box expansion in standard libass).
          const bord    = Math.round((padX + padY) / 2)
          const rounded = (template as any).lineBgRounded ?? false
          const be      = rounded ? '\\be3' : '\\be0'
          return '{\\bord' + bord + be + '}'
        })()
      : ''

    const inlineTags = buildInlineTags(style, template)
    const tags       = posTag + inlineTags
    const animTag    = buildAnimationTag(
      template.animation,
      durationMs,
      style.alignment ?? template.alignment,
      style.marginV   ?? template.marginV,
      style.fontSize  ?? template.fontSize,
    )

    // Typewriter: no word highlight, emit as-is.
    if (template.animation === 'typewriter') {
      events.push(...buildTypewriterEvents(
        text, start, end,
        line.startMs, line.endMs,
        lineBgPad + tags
      ))
      continue
    }

    if (!needsWordHighlight) {
      events.push('Dialogue: 0,' + start + ',' + end + ',Default,,0,0,0,,' + animTag + lineBgPad + tags + text)
      continue
    }

    // ── Active word color highlight ───────────────────────────────────────────
    // Layer 0: full line, base color, anchored with \pos.
    // Layer 1: per-word-window events with identical \pos, full line text,
    //   non-active words invisible (\alpha&HFF&), active word in activeWordColor.
    //
    // Both layers use the same \pos so libass overlays them without collision.

    const al  = style.alignment ?? template.alignment
    const mV  = style.marginV   ?? template.marginV
    const mL  = style.marginL   ?? template.marginL
    const mR  = style.marginR   ?? template.marginR
    const apX = [1,4,7].includes(al) ? mL
              : [3,6,9].includes(al) ? SCRIPT_W - mR
              : SCRIPT_W / 2
    const apY = al <= 3 ? SCRIPT_H - mV
              : al <= 6 ? SCRIPT_H / 2
              : mV
    // String concatenation — template literals drop \a, \p backslashes.
    const alignPosTag = posTag !== ''
      ? posTag
      : '{\\an' + al + '\\pos(' + Math.round(apX) + ',' + Math.round(apY) + ')}'
    // Strip \an from inlineTags — alignPosTag already sets it.
    const tagsNoAn = inlineTags.replace(/\{([^}]*)\\an\d([^}]*)\}/g, (_, pre, post) => {
      const inner = (pre + post).trim(); return inner ? '{' + inner + '}' : ''
    })

    // Layer 0: base line
    events.push('Dialogue: 0,' + start + ',' + end + ',Default,,0,0,0,,' + animTag + lineBgPad + alignPosTag + tagsNoAn + text)

    const segStartMs = line.startMs
    const segEndMs   = line.endMs
    const wordTokens = correctedRaw.filter(r =>
      r.startMs >= segStartMs - 50 && r.startMs <= segEndMs + 50
    )
    const words       = text.split(' ')
    const activeColor = hexToAss(template.activeWordColor ?? template.primaryColor)
    const INVIS       = '{\\alpha&HFF&\\3a&HFF&}'

    for (let wi = 0; wi < words.length; wi++) {
      const token = wordTokens[wi]
      if (!token) continue

      const wordStartMs = Math.max(token.startMs, segStartMs)
      const nextStart   = wordTokens[wi + 1]?.startMs ?? segEndMs
      const wordEndMs   = Math.min(nextStart, segEndMs)
      if (wordStartMs >= wordEndMs) continue

      const wStart = msToAssTime(wordStartMs)
      const wEnd   = msToAssTime(wordEndMs)

      // Full line with non-active words invisible, active word in activeWordColor.
      let lineText = ''
      let inInvis  = false
      for (let wj = 0; wj < words.length; wj++) {
        if (wj > 0) lineText += ' '
        if (wj === wi) {
          lineText += '{\\c' + activeColor + '\\alpha&H00&\\1a&H00&\\3a&H00&}' + words[wj]
          inInvis = false
          if (wj < words.length - 1) { lineText += '{\\alpha&HFF&\\3a&HFF&}'; inInvis = true }
        } else {
          if (!inInvis) { lineText += INVIS; inInvis = true }
          lineText += words[wj]
        }
      }

      events.push('Dialogue: 1,' + wStart + ',' + wEnd + ',Default,,0,0,0,,' + lineBgPad + alignPosTag + tagsNoAn + lineText)
    }
  }

  return events
}


// ─── SRT parser
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

// ─── Clause / micro-pause extraction ─────────────────────────────────────────
//
// Three-level hierarchy that drives the density slider, built entirely from
// timing gaps in whisper's word timestamps. No punctuation is used because
// whisper often strips it or attaches it inconsistently across versions.
//
//   Clause      — maximal run of words with no inter-word gap ≥ CLAUSE_CUT_MS.
//                 This is the maximum segment size (ratio = 1). In practice
//                 500 ms captures natural sentence-boundary pauses reliably.
//
//   Micro-pause — gap ≥ MICRO_CUT_MS within a clause, used to subdivide it
//                 when the slider is in the middle range (≈ 0.5).
//                 80 ms catches brief hesitations within a phrase.
//
//   Word        — single token, the minimum unit (ratio = 0).
//
// Slider mapping:
//   ratio = 0.0  → 1 word per segment
//   ratio = 0.5  → 1 micro-pause group per segment
//   ratio = 1.0  → 1 full clause per segment
//
// Between anchor points the groups are merged/split proportionally.

const CLAUSE_CUT_MS = 500   // gap ≥ this → new clause (sentence boundary)
const MICRO_CUT_MS  = 80    // gap ≥ this within a clause → micro-pause group

export interface PauseGroups {
  clauses: Token[][]        // top level — one entry per clause
  micros:  Token[][][]      // micros[i] = micro-pause sub-groups within clause i
}

export function extractPauseGroups(rawSubs: Subtitle[]): PauseGroups {
  const tokens = buildTokens(rawSubs)
  if (tokens.length === 0) return { clauses: [], micros: [] }

  const clauses: Token[][] = []
  const micros:  Token[][][] = []

  let clauseBuf: Token[] = []

  const flushClause = () => {
    if (clauseBuf.length === 0) return
    clauses.push([...clauseBuf])

    // Split this clause into micro-pause groups by MICRO_CUT_MS gaps
    const mGroups: Token[][] = []
    let mBuf: Token[] = [clauseBuf[0]]
    for (let j = 1; j < clauseBuf.length; j++) {
      const gap = clauseBuf[j].startMs - clauseBuf[j - 1].endMs
      if (gap >= MICRO_CUT_MS) {
        mGroups.push([...mBuf])
        mBuf = [clauseBuf[j]]
      } else {
        mBuf.push(clauseBuf[j])
      }
    }
    if (mBuf.length > 0) mGroups.push(mBuf)
    micros.push(mGroups)

    clauseBuf = []
  }

  for (let i = 0; i < tokens.length; i++) {
    if (clauseBuf.length > 0) {
      const gap = tokens[i].startMs - clauseBuf[clauseBuf.length - 1].endMs
      if (gap >= CLAUSE_CUT_MS) flushClause()
    }
    clauseBuf.push(tokens[i])
  }
  flushClause()

  return { clauses, micros }
}

// ─── Density-based grouping ───────────────────────────────────────────────────
//
// ratio = 0.0 → one word per segment
// ratio = 0.5 → one micro-pause group per segment
// ratio = 1.0 → one full clause per segment
//
// The lower half (0–0.5) subdivides micro-pause groups proportionally.
// The upper half (0.5–1.0) merges micro-pause groups up toward full clauses.

function tokensToSubtitle(tokens: Token[], idx: number): Subtitle {
  const text = tokens.map(t => t.word).join(' ')
  return {
    index:        idx,
    start:        tokens[0].startSrt,
    end:          tokens[tokens.length - 1].endSrt,
    text,
    originalText: text,
  }
}

export function applyDensityRatio(groups: PauseGroups, ratio: number): Subtitle[] {
  const r = Math.max(0, Math.min(1, ratio))
  const subtitles: Subtitle[] = []
  let idx = 1

  for (let ci = 0; ci < groups.clauses.length; ci++) {
    const microGroups = groups.micros[ci]  // micro-pause sub-groups within this clause

    if (r >= 0.5) {
      // Upper half: merge micro-groups toward the full clause.
      // r=0.5 → each micro-group is one segment
      // r=1.0 → entire clause is one segment
      //
      // Scale r from [0.5,1] → [0,1] for this range.
      const t = (r - 0.5) * 2  // 0 at r=0.5, 1 at r=1.0

      // Number of output segments = lerp from microGroups.length (t=0) to 1 (t=1)
      const targetSegs = Math.max(1, Math.round(microGroups.length * (1 - t) + 1 * t))
      // Distribute micro-groups into targetSegs buckets as evenly as possible
      const buckets = distributeBuckets(microGroups, targetSegs)
      for (const bucket of buckets) {
        const tokens = bucket.flat()
        if (tokens.length > 0) subtitles.push(tokensToSubtitle(tokens, idx++))
      }
    } else {
      // Lower half: subdivide each micro-group toward single words.
      // r=0.0 → each word is one segment
      // r=0.5 → each micro-group is one segment
      //
      // Scale r from [0,0.5] → [0,1] for this range.
      const t = r * 2  // 0 at r=0, 1 at r=0.5

      for (const mg of microGroups) {
        // Number of output segments = lerp from mg.length (t=0) to 1 (t=1)
        const targetSegs = Math.max(1, Math.round(mg.length * (1 - t) + 1 * t))
        const buckets = distributeBuckets(mg.map(tok => [tok]), targetSegs)
        for (const bucket of buckets) {
          const tokens = bucket.flat()
          if (tokens.length > 0) subtitles.push(tokensToSubtitle(tokens, idx++))
        }
      }
    }
  }

  return subtitles
}

// Distribute `items` into exactly `n` contiguous buckets as evenly as possible.
// Contiguous (not round-robin) so that word order within each segment is preserved.
function distributeBuckets<T>(items: T[], n: number): T[][] {
  const count = Math.min(n, items.length)
  const buckets: T[][] = []
  const base  = Math.floor(items.length / count)
  const extra = items.length % count
  let start = 0
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0)
    buckets.push(items.slice(start, start + size))
    start += size
  }
  return buckets
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