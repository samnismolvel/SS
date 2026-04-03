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

interface Token {
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
  lines.push('WrapStyle: 2')  // 2 = no wrapping — overflow clips, never wraps to a second line
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

// ─── Grouping options from template ──────────────────────────────────────────

function groupOptsFromTemplate(template: Template): GroupOptions {
  return {
    maxWords: 3,     // 3 words guarantees a single line at typical font sizes
    maxMs:    3000,
    minMs:    400,
    breathMs: 250,
    // clauseMs and cutMs come from the user-tunable pauseThreshold.
    // pauseThreshold is the "clause" boundary; cutMs is 1.6× that.
    clauseMs: template.pauseThreshold ?? 500,
    cutMs:    Math.round((template.pauseThreshold ?? 500) * 1.6),
  }
}

// ─── Animation tag builder ───────────────────────────────────────────────────
//
// Returns an ASS override tag string to prepend to each dialogue event's text.
// All tags are self-contained per-event so they work cleanly with libass/FFmpeg.
//
// fade: \fad(inMs, outMs)
//   Fades the event in and out. Both values clamped to half the event duration.
//
// pop: \fscx\fscy + \t() scale transform
//   Scales the subtitle from 50% → 100% over 150 ms (clamped to event length).
//   Uses \fscx/\fscy (horizontal/vertical scale %) rather than \fs so it
//   works relative to the style's base font size and doesn't fight other tags.
//   A simultaneous short fade-in (\fad) smooths the leading edge.

function buildAnimationTag(
  animation: AnimationMode,
  eventDurationMs: number
): string {
  if (animation === 'none' || !animation) return ''

  if (animation === 'fade') {
    const half    = Math.floor(eventDurationMs / 2)
    const fadeIn  = Math.min(80, half)
    const fadeOut = Math.min(80, half)
    return `{\\fad(${fadeIn},${fadeOut})}`
  }

  if (animation === 'pop') {
    // Scale from 50% → 100% over popMs, clamped so it never exceeds the event.
    const popMs  = Math.min(150, eventDurationMs)
    const fadeIn = Math.min(60, Math.floor(eventDurationMs / 2))
    // \fscx50\fscy50 sets the start scale; \t(0,popMs,...) animates to 100%.
    // \fad(fadeIn,0) softens the very first frames so the pop doesn't feel harsh.
    return `{\\fad(${fadeIn},0)\\fscx50\\fscy50\\t(0,${popMs},\\fscx100\\fscy100)}`
  }

  return ''
}

// ─── Plain events ─────────────────────────────────────────────────────────────

function buildPlainEvents(subtitles: Subtitle[], template: Template): string[] {
  const events: string[] = []
  const syncOffset = template.syncOffset ?? 120

  const tokens  = buildTokens(subtitles)
  const grouped = applyTimingCorrection(
    groupTokens(tokens, groupOptsFromTemplate(template)),
    syncOffset
  )

  const overrideMap = new Map<string, Subtitle['overrides']>()
  for (const sub of subtitles) {
    if (sub.overrides) overrideMap.set(sub.start, sub.overrides)
  }

  for (const line of grouped) {
    const overrides = overrideMap.get(line.startSrt)
    const style     = resolveStyle(template, overrides)
    const start     = srtTimeToAss(line.startSrt)
    const end       = srtTimeToAss(line.endSrt)
    const tags      = buildInlineTags(style, template)
    const text      = line.text.replace(/\{/g, '\\{').replace(/\}/g, '\\}')
    const animTag   = buildAnimationTag(template.animation, srtToMs(line.endSrt) - srtToMs(line.startSrt))
    events.push('Dialogue: 0,' + start + ',' + end + ',Default,,0,0,0,,' + animTag + tags + text)
  }

  return events
}

// ─── Word-by-word events ──────────────────────────────────────────────────────
//
// Receives the GROUPED subtitles from parseSRT (one Subtitle = one display line,
// potentially multiple words). Per-word timing is derived via distributeWordTimings
// which is accurate enough for the highlight/solo display effect.
// Plain mode (buildPlainEvents) is the one that needs frame-accurate per-word
// timestamps — it gets them via buildTokens on the raw single-word SRT blocks.

function buildWordByWordEvents(subtitles: Subtitle[], template: Template): string[] {
  const events: string[] = []
  const primaryColor   = '{\\c' + hexToAss(template.primaryColor) + '}'
  const highlightColor = '{\\c' + hexToAss(template.highlightColor) + '}'
  const syncOffset     = template.syncOffset ?? 120
  const wbwOpts: GroupOptions = {
    ...groupOptsFromTemplate(template),
    maxWords: 8,
    maxMs:    5000,
  }

  // Build word-level tokens from the grouped subtitles.
  // Each grouped subtitle may contain multiple words — we split them and assign
  // timing via distributeWordTimings over the subtitle's real time span.
  const wordTokens: Token[] = []
  for (const sub of subtitles) {
    const words = sub.text.trim().split(' ').map(cleanWord).filter(isValidWord)
    if (words.length === 0) continue
    const startMs = srtToMs(sub.start)
    const endMs   = srtToMs(sub.end)
    const timings = distributeWordTimings(words, startMs, endMs)
    words.forEach((word, wi) => {
      wordTokens.push({
        word,
        rawWord:  word,
        startSrt: sub.start,
        endSrt:   sub.end,
        startMs:  timings[wi].startMs,
        endMs:    timings[wi].endMs,
      })
    })
  }

  const validTokens = wordTokens.filter(t => isValidWord(t.word))

  // Group into display sentences using the shared groupTokens logic,
  // then apply timing correction.
  const sentences = applyTimingCorrection(
    groupTokens(validTokens, wbwOpts),
    syncOffset
  )

  for (const sentence of sentences) {
    const sentenceWords = sentence.text.split(' ')

    // Recover the per-word tokens for this sentence.
    // Token lookup uses the uncorrected time range (before syncOffset was added).
    const uncorrectedStart = sentence.startMs - syncOffset
    const uncorrectedEnd   = sentence.endMs   - syncOffset
    const sentenceTokens   = validTokens.filter(
      t => t.startMs >= uncorrectedStart - 50 && t.endMs <= uncorrectedEnd + 50
    )

    const resolvedTokens: Token[] = sentenceWords.map((word, wi) => {
      const found = sentenceTokens[wi]
      if (found) {
        return {
          ...found,
          startMs:  found.startMs + syncOffset,
          endMs:    found.endMs   + syncOffset,
          startSrt: msToSrt(found.startMs + syncOffset),
          endSrt:   msToSrt(found.endMs   + syncOffset),
        }
      }
      // Fallback: even distribution across sentence span
      const span = (sentence.endMs - sentence.startMs) / Math.max(sentenceWords.length, 1)
      return {
        word,
        rawWord:  word,
        startSrt: sentence.startSrt,
        endSrt:   sentence.endSrt,
        startMs:  Math.round(sentence.startMs + wi * span),
        endMs:    Math.round(sentence.startMs + (wi + 1) * span),
      }
    })

    if (template.wordMode === 'highlight') {
      for (let wi = 0; wi < resolvedTokens.length; wi++) {
        const { startMs, endMs } = resolvedTokens[wi]
        let text = ''
        for (let j = 0; j < resolvedTokens.length; j++) {
          text += j === wi
            ? highlightColor + resolvedTokens[j].word + primaryColor
            : resolvedTokens[j].word
          if (j < resolvedTokens.length - 1) text += ' '
        }
        const wordDur = endMs - startMs
        const animTag = buildAnimationTag(template.animation, wordDur)
        events.push(
          'Dialogue: 0,' + msToAssTime(startMs) + ',' + msToAssTime(endMs) +
          ',Default,,0,0,0,,' + animTag + primaryColor + text
        )
      }
    } else if (template.wordMode === 'solo') {
      for (const { word, startMs, endMs } of resolvedTokens) {
        const wordDur = endMs - startMs
        const animTag = buildAnimationTag(template.animation, wordDur)
        events.push(
          'Dialogue: 0,' + msToAssTime(startMs) + ',' + msToAssTime(endMs) +
          ',Default,,0,0,0,,' + animTag + highlightColor + word
        )
      }
    }
  }

  return events
}


// ─── SRT parser ───────────────────────────────────────────────────────────────
// Timing correction is NOT applied here — it's burn-time only (buildAss).
// This keeps stored SRT timestamps clean so re-burning never double-shifts.

export function parseSRT(content: string): Subtitle[] {
  const blocks = content.trim().split(/\n\n+/)
  const rawSubs: Subtitle[] = blocks
    .map(block => {
      const lines = block.trim().split('\n')
      if (lines.length < 3) return null
      const index       = parseInt(lines[0], 10)
      const timingParts = lines[1].split(' --> ')
      if (timingParts.length !== 2) return null
      const [start, end] = timingParts
      const text = lines.slice(2).join('\n')
      return { index, start: start.trim(), end: end.trim(), text, originalText: text } as Subtitle
    })
    .filter((s): s is Subtitle => s !== null)

  // Group raw word tokens into display lines using default opts.
  // No timing correction here — offsets applied at burn time only.
  const tokens  = buildTokens(rawSubs)
  const grouped = groupTokens(tokens)

  return grouped.map((line, i) => ({
    index:        i + 1,
    start:        line.startSrt,
    end:          line.endSrt,
    text:         line.text,
    originalText: line.text,
  }))
}

export function serializeSRT(subtitles: Subtitle[]): string {
  return subtitles
    .map(s => `${s.index}\n${s.start} --> ${s.end}\n${s.text}`)
    .join('\n\n') + '\n'
}