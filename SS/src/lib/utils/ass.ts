import type { Template, Subtitle } from '../types'

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
  const cs = parseInt(csStr ?? '0', 10)
  return h * 3600000 + m * 60000 + sec * 1000 + cs * 10
}

export function msToAssTime(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const rem1 = ms % 3600000
  const m = Math.floor(rem1 / 60000)
  const rem2 = rem1 % 60000
  const s = Math.floor(rem2 / 1000)
  const cs = Math.floor((rem2 % 1000) / 10)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

// ─── Token type ───────────────────────────────────────────────────────────────

interface Token {
  word: string
  rawWord: string
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
// Distributes a segment's duration across its words proportionally by character
// length, so longer/harder words get more screen time than short ones.
// MIN_WORD_MS is set to 250 so that every word window is wide enough to be
// caught by the video element's timeupdate event (~250 ms fire rate).

const MIN_WORD_MS = 250   // must be >= typical timeupdate interval
const MAX_WORD_MS = 1500

export function distributeWordTimings(
  words: string[],
  startMs: number,
  endMs: number
): Array<{ startMs: number; endMs: number }> {
  if (words.length === 0) return []
  if (words.length === 1) return [{ startMs, endMs }]

  const totalMs = endMs - startMs
  const lengths = words.map(w => Math.max(w.length, 1))
  const totalLen = lengths.reduce((a, b) => a + b, 0)

  // First pass: proportional durations
  const durations = lengths.map(len => (len / totalLen) * totalMs)

  // Second pass: clamp each word, track overflow/underflow
  let surplus = 0
  const clamped = durations.map(d => {
    const c = Math.max(MIN_WORD_MS, Math.min(MAX_WORD_MS, d))
    surplus += d - c
    return c
  })

  // Third pass: redistribute surplus to unclamped words
  let iterations = 0
  while (Math.abs(surplus) > 1 && iterations++ < 5) {
    const unclamped = clamped.map((c, i) =>
      (surplus > 0 && c < MAX_WORD_MS) || (surplus < 0 && c > MIN_WORD_MS) ? i : -1
    ).filter(i => i >= 0)

    if (unclamped.length === 0) break
    const share = surplus / unclamped.length
    surplus = 0
    for (const i of unclamped) {
      const next = Math.max(MIN_WORD_MS, Math.min(MAX_WORD_MS, clamped[i] + share))
      surplus += clamped[i] + share - next
      clamped[i] = next
    }
  }

  // Build absolute timestamps
  const result: Array<{ startMs: number; endMs: number }> = []
  let cursor = startMs
  for (let i = 0; i < words.length; i++) {
    const wStart = Math.round(cursor)
    const wEnd = i === words.length - 1
      ? endMs
      : Math.round(cursor + clamped[i])
    result.push({ startMs: wStart, endMs: wEnd })
    cursor += clamped[i]
  }
  return result
}

// ─── Build token list from raw subtitles ──────────────────────────────────────

function buildTokens(subtitles: Subtitle[]): Token[] {
  const raw: Token[] = subtitles.map(sub => ({
    word: sub.text.trim(),
    rawWord: sub.text.trim(),
    startSrt: sub.start,
    endSrt: sub.end,
    startMs: assTimeToMs(srtTimeToAss(sub.start)),
    endMs: assTimeToMs(srtTimeToAss(sub.end)),
  }))

  // Merge contraction suffixes
  const merged: Token[] = []
  for (const token of raw) {
    const isContraction = /^'[a-z]+$/i.test(token.word)
    if (isContraction && merged.length > 0) {
      const prev = merged[merged.length - 1]
      merged[merged.length - 1] = {
        ...prev,
        word: prev.word + token.word,
        endSrt: token.endSrt,
        endMs: token.endMs,
      }
    } else {
      merged.push(token)
    }
  }

  return merged
    .map(t => ({ ...t, rawWord: t.word, word: cleanWord(t.word) }))
    .filter(t => isValidWord(t.word))
}

// ─── Group tokens into natural subtitle lines ─────────────────────────────────

interface Line {
  text: string
  startSrt: string
  endSrt: string
  startMs: number
  endMs: number
}

function groupIntoLines(tokens: Token[], maxWords = 7, maxMs = 4000): Line[] {
  const lines: Line[] = []
  let i = 0

  while (i < tokens.length) {
    const group: Token[] = []

    while (i < tokens.length && group.length < maxWords) {
      const token = tokens[i]
      const lastRaw = group.length > 0 ? group[group.length - 1].rawWord : ''

      // Only break on a capital letter if the previous token ended a sentence.
      // This prevents "I", proper nouns, and whisper mid-sentence capitalisation
      // from fragmenting lines into single words.
      const prevEndedSentence = /[.!?]$/.test(lastRaw)
      if (group.length > 0 && prevEndedSentence && /^[A-Z]/.test(token.word)) break

      group.push(token)
      i++

      const currentRaw = group[group.length - 1].rawWord

      // Hard break on sentence-ending punctuation
      if (/[.!?]$/.test(currentRaw)) break

      // Soft break on clause-ending punctuation (comma, semicolon, colon)
      // only when we already have a reasonable number of words
      if (group.length >= 4 && /[,;:]$/.test(currentRaw)) break

      // Duration cap — only enforce once we have at least 3 words, so we
      // never emit a 1- or 2-word line purely because the segment is short.
      if (group.length >= 3) {
        const dur = group[group.length - 1].endMs - group[0].startMs
        if (dur > maxMs) break
      }
    }

    if (group.length === 0 && i < tokens.length) {
      group.push(tokens[i++])
    }
    if (group.length === 0) continue

    lines.push({
      text: group.map(t => t.word).join(' '),
      startSrt: group[0].startSrt,
      endSrt: group[group.length - 1].endSrt,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
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
    t.marginL, t.marginR, t.marginV, 1
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

  if (template.wordByWord && template.wordMode !== 'none') {
    lines.push(...buildWordByWordEvents(subtitles, template))
  } else {
    lines.push(...buildPlainEvents(subtitles, template))
  }

  return lines.join('\n')
}

// ─── Plain events ─────────────────────────────────────────────────────────────

function buildPlainEvents(subtitles: Subtitle[], template: Template): string[] {
  const events: string[] = []
  const tokens = buildTokens(subtitles)
  const grouped = groupIntoLines(tokens)

  const overrideMap = new Map<string, Subtitle['overrides']>()
  for (const sub of subtitles) {
    if (sub.overrides) overrideMap.set(sub.start, sub.overrides)
  }

  for (const line of grouped) {
    const overrides = overrideMap.get(line.startSrt)
    const style = resolveStyle(template, overrides)
    const start = srtTimeToAss(line.startSrt)
    const end   = srtTimeToAss(line.endSrt)
    const tags  = buildInlineTags(style, template)
    const text  = line.text.replace(/\{/g, '\\{').replace(/\}/g, '\\}')
    events.push('Dialogue: 0,' + start + ',' + end + ',Default,,0,0,0,,' + tags + text)
  }

  return events
}

// ─── Word-by-word events ──────────────────────────────────────────────────────

function buildWordByWordEvents(subtitles: Subtitle[], template: Template): string[] {
  const events: string[] = []
  const primaryColor   = '{\\c' + hexToAss(template.primaryColor) + '}'
  const highlightColor = '{\\c' + hexToAss(template.highlightColor) + '}'

  // Expand each subtitle line into word tokens with length-weighted timing
  const wordTokens: Token[] = []
  for (const sub of subtitles) {
    const words = sub.text.trim().split(' ').map(cleanWord).filter(isValidWord)
    if (words.length === 0) continue
    const startMs = assTimeToMs(srtTimeToAss(sub.start))
    const endMs   = assTimeToMs(srtTimeToAss(sub.end))
    const timings = distributeWordTimings(words, startMs, endMs)

    words.forEach((word, wi) => {
      wordTokens.push({
        word,
        rawWord: word,
        startSrt: sub.start,
        endSrt: sub.end,
        startMs: timings[wi].startMs,
        endMs: timings[wi].endMs,
      })
    })
  }

  const tokens = wordTokens.filter(t => isValidWord(t.word))

  // Group into display sentences using the same smarter break logic as groupIntoLines
  let i = 0
  while (i < tokens.length) {
    const sentence: Token[] = []

    while (i < tokens.length && sentence.length < 8) {
      const token = tokens[i]
      const lastRaw = sentence.length > 0 ? sentence[sentence.length - 1].rawWord : ''
      const prevEndedSentence = /[.!?]$/.test(lastRaw)

      if (sentence.length > 0 && prevEndedSentence && /^[A-Z]/.test(token.word)) break

      sentence.push(token)
      i++

      const currentRaw = sentence[sentence.length - 1].rawWord
      if (/[.!?]$/.test(currentRaw)) break
      if (sentence.length >= 4 && /[,;:]$/.test(currentRaw)) break

      if (sentence.length >= 3) {
        const dur = sentence[sentence.length - 1].endMs - sentence[0].startMs
        if (dur > 5000) break
      }
    }

    if (sentence.length === 0 && i < tokens.length) {
      sentence.push(tokens[i++])
    }
    if (sentence.length === 0) continue

    if (template.wordMode === 'highlight') {
      for (let wi = 0; wi < sentence.length; wi++) {
        const { startMs, endMs } = sentence[wi]
        let text = ''
        for (let j = 0; j < sentence.length; j++) {
          text += j === wi
            ? highlightColor + sentence[j].word + primaryColor
            : sentence[j].word
          if (j < sentence.length - 1) text += ' '
        }
        // Always open with primaryColor to prevent color bleed from previous event
        events.push(
          'Dialogue: 0,' + msToAssTime(startMs) + ',' + msToAssTime(endMs) +
          ',Default,,0,0,0,,' + primaryColor + text
        )
      }
    } else if (template.wordMode === 'solo') {
      for (const { word, startMs, endMs } of sentence) {
        events.push(
          'Dialogue: 0,' + msToAssTime(startMs) + ',' + msToAssTime(endMs) +
          ',Default,,0,0,0,,' + highlightColor + word
        )
      }
    }
  }

  return events
}

// ─── SRT parser ───────────────────────────────────────────────────────────────

export function parseSRT(content: string): Subtitle[] {
  const blocks = content.trim().split(/\n\n+/)
  const rawSubs: Subtitle[] = blocks
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

  const tokens = buildTokens(rawSubs)
  const grouped = groupIntoLines(tokens)

  return grouped.map((line, i) => ({
    index: i + 1,
    start: line.startSrt,
    end: line.endSrt,
    text: line.text,
    originalText: line.text,
  }))
}

export function serializeSRT(subtitles: Subtitle[]): string {
  return subtitles
    .map(s => `${s.index}\n${s.start} --> ${s.end}\n${s.text}`)
    .join('\n\n') + '\n'
}