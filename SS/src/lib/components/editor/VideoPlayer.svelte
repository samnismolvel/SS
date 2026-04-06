<script lang="ts">
  import { distributeWordTimings } from '$lib/utils/ass'
  import { convertFileSrc } from '@tauri-apps/api/core'
  import { selectSegment, updateSubtitleText, updateSubtitleOverrides, clearSubtitleOverrides } from '$lib/stores/editor'
  import type { Subtitle, Template, Alignment, AspectRatio } from '$lib/types'
  import { parseRatio } from '$lib/types'

  interface Props {
    videoPath:     string
    subtitles:     Subtitle[]
    selectedIndex: number | null
    template:      Template | null
    ratio?:        AspectRatio
    offset?:       number        // 0–100 vertical crop %
  }
  let { videoPath, subtitles, selectedIndex, template, ratio = 'original', offset = 50 }: Props = $props()

  // ── Aspect ratio crop style ────────────────────────────────────────────────
  // We show the video at its natural size inside a wrapper that clips to the
  // chosen ratio. The video element itself keeps object-fit:cover so it fills
  // the wrapper, and we shift it vertically with object-position.
  let wrapStyle = $derived((() => {
    const parsed = parseRatio(ratio)
    if (!parsed) return ''           // 'original' — no constraint
    const [w, h] = parsed
    // padding-top trick: height = width × (h/w)
    return `position:relative;width:100%;padding-top:${(h / w) * 100}%;max-height:100%;overflow:hidden;`
  })())

  // object-position maps offset 0→top, 50→center, 100→bottom
  let videoStyle = $derived(
    parseRatio(ratio)
      ? `position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center ${offset}%;`
      : `width:100%;height:100%;object-fit:contain;display:block;`
  )

  // ── Player state ───────────────────────────────────────────────────────────
  let videoEl     = $state(null as HTMLVideoElement | null)
  let currentTime = $state(0)
  let duration    = $state(0)
  let playing     = $state(false)
  let videoSrc    = $derived(videoPath ? convertFileSrc(videoPath) : '')

  // ── Active subtitle ────────────────────────────────────────────────────────
  let activeSub = $derived((() => {
    if (!subtitles.length) return null
    return subtitles.find(sub => {
      const s = srtToSeconds(sub.start), e = srtToSeconds(sub.end)
      return currentTime >= s && currentTime <= e
    }) ?? null
  })())

  let activeWordIndex = $derived((() => {
    if (!activeSub || !template?.wordByWord) return -1
    const words = activeSub.text.trim().split(' ').filter(w => w.length > 0)
    if (words.length === 0) return -1
    if (words.length === 1) return 0
    const startMs = srtToSeconds(activeSub.start) * 1000
    const endMs   = srtToSeconds(activeSub.end)   * 1000
    const nowMs   = currentTime * 1000
    const timings = distributeWordTimings(words, startMs, endMs)
    const idx = timings.findIndex(t => nowMs >= t.startMs && nowMs <= t.endMs)
    if (idx !== -1) return idx
    if (nowMs < timings[0].startMs) return 0
    if (nowMs >= timings[timings.length - 1].endMs) return words.length - 1
    for (let i = timings.length - 1; i >= 0; i--) { if (nowMs >= timings[i].startMs) return i }
    return 0
  })())

  let typewriterText = $derived((() => {
    if (!activeSub || template?.animation !== 'typewriter') return null
    const chars   = [...activeSub.text]
    const startMs = srtToSeconds(activeSub.start) * 1000
    const endMs   = srtToSeconds(activeSub.end)   * 1000
    const delayMs = Math.max(30, Math.min(80, Math.floor((endMs - startMs) / chars.length)))
    const elapsed = currentTime * 1000 - startMs
    const revealed = Math.min(chars.length, Math.max(0, Math.ceil(elapsed / delayMs)))
    return chars.slice(0, revealed).join('')
  })())

  // ── Selected segment ───────────────────────────────────────────────────────
  let selectedSub  = $derived(selectedIndex !== null ? subtitles[selectedIndex] : null)
  let overrides    = $derived(selectedSub?.overrides ?? {})
  let effective    = $derived(template ? { ...template, ...overrides } : null)
  let hasOverrides = $derived(!!selectedSub?.overrides && Object.keys(selectedSub.overrides).length > 0)

  function setOverride(key: string, value: any) {
    if (selectedIndex === null) return
    updateSubtitleOverrides(selectedIndex, { [key]: value })
  }
  function clearOverrides() {
    if (selectedIndex !== null) clearSubtitleOverrides(selectedIndex)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function srtToSeconds(srt: string): number {
    if (!srt) return 0
    const [time, ms] = srt.split(',')
    const [h, m, s] = time.split(':').map(Number)
    return h * 3600 + m * 60 + s + (parseInt(ms) / 1000)
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function getAlignmentStyle(alignment: number): string {
    const p: Record<number, string> = {
      1: 'bottom:10%;left:5%;text-align:left;',
      2: 'bottom:10%;left:50%;transform:translateX(-50%);text-align:center;',
      3: 'bottom:10%;right:5%;text-align:right;',
      4: 'top:50%;left:5%;transform:translateY(-50%);text-align:left;',
      5: 'top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;',
      6: 'top:50%;right:5%;transform:translateY(-50%);text-align:right;',
      7: 'top:5%;left:5%;text-align:left;',
      8: 'top:5%;left:50%;transform:translateX(-50%);text-align:center;',
      9: 'top:5%;right:5%;text-align:right;',
    }
    return p[alignment] ?? p[2]
  }

  function getAnimationStyle(animation: string | undefined): string {
    switch (animation) {
      case 'fade':     return 'animation:sub-fade 300ms ease-in-out forwards;'
      case 'pop':      return 'animation:sub-pop 350ms cubic-bezier(0.34,1.56,0.64,1) forwards;'
      case 'slide-up': return 'animation:sub-slide-up 350ms ease-out forwards;'
      default:         return ''
    }
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  function onTimeUpdate()     { if (videoEl) currentTime = videoEl.currentTime }
  function onLoadedMetadata() { if (videoEl) duration = videoEl.duration }
  function onVideoPlay()      { playing = true }
  function onVideoPause()     { playing = false }

  function togglePlay() {
    if (!videoEl) return
    playing ? videoEl.pause() : videoEl.play()
    playing = !playing
  }

  function seekTo(seconds: number) {
    if (videoEl) { videoEl.currentTime = seconds; currentTime = seconds }
  }

  function seekToSegment(sub: Subtitle) {
    seekTo(srtToSeconds(sub.start))
    const idx = subtitles.indexOf(sub)
    if (idx !== -1) selectSegment(idx)
    if (videoEl && playing) { videoEl.pause(); playing = false }
  }

  function initTextarea(node: HTMLTextAreaElement, text: string) {
    node.value = text
    node.style.height = 'auto'
    node.style.height = Math.max(48, node.scrollHeight) + 'px'
    return {
      update(newText: string) {
        if (document.activeElement !== node) {
          node.value = newText
          node.style.height = 'auto'
          node.style.height = Math.max(48, node.scrollHeight) + 'px'
        }
      }
    }
  }
</script>

<div class="video-col">

  <!-- Video + overlay -->
  <div class="video-wrap">
    {#if videoSrc}
      <!-- crop-frame constrains the video to the chosen aspect ratio -->
      <div class="crop-frame" style={wrapStyle}>
        <video bind:this={videoEl} src={videoSrc}
          ontimeupdate={onTimeUpdate} onloadedmetadata={onLoadedMetadata}
          onplay={onVideoPlay} onpause={onVideoPause}
          style={videoStyle}>
        </video>

        <!-- Subtitle overlay — inside crop-frame so it clips with the video -->
        {#if activeSub && template}
          {#key activeSub?.start}
            <div class="sub-overlay"
              style="position:absolute;{getAlignmentStyle(template.alignment ?? 2)}max-width:90%;pointer-events:auto;cursor:pointer;"
              onclick={() => seekToSegment(activeSub!)}>
            <span style="display:inline-block;transform-origin:center bottom;
              font-family:{template.fontName ?? 'Arial'};
              font-size:{(template.fontSize ?? 24) * 0.8}px;
              font-weight:{template.bold ? 'bold' : 'normal'};
              font-style:{template.italic ? 'italic' : 'normal'};
              color:{template.primaryColor ?? '#fff'};
              text-shadow:
                -{template.outline ?? 2}px -{template.outline ?? 2}px 0 {template.outlineColor ?? '#000'},
                 {template.outline ?? 2}px -{template.outline ?? 2}px 0 {template.outlineColor ?? '#000'},
                -{template.outline ?? 2}px  {template.outline ?? 2}px 0 {template.outlineColor ?? '#000'},
                 {template.outline ?? 2}px  {template.outline ?? 2}px 0 {template.outlineColor ?? '#000'};
              padding:2px 8px;{getAnimationStyle(template.animation)}">
              {#if template.wordByWord && template.wordMode !== 'none'}
                {#if template.wordMode === 'solo'}
                  {#if activeWordIndex >= 0}
                    {@const sw = activeSub.text.trim().split(' ').filter(w => w.length > 0)}
                    <span style="color:{template.highlightColor};white-space:pre;">{sw[activeWordIndex] ?? ''}</span>
                  {/if}
                {:else}
                  {#each activeSub.text.trim().split(' ').filter(w => w.length > 0) as word, wi}
                    {@const aw = activeSub.text.trim().split(' ').filter(w => w.length > 0)}
                    <span style="color:{wi === activeWordIndex ? template.highlightColor : (template.primaryColor ?? '#fff')};white-space:pre;"
                      >{word}{wi < aw.length - 1 ? ' ' : ''}</span>
                  {/each}
                {/if}
              {:else}
                {template.animation === 'typewriter' ? (typewriterText ?? '') : activeSub.text}
              {/if}
            </span>
          </div>
          {/key}
        {/if}
      </div><!-- /crop-frame -->

      <!-- Controls sit outside crop-frame, always full-width at bottom -->
      <div class="video-controls">
        <button class="play-btn" onclick={togglePlay}>
          {#if playing}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          {/if}
        </button>
        <span class="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <div class="progress-bar" role="slider" tabindex="0"
          aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration}
          onclick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * duration) }}
          onkeydown={(e) => { if (e.key === 'ArrowRight') seekTo(currentTime + 5); if (e.key === 'ArrowLeft') seekTo(currentTime - 5) }}>
          <div class="progress-fill" style="width:{duration ? (currentTime / duration) * 100 : 0}%"></div>
        </div>
      </div>

    {:else}
      <div class="no-video">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
        </svg>
        No video loaded
      </div>
    {/if}
  </div>

  <!-- Segment editor below video -->
  {#if selectedSub && effective}
    <div class="seg-editor">
      <div class="seg-header">
        <span class="seg-badge">#{selectedSub.index}</span>
        <span class="seg-time">{selectedSub.start.slice(0, 8)} → {selectedSub.end.slice(0, 8)}</span>
        <div class="seg-actions">
          {#if hasOverrides}
            <button class="seg-action-btn danger" onclick={clearOverrides}>Reset</button>
          {/if}
          <button class="seg-action-btn" onclick={() => selectSegment(null)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <textarea class="seg-textarea"
        use:initTextarea={selectedSub.text}
        oninput={(e) => updateSubtitleText(selectedIndex!, (e.currentTarget as HTMLTextAreaElement).value)}>
      </textarea>

      <div class="seg-overrides">
        <div class="or">
          <label>Text</label>
          <input type="color" value={effective.primaryColor} oninput={(e) => setOverride('primaryColor', e.currentTarget.value)} />
          {#if 'primaryColor' in overrides}<span class="override-dot"></span>{/if}
        </div>
        <div class="or">
          <label>Outline</label>
          <input type="color" value={effective.outlineColor} oninput={(e) => setOverride('outlineColor', e.currentTarget.value)} />
          {#if 'outlineColor' in overrides}<span class="override-dot"></span>{/if}
        </div>
        <div class="or">
          <label>Size</label>
          <input type="number" min="8" max="120" value={effective.fontSize}
            onchange={(e) => setOverride('fontSize', Number(e.currentTarget.value))} />
          {#if 'fontSize' in overrides}<span class="override-dot"></span>{/if}
        </div>
        <div class="or">
          <label>Position</label>
          <select value={effective.alignment} onchange={(e) => setOverride('alignment', Number(e.currentTarget.value))}>
            <option value={7}>Top Left</option><option value={8}>Top Center</option><option value={9}>Top Right</option>
            <option value={4}>Mid Left</option><option value={5}>Mid Center</option><option value={6}>Mid Right</option>
            <option value={1}>Bot Left</option><option value={2}>Bot Center</option><option value={3}>Bot Right</option>
          </select>
          {#if 'alignment' in overrides}<span class="override-dot"></span>{/if}
        </div>
      </div>
    </div>
  {/if}

</div>

<style>
  .video-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .video-wrap {
    flex: 1;
    position: relative;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  /* crop-frame: sized by wrapStyle (padding-top trick) or fills wrap when original */
  .crop-frame {
    /* when ratio=original, wrapStyle is empty so these take over */
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }
  /* video style is now fully inline (videoStyle), this class is unused but kept as fallback */
  .video { width: 100%; height: 100%; object-fit: contain; display: block; }

  .no-video {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }

  .sub-overlay { position: absolute; line-height: 1.3; }
  .sub-overlay:hover { outline: 1px dashed rgba(255,255,255,0.3); border-radius: 2px; }

  /* Controls */
  .video-controls {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.85rem;
    background: linear-gradient(transparent, rgba(0,0,0,0.8));
  }
  .play-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px; height: 28px;
    border-radius: 50%;
    background: rgba(255,255,255,0.15);
    border: none;
    color: white;
    cursor: pointer;
    transition: background var(--transition);
    flex-shrink: 0;
  }
  .play-btn:hover { background: rgba(255,255,255,0.25); }
  .time-display {
    color: rgba(255,255,255,0.8);
    font-size: 0.7rem;
    font-family: monospace;
    white-space: nowrap;
  }
  .progress-bar {
    flex: 1;
    height: 3px;
    background: rgba(255,255,255,0.2);
    border-radius: 2px;
    cursor: pointer;
    position: relative;
    transition: height var(--transition);
  }
  .progress-bar:hover { height: 5px; }
  .progress-fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: 2px;
    pointer-events: none;
  }

  /* Segment editor */
  .seg-editor {
    flex-shrink: 0;
    padding: 0.65rem 0.85rem;
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
  }
  .seg-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.45rem;
  }
  .seg-badge {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--color-accent);
    background: var(--color-accent-subtle, rgba(99,102,241,0.1));
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  .seg-time {
    font-size: 0.68rem;
    color: var(--color-text-muted);
    font-family: monospace;
    flex: 1;
  }
  .seg-actions { display: flex; gap: 0.3rem; }
  .seg-action-btn {
    display: flex;
    align-items: center;
    padding: 0.2rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    transition: all var(--transition);
  }
  .seg-action-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .seg-action-btn.danger { border-color: var(--color-danger, #ef4444); color: var(--color-danger, #ef4444); }
  .seg-action-btn.danger:hover { background: rgba(239,68,68,0.08); }

  .seg-textarea {
    width: 100%;
    padding: 0.4rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.82rem;
    font-family: inherit;
    resize: none;
    overflow: hidden;
    min-height: 48px;
    box-sizing: border-box;
    line-height: 1.5;
    outline: none;
    transition: border-color var(--transition);
  }
  .seg-textarea:focus { border-color: var(--color-accent); }

  .seg-overrides {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.45rem;
  }
  .or label { font-size: 0.65rem; color: var(--color-text-muted); }
  .or input[type="color"] { width: 20px; height: 18px; padding: 0; border: none; background: none; cursor: pointer; border-radius: 3px; }
  .or input[type="number"] { width: 44px; padding: 0.1rem 0.25rem; border-radius: 3px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); font-size: 0.72rem; }
  .or select { padding: 0.1rem 0.25rem; border-radius: 3px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); font-size: 0.72rem; }
  .override-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--color-accent); flex-shrink: 0; }

  /* Animations */
  :global {
    @keyframes sub-fade     { from{opacity:0} to{opacity:1} }
    @keyframes sub-pop      { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
    @keyframes sub-slide-up { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
  }
</style>