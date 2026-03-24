import type { Template, Subtitle, Alignment } from '../types'

// ─── Color helpers ───────────────────────────────────────────────────────────

/** Convert #RRGGBB or #RRGGBBAA to ASS &HAABBGGRR format */
export function hexToAss(hex: string, alpha = 0): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '&H00FFFFFF'
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  const a = alpha.toString(16).padStart(2, '0').toUpperCase()
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

// ─── Time helpers ────────────────────────────────────────────────────────────

/** "00:00:01,000" → ASS "0:00:01.00" */
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

/** ASS time string → milliseconds */
export function assTimeToMs(assTime: string): number {
  const parts = assTime.split(':')
  if (parts.length !== 3) return 0
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const [secStr, csStr] = parts[2].split('.')
  const sec = parseInt(secStr, 10)
  const cs = parseInt(csStr ?? '0', 10)
  return h * 3600000 + m * 60000 + sec * 1000 + cs * 10
}

/** milliseconds → ASS time string */
export function msToAssTime(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const rem1 = ms % 3600000
  const m = Math.floor(rem1 / 60000)
  const rem2 = rem1 % 60000
  const s = Math.floor(rem2 / 1000)
  const cs = Math.floor((rem2 % 1000) / 10)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

// ─── Effective style resolver ─────────────────────────────────────────────────
// Merges template + per-segment overrides into a flat style object.

type EffectiveStyle = Omit<Template, 'id' | 'name'>

export function resolveStyle(template: Template, overrides?: Subtitle['overrides']): EffectiveStyle {
  if (!overrides) return template
  return { ...template, ...overrides }
}

// ─── ASS Style line builder ───────────────────────────────────────────────────

function buildStyleLine(name: string, t: EffectiveStyle): string {
  const primary  = hexToAss(t.primaryColor)
  const secondary = hexToAss(t.secondaryColor)
  const outline  = hexToAss(t.outlineColor)
  const back     = hexToAss(t.backColor, 128)
  const bold     = t.bold ? -1 : 0
  const italic   = t.italic ? -1 : 0

  // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,
  //         OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,
  //         ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,
  //         Alignment, MarginL, MarginR, MarginV, Encoding
  return [
    `Style: ${name}`,
    t.fontName,
    t.fontSize,
    primary,
    secondary,
    outline,
    back,
    bold,
    italic,
    0, 0,                          // Underline, StrikeOut
    t.scaleX, t.scaleY,
    t.spacing,
    0,                             // Angle
    1,                             // BorderStyle (1 = outline+shadow)
    t.outline,
    t.shadow,
    t.alignment,
    t.marginL, t.marginR, t.marginV,
    1                              // Encoding
  ].join(',')
}

// ─── Main ASS builder ────────────────────────────────────────────────────────

/**
 * Build a complete .ass file string from subtitles + a base template.
 * Per-segment overrides are handled by injecting inline ASS override tags
 * or by emitting named styles for segments that differ from the default.
 */
export function buildAss(subtitles: Subtitle[], template: Template): string {
  // Collect unique style variants needed (default + one per unique override set)
  // For simplicity we inline override tags directly into dialogue lines —
  // this avoids needing to register a style per segment.

  const lines: string[] = []

  // ── Script Info ──
  lines.push('[Script Info]')
  lines.push('Title: Subtitles')
  lines.push('ScriptType: v4.00+')
  lines.push('Collisions: Normal')
  lines.push('WrapStyle: 0')
  lines.push('')

  // ── Styles ──
  lines.push('[V4+ Styles]')
  lines.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, ' +
    'OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ' +
    'ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, ' +
    'Alignment, MarginL, MarginR, MarginV, Encoding'
  )
  lines.push(buildStyleLine('Default', template))
  lines.push('')

  // ── Events ──
  lines.push('[Events]')
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')

  if (template.wordByWord && template.wordMode !== 'none') {
    lines.push(...buildWordByWordEvents(subtitles, template))
  } else {
    lines.push(...buildPlainEvents(subtitles, template))
  }

  return lines.join('\n')
}

// ─── Plain subtitle events ────────────────────────────────────────────────────

function buildPlainEvents(subtitles: Subtitle[], template: Template): string[] {
  const events: string[] = []

  for (const sub of subtitles) {
    const style = resolveStyle(template, sub.overrides)
    const start = srtTimeToAss(sub.start)
    const end   = srtTimeToAss(sub.end)

    // Build inline override tags if this segment differs from template
    const tags = buildInlineTags(style, template)
    const text = sub.text
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\n/g, '\\N')

    events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${tags}${text}`)
  }

  return events
}

// ─── Word-by-word events ──────────────────────────────────────────────────────

function buildWordByWordEvents(subtitles: Subtitle[], template: Template): string[] {
  const events: string[] = []
  const primaryAss   = hexToAss(template.primaryColor)
  const highlightAss = hexToAss(template.highlightColor)

  // Each subtitle is already one word (from whisper token-level output)
  // Step 1: Build raw list with timing
  const raw = subtitles.map(sub => ({
    word: sub.text.trim(),
    start: srtTimeToAss(sub.start),
    end:   srtTimeToAss(sub.end),
    startMs: assTimeToMs(srtTimeToAss(sub.start)),
    endMs:   assTimeToMs(srtTimeToAss(sub.end)),
  }))

  // Step 2: Merge contraction suffixes ('re, 'll, 've, 't, 's, 'd, 'm) into previous word
  const merged: typeof raw = []
  for (const token of raw) {
    const isContraction = /^'[a-z]+$/i.test(token.word)
    if (isContraction && merged.length > 0) {
      const prev = merged[merged.length - 1]
      merged[merged.length - 1] = {
        ...prev,
        word: prev.word + token.word,
        end: token.end,
        endMs: token.endMs,
      }
    } else {
      merged.push(token)
    }
  }

  // Step 3: Strip punctuation, keep only tokens with actual word characters
  const words = merged.map(w => ({
    ...w,
    word: w.word.replace(/[^\w']/g, '').trim()
  })).filter(w => w.word.length > 0 && /\w/.test(w.word))

  let i = 0
  while (i < words.length) {
    const sentence: typeof words = []

    while (i < words.length && sentence.length < 8) {
      sentence.push(words[i])
      i++
      if (sentence.length > 1) {
        const duration = sentence[sentence.length - 1].endMs - sentence[0].startMs
        if (duration > 5000) break
      }
    }

    if (sentence.length === 0) continue

    if (template.wordMode === 'highlight') {
      // One dialogue line per word — shows full sentence, highlights active word
      for (let wi = 0; wi < sentence.length; wi++) {
        const { start, end } = sentence[wi]
        let text = ''
        for (let j = 0; j < sentence.length; j++) {
          if (j === wi) {
            text += `{\\c${highlightAss}}${sentence[j].word}{\\c${primaryAss}}`
          } else {
            text += sentence[j].word
          }
          if (j < sentence.length - 1) text += ' '
        }
        events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`)
      }
    } else if (template.wordMode === 'solo') {
      // One word visible at a time, highlighted
      for (const { word, start, end } of sentence) {
        events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,{\\c${highlightAss}}${word}`)
      }
    }
  }

  return events
}

// ─── Inline override tag builder ─────────────────────────────────────────────
// Compares resolved style against template and emits only the tags that differ.

function buildInlineTags(style: EffectiveStyle, base: Template): string {
  const tags: string[] = []

  if (style.fontName    !== base.fontName)    tags.push(`\\fn${style.fontName}`)
  if (style.fontSize    !== base.fontSize)    tags.push(`\\fs${style.fontSize}`)
  if (style.bold        !== base.bold)        tags.push(style.bold ? '\\b1' : '\\b0')
  if (style.italic      !== base.italic)      tags.push(style.italic ? '\\i1' : '\\i0')
  if (style.primaryColor !== base.primaryColor) tags.push(`\\c${hexToAss(style.primaryColor)}`)
  if (style.outlineColor !== base.outlineColor) tags.push(`\\3c${hexToAss(style.outlineColor)}`)
  if (style.outline     !== base.outline)     tags.push(`\\bord${style.outline}`)
  if (style.shadow      !== base.shadow)      tags.push(`\\shad${style.shadow}`)
  if (style.alignment   !== base.alignment)   tags.push(`\\an${style.alignment}`)

  return tags.length > 0 ? `{${tags.join('')}}` : ''
}

// ─── SRT parser ──────────────────────────────────────────────────────────────

export function parseSRT(content: string): Subtitle[] {
  const blocks = content.trim().split(/\n\n+/)
  return blocks
    .map(block => {
      const lines = block.trim().split('\n')
      if (lines.length < 3) return null
      const index = parseInt(lines[0], 10)
      const timingParts = lines[1].split(' --> ')
      if (timingParts.length !== 2) return null
      const [start, end] = timingParts
      const text = lines.slice(2).join('\n')
      return { index, start: start.trim(), end: end.trim(), text, originalText: text } as Subtitle
    })
    .filter((s): s is Subtitle => s !== null)
}

/** Serialize subtitles back to SRT string */
export function serializeSRT(subtitles: Subtitle[]): string {
  return subtitles
    .map(s => `${s.index}\n${s.start} --> ${s.end}\n${s.text}`)
    .join('\n\n') + '\n'
}