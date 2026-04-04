<script lang="ts">
  import { session, isDirty, findAndReplace, selectSegment, updateSubtitleText, resetSubtitleText, updateSubtitleOverrides, clearSubtitleOverrides } from '$lib/stores/editor'
  import { activeTemplate, updateActiveTemplate, allTemplates, setActiveTemplate, saveActiveAsTemplate } from '$lib/stores/templates'
  import { buildAss, distributeWordTimings } from '$lib/utils/ass'
  import { convertFileSrc } from '@tauri-apps/api/core'
  import type { Subtitle, Template, WordMode, Alignment, AnimationMode } from '$lib/types'


  interface Props {
    onburn: (detail: { videoPath: string; outputPath: string; assContent: string }) => void
    oncancel: () => void
  }
  let { onburn, oncancel }: Props = $props()

  // Store subscriptions
  let sessionVal = $state(null as any)
  let isDirtyVal = $state(false)
  let templateVal = $state(null as any)
  let items = $state([] as any[])
  let selIdx = $state(null as number | null)

  $effect(() => {
    const u1 = session.subscribe(v => {
      sessionVal = v
      items = v?.subtitles ?? []
      selIdx = v?.selectedIndex ?? null
    })
    const u2 = isDirty.subscribe(v => { isDirtyVal = v })
    const u3 = activeTemplate.subscribe(v => { templateVal = v })
    return () => { u1(); u2(); u3() }
  })

  // Video player state
  let videoEl = $state(null as HTMLVideoElement | null)
  let currentTime = $state(0)
  let duration = $state(0)
  let playing = $state(false)
  let videoSrc = $state('')

  // Drag-to-reposition state
  let videoWrapEl = $state(null as HTMLDivElement | null)
  let isDragging  = $state(false)
  let dragOffsetX = $state(0)
  let dragOffsetY = $state(0)

  $effect(() => {
    if (sessionVal?.videoPath) {
      videoSrc = convertFileSrc(sessionVal.videoPath)
    }
  })

  // Active subtitle based on currentTime
  let activeSub = $derived((() => {
    if (!items.length) return null
    return items.find((sub: any) => {
      const start = srtToSeconds(sub.start)
      const end = srtToSeconds(sub.end)
      return currentTime >= start && currentTime <= end
    }) ?? null
  })())

  // For word-by-word preview: which word in the active subtitle is current
  // Distribute timing evenly across words in the line
  let activeWordIndex = $derived((() => {
    if (!activeSub || !templateVal?.wordByWord) return -1
    const words = activeSub.text.trim().split(' ').filter((w: string) => w.length > 0)
    if (words.length === 0) return -1
    if (words.length === 1) return 0
 
    const startMs = srtToSeconds(activeSub.start) * 1000
    const endMs   = srtToSeconds(activeSub.end)   * 1000
    const nowMs   = currentTime * 1000
 
    // Use the same length-weighted distribution as ass.ts so preview matches burn
    const timings = distributeWordTimings(words, startMs, endMs)
 
    // Use <= on upper bound — timeupdate fires ~every 250 ms so exact boundary
    // hits are common and must not fall through to -1.
    const idx = timings.findIndex(t => nowMs >= t.startMs && nowMs <= t.endMs)
    if (idx !== -1) return idx
 
    // Before the first word
    if (nowMs < timings[0].startMs) return 0
 
    // After the last word
    if (nowMs >= timings[timings.length - 1].endMs) return words.length - 1
 
    // Between two adjacent words — snap to the word we most recently passed
    for (let i = timings.length - 1; i >= 0; i--) {
      if (nowMs >= timings[i].startMs) return i
    }
    return 0
  })())

  function srtToSeconds(srt: string): number {
    if (!srt) return 0
    const [time, ms] = srt.split(',')
    const [h, m, s] = time.split(':').map(Number)
    return h * 3600 + m * 60 + s + (parseInt(ms) / 1000)
  }

  function onTimeUpdate() {
    if (videoEl) currentTime = videoEl.currentTime
  }

  function onLoadedMetadata() {
    if (videoEl) duration = videoEl.duration
  }

  function togglePlay() {
    if (!videoEl) return
    if (playing) videoEl.pause()
    else videoEl.play()
    playing = !playing
  }

  function onVideoPlay() { playing = true }
  function onVideoPause() { playing = false }

  function seekTo(seconds: number) {
    if (videoEl) {
      videoEl.currentTime = seconds
      currentTime = seconds
    }
  }

  function seekToSegment(sub: any) {
    seekTo(srtToSeconds(sub.start))
    const idx = items.indexOf(sub)
    if (idx !== -1) selectSegment(idx)
    if (videoEl && playing) {
      videoEl.pause()
      playing = false
    }
  }

  // ── Letterbox-aware video frame rect ──────────────────────────────────────
  // video-wrap uses object-fit:contain — compute the rect of the actual rendered
  // frame (excluding black bars) so drag coords map to real video pixels.
  function getVideoFrameRect(): { left: number; top: number; width: number; height: number } | null {
    if (!videoWrapEl || !videoEl || !videoEl.videoWidth) return null
    const wrap   = videoWrapEl.getBoundingClientRect()
    const vidAR  = videoEl.videoWidth / videoEl.videoHeight
    const wrapAR = wrap.width / wrap.height
    let frameW: number, frameH: number
    if (vidAR > wrapAR) {
      frameW = wrap.width;  frameH = wrap.width / vidAR
    } else {
      frameH = wrap.height; frameW = wrap.height * vidAR
    }
    return {
      left:   wrap.left + (wrap.width  - frameW) / 2,
      top:    wrap.top  + (wrap.height - frameH) / 2,
      width:  frameW,
      height: frameH,
    }
  }

  // Returns CSS positioning string for the overlay div.
  // Uses posX/posY (% of video frame) when set by drag; falls back to alignment grid.
  function getOverlayStyle(sub: any, alignment: number): string {
    const posX = sub?.overrides?.posX
    const posY = sub?.overrides?.posY
    if (posX != null && posY != null) {
      const frame = getVideoFrameRect()
      const wrap  = videoWrapEl?.getBoundingClientRect()
      if (frame && wrap) {
        const absX = frame.left - wrap.left + (posX / 100) * frame.width
        const absY = frame.top  - wrap.top  + (posY / 100) * frame.height
        return `left: ${absX}px; top: ${absY}px; text-align: left; transform: none;`
      }
      return `left: ${posX}%; top: ${posY}%; text-align: left; transform: none;`
    }
    return getAlignmentStyle(alignment)
  }

  function getAlignmentStyle(alignment: number): string {
    const positions: Record<number, string> = {
      1: 'bottom: 10%; left: 5%; text-align: left;',
      2: 'bottom: 10%; left: 50%; transform: translateX(-50%); text-align: center;',
      3: 'bottom: 10%; right: 5%; text-align: right;',
      4: 'top: 50%; left: 5%; transform: translateY(-50%); text-align: left;',
      5: 'top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;',
      6: 'top: 50%; right: 5%; transform: translateY(-50%); text-align: right;',
      7: 'top: 5%; left: 5%; text-align: left;',
      8: 'top: 5%; left: 50%; transform: translateX(-50%); text-align: center;',
      9: 'top: 5%; right: 5%; text-align: right;',
    }
    return positions[alignment] ?? positions[2]
  }

  // ── Drag handlers ───────────────────────────────────────────────────────────
  function onOverlayPointerDown(e: PointerEvent, sub: any) {
    e.preventDefault()
    e.stopPropagation()
    const idx = items.indexOf(sub)
    if (idx !== -1) selectSegment(idx)
    const el = e.currentTarget as HTMLElement
    const r  = el.getBoundingClientRect()
    dragOffsetX = e.clientX - r.left
    dragOffsetY = e.clientY - r.top
    isDragging  = true
    el.setPointerCapture(e.pointerId)
  }

  function onOverlayPointerMove(e: PointerEvent, sub: any) {
    if (!isDragging) return
    e.preventDefault()
    const frame = getVideoFrameRect()
    if (!frame) return
    const rawX     = e.clientX - frame.left - dragOffsetX
    const rawY     = e.clientY - frame.top  - dragOffsetY
    const clampedX = Math.max(0, Math.min(frame.width  - 4, rawX))
    const clampedY = Math.max(0, Math.min(frame.height - 4, rawY))
    const pctX = (clampedX / frame.width)  * 100
    const pctY = (clampedY / frame.height) * 100
    const idx = items.indexOf(sub)
    if (idx !== -1) updateSubtitleOverrides(idx, { posX: pctX, posY: pctY })
  }

  function onOverlayPointerUp(_e: PointerEvent) {
    isDragging = false
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // Selected segment derived
  let selectedSub = $derived(selIdx !== null ? items[selIdx] : null)

  // Find & replace
  let searchTerm = $state('')
  let replaceTerm = $state('')
  let findMode = $state('all' as 'all' | 'single')
  let replaceMessage = $state('')

  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, findMode)
    replaceMessage = `Replaced ${count} occurrence${count !== 1 ? 's' : ''}`
    setTimeout(() => replaceMessage = '', 3000)
  }

  function handleBurn() {
    if (!sessionVal || !templateVal) return
    const w = videoEl?.videoWidth  ?? 1920
    const h = videoEl?.videoHeight ?? 1080
    const assContent = buildAss(sessionVal.subtitles, templateVal, w, h)
    onburn({ videoPath: sessionVal.videoPath, outputPath: sessionVal.outputPath, assContent })
  }

  function getFileName(path: string) {
    return path.split(/[\\/]/).pop() ?? path
  }

  // Template panel helpers
  const SYSTEM_FONTS = [
    'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
    'Impact', 'Lucida Console', 'Tahoma', 'Times New Roman',
    'Trebuchet MS', 'Verdana', 'Segoe UI', 'Calibri', 'Cambria', 'Consolas',
  ]

  let advanced = $state(false)
  let customFont = $state(false)
  let templatesVal = $state([] as any[])
  let showSaveDialog = $state(false)
  let saveTemplateName = $state('')

  $effect(() => {
    const u = allTemplates.subscribe(v => { templatesVal = v })
    return u
  })

  $effect(() => {
    if (templateVal?.fontName && !SYSTEM_FONTS.includes(templateVal.fontName)) {
      customFont = true
    }
  })

  function handleFontSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value
    if (val === '__custom__') customFont = true
    else { customFont = false; updateActiveTemplate({ fontName: val }) }
  }

  function handlePresetSelect(e: Event) {
    const id = (e.target as HTMLSelectElement).value
    const found = templatesVal.find((t: any) => t.id === id)
    if (found) setActiveTemplate(found)
  }

  function handleSaveTemplate() {
    if (!saveTemplateName.trim()) return
    saveActiveAsTemplate(saveTemplateName.trim())
    saveTemplateName = ''
    showSaveDialog = false
  }

  // Segment inspector helpers
  function setOverride(key: string, value: any) {
    if (selIdx === null) return
    updateSubtitleOverrides(selIdx, { [key]: value })
  }

  function clearOverrides() {
    if (selIdx === null) return
    clearSubtitleOverrides(selIdx)
  }

  let overrides = $derived(selectedSub?.overrides ?? {})
  let effective = $derived(templateVal ? { ...templateVal, ...overrides } : null)
  let hasOverrides = $derived(!!selectedSub?.overrides && Object.keys(selectedSub.overrides).length > 0)

  // Segment text action
  function initTextarea(node: HTMLTextAreaElement, text: string) {
    node.value = text
    node.style.height = 'auto'
    node.style.height = Math.max(60, node.scrollHeight) + 'px'
    return {
      update(newText: string) {
        if (document.activeElement !== node) {
          node.value = newText
          node.style.height = 'auto'
          node.style.height = Math.max(60, node.scrollHeight) + 'px'
        }
      }
    }
  }
</script>

<div class="editor">
  <!-- ── Topbar ── -->
  <div class="topbar">
    <button class="back-btn" onclick={oncancel}>← Queue</button>
    <span class="file-name">{getFileName(sessionVal?.videoPath ?? '')}</span>
    <span class="seg-count">{items.length} segments</span>
    {#if isDirtyVal}<span class="dirty-badge">unsaved</span>{/if}
    <div class="spacer"></div>
    <div class="find-replace">
      <input type="text" bind:value={searchTerm} placeholder="Find..." class="fr-input" />
      <input type="text" bind:value={replaceTerm} placeholder="Replace..." class="fr-input" />
      <select bind:value={findMode} class="fr-select">
        <option value="all">All</option>
        <option value="single">First</option>
      </select>
      <button class="btn-sm" onclick={handleFindReplace}>Replace</button>
      {#if replaceMessage}<span class="replace-msg">{replaceMessage}</span>{/if}
    </div>
    <button class="btn-burn" onclick={handleBurn}>Burn Subtitles →</button>
  </div>

  <!-- ── Main area ── -->
  <div class="main">

    <!-- LEFT: Video + timeline -->
    <div class="left-col">

      <!-- Video player -->
      <div class="video-wrap" bind:this={videoWrapEl}>
        {#if videoSrc}
          <video
            bind:this={videoEl}
            src={videoSrc}
            ontimeupdate={onTimeUpdate}
            onloadedmetadata={onLoadedMetadata}
            onplay={onVideoPlay}
            onpause={onVideoPause}
            class="video"
          ></video>

          <!-- Subtitle overlay -->
          <!-- While paused: show selectedSub (so you can drag it).
               While playing: always show activeSub so the overlay tracks the video. -->
          {#if (activeSub || (selectedSub && !playing)) && templateVal}
            {@const displaySub = (!playing && selectedSub) ? selectedSub : activeSub}
            {@const displayEff = (!playing && selectedSub) ? effective : templateVal}
            <div
              class="sub-overlay"
              class:is-dragging={isDragging}
              style="
                position: absolute;
                {getOverlayStyle(displaySub, displayEff?.alignment ?? 2)}
                font-family: {displayEff?.fontName ?? 'Arial'};
                font-size: {(displayEff?.fontSize ?? 24) * 0.8}px;
                font-weight: {displayEff?.bold ? 'bold' : 'normal'};
                font-style: {displayEff?.italic ? 'italic' : 'normal'};
                color: {displayEff?.primaryColor ?? '#ffffff'};
                text-shadow:
                  -{displayEff?.outline ?? 2}px -{displayEff?.outline ?? 2}px 0 {displayEff?.outlineColor ?? '#000'},
                  {displayEff?.outline ?? 2}px -{displayEff?.outline ?? 2}px 0 {displayEff?.outlineColor ?? '#000'},
                  -{displayEff?.outline ?? 2}px {displayEff?.outline ?? 2}px 0 {displayEff?.outlineColor ?? '#000'},
                  {displayEff?.outline ?? 2}px {displayEff?.outline ?? 2}px 0 {displayEff?.outlineColor ?? '#000'};
                max-width: 90%;
                pointer-events: auto;
                cursor: {isDragging ? 'grabbing' : 'grab'};
                padding: 2px 8px;
                user-select: none;
                touch-action: none;
              "
              onpointerdown={(e) => onOverlayPointerDown(e, displaySub)}
              onpointermove={(e) => onOverlayPointerMove(e, displaySub)}
              onpointerup={onOverlayPointerUp}
              onpointercancel={onOverlayPointerUp}
            >
              {#if templateVal.wordByWord && templateVal.wordMode !== 'none'}
                {#if templateVal.wordMode === 'solo'}
                  {#if activeWordIndex >= 0}
                    {@const soloWords = displaySub.text.trim().split(' ').filter((w: string) => w.length > 0)}
                    <span style="color: {templateVal.highlightColor}; white-space: pre;">
                      {soloWords[activeWordIndex] ?? ''}
                    </span>
                  {/if}
                {:else}
                  {#each displaySub.text.trim().split(' ').filter((w: string) => w.length > 0) as word, wi}
                    {@const allWords = displaySub.text.trim().split(' ').filter((w: string) => w.length > 0)}
                    <span style="color: {wi === activeWordIndex ? templateVal.highlightColor : (displayEff?.primaryColor ?? '#fff')}; white-space: pre;">{word}{wi < allWords.length - 1 ? ' ' : ''}</span>
                  {/each}
                {/if}
              {:else}
                {displaySub.text}
              {/if}
            </div>
          {/if}

          <!-- Controls -->
          <div class="video-controls">
            <button class="play-btn" onclick={togglePlay}>
              {playing ? '⏸' : '▶'}
            </button>
            <span class="time">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div class="progress-bar" onclick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                seekTo(((e.clientX - rect.left) / rect.width) * duration)
            }} role="slider" tabindex="0"
              aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration}
              onkeydown={(e) => {
                if (e.key === 'ArrowRight') seekTo(currentTime + 5)
                if (e.key === 'ArrowLeft') seekTo(currentTime - 5)
              }}>
              <div class="progress-fill" style="width: {duration ? (currentTime/duration)*100 : 0}%"></div>
            </div>
          </div>
        {:else}
          <div class="no-video">No video loaded</div>
        {/if}
      </div>

    </div>

    <!-- RIGHT: Style panel + segment editor -->
    <div class="right-col">

      {#if selectedSub && effective}
        <!-- Segment editor -->
        <div class="seg-editor">
          <div class="seg-editor-header">
            <span class="seg-ref">#{selectedSub.index}</span>
            <span class="seg-timing-small">{selectedSub.start} → {selectedSub.end}</span>
            {#if selectedSub?.overrides?.posX != null}
              <button class="clear-btn" onclick={() => {
                if (selIdx !== null) updateSubtitleOverrides(selIdx, { posX: undefined, posY: undefined })
              }}>↺ pos</button>
            {/if}
            {#if hasOverrides}
              <button class="clear-btn" onclick={clearOverrides}>Clear overrides</button>
            {/if}
            <button class="close-seg" onclick={() => selectSegment(null)}>✕</button>
          </div>

          <textarea
            class="seg-textarea"
            use:initTextarea={selectedSub.text}
            oninput={(e) => updateSubtitleText(selIdx!, (e.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>

          <div class="seg-overrides">
            <div class="override-row">
              <label>Color</label>
              <input type="color" value={effective.primaryColor}
                oninput={(e) => setOverride('primaryColor', e.currentTarget.value)} />
              {#if 'primaryColor' in overrides}
                <span class="override-dot" title="Overridden"></span>
              {/if}
            </div>
            <div class="override-row">
              <label>Outline</label>
              <input type="color" value={effective.outlineColor}
                oninput={(e) => setOverride('outlineColor', e.currentTarget.value)} />
              {#if 'outlineColor' in overrides}
                <span class="override-dot" title="Overridden"></span>
              {/if}
            </div>
            <div class="override-row">
              <label>Size</label>
              <input type="number" min="8" max="120" value={effective.fontSize}
                onchange={(e) => setOverride('fontSize', Number(e.currentTarget.value))} />
              {#if 'fontSize' in overrides}
                <span class="override-dot" title="Overridden"></span>
              {/if}
            </div>
            <div class="override-row">
              <label>Position</label>
              <select value={effective.alignment}
                onchange={(e) => setOverride('alignment', Number(e.currentTarget.value))}>
                <option value={7}>Top Left</option>
                <option value={8}>Top Center</option>
                <option value={9}>Top Right</option>
                <option value={4}>Mid Left</option>
                <option value={5}>Mid Center</option>
                <option value={6}>Mid Right</option>
                <option value={1}>Bot Left</option>
                <option value={2}>Bot Center</option>
                <option value={3}>Bot Right</option>
              </select>
              {#if 'alignment' in overrides}
                <span class="override-dot" title="Overridden"></span>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Template panel (always visible) -->
      <div class="template-panel">
        <div class="tp-header">
          <span class="panel-label">Style</span>
          <select class="preset-select" onchange={handlePresetSelect} value={templateVal?.id}>
            {#each templatesVal as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
          <button class="icon-btn" onclick={() => showSaveDialog = !showSaveDialog}>+ Save</button>
          <button class="mode-toggle" class:active={advanced} onclick={() => advanced = !advanced}>
            {advanced ? 'Simple' : 'Advanced'}
          </button>
        </div>

        {#if showSaveDialog}
          <div class="save-row">
            <input type="text" bind:value={saveTemplateName} placeholder="Template name..."
              onkeydown={(e) => e.key === 'Enter' && handleSaveTemplate()} />
            <button onclick={handleSaveTemplate}>Save</button>
            <button onclick={() => showSaveDialog = false}>✕</button>
          </div>
        {/if}

        {#if templateVal}
        <div class="tp-body">
          <div class="field-row">
            <label>Animation</label>
            <select value={templateVal.animation ?? 'none'}
              onchange={(e) => updateActiveTemplate({ animation: e.currentTarget.value as AnimationMode })}>
              <option value="none">None</option>
              <option value="fade">Fade</option>
              <option value="pop">Pop</option>
              <option value="slide-up">Slide up</option>
              <option value="typewriter">Typewriter</option>
            </select>
          </div>

          <div class="divider"></div>

          <div class="field-row">
            <label class="checkbox-label">
              <input type="checkbox" checked={templateVal.wordByWord}
                onchange={(e) => updateActiveTemplate({ wordByWord: e.currentTarget.checked })} />
              Word-by-word
            </label>
          </div>
          {#if templateVal.wordByWord}
            <div class="field-row">
              <label>Mode</label>
              <select value={templateVal.wordMode}
                onchange={(e) => updateActiveTemplate({ wordMode: e.currentTarget.value as WordMode })}>
                <option value="highlight">Highlight</option>
                <option value="solo">Solo</option>
              </select>
            </div>
            <div class="field-row">
              <label>Highlight</label>
              <input type="color" value={templateVal.highlightColor}
                oninput={(e) => updateActiveTemplate({ highlightColor: e.currentTarget.value })} />
            </div>
          {/if}

          <div class="divider"></div>

          <div class="field-row">
            <label>Font</label>
            <select onchange={handleFontSelect} value={customFont ? '__custom__' : templateVal.fontName}>
              {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
              <option value="__custom__">Custom...</option>
            </select>
          </div>
          {#if customFont}
            <div class="field-row">
              <label></label>
              <input type="text" value={templateVal.fontName} placeholder="Font name..."
                onchange={(e) => updateActiveTemplate({ fontName: e.currentTarget.value })} />
            </div>
          {/if}
          <div class="field-row">
            <label>Size</label>
            <input type="number" min="8" max="120" value={templateVal.fontSize} class="short-input"
              onchange={(e) => updateActiveTemplate({ fontSize: Number(e.currentTarget.value) })} />
            {#if advanced}
              <button class="toggle-btn" class:active={templateVal.bold}
                onclick={() => updateActiveTemplate({ bold: !templateVal.bold })}><b>B</b></button>
              <button class="toggle-btn" class:active={templateVal.italic}
                onclick={() => updateActiveTemplate({ italic: !templateVal.italic })}><i>I</i></button>
            {/if}
          </div>

          <div class="divider"></div>

          <div class="field-row">
            <label>Text</label>
            <input type="color" value={templateVal.primaryColor}
              oninput={(e) => updateActiveTemplate({ primaryColor: e.currentTarget.value })} />
            <span class="hex">{templateVal.primaryColor}</span>
          </div>
          <div class="field-row">
            <label>Outline</label>
            <input type="color" value={templateVal.outlineColor}
              oninput={(e) => updateActiveTemplate({ outlineColor: e.currentTarget.value })} />
            <span class="hex">{templateVal.outlineColor}</span>
          </div>
          {#if advanced}
            <div class="field-row">
              <label>Back</label>
              <input type="color" value={templateVal.backColor}
                oninput={(e) => updateActiveTemplate({ backColor: e.currentTarget.value })} />
            </div>
          {/if}

          <div class="divider"></div>

          <div class="field-row">
            <label>Outline</label>
            <input type="range" min="0" max="4" step="0.5" value={templateVal.outline}
              oninput={(e) => updateActiveTemplate({ outline: Number(e.currentTarget.value) })} />
            <span class="range-val">{templateVal.outline}</span>
          </div>
          <div class="field-row">
            <label>Shadow</label>
            <input type="range" min="0" max="4" step="0.5" value={templateVal.shadow}
              oninput={(e) => updateActiveTemplate({ shadow: Number(e.currentTarget.value) })} />
            <span class="range-val">{templateVal.shadow}</span>
          </div>

          {#if advanced}
            <div class="field-row">
              <label>Spacing</label>
              <input type="range" min="0" max="10" step="0.5" value={templateVal.spacing}
                oninput={(e) => updateActiveTemplate({ spacing: Number(e.currentTarget.value) })} />
              <span class="range-val">{templateVal.spacing}</span>
            </div>
            <div class="field-row">
              <label>Margin V</label>
              <input type="range" min="0" max="100" value={templateVal.marginV}
                oninput={(e) => updateActiveTemplate({ marginV: Number(e.currentTarget.value) })} />
              <span class="range-val">{templateVal.marginV}</span>
            </div>

            <div class="divider"></div>

            <div class="field-row">
              <label title="Push subtitle start times forward to compensate for whisper early onset detection.">Sync offset</label>
              <input type="range" min="0" max="300" step="10" value={templateVal.syncOffset ?? 120}
                oninput={(e) => updateActiveTemplate({ syncOffset: Number(e.currentTarget.value) })} />
              <span class="range-val">{templateVal.syncOffset ?? 120}ms</span>
            </div>
            <div class="field-row">
              <label title="Inter-word pause that triggers a new subtitle line. 400–600 ms suits natural speech.">Pause split</label>
              <input type="range" min="200" max="800" step="50" value={templateVal.pauseThreshold ?? 500}
                oninput={(e) => updateActiveTemplate({ pauseThreshold: Number(e.currentTarget.value) })} />
              <span class="range-val">{templateVal.pauseThreshold ?? 500}ms</span>
            </div>
          {/if}

          <div class="divider"></div>

          <div class="field-row">
            <label>Position</label>
            <div class="align-grid">
              {#each [7,8,9,4,5,6,1,2,3] as pos}
                <button class="align-btn" class:active={templateVal.alignment === pos}
                  onclick={() => updateActiveTemplate({ alignment: pos as Alignment })}></button>
              {/each}
            </div>
          </div>
        </div>
        {/if}
      </div>

    </div>
  </div>
</div>

<style>
  .editor { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  /* Topbar */
  .topbar {
    display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-border); background: var(--color-surface);
    flex-shrink: 0; flex-wrap: wrap;
  }
  .back-btn {
    padding: 0.3rem 0.75rem; border-radius: 6px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted); font-size: 0.8rem; cursor: pointer;
  }
  .back-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .file-name { font-weight: 600; font-size: 0.9rem; }
  .seg-count { font-size: 0.8rem; color: var(--color-text-muted); }
  .dirty-badge {
    font-size: 0.7rem; padding: 2px 6px; border-radius: 20px;
    background: var(--color-warning-subtle); color: var(--color-warning);
  }
  .spacer { flex: 1; }
  .find-replace { display: flex; align-items: center; gap: 0.3rem; }
  .fr-input {
    padding: 0.3rem 0.5rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-bg); color: var(--color-text); font-size: 0.8rem; width: 100px;
  }
  .fr-select {
    padding: 0.3rem 0.4rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-bg); color: var(--color-text); font-size: 0.8rem;
  }
  .btn-sm {
    padding: 0.3rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text); font-size: 0.8rem; cursor: pointer;
  }
  .btn-sm:hover { background: var(--color-surface-hover); }
  .replace-msg { font-size: 0.75rem; color: var(--color-success); }
  .btn-burn {
    padding: 0.35rem 1rem; border-radius: 6px; border: none;
    background: var(--color-accent); color: white; font-size: 0.85rem;
    font-weight: 500; cursor: pointer; white-space: nowrap;
  }
  .btn-burn:hover { filter: brightness(1.1); }

  /* Layout */
  .main { display: grid; grid-template-columns: 1fr 300px; flex: 1; overflow: hidden; }

  /* Left column */
  .left-col {
    display: flex; flex-direction: column; overflow: hidden;
    border-right: 1px solid var(--color-border);
  }

  /* Video */
  .video-wrap {
    flex: 1; position: relative; background: #000;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  .video { width: 100%; height: 100%; object-fit: contain; display: block; }
  .no-video { color: #666; font-size: 0.9rem; }

  .sub-overlay {
    position: absolute;
    line-height: 1.3;
    border-radius: 3px;
    touch-action: none;
  }
  .sub-overlay:hover { outline: 1px dashed rgba(255,255,255,0.45); }
  .sub-overlay.is-dragging { outline: 1px dashed rgba(255,255,255,0.9); }

  .video-controls {
    position: absolute; bottom: 0; left: 0; right: 0;
    display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem;
    background: linear-gradient(transparent, rgba(0,0,0,0.7));
  }
  .play-btn {
    background: none; border: none; color: white; font-size: 1rem;
    cursor: pointer; padding: 0; width: 28px;
  }
  .time { color: white; font-size: 0.75rem; white-space: nowrap; font-family: monospace; }
  .progress-bar {
    flex: 1; height: 4px; background: rgba(255,255,255,0.3);
    border-radius: 2px; cursor: pointer; position: relative;
  }
  .progress-fill {
    height: 100%; background: var(--color-accent);
    border-radius: 2px; pointer-events: none;
  }

  /* Right column */
  .right-col {
    display: flex; flex-direction: column; overflow: hidden; background: var(--color-bg);
  }

  /* Segment editor */
  .seg-editor {
    flex-shrink: 0; border-bottom: 1px solid var(--color-border);
    background: var(--color-surface); padding: 0.75rem;
  }
  .seg-editor-header {
    display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;
  }
  .seg-ref { font-size: 0.75rem; font-weight: 700; color: var(--color-accent); }
  .seg-timing-small { font-size: 0.7rem; color: var(--color-text-muted); font-family: monospace; flex: 1; }
  .clear-btn {
    font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;
    border: 1px solid var(--color-danger); background: transparent; color: var(--color-danger); cursor: pointer;
  }
  .clear-btn:hover { background: var(--color-danger-subtle); }
  .close-seg {
    background: none; border: none; color: var(--color-text-muted);
    cursor: pointer; font-size: 0.85rem; padding: 2px 4px;
  }
  .close-seg:hover { color: var(--color-text); }

  .seg-textarea {
    width: 100%; padding: 0.4rem 0.6rem; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.85rem; font-family: inherit;
    resize: none; overflow: hidden; min-height: 60px; box-sizing: border-box;
    line-height: 1.5; outline: none;
  }
  .seg-textarea:focus { border-color: var(--color-accent); }

  .seg-overrides { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem; }
  .override-row { display: flex; align-items: center; gap: 0.4rem; }
  .override-row label { font-size: 0.72rem; color: var(--color-text-muted); min-width: 50px; }
  .override-row input[type="color"] {
    width: 28px; height: 24px; padding: 1px; border-radius: 4px;
    border: 1px solid var(--color-border); cursor: pointer;
  }
  .override-row input[type="number"] {
    width: 55px; padding: 0.2rem 0.4rem; border-radius: 4px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.75rem;
  }
  .override-row select {
    flex: 1; padding: 0.2rem 0.4rem; border-radius: 4px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.75rem;
  }
  .override-dot {
    width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); flex-shrink: 0;
  }

  /* Template panel */
  .template-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .tp-header {
    display: flex; align-items: center; gap: 0.4rem; padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap;
  }
  .panel-label {
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--color-text-muted);
  }
  .preset-select {
    flex: 1; padding: 0.25rem 0.4rem; border-radius: 4px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.75rem;
  }
  .icon-btn {
    padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted); font-size: 0.72rem; cursor: pointer;
  }
  .icon-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .mode-toggle {
    padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted); font-size: 0.72rem; cursor: pointer;
  }
  .mode-toggle.active { background: var(--color-accent-subtle); border-color: var(--color-accent); color: var(--color-accent); }

  .save-row {
    display: flex; gap: 0.3rem; padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--color-border); background: var(--color-surface-hover);
  }
  .save-row input {
    flex: 1; padding: 0.25rem 0.4rem; border-radius: 4px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.75rem;
  }
  .save-row button {
    padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text); font-size: 0.75rem; cursor: pointer;
  }
  .save-row button:first-of-type { background: var(--color-accent); border-color: var(--color-accent); color: white; }

  .tp-body { flex: 1; overflow-y: auto; padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; }

  .field-row { display: flex; align-items: center; gap: 0.4rem; }
  .field-row label { font-size: 0.72rem; color: var(--color-text-muted); min-width: 50px; }
  .checkbox-label {
    display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem;
    color: var(--color-text); cursor: pointer; min-width: unset !important;
  }
  .field-row input[type="text"], .field-row input[type="number"], .field-row select {
    flex: 1; padding: 0.25rem 0.4rem; border-radius: 4px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.75rem;
  }
  .field-row input:focus, .field-row select:focus { outline: none; border-color: var(--color-accent); }
  .short-input { max-width: 55px; flex: none !important; }
  .field-row input[type="color"] {
    width: 28px; height: 24px; padding: 1px; border-radius: 4px;
    border: 1px solid var(--color-border); cursor: pointer; flex: none;
  }
  .hex { font-size: 0.7rem; font-family: monospace; color: var(--color-text-muted); }
  .field-row input[type="range"] { flex: 1; accent-color: var(--color-accent); }
  .range-val { font-size: 0.7rem; color: var(--color-text-muted); min-width: 24px; text-align: right; }
  .divider { height: 1px; background: var(--color-border); margin: 0.2rem 0; }

  .toggle-btn {
    width: 26px; height: 26px; border-radius: 4px; border: 1px solid var(--color-border);
    background: var(--color-bg); color: var(--color-text-muted); cursor: pointer; font-size: 0.8rem;
  }
  .toggle-btn.active { background: var(--color-accent); border-color: var(--color-accent); color: white; }

  .align-grid { display: grid; grid-template-columns: repeat(3, 24px); gap: 2px; }
  .align-btn {
    width: 24px; height: 24px; border-radius: 3px; border: 1px solid var(--color-border);
    background: var(--color-bg); cursor: pointer; position: relative;
  }
  .align-btn::after {
    content: ''; position: absolute; width: 5px; height: 5px; border-radius: 50%;
    background: var(--color-text-muted); top: 50%; left: 50%; transform: translate(-50%, -50%);
  }
  .align-btn.active { background: var(--color-accent-subtle); border-color: var(--color-accent); }
  .align-btn.active::after { background: var(--color-accent); }
  .align-btn:hover:not(.active) { background: var(--color-surface-hover); }
</style>