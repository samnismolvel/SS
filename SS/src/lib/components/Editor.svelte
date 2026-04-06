<script lang="ts">
  import { session, isDirty, findAndReplace, selectSegment, updateSubtitleText, updateSubtitleOverrides, clearSubtitleOverrides } from '$lib/stores/editor'
  import { activeTemplate, updateActiveTemplate, allTemplates, setActiveTemplate, saveActiveAsTemplate } from '$lib/stores/templates'
  import { buildAss, distributeWordTimings } from '$lib/utils/ass'
  import { convertFileSrc } from '@tauri-apps/api/core'
  import type { Subtitle, Template, WordMode, Alignment, AnimationMode } from '$lib/types'

  interface Props {
    onburn: (detail: { videoPath: string; outputPath: string; assContent: string }) => void
    oncancel: () => void
  }
  let { onburn, oncancel }: Props = $props()

  // ── Store subscriptions ────────────────────────────────────────────────────
  let sessionVal   = $state(null as any)
  let isDirtyVal   = $state(false)
  let templateVal  = $state(null as any)
  let items        = $state([] as any[])
  let selIdx       = $state(null as number | null)
  let templatesVal = $state([] as any[])

  $effect(() => {
    const u1 = session.subscribe(v => { sessionVal = v; items = v?.subtitles ?? []; selIdx = v?.selectedIndex ?? null })
    const u2 = isDirty.subscribe(v => { isDirtyVal = v })
    const u3 = activeTemplate.subscribe(v => { templateVal = v })
    const u4 = allTemplates.subscribe(v => { templatesVal = v })
    return () => { u1(); u2(); u3(); u4() }
  })

  // ── Sidebar nav state ──────────────────────────────────────────────────────
  type PanelId = 'styles' | 'customize' | 'captions' | null
  let activePanel = $state<PanelId>('styles')
  type CustomizeTab = 'layout' | 'text' | 'animation'
  let customizeTab = $state<CustomizeTab>('text')

  function togglePanel(id: PanelId) {
    activePanel = activePanel === id ? null : id
  }

  // ── Video player ───────────────────────────────────────────────────────────
  let videoEl     = $state(null as HTMLVideoElement | null)
  let currentTime = $state(0)
  let duration    = $state(0)
  let playing     = $state(false)
  let videoSrc    = $state('')

  $effect(() => { if (sessionVal?.videoPath) videoSrc = convertFileSrc(sessionVal.videoPath) })

  let activeSub = $derived((() => {
    if (!items.length) return null
    return items.find((sub: any) => {
      const start = srtToSeconds(sub.start)
      const end   = srtToSeconds(sub.end)
      return currentTime >= start && currentTime <= end
    }) ?? null
  })())

  let activeWordIndex = $derived((() => {
    if (!activeSub || !templateVal?.wordByWord) return -1
    const words = activeSub.text.trim().split(' ').filter((w: string) => w.length > 0)
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

  function srtToSeconds(srt: string): number {
    if (!srt) return 0
    const [time, ms] = srt.split(',')
    const [h, m, s]  = time.split(':').map(Number)
    return h * 3600 + m * 60 + s + (parseInt(ms) / 1000)
  }

  function onTimeUpdate()     { if (videoEl) currentTime = videoEl.currentTime }
  function onLoadedMetadata() { if (videoEl) duration = videoEl.duration }
  function onVideoPlay()      { playing = true }
  function onVideoPause()     { playing = false }
  function togglePlay()       { if (!videoEl) return; playing ? videoEl.pause() : videoEl.play(); playing = !playing }

  function seekTo(seconds: number) {
    if (videoEl) { videoEl.currentTime = seconds; currentTime = seconds }
  }
  function seekToSegment(sub: any) {
    seekTo(srtToSeconds(sub.start))
    const idx = items.indexOf(sub)
    if (idx !== -1) selectSegment(idx)
    if (videoEl && playing) { videoEl.pause(); playing = false }
  }

  function getAlignmentStyle(alignment: number): string {
    const p: Record<number, string> = {
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
    return p[alignment] ?? p[2]
  }

  function formatTime(s: number): string {
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  // ── Segment / overrides ────────────────────────────────────────────────────
  let selectedSub  = $derived(selIdx !== null ? items[selIdx] : null)
  let overrides    = $derived(selectedSub?.overrides ?? {})
  let effective    = $derived(templateVal ? { ...templateVal, ...overrides } : null)
  let hasOverrides = $derived(!!selectedSub?.overrides && Object.keys(selectedSub.overrides).length > 0)

  function setOverride(key: string, value: any) {
    if (selIdx === null) return
    updateSubtitleOverrides(selIdx, { [key]: value })
  }
  function clearOverrides() {
    if (selIdx === null) return
    clearSubtitleOverrides(selIdx)
  }

  // ── Find & replace ─────────────────────────────────────────────────────────
  let searchTerm     = $state('')
  let replaceTerm    = $state('')
  let findMode       = $state('all' as 'all' | 'single')
  let replaceMessage = $state('')

  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, findMode)
    replaceMessage = `Replaced ${count} occurrence${count !== 1 ? 's' : ''}`
    setTimeout(() => replaceMessage = '', 3000)
  }

  // ── Burn ───────────────────────────────────────────────────────────────────
  function handleBurn() {
    if (!sessionVal || !templateVal) return
    const assContent = buildAss(sessionVal.subtitles, templateVal)
    onburn({ videoPath: sessionVal.videoPath, outputPath: sessionVal.outputPath, assContent })
  }

  function getFileName(path: string) { return path.split(/[\\/]/).pop() ?? path }

  // ── Template helpers ───────────────────────────────────────────────────────
  const SYSTEM_FONTS = [
    'Arial','Arial Black','Comic Sans MS','Courier New','Georgia',
    'Impact','Lucida Console','Tahoma','Times New Roman',
    'Trebuchet MS','Verdana','Segoe UI','Calibri','Cambria','Consolas',
  ]
  let customFont       = $state(false)
  let showSaveDialog   = $state(false)
  let saveTemplateName = $state('')

  $effect(() => {
    if (templateVal?.fontName && !SYSTEM_FONTS.includes(templateVal.fontName)) customFont = true
  })

  function handleFontSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value
    if (val === '__custom__') customFont = true
    else { customFont = false; updateActiveTemplate({ fontName: val }) }
  }

  function handlePresetSelect(id: string) {
    const found = templatesVal.find((t: any) => t.id === id)
    if (found) setActiveTemplate(found)
  }

  function handleSaveTemplate() {
    if (!saveTemplateName.trim()) return
    saveActiveAsTemplate(saveTemplateName.trim())
    saveTemplateName = ''
    showSaveDialog = false
  }

  function initTextarea(node: HTMLTextAreaElement, text: string) {
    node.value = text
    node.style.height = 'auto'
    node.style.height = Math.max(56, node.scrollHeight) + 'px'
    return {
      update(newText: string) {
        if (document.activeElement !== node) {
          node.value = newText
          node.style.height = 'auto'
          node.style.height = Math.max(56, node.scrollHeight) + 'px'
        }
      }
    }
  }
</script>

<div class="editor">

  <!-- ── Topbar ──────────────────────────────────────────────────────────── -->
  <div class="topbar">
    <button class="back-btn" onclick={oncancel}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg>
      Queue
    </button>
    <div class="file-info">
      <span class="file-name">{getFileName(sessionVal?.videoPath ?? '')}</span>
      <span class="seg-count">{items.length} segments</span>
      {#if isDirtyVal}<span class="dirty-badge">unsaved</span>{/if}
    </div>
    <div class="spacer"></div>
    <button class="btn-burn" onclick={handleBurn}>
      Export
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>
    </button>
  </div>

  <!-- ── Body ────────────────────────────────────────────────────────────── -->
  <div class="body">

    <!-- Sidebar icon rail -->
    <nav class="sidebar-rail">
      <button class="rail-btn" class:active={activePanel === 'styles'} onclick={() => togglePanel('styles')} title="Styles">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        <span>Styles</span>
      </button>
      <button class="rail-btn" class:active={activePanel === 'customize'} onclick={() => togglePanel('customize')} title="Customize">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/></svg>
        <span>Customize</span>
      </button>
      <button class="rail-btn" class:active={activePanel === 'captions'} onclick={() => togglePanel('captions')} title="Captions">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="14" y2="13"/><line x1="7" y1="17" x2="11" y2="17"/></svg>
        <span>Captions</span>
      </button>
    </nav>

    <!-- Expandable side panel -->
    {#if activePanel !== null}
      <div class="side-panel">

        <!-- ── STYLES ─────────────────────────────────────────────────── -->
        {#if activePanel === 'styles'}
          <div class="panel-header">
            <span class="panel-title">Styles</span>
            {#if showSaveDialog}
              <div class="save-inline">
                <input type="text" bind:value={saveTemplateName} placeholder="Name…" class="save-input"
                  onkeydown={(e) => e.key === 'Enter' && handleSaveTemplate()} />
                <button class="save-confirm" onclick={handleSaveTemplate}>Save</button>
                <button class="save-cancel" onclick={() => showSaveDialog = false}>✕</button>
              </div>
            {:else}
              <button class="save-btn" onclick={() => showSaveDialog = true}>+ Save current</button>
            {/if}
          </div>
          <div class="styles-grid">
            {#each templatesVal as t}
              <button class="style-card" class:active={templateVal?.id === t.id} onclick={() => handlePresetSelect(t.id)}>
                <div class="style-preview" style="font-family:{t.fontName};font-size:{Math.min(t.fontSize*0.45,18)}px;font-weight:{t.bold?'bold':'normal'};font-style:{t.italic?'italic':'normal'};color:{t.primaryColor};text-shadow:-{t.outline}px -{t.outline}px 0 {t.outlineColor},{t.outline}px {t.outline}px 0 {t.outlineColor};">
                  {#if t.wordByWord && t.wordMode !== 'none'}
                    <span>Every </span><span style="color:{t.highlightColor}">word</span><span> counts</span>
                  {:else}Every word counts{/if}
                </div>
                <span class="style-name">{t.name}</span>
                {#if templateVal?.id === t.id}<span class="style-active-badge">Active</span>{/if}
              </button>
            {/each}
          </div>

        <!-- ── CUSTOMIZE ──────────────────────────────────────────────── -->
        {:else if activePanel === 'customize'}
          <div class="panel-header">
            <span class="panel-title">Customize</span>
          </div>
          <div class="sub-tabs">
            <button class="sub-tab" class:active={customizeTab==='layout'}    onclick={() => customizeTab='layout'}>Layout</button>
            <button class="sub-tab" class:active={customizeTab==='text'}      onclick={() => customizeTab='text'}>Text</button>
            <button class="sub-tab" class:active={customizeTab==='animation'} onclick={() => customizeTab='animation'}>Animation</button>
          </div>
          <div class="panel-body">
            {#if templateVal}

              {#if customizeTab === 'layout'}
                <p class="section-label">Position</p>
                <div class="align-grid-large">
                  {#each [7,8,9,4,5,6,1,2,3] as pos}
                    <button class="align-btn-large" class:active={templateVal.alignment===pos}
                      onclick={() => updateActiveTemplate({ alignment: pos as Alignment })}></button>
                  {/each}
                </div>
                <p class="section-label" style="margin-top:1.1rem">Vertical margin</p>
                <div class="slider-row">
                  <input type="range" min="0" max="200" value={templateVal.marginV}
                    oninput={(e) => updateActiveTemplate({ marginV: Number(e.currentTarget.value) })} />
                  <span class="range-val">{templateVal.marginV}px</span>
                </div>
                <div class="divider"></div>
                <p class="section-label">Timing</p>
                <label class="field-label">Sync offset</label>
                <div class="slider-row">
                  <input type="range" min="0" max="300" step="10" value={templateVal.syncOffset??120}
                    oninput={(e) => updateActiveTemplate({ syncOffset: Number(e.currentTarget.value) })} />
                  <span class="range-val">{templateVal.syncOffset??120}ms</span>
                </div>
                <label class="field-label">Pause split</label>
                <div class="slider-row">
                  <input type="range" min="200" max="800" step="50" value={templateVal.pauseThreshold??500}
                    oninput={(e) => updateActiveTemplate({ pauseThreshold: Number(e.currentTarget.value) })} />
                  <span class="range-val">{templateVal.pauseThreshold??500}ms</span>
                </div>

              {:else if customizeTab === 'text'}
                <p class="section-label">Font</p>
                <select class="full-select" onchange={handleFontSelect} value={customFont?'__custom__':templateVal.fontName}>
                  {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
                  <option value="__custom__">Custom…</option>
                </select>
                {#if customFont}
                  <input type="text" class="full-input" value={templateVal.fontName} placeholder="Font name…"
                    onchange={(e) => updateActiveTemplate({ fontName: e.currentTarget.value })} />
                {/if}
                <div class="two-col" style="margin-top:0.6rem">
                  <div>
                    <label class="field-label">Size</label>
                    <input type="number" class="num-input" min="8" max="120" value={templateVal.fontSize}
                      onchange={(e) => updateActiveTemplate({ fontSize: Number(e.currentTarget.value) })} />
                  </div>
                  <div class="toggle-pair">
                    <button class="toggle-btn" class:active={templateVal.bold}   onclick={() => updateActiveTemplate({ bold: !templateVal.bold })}><b>B</b></button>
                    <button class="toggle-btn" class:active={templateVal.italic} onclick={() => updateActiveTemplate({ italic: !templateVal.italic })}><i>I</i></button>
                  </div>
                </div>
                <div class="divider"></div>
                <p class="section-label">Colors</p>
                <div class="color-row">
                  <span class="color-label">Text</span>
                  <input type="color" value={templateVal.primaryColor} oninput={(e) => updateActiveTemplate({ primaryColor: e.currentTarget.value })} />
                  <span class="hex-val">{templateVal.primaryColor}</span>
                </div>
                <div class="color-row">
                  <span class="color-label">Outline</span>
                  <input type="color" value={templateVal.outlineColor} oninput={(e) => updateActiveTemplate({ outlineColor: e.currentTarget.value })} />
                  <span class="hex-val">{templateVal.outlineColor}</span>
                </div>
                <div class="color-row">
                  <span class="color-label">Background</span>
                  <input type="color" value={templateVal.backColor} oninput={(e) => updateActiveTemplate({ backColor: e.currentTarget.value })} />
                  <span class="hex-val">{templateVal.backColor}</span>
                </div>
                <div class="divider"></div>
                <p class="section-label">Stroke &amp; shadow</p>
                <label class="field-label">Outline width</label>
                <div class="slider-row">
                  <input type="range" min="0" max="4" step="0.5" value={templateVal.outline}
                    oninput={(e) => updateActiveTemplate({ outline: Number(e.currentTarget.value) })} />
                  <span class="range-val">{templateVal.outline}</span>
                </div>
                <label class="field-label">Shadow depth</label>
                <div class="slider-row">
                  <input type="range" min="0" max="4" step="0.5" value={templateVal.shadow}
                    oninput={(e) => updateActiveTemplate({ shadow: Number(e.currentTarget.value) })} />
                  <span class="range-val">{templateVal.shadow}</span>
                </div>
                <label class="field-label">Letter spacing</label>
                <div class="slider-row">
                  <input type="range" min="0" max="10" step="0.5" value={templateVal.spacing}
                    oninput={(e) => updateActiveTemplate({ spacing: Number(e.currentTarget.value) })} />
                  <span class="range-val">{templateVal.spacing}</span>
                </div>
                <div class="divider"></div>
                <p class="section-label">Word highlight</p>
                <label class="checkbox-label">
                  <input type="checkbox" checked={templateVal.wordByWord}
                    onchange={(e) => updateActiveTemplate({ wordByWord: e.currentTarget.checked })} />
                  Word-by-word mode
                </label>
                {#if templateVal.wordByWord}
                  <label class="field-label" style="margin-top:0.5rem">Mode</label>
                  <select class="full-select" value={templateVal.wordMode}
                    onchange={(e) => updateActiveTemplate({ wordMode: e.currentTarget.value as WordMode })}>
                    <option value="highlight">Highlight</option>
                    <option value="solo">Solo</option>
                  </select>
                  <div class="color-row" style="margin-top:0.5rem">
                    <span class="color-label">Highlight</span>
                    <input type="color" value={templateVal.highlightColor} oninput={(e) => updateActiveTemplate({ highlightColor: e.currentTarget.value })} />
                    <span class="hex-val">{templateVal.highlightColor}</span>
                  </div>
                {/if}

              {:else if customizeTab === 'animation'}
                <p class="section-label">Caption transition</p>
                <div class="pill-grid">
                  {#each ['none','fade','pop','slide-up','typewriter'] as anim}
                    <button class="pill-btn" class:active={(templateVal.animation??'none')===anim}
                      onclick={() => updateActiveTemplate({ animation: anim as AnimationMode })}>
                      {anim === 'slide-up' ? 'Slide up' : anim.charAt(0).toUpperCase() + anim.slice(1)}
                    </button>
                  {/each}
                </div>
              {/if}

            {/if}
          </div>

        <!-- ── CAPTIONS ───────────────────────────────────────────────── -->
        {:else if activePanel === 'captions'}
          <div class="panel-header">
            <span class="panel-title">Captions</span>
          </div>
          <div class="find-replace-block">
            <div class="fr-row">
              <input type="text" bind:value={searchTerm} placeholder="Find…" class="fr-in" />
              <input type="text" bind:value={replaceTerm} placeholder="Replace…" class="fr-in" />
              <select bind:value={findMode} class="fr-sel">
                <option value="all">All</option>
                <option value="single">First</option>
              </select>
              <button class="fr-btn" onclick={handleFindReplace}>Go</button>
            </div>
            {#if replaceMessage}<p class="replace-msg">{replaceMessage}</p>{/if}
          </div>
          <div class="seg-list">
            {#each items as sub, idx}
              <div class="seg-item" class:selected={selIdx===idx} onclick={() => seekToSegment(sub)}>
                <div class="seg-item-header">
                  <span class="seg-num">#{sub.index}</span>
                  <span class="seg-time">{sub.start.split(',')[0]} → {sub.end.split(',')[0]}</span>
                  {#if sub.overrides && Object.keys(sub.overrides).length > 0}
                    <span class="override-pip" title="Has overrides"></span>
                  {/if}
                </div>
                {#if selIdx === idx}
                  <textarea class="seg-textarea" use:initTextarea={sub.text}
                    oninput={(e) => updateSubtitleText(idx, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
                  <div class="seg-actions">
                    {#if hasOverrides}
                      <button class="seg-action-btn danger" onclick={(e) => { e.stopPropagation(); clearOverrides() }}>Clear overrides</button>
                    {/if}
                    <button class="seg-action-btn" onclick={(e) => { e.stopPropagation(); selectSegment(null) }}>Done</button>
                  </div>
                  <div class="seg-overrides">
                    <div class="override-row">
                      <label>Color</label>
                      <input type="color" value={effective?.primaryColor??'#ffffff'} oninput={(e) => setOverride('primaryColor', e.currentTarget.value)} />
                      {#if 'primaryColor' in overrides}<span class="override-dot"></span>{/if}
                    </div>
                    <div class="override-row">
                      <label>Outline</label>
                      <input type="color" value={effective?.outlineColor??'#000000'} oninput={(e) => setOverride('outlineColor', e.currentTarget.value)} />
                      {#if 'outlineColor' in overrides}<span class="override-dot"></span>{/if}
                    </div>
                    <div class="override-row">
                      <label>Size</label>
                      <input type="number" min="8" max="120" value={effective?.fontSize??24} onchange={(e) => setOverride('fontSize', Number(e.currentTarget.value))} />
                      {#if 'fontSize' in overrides}<span class="override-dot"></span>{/if}
                    </div>
                    <div class="override-row">
                      <label>Align</label>
                      <select value={effective?.alignment??2} onchange={(e) => setOverride('alignment', Number(e.currentTarget.value))}>
                        <option value={7}>Top L</option><option value={8}>Top C</option><option value={9}>Top R</option>
                        <option value={4}>Mid L</option><option value={5}>Mid C</option><option value={6}>Mid R</option>
                        <option value={1}>Bot L</option><option value={2}>Bot C</option><option value={3}>Bot R</option>
                      </select>
                      {#if 'alignment' in overrides}<span class="override-dot"></span>{/if}
                    </div>
                  </div>
                {:else}
                  <p class="seg-text-preview">{sub.text}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

      </div>
    {/if}

    <!-- ── Video area ────────────────────────────────────────────────────── -->
    <div class="video-area">
      <div class="video-wrap">
        {#if videoSrc}
          <video bind:this={videoEl} src={videoSrc}
            ontimeupdate={onTimeUpdate} onloadedmetadata={onLoadedMetadata}
            onplay={onVideoPlay} onpause={onVideoPause} class="video"></video>

          {#if activeSub && templateVal}
            <div class="sub-overlay" style="
              position:absolute;
              {getAlignmentStyle(effective?.alignment??2)}
              font-family:{effective?.fontName??'Arial'};
              font-size:{(effective?.fontSize??24)*0.8}px;
              font-weight:{effective?.bold?'bold':'normal'};
              font-style:{effective?.italic?'italic':'normal'};
              color:{effective?.primaryColor??'#ffffff'};
              text-shadow:
                -{effective?.outline??2}px -{effective?.outline??2}px 0 {effective?.outlineColor??'#000'},
                 {effective?.outline??2}px -{effective?.outline??2}px 0 {effective?.outlineColor??'#000'},
                -{effective?.outline??2}px  {effective?.outline??2}px 0 {effective?.outlineColor??'#000'},
                 {effective?.outline??2}px  {effective?.outline??2}px 0 {effective?.outlineColor??'#000'};
              max-width:90%;pointer-events:auto;cursor:pointer;padding:2px 8px;"
              onclick={() => seekToSegment(activeSub)}>
              {#if templateVal.wordByWord && templateVal.wordMode !== 'none'}
                {#if templateVal.wordMode === 'solo'}
                  {#if activeWordIndex >= 0}
                    {@const sw = activeSub.text.trim().split(' ').filter((w: string) => w.length > 0)}
                    <span style="color:{templateVal.highlightColor};white-space:pre;">{sw[activeWordIndex]??''}</span>
                  {/if}
                {:else}
                  {#each activeSub.text.trim().split(' ').filter((w: string) => w.length > 0) as word, wi}
                    {@const aw = activeSub.text.trim().split(' ').filter((w: string) => w.length > 0)}
                    <span style="color:{wi===activeWordIndex?templateVal.highlightColor:(effective?.primaryColor??'#fff')};white-space:pre;">{word}{wi<aw.length-1?' ':''}</span>
                  {/each}
                {/if}
              {:else}
                {activeSub.text}
              {/if}
            </div>
          {/if}

          <div class="video-controls">
            <button class="play-btn" onclick={togglePlay}>{playing?'⏸':'▶'}</button>
            <span class="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div class="progress-bar"
              onclick={(e) => { const r=e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX-r.left)/r.width)*duration) }}
              role="slider" tabindex="0" aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration}
              onkeydown={(e) => { if(e.key==='ArrowRight') seekTo(currentTime+5); if(e.key==='ArrowLeft') seekTo(currentTime-5) }}>
              <div class="progress-fill" style="width:{duration?(currentTime/duration)*100:0}%"></div>
            </div>
          </div>
        {:else}
          <div class="no-video">No video loaded</div>
        {/if}
      </div>
    </div>

  </div>
</div>

<style>
  .editor { display:flex; flex-direction:column; height:100%; overflow:hidden; background:var(--color-bg); }

  /* Topbar */
  .topbar { display:flex; align-items:center; gap:0.75rem; padding:0.45rem 1rem; border-bottom:1px solid var(--color-border); background:var(--color-surface); flex-shrink:0; }
  .back-btn { display:flex; align-items:center; gap:0.3rem; padding:0.3rem 0.65rem; border-radius:6px; border:1px solid var(--color-border); background:transparent; color:var(--color-text-muted); font-size:0.78rem; cursor:pointer; }
  .back-btn:hover { background:var(--color-surface-hover); color:var(--color-text); }
  .file-info { display:flex; align-items:center; gap:0.5rem; }
  .file-name { font-weight:600; font-size:0.85rem; }
  .seg-count { font-size:0.75rem; color:var(--color-text-muted); }
  .dirty-badge { font-size:0.68rem; padding:2px 6px; border-radius:20px; background:var(--color-warning-subtle); color:var(--color-warning); }
  .spacer { flex:1; }
  .btn-burn { display:flex; align-items:center; gap:0.35rem; padding:0.38rem 1rem; border-radius:7px; border:none; background:var(--color-accent); color:white; font-size:0.82rem; font-weight:600; cursor:pointer; }
  .btn-burn:hover { filter:brightness(1.1); }

  /* Body */
  .body { display:flex; flex:1; overflow:hidden; }

  /* Rail */
  .sidebar-rail { width:64px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; padding:0.75rem 0; gap:0.25rem; background:var(--color-surface); border-right:1px solid var(--color-border); }
  .rail-btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.25rem; width:52px; padding:0.5rem 0.25rem; border-radius:8px; border:none; background:transparent; color:var(--color-text-muted); cursor:pointer; font-size:0.57rem; letter-spacing:0.02em; text-transform:uppercase; transition:background 0.15s,color 0.15s; }
  .rail-btn:hover { background:var(--color-surface-hover); color:var(--color-text); }
  .rail-btn.active { background:var(--color-accent-subtle); color:var(--color-accent); }

  /* Side panel */
  .side-panel { width:260px; flex-shrink:0; display:flex; flex-direction:column; overflow:hidden; background:var(--color-surface); border-right:1px solid var(--color-border); }
  .panel-header { display:flex; align-items:center; justify-content:space-between; padding:0.7rem 0.9rem; border-bottom:1px solid var(--color-border); flex-shrink:0; }
  .panel-title { font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--color-text-muted); }
  .save-btn { font-size:0.68rem; padding:0.2rem 0.5rem; border-radius:4px; border:1px solid var(--color-border); background:transparent; color:var(--color-text-muted); cursor:pointer; }
  .save-btn:hover { background:var(--color-surface-hover); color:var(--color-text); }
  .save-inline { display:flex; align-items:center; gap:0.3rem; }
  .save-input { font-size:0.7rem; padding:0.2rem 0.4rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); width:86px; }
  .save-confirm { font-size:0.68rem; padding:0.2rem 0.45rem; border-radius:4px; border:none; background:var(--color-accent); color:white; cursor:pointer; }
  .save-cancel { font-size:0.68rem; padding:0.2rem 0.4rem; border-radius:4px; border:1px solid var(--color-border); background:transparent; color:var(--color-text-muted); cursor:pointer; }

  /* Styles grid */
  .styles-grid { flex:1; overflow-y:auto; padding:0.75rem; display:flex; flex-direction:column; gap:0.55rem; }
  .style-card { position:relative; border-radius:8px; border:1.5px solid var(--color-border); background:var(--color-bg); cursor:pointer; overflow:hidden; text-align:left; padding:0; transition:border-color 0.15s; width:100%; }
  .style-card:hover { border-color:var(--color-text-muted); }
  .style-card.active { border-color:var(--color-accent); }
  .style-preview { width:100%; padding:0.9rem 0.75rem; display:flex; align-items:center; justify-content:center; min-height:52px; background:#111; overflow:hidden; }
  .style-name { display:block; padding:0.3rem 0.6rem; font-size:0.68rem; color:var(--color-text-muted); border-top:1px solid var(--color-border); text-transform:uppercase; letter-spacing:0.04em; }
  .style-active-badge { position:absolute; top:0.35rem; right:0.35rem; font-size:0.58rem; padding:1px 5px; border-radius:3px; background:var(--color-accent); color:white; }

  /* Sub-tabs */
  .sub-tabs { display:flex; border-bottom:1px solid var(--color-border); flex-shrink:0; }
  .sub-tab { flex:1; padding:0.48rem 0.2rem; font-size:0.7rem; border:none; background:transparent; color:var(--color-text-muted); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; transition:color 0.15s; }
  .sub-tab:hover { color:var(--color-text); }
  .sub-tab.active { color:var(--color-accent); border-bottom-color:var(--color-accent); }

  /* Panel body */
  .panel-body { flex:1; overflow-y:auto; padding:0.8rem 0.9rem; display:flex; flex-direction:column; gap:0.38rem; }
  .section-label { font-size:0.63rem; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:var(--color-text-muted); margin:0 0 0.35rem; }
  .field-label { font-size:0.68rem; color:var(--color-text-muted); margin-bottom:0.18rem; display:block; }
  .divider { height:1px; background:var(--color-border); margin:0.65rem 0; }

  .slider-row { display:flex; align-items:center; gap:0.5rem; }
  .slider-row input[type="range"] { flex:1; accent-color:var(--color-accent); }
  .range-val { font-size:0.65rem; color:var(--color-text-muted); min-width:36px; text-align:right; white-space:nowrap; }

  .full-select,.full-input { width:100%; padding:0.28rem 0.45rem; border-radius:5px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.73rem; box-sizing:border-box; }
  .full-select:focus,.full-input:focus { outline:none; border-color:var(--color-accent); }
  .full-input { margin-top:0.3rem; }

  .two-col { display:flex; align-items:flex-end; gap:0.6rem; }
  .num-input { width:56px; padding:0.28rem 0.38rem; border-radius:5px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.73rem; }
  .toggle-pair { display:flex; gap:0.3rem; margin-left:auto; }
  .toggle-btn { width:28px; height:28px; border-radius:5px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text-muted); cursor:pointer; font-size:0.78rem; }
  .toggle-btn.active { background:var(--color-accent); border-color:var(--color-accent); color:white; }

  .color-row { display:flex; align-items:center; gap:0.5rem; padding:0.22rem 0; }
  .color-label { font-size:0.7rem; color:var(--color-text-muted); min-width:60px; }
  .color-row input[type="color"] { width:26px; height:22px; padding:1px; border-radius:4px; border:1px solid var(--color-border); cursor:pointer; }
  .hex-val { font-size:0.65rem; font-family:monospace; color:var(--color-text-muted); }

  .checkbox-label { display:flex; align-items:center; gap:0.4rem; font-size:0.76rem; color:var(--color-text); cursor:pointer; }

  .align-grid-large { display:grid; grid-template-columns:repeat(3,1fr); gap:4px; }
  .align-btn-large { aspect-ratio:1; border-radius:5px; border:1.5px solid var(--color-border); background:var(--color-bg); cursor:pointer; position:relative; }
  .align-btn-large::after { content:''; position:absolute; width:6px; height:6px; border-radius:50%; background:var(--color-text-muted); top:50%; left:50%; transform:translate(-50%,-50%); }
  .align-btn-large.active { background:var(--color-accent-subtle); border-color:var(--color-accent); }
  .align-btn-large.active::after { background:var(--color-accent); }
  .align-btn-large:hover:not(.active) { background:var(--color-surface-hover); }

  .pill-grid { display:flex; flex-wrap:wrap; gap:0.38rem; }
  .pill-btn { padding:0.28rem 0.65rem; border-radius:20px; border:1.5px solid var(--color-border); background:var(--color-bg); color:var(--color-text-muted); font-size:0.7rem; cursor:pointer; transition:all 0.15s; }
  .pill-btn:hover { border-color:var(--color-text-muted); color:var(--color-text); }
  .pill-btn.active { background:var(--color-accent-subtle); border-color:var(--color-accent); color:var(--color-accent); }

  /* Captions */
  .find-replace-block { padding:0.55rem 0.75rem; border-bottom:1px solid var(--color-border); flex-shrink:0; }
  .fr-row { display:flex; gap:0.3rem; flex-wrap:wrap; }
  .fr-in { flex:1; min-width:68px; padding:0.22rem 0.38rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.7rem; }
  .fr-sel { padding:0.22rem 0.28rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.7rem; }
  .fr-btn { padding:0.22rem 0.48rem; border-radius:4px; border:none; background:var(--color-accent); color:white; font-size:0.7rem; cursor:pointer; }
  .replace-msg { font-size:0.68rem; color:var(--color-success); margin:0.28rem 0 0; }

  .seg-list { flex:1; overflow-y:auto; padding:0.45rem; display:flex; flex-direction:column; gap:0.3rem; }
  .seg-item { border-radius:7px; border:1px solid var(--color-border); background:var(--color-bg); cursor:pointer; padding:0.48rem 0.58rem; transition:border-color 0.12s; }
  .seg-item:hover { border-color:var(--color-text-muted); }
  .seg-item.selected { border-color:var(--color-accent); background:var(--color-surface); }
  .seg-item-header { display:flex; align-items:center; gap:0.38rem; margin-bottom:0.28rem; }
  .seg-num { font-size:0.62rem; font-weight:700; color:var(--color-accent); }
  .seg-time { font-size:0.6rem; color:var(--color-text-muted); font-family:monospace; flex:1; }
  .override-pip { width:5px; height:5px; border-radius:50%; background:var(--color-warning); }
  .seg-text-preview { font-size:0.76rem; color:var(--color-text); margin:0; line-height:1.4; }
  .seg-textarea { width:100%; padding:0.32rem 0.48rem; border-radius:5px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.78rem; font-family:inherit; resize:none; overflow:hidden; min-height:52px; box-sizing:border-box; line-height:1.5; outline:none; }
  .seg-textarea:focus { border-color:var(--color-accent); }
  .seg-actions { display:flex; gap:0.38rem; margin-top:0.38rem; justify-content:flex-end; }
  .seg-action-btn { font-size:0.66rem; padding:0.18rem 0.48rem; border-radius:4px; border:1px solid var(--color-border); background:transparent; color:var(--color-text-muted); cursor:pointer; }
  .seg-action-btn:hover { background:var(--color-surface-hover); color:var(--color-text); }
  .seg-action-btn.danger { border-color:var(--color-danger); color:var(--color-danger); }
  .seg-action-btn.danger:hover { background:var(--color-danger-subtle); }
  .seg-overrides { display:flex; flex-direction:column; gap:0.28rem; margin-top:0.38rem; padding-top:0.38rem; border-top:1px solid var(--color-border); }
  .override-row { display:flex; align-items:center; gap:0.38rem; }
  .override-row label { font-size:0.65rem; color:var(--color-text-muted); min-width:40px; }
  .override-row input[type="color"] { width:23px; height:21px; padding:1px; border-radius:3px; border:1px solid var(--color-border); cursor:pointer; }
  .override-row input[type="number"] { width:48px; padding:0.14rem 0.28rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.7rem; }
  .override-row select { flex:1; padding:0.14rem 0.28rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.7rem; }
  .override-dot { width:5px; height:5px; border-radius:50%; background:var(--color-accent); flex-shrink:0; }

  /* Video */
  .video-area { flex:1; display:flex; flex-direction:column; overflow:hidden; }
  .video-wrap { flex:1; position:relative; background:#000; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .video { width:100%; height:100%; object-fit:contain; display:block; }
  .no-video { color:#555; font-size:0.9rem; }
  .sub-overlay { position:absolute; line-height:1.3; border-radius:3px; }
  .sub-overlay:hover { opacity:0.85; }
  .video-controls { position:absolute; bottom:0; left:0; right:0; display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.75rem; background:linear-gradient(transparent,rgba(0,0,0,0.75)); }
  .play-btn { background:none; border:none; color:white; font-size:1rem; cursor:pointer; padding:0; width:26px; }
  .time-display { color:rgba(255,255,255,0.8); font-size:0.7rem; white-space:nowrap; font-family:monospace; }
  .progress-bar { flex:1; height:3px; background:rgba(255,255,255,0.25); border-radius:2px; cursor:pointer; position:relative; }
  .progress-fill { height:100%; background:var(--color-accent); border-radius:2px; pointer-events:none; }
</style>