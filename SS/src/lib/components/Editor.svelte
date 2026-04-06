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
  let sessionVal  = $state(null as any)
  let isDirtyVal  = $state(false)
  let templateVal = $state(null as any)
  let items       = $state([] as any[])
  let selIdx      = $state(null as number | null)

  $effect(() => {
    const u1 = session.subscribe(v => { sessionVal = v; items = v?.subtitles ?? []; selIdx = v?.selectedIndex ?? null })
    const u2 = isDirty.subscribe(v => { isDirtyVal = v })
    const u3 = activeTemplate.subscribe(v => { templateVal = v })
    return () => { u1(); u2(); u3() }
  })

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
      const s = srtToSeconds(sub.start), e = srtToSeconds(sub.end)
      return currentTime >= s && currentTime <= e
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

  let typewriterText = $derived((() => {
    if (!activeSub || templateVal?.animation !== 'typewriter') return null
    const chars    = [...activeSub.text]
    const startMs  = srtToSeconds(activeSub.start) * 1000
    const endMs    = srtToSeconds(activeSub.end)   * 1000
    const delayMs  = Math.max(30, Math.min(80, Math.floor((endMs - startMs) / chars.length)))
    const elapsed  = currentTime * 1000 - startMs
    const revealed = Math.min(chars.length, Math.max(0, Math.ceil(elapsed / delayMs)))
    return chars.slice(0, revealed).join('')
  })())

  function srtToSeconds(srt: string): number {
    if (!srt) return 0
    const [time, ms] = srt.split(',')
    const [h, m, s] = time.split(':').map(Number)
    return h * 3600 + m * 60 + s + (parseInt(ms) / 1000)
  }

  function onTimeUpdate()      { if (videoEl) currentTime = videoEl.currentTime }
  function onLoadedMetadata()  { if (videoEl) duration = videoEl.duration }
  function onVideoPlay()       { playing = true }
  function onVideoPause()      { playing = false }

  function togglePlay() {
    if (!videoEl) return
    playing ? videoEl.pause() : videoEl.play()
    playing = !playing
  }

  function seekTo(seconds: number) {
    if (videoEl) { videoEl.currentTime = seconds; currentTime = seconds }
  }

  function seekToSegment(sub: any) {
    seekTo(srtToSeconds(sub.start))
    const idx = items.indexOf(sub)
    if (idx !== -1) selectSegment(idx)
    if (videoEl && playing) { videoEl.pause(); playing = false }
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function getFileName(path: string) { return path.split(/[\\/]/).pop() ?? path }

  // ── Subtitle overlay helpers ───────────────────────────────────────────────
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
      case 'fade':      return 'animation:sub-fade 300ms ease-in-out forwards;'
      case 'pop':       return 'animation:sub-pop 350ms cubic-bezier(0.34,1.56,0.64,1) forwards;'
      case 'slide-up':  return 'animation:sub-slide-up 350ms ease-out forwards;'
      default:          return ''
    }
  }

  // ── Sidebar navigation ─────────────────────────────────────────────────────
  type PanelId = 'styles' | 'customize' | 'captions'
  let activePanel = $state<PanelId>('styles')

  // Customize sub-sections
  type SubSection = 'layout' | 'text' | 'animation' | 'wordbyword'
  let openSection = $state<SubSection | null>('text')

  function toggleSection(s: SubSection) { openSection = openSection === s ? null : s }

  // ── Template / styles helpers ──────────────────────────────────────────────
  const SYSTEM_FONTS = [
    'Arial','Arial Black','Comic Sans MS','Courier New','Georgia',
    'Impact','Lucida Console','Tahoma','Times New Roman',
    'Trebuchet MS','Verdana','Segoe UI','Calibri','Cambria','Consolas',
  ]

  let customFont       = $state(false)
  let templatesVal     = $state([] as any[])
  let showSaveDialog   = $state(false)
  let saveTemplateName = $state('')

  $effect(() => { const u = allTemplates.subscribe(v => { templatesVal = v }); return u })
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
    saveTemplateName = ''; showSaveDialog = false
  }

  // ── Segment inspector ──────────────────────────────────────────────────────
  let selectedSub  = $derived(selIdx !== null ? items[selIdx] : null)
  let overrides    = $derived(selectedSub?.overrides ?? {})
  let effective    = $derived(templateVal ? { ...templateVal, ...overrides } : null)
  let hasOverrides = $derived(!!selectedSub?.overrides && Object.keys(selectedSub.overrides).length > 0)

  function setOverride(key: string, value: any) {
    if (selIdx === null) return
    updateSubtitleOverrides(selIdx, { [key]: value })
  }
  function clearOverrides() { if (selIdx !== null) clearSubtitleOverrides(selIdx) }

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

  // ── Find & replace ─────────────────────────────────────────────────────────
  let searchTerm     = $state('')
  let replaceTerm    = $state('')
  let replaceMessage = $state('')

  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, 'all')
    replaceMessage = `${count} replaced`
    setTimeout(() => replaceMessage = '', 2500)
  }

  // ── Burn ───────────────────────────────────────────────────────────────────
  function handleBurn() {
    if (!sessionVal || !templateVal) return
    const assContent = buildAss(sessionVal.subtitles, templateVal)
    onburn({ videoPath: sessionVal.videoPath, outputPath: sessionVal.outputPath, assContent })
  }

  // ── Style card preview helper ──────────────────────────────────────────────
  function stylePreviewWords(t: any) {
    // Returns segments for the preview: [normal, highlighted, normal]
    return [
      { text: 'Every word ', highlight: false },
      { text: t.wordByWord ? 'matters' : 'Aa', highlight: t.wordByWord },
    ]
  }
</script>

<svelte:head>
  <style>
    @keyframes sub-fade     { from{opacity:0} to{opacity:1} }
    @keyframes sub-pop      { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
    @keyframes sub-slide-up { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
  </style>
</svelte:head>

<div class="editor">

  <!-- ── Topbar ─────────────────────────────────────────────────────────── -->
  <div class="topbar">
    <button class="back-btn" onclick={oncancel}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      Queue
    </button>
    <div class="file-info">
      <span class="file-name">{getFileName(sessionVal?.videoPath ?? '')}</span>
      {#if isDirtyVal}<span class="dirty-dot"></span>{/if}
    </div>
    <div class="spacer"></div>
    <button class="export-btn" onclick={handleBurn}>
      Export
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
  </div>

  <!-- ── Body ───────────────────────────────────────────────────────────── -->
  <div class="body">

    <!-- Video column -->
    <div class="video-col">
      <div class="video-wrap">
        {#if videoSrc}
          <video bind:this={videoEl} src={videoSrc}
            ontimeupdate={onTimeUpdate} onloadedmetadata={onLoadedMetadata}
            onplay={onVideoPlay} onpause={onVideoPause} class="video">
          </video>

          <!-- Subtitle overlay -->
          {#if activeSub && templateVal}
            {#key activeSub?.start}
            <div class="sub-overlay" style="position:absolute;{getAlignmentStyle(templateVal?.alignment ?? 2)}max-width:90%;pointer-events:auto;cursor:pointer;"
              onclick={() => seekToSegment(activeSub)}>
              <span style="display:inline-block;transform-origin:center bottom;
                font-family:{templateVal?.fontName ?? 'Arial'};
                font-size:{(templateVal?.fontSize ?? 24) * 0.8}px;
                font-weight:{templateVal?.bold ? 'bold' : 'normal'};
                font-style:{templateVal?.italic ? 'italic' : 'normal'};
                color:{templateVal?.primaryColor ?? '#fff'};
                text-shadow:-{templateVal?.outline ?? 2}px -{templateVal?.outline ?? 2}px 0 {templateVal?.outlineColor ?? '#000'},{templateVal?.outline ?? 2}px -{templateVal?.outline ?? 2}px 0 {templateVal?.outlineColor ?? '#000'},-{templateVal?.outline ?? 2}px {templateVal?.outline ?? 2}px 0 {templateVal?.outlineColor ?? '#000'},{templateVal?.outline ?? 2}px {templateVal?.outline ?? 2}px 0 {templateVal?.outlineColor ?? '#000'};
                padding:2px 8px;{getAnimationStyle(templateVal?.animation)}">
                {#if templateVal.wordByWord && templateVal.wordMode !== 'none'}
                  {#if templateVal.wordMode === 'solo'}
                    {#if activeWordIndex >= 0}
                      {@const sw = activeSub.text.trim().split(' ').filter((w:string)=>w.length>0)}
                      <span style="color:{templateVal.highlightColor};white-space:pre;">{sw[activeWordIndex]??''}</span>
                    {/if}
                  {:else}
                    {#each activeSub.text.trim().split(' ').filter((w:string)=>w.length>0) as word,wi}
                      {@const aw = activeSub.text.trim().split(' ').filter((w:string)=>w.length>0)}
                      <span style="color:{wi===activeWordIndex?templateVal.highlightColor:(templateVal?.primaryColor??'#fff')};white-space:pre;">{word}{wi<aw.length-1?' ':''}</span>
                    {/each}
                  {/if}
                {:else}
                  {templateVal?.animation==='typewriter' ? (typewriterText??'') : activeSub.text}
                {/if}
              </span>
            </div>
            {/key}
          {/if}

          <!-- Video controls -->
          <div class="video-controls">
            <button class="play-btn" onclick={togglePlay}>
              {#if playing}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              {/if}
            </button>
            <span class="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div class="progress-bar" role="slider" tabindex="0"
              aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration}
              onclick={(e) => { const r=e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX-r.left)/r.width)*duration) }}
              onkeydown={(e) => { if(e.key==='ArrowRight') seekTo(currentTime+5); if(e.key==='ArrowLeft') seekTo(currentTime-5) }}>
              <div class="progress-fill" style="width:{duration?(currentTime/duration)*100:0}%"></div>
            </div>
          </div>
        {:else}
          <div class="no-video">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/></svg>
            No video loaded
          </div>
        {/if}
      </div>

      <!-- Selected segment editor (below video) -->
      {#if selectedSub && effective}
        <div class="seg-editor">
          <div class="seg-header">
            <span class="seg-badge">#{selectedSub.index}</span>
            <span class="seg-time">{selectedSub.start.slice(0,8)} → {selectedSub.end.slice(0,8)}</span>
            <div class="seg-actions">
              {#if hasOverrides}
                <button class="seg-action-btn danger" onclick={clearOverrides}>Reset</button>
              {/if}
              <button class="seg-action-btn" onclick={() => selectSegment(null)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
          <textarea class="seg-textarea"
            use:initTextarea={selectedSub.text}
            oninput={(e) => updateSubtitleText(selIdx!, (e.currentTarget as HTMLTextAreaElement).value)}>
          </textarea>
          <div class="seg-overrides">
            <div class="or">
              <label>Text</label>
              <input type="color" value={effective.primaryColor} oninput={(e)=>setOverride('primaryColor',e.currentTarget.value)} />
              {#if 'primaryColor' in overrides}<span class="override-dot"></span>{/if}
            </div>
            <div class="or">
              <label>Outline</label>
              <input type="color" value={effective.outlineColor} oninput={(e)=>setOverride('outlineColor',e.currentTarget.value)} />
              {#if 'outlineColor' in overrides}<span class="override-dot"></span>{/if}
            </div>
            <div class="or">
              <label>Size</label>
              <input type="number" min="8" max="120" value={effective.fontSize} onchange={(e)=>setOverride('fontSize',Number(e.currentTarget.value))} />
              {#if 'fontSize' in overrides}<span class="override-dot"></span>{/if}
            </div>
            <div class="or">
              <label>Position</label>
              <select value={effective.alignment} onchange={(e)=>setOverride('alignment',Number(e.currentTarget.value))}>
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

    <!-- Right sidebar: icon strip + panel -->
    <div class="sidebar">

      <!-- Icon strip -->
      <div class="icon-strip">
        <button class="nav-btn {activePanel==='styles' ? 'active' : ''}"
          onclick={()=>activePanel='styles'} title="Styles">
          <!-- Styles: sparkle / wand -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M12 2l2.4 6.4L21 10l-6.6 2.4L12 19l-2.4-6.6L3 10l6.6-2.6z"/>
          </svg>
          <span class="nav-label">Styles</span>
        </button>

        <button class="nav-btn {activePanel==='customize' ? 'active' : ''}"
          onclick={()=>activePanel='customize'} title="Customize">
          <!-- Customize: sliders -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <line x1="4" y1="6" x2="20" y2="6"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/>
            <line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/>
            <line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/>
          </svg>
          <span class="nav-label">Customize</span>
        </button>

        <button class="nav-btn {activePanel==='captions' ? 'active' : ''}"
          onclick={()=>activePanel='captions'} title="Captions">
          <!-- Captions: text lines -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <rect x="3" y="5" width="18" height="14" rx="2"/>
            <path d="M7 9h6M7 13h4"/>
          </svg>
          <span class="nav-label">Captions</span>
        </button>
      </div>

      <!-- Panel content -->
      <div class="panel">

        <!-- ── STYLES panel ───────────────────────────────────────────── -->
        {#if activePanel === 'styles'}
          <div class="panel-header">
            <span class="panel-title">Styles</span>
            <button class="header-action-btn" onclick={()=>showSaveDialog=!showSaveDialog}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Save current
            </button>
          </div>

          {#if showSaveDialog}
            <div class="save-row">
              <input type="text" bind:value={saveTemplateName} placeholder="Template name…"
                onkeydown={(e)=>e.key==='Enter'&&handleSaveTemplate()} />
              <button class="save-confirm-btn" onclick={handleSaveTemplate}>Save</button>
              <button class="save-cancel-btn" onclick={()=>showSaveDialog=false}>✕</button>
            </div>
          {/if}

          <div class="styles-grid">
            {#each templatesVal as t}
              {@const isActive = templateVal?.id === t.id}
              <button class="style-card {isActive ? 'active' : ''}" onclick={() => handlePresetSelect(t.id)}>
                <!-- Rich preview -->
                <div class="style-preview" style="background:{t.outlineColor === '#000000' || t.outlineColor === '#1A1A1A' ? '#141414' : '#f0f0f0'};">
                  <div class="preview-inner">
                    {#if t.wordByWord && t.wordMode !== 'none'}
                      <span style="font-family:{t.fontName};font-weight:{t.bold?'700':'400'};font-style:{t.italic?'italic':'normal'};color:{t.primaryColor};font-size:10px;text-shadow:-1px -1px 0 {t.outlineColor},1px -1px 0 {t.outlineColor},-1px 1px 0 {t.outlineColor},1px 1px 0 {t.outlineColor};">Every </span><span style="font-family:{t.fontName};font-weight:{t.bold?'700':'400'};font-style:{t.italic?'italic':'normal'};color:{t.highlightColor};font-size:10px;text-shadow:-1px -1px 0 {t.outlineColor},1px -1px 0 {t.outlineColor},-1px 1px 0 {t.outlineColor},1px 1px 0 {t.outlineColor};">word</span>
                    {:else}
                      <span style="font-family:{t.fontName};font-weight:{t.bold?'700':'400'};font-style:{t.italic?'italic':'normal'};color:{t.primaryColor};font-size:11px;text-shadow:-1px -1px 0 {t.outlineColor},1px -1px 0 {t.outlineColor},-1px 1px 0 {t.outlineColor},1px 1px 0 {t.outlineColor};">Subtitle text</span>
                    {/if}
                  </div>
                </div>
                <div class="style-footer">
                  <span class="style-name">{t.name}</span>
                  {#if isActive}
                    <span class="style-active-dot"></span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}

        <!-- ── CUSTOMIZE panel ────────────────────────────────────────── -->
        {#if activePanel === 'customize' && templateVal}
          <div class="panel-header">
            <span class="panel-title">Customize</span>
            <span class="panel-subtitle">{templateVal.name}</span>
          </div>

          <div class="accordion-list">

            <!-- Layout section -->
            <div class="accordion-item">
              <button class="accordion-btn {openSection==='layout' ? 'open' : ''}" onclick={()=>toggleSection('layout')}>
                <span class="acc-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                </span>
                <span class="acc-label">Layout</span>
                <svg class="acc-chevron {openSection==='layout' ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {#if openSection === 'layout'}
                <div class="accordion-body">
                  <div class="field-row">
                    <label class="field-label">Position</label>
                    <div class="align-grid">
                      {#each [7,8,9,4,5,6,1,2,3] as pos}
                        <button class="align-btn {templateVal.alignment===pos ? 'active' : ''}"
                          onclick={()=>updateActiveTemplate({alignment:pos as Alignment})}
                          title={['','Bot L','Bot C','Bot R','Mid L','Mid C','Mid R','Top L','Top C','Top R'][pos]}>
                        </button>
                      {/each}
                    </div>
                  </div>
                  <div class="field-row">
                    <label class="field-label">Margin V</label>
                    <input type="range" class="field-range" min="0" max="100" value={templateVal.marginV}
                      oninput={(e)=>updateActiveTemplate({marginV:Number(e.currentTarget.value)})} />
                    <span class="field-val">{templateVal.marginV}</span>
                  </div>
                  <div class="field-row">
                    <label class="field-label">Margin L/R</label>
                    <input type="range" class="field-range" min="0" max="100" value={templateVal.marginL}
                      oninput={(e)=>updateActiveTemplate({marginL:Number(e.currentTarget.value),marginR:Number(e.currentTarget.value)})} />
                    <span class="field-val">{templateVal.marginL}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Text section -->
            <div class="accordion-item">
              <button class="accordion-btn {openSection==='text' ? 'open' : ''}" onclick={()=>toggleSection('text')}>
                <span class="acc-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
                </span>
                <span class="acc-label">Text</span>
                <svg class="acc-chevron {openSection==='text' ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {#if openSection === 'text'}
                <div class="accordion-body">
                  <div class="field-row">
                    <label class="field-label">Font</label>
                    <select class="field-select" onchange={handleFontSelect} value={customFont?'__custom__':templateVal.fontName}>
                      {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
                      <option value="__custom__">Custom…</option>
                    </select>
                  </div>
                  {#if customFont}
                    <div class="field-row">
                      <label class="field-label"></label>
                      <input class="field-input" type="text" value={templateVal.fontName} placeholder="Font name…"
                        onchange={(e)=>updateActiveTemplate({fontName:e.currentTarget.value})} />
                    </div>
                  {/if}
                  <div class="field-row">
                    <label class="field-label">Size</label>
                    <input class="field-input short" type="number" min="8" max="120" value={templateVal.fontSize}
                      onchange={(e)=>updateActiveTemplate({fontSize:Number(e.currentTarget.value)})} />
                    <button class="tog-btn {templateVal.bold ? 'on' : ''}" onclick={()=>updateActiveTemplate({bold:!templateVal.bold})}><b>B</b></button>
                    <button class="tog-btn {templateVal.italic ? 'on' : ''}" onclick={()=>updateActiveTemplate({italic:!templateVal.italic})}><i>I</i></button>
                  </div>
                  <div class="field-row">
                    <label class="field-label">Color</label>
                    <input type="color" class="color-swatch" value={templateVal.primaryColor} oninput={(e)=>updateActiveTemplate({primaryColor:e.currentTarget.value})} />
                    <span class="hex-label">{templateVal.primaryColor}</span>
                  </div>
                  <div class="field-row">
                    <label class="field-label">Outline</label>
                    <input type="color" class="color-swatch" value={templateVal.outlineColor} oninput={(e)=>updateActiveTemplate({outlineColor:e.currentTarget.value})} />
                    <input type="range" class="field-range sm" min="0" max="4" step="0.5" value={templateVal.outline}
                      oninput={(e)=>updateActiveTemplate({outline:Number(e.currentTarget.value)})} />
                    <span class="field-val">{templateVal.outline}</span>
                  </div>
                  <div class="field-row">
                    <label class="field-label">Shadow</label>
                    <input type="range" class="field-range" min="0" max="4" step="0.5" value={templateVal.shadow}
                      oninput={(e)=>updateActiveTemplate({shadow:Number(e.currentTarget.value)})} />
                    <span class="field-val">{templateVal.shadow}</span>
                  </div>
                  <div class="field-row">
                    <label class="field-label">Spacing</label>
                    <input type="range" class="field-range" min="0" max="10" step="0.5" value={templateVal.spacing}
                      oninput={(e)=>updateActiveTemplate({spacing:Number(e.currentTarget.value)})} />
                    <span class="field-val">{templateVal.spacing}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Word-by-word / highlight section -->
            <div class="accordion-item">
              <button class="accordion-btn {openSection==='wordbyword' ? 'open' : ''}" onclick={()=>toggleSection('wordbyword')}>
                <span class="acc-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="6" height="8" rx="1"/><rect x="11" y="8" width="10" height="8" rx="1" fill="currentColor" fill-opacity="0.2"/><path d="M11 12h10"/></svg>
                </span>
                <span class="acc-label">Word Highlight</span>
                {#if templateVal.wordByWord}
                  <span class="acc-badge">ON</span>
                {/if}
                <svg class="acc-chevron {openSection==='wordbyword' ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {#if openSection === 'wordbyword'}
                <div class="accordion-body">
                  <div class="field-row">
                    <label class="toggle-label">
                      <span>Enable word-by-word</span>
                      <button class="toggle-switch {templateVal.wordByWord ? 'on' : ''}"
                        onclick={()=>updateActiveTemplate({wordByWord:!templateVal.wordByWord})}>
                        <span class="toggle-thumb"></span>
                      </button>
                    </label>
                  </div>
                  {#if templateVal.wordByWord}
                    <div class="field-row">
                      <label class="field-label">Mode</label>
                      <div class="chip-group">
                        <button class="chip {templateVal.wordMode==='highlight' ? 'active' : ''}"
                          onclick={()=>updateActiveTemplate({wordMode:'highlight'})}>Highlight</button>
                        <button class="chip {templateVal.wordMode==='solo' ? 'active' : ''}"
                          onclick={()=>updateActiveTemplate({wordMode:'solo'})}>Solo</button>
                      </div>
                    </div>
                    <div class="field-row">
                      <label class="field-label">Color</label>
                      <input type="color" class="color-swatch" value={templateVal.highlightColor}
                        oninput={(e)=>updateActiveTemplate({highlightColor:e.currentTarget.value})} />
                      <span class="hex-label">{templateVal.highlightColor}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Animation section -->
            <div class="accordion-item">
              <button class="accordion-btn {openSection==='animation' ? 'open' : ''}" onclick={()=>toggleSection('animation')}>
                <span class="acc-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/><circle cx="5" cy="12" r="2" fill="currentColor" stroke="none"/></svg>
                </span>
                <span class="acc-label">Animation</span>
                {#if templateVal.animation && templateVal.animation !== 'none'}
                  <span class="acc-badge">{templateVal.animation}</span>
                {/if}
                <svg class="acc-chevron {openSection==='animation' ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {#if openSection === 'animation'}
                <div class="accordion-body">
                  <div class="field-row">
                    <label class="field-label">Transition</label>
                    <div class="chip-group wrap">
                      {#each ['none','fade','pop','slide-up','typewriter'] as anim}
                        <button class="chip {(templateVal.animation??'none')===anim ? 'active' : ''}"
                          onclick={()=>updateActiveTemplate({animation:anim as AnimationMode})}>
                          {anim === 'slide-up' ? 'Slide' : anim.charAt(0).toUpperCase()+anim.slice(1)}
                        </button>
                      {/each}
                    </div>
                  </div>
                  <div class="field-row">
                    <label class="field-label" title="Push subtitle start times forward to compensate for whisper early onset.">Sync offset</label>
                    <input type="range" class="field-range" min="0" max="300" step="10" value={templateVal.syncOffset??50}
                      oninput={(e)=>updateActiveTemplate({syncOffset:Number(e.currentTarget.value)})} />
                    <span class="field-val">{templateVal.syncOffset??50}ms</span>
                  </div>
                  <div class="field-row">
                    <label class="field-label" title="Inter-word gap that triggers a new line.">Pause split</label>
                    <input type="range" class="field-range" min="200" max="800" step="50" value={templateVal.pauseThreshold??500}
                      oninput={(e)=>updateActiveTemplate({pauseThreshold:Number(e.currentTarget.value)})} />
                    <span class="field-val">{templateVal.pauseThreshold??500}ms</span>
                  </div>
                </div>
              {/if}
            </div>

          </div>
        {/if}

        <!-- ── CAPTIONS panel ──────────────────────────────────────────── -->
        {#if activePanel === 'captions'}
          <div class="panel-header">
            <span class="panel-title">Captions</span>
            <span class="panel-count">{items.length}</span>
          </div>

          <!-- Actions row -->
          <div class="captions-actions">
            <button class="captions-action-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export SRT
            </button>
            <button class="captions-action-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import SRT
            </button>
          </div>

          <!-- Find & replace -->
          <div class="find-row">
            <div class="find-inputs">
              <input type="text" class="find-input" bind:value={searchTerm} placeholder="Find…" />
              <input type="text" class="find-input" bind:value={replaceTerm} placeholder="Replace with…" />
            </div>
            <button class="replace-btn" onclick={handleFindReplace}>Replace all</button>
            {#if replaceMessage}<span class="replace-msg">{replaceMessage}</span>{/if}
          </div>

          <!-- Segment list -->
          <div class="caption-list">
            {#each items as sub, i}
              <div class="caption-item {selIdx===i ? 'active' : ''}"
                onclick={()=>seekToSegment(sub)}
                role="button" tabindex="0"
                onkeydown={(e)=>e.key==='Enter'&&seekToSegment(sub)}>
                <div class="caption-meta">
                  <span class="cap-num">#{sub.index}</span>
                  <span class="cap-time">{sub.start.slice(0,8)}</span>
                </div>
                <div class="cap-text">{sub.text}</div>
              </div>
            {/each}
          </div>
        {/if}

      </div>
    </div>
  </div>
</div>

<style>
  /* ── CSS variables (mirror your global ones) ───────────────────────────── */
  :root {
    --panel-w: 300px;
    --strip-w: 56px;
    --radius: 8px;
    --radius-sm: 5px;
    --transition: 0.15s ease;
  }

  /* ── Reset & layout ─────────────────────────────────────────────────────── */
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-bg);
    font-size: 0.82rem;
  }

  /* ── Topbar ──────────────────────────────────────────────────────────────── */
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    height: 44px;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 0.78rem;
    cursor: pointer;
    transition: all var(--transition);
  }
  .back-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }

  .file-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .file-name {
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--color-text);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning, #f59e0b);
    flex-shrink: 0;
  }

  .spacer { flex: 1; }

  .export-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 1rem;
    border-radius: var(--radius-sm);
    border: none;
    background: var(--color-accent);
    color: white;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: filter var(--transition);
  }
  .export-btn:hover { filter: brightness(1.12); }

  /* ── Body ────────────────────────────────────────────────────────────────── */
  .body { display: flex; flex: 1; overflow: hidden; }

  /* ── Video column ────────────────────────────────────────────────────────── */
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
  .time-display { color: rgba(255,255,255,0.8); font-size: 0.7rem; font-family: monospace; white-space: nowrap; }
  .progress-bar {
    flex: 1;
    height: 3px;
    background: rgba(255,255,255,0.2);
    border-radius: 2px;
    cursor: pointer;
    position: relative;
  }
  .progress-bar:hover { height: 5px; }
  .progress-fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: 2px;
    pointer-events: none;
    transition: height var(--transition);
  }

  /* ── Segment editor ──────────────────────────────────────────────────────── */
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

  /* ── Sidebar ─────────────────────────────────────────────────────────────── */
  .sidebar {
    display: flex;
    flex-direction: row;
    border-left: 1px solid var(--color-border);
    width: calc(var(--strip-w) + var(--panel-w));
    flex-shrink: 0;
    overflow: hidden;
  }

  /* Icon strip */
  .icon-strip {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.6rem 0;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    width: var(--strip-w);
    flex-shrink: 0;
    gap: 0.1rem;
  }

  .nav-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    width: 44px;
    height: 50px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all var(--transition);
  }
  .nav-btn:hover { color: var(--color-text); background: var(--color-surface-hover); }
  .nav-btn.active {
    color: var(--color-accent);
    background: var(--color-accent-subtle, rgba(99,102,241,0.12));
  }
  .nav-label {
    font-size: 0.58rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    line-height: 1;
  }

  /* Panel */
  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-bg);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
    gap: 0.5rem;
  }
  .panel-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
  }
  .panel-subtitle {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-count {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    background: var(--color-surface-hover, rgba(255,255,255,0.06));
    padding: 0.1rem 0.45rem;
    border-radius: 99px;
  }

  .header-action-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text-muted);
    font-size: 0.68rem;
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--transition);
  }
  .header-action-btn:hover { color: var(--color-text); background: var(--color-surface-hover); }

  /* ── Styles grid ─────────────────────────────────────────────────────────── */
  .save-row {
    display: flex;
    gap: 0.3rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-hover, rgba(255,255,255,0.04));
    flex-shrink: 0;
  }
  .save-row input {
    flex: 1;
    padding: 0.25rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.73rem;
  }
  .save-confirm-btn {
    padding: 0.25rem 0.6rem;
    border-radius: var(--radius-sm);
    border: none;
    background: var(--color-accent);
    color: white;
    font-size: 0.73rem;
    cursor: pointer;
  }
  .save-cancel-btn {
    padding: 0.25rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 0.73rem;
    cursor: pointer;
  }

  .styles-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
    padding: 0.75rem;
    overflow-y: auto;
    flex: 1;
  }

  .style-card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--color-surface);
    cursor: pointer;
    transition: border-color var(--transition), box-shadow var(--transition);
    text-align: left;
    padding: 0;
  }
  .style-card:hover { border-color: var(--color-text-muted); }
  .style-card.active {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
  }

  .style-preview {
    width: 100%;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .preview-inner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0;
    padding: 0 0.4rem;
    text-align: center;
    line-height: 1.3;
  }

  .style-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.5rem;
    border-top: 1px solid var(--color-border);
  }
  .style-name {
    font-size: 0.65rem;
    color: var(--color-text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .style-active-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--color-accent);
  }

  /* ── Accordion ───────────────────────────────────────────────────────────── */
  .accordion-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .accordion-item {
    border-bottom: 1px solid var(--color-border);
  }

  .accordion-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.6rem 0.85rem;
    border: none;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    transition: background var(--transition);
  }
  .accordion-btn:hover { background: var(--color-surface-hover); }
  .accordion-btn.open { color: var(--color-accent); }

  .acc-icon {
    display: flex;
    align-items: center;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .accordion-btn.open .acc-icon { color: var(--color-accent); }

  .acc-label { flex: 1; }

  .acc-badge {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-accent);
    background: var(--color-accent-subtle, rgba(99,102,241,0.12));
    padding: 0.1rem 0.4rem;
    border-radius: 99px;
  }

  .acc-chevron {
    color: var(--color-text-muted);
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }
  .acc-chevron.rotated { transform: rotate(180deg); }

  .accordion-body {
    padding: 0.6rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    background: var(--color-bg);
  }

  /* ── Fields ──────────────────────────────────────────────────────────────── */
  .field-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 26px;
  }
  .field-label {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    min-width: 68px;
    flex-shrink: 0;
  }
  .field-range {
    flex: 1;
    accent-color: var(--color-accent);
    height: 3px;
  }
  .field-range.sm { flex: 0 0 60px; }
  .field-val {
    font-size: 0.68rem;
    color: var(--color-text-muted);
    min-width: 32px;
    text-align: right;
    font-family: monospace;
  }
  .field-select, .field-input {
    flex: 1;
    padding: 0.22rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.73rem;
    outline: none;
  }
  .field-select:focus, .field-input:focus { border-color: var(--color-accent); }
  .field-input.short { flex: 0 0 52px; }

  .color-swatch {
    width: 24px; height: 22px;
    padding: 1px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    cursor: pointer;
    flex-shrink: 0;
    background: none;
  }
  .hex-label {
    font-size: 0.68rem;
    font-family: monospace;
    color: var(--color-text-muted);
  }

  .tog-btn {
    width: 26px; height: 26px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 0.78rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
    flex-shrink: 0;
  }
  .tog-btn.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: white;
  }

  /* Alignment grid */
  .align-grid {
    display: grid;
    grid-template-columns: repeat(3, 24px);
    gap: 3px;
  }
  .align-btn {
    width: 24px; height: 24px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    cursor: pointer;
    position: relative;
    transition: all var(--transition);
  }
  .align-btn::after {
    content: '';
    position: absolute;
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--color-text-muted);
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
  }
  .align-btn.active {
    background: var(--color-accent-subtle, rgba(99,102,241,0.12));
    border-color: var(--color-accent);
  }
  .align-btn.active::after { background: var(--color-accent); }
  .align-btn:hover:not(.active) { background: var(--color-surface-hover); }

  /* Toggle switch */
  .toggle-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--color-text);
    cursor: pointer;
    width: 100%;
  }
  .toggle-switch {
    width: 36px; height: 20px;
    border-radius: 10px;
    background: var(--color-border);
    border: none;
    position: relative;
    cursor: pointer;
    transition: background var(--transition);
    flex-shrink: 0;
  }
  .toggle-switch.on { background: var(--color-accent); }
  .toggle-thumb {
    position: absolute;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: white;
    top: 3px; left: 3px;
    transition: transform var(--transition);
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }
  .toggle-switch.on .toggle-thumb { transform: translateX(16px); }

  /* Chip group */
  .chip-group {
    display: flex;
    gap: 0.3rem;
    flex-wrap: nowrap;
  }
  .chip-group.wrap { flex-wrap: wrap; }
  .chip {
    padding: 0.2rem 0.5rem;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
  }
  .chip:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .chip.active {
    background: var(--color-accent-subtle, rgba(99,102,241,0.12));
    border-color: var(--color-accent);
    color: var(--color-accent);
    font-weight: 600;
  }

  /* ── Captions panel ──────────────────────────────────────────────────────── */
  .captions-actions {
    display: flex;
    gap: 0.4rem;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .captions-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: 0.7rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition);
  }
  .captions-action-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }

  .find-row {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .find-inputs { display: flex; flex-direction: column; gap: 0.25rem; }
  .find-input {
    padding: 0.25rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.73rem;
    outline: none;
  }
  .find-input:focus { border-color: var(--color-accent); }
  .replace-btn {
    padding: 0.25rem 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: 0.72rem;
    cursor: pointer;
    align-self: flex-end;
    transition: all var(--transition);
  }
  .replace-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .replace-msg {
    font-size: 0.7rem;
    color: var(--color-success, #22c55e);
  }

  .caption-list { flex: 1; overflow-y: auto; }
  .caption-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.45rem 0.85rem;
    border-bottom: 1px solid var(--color-border);
    cursor: pointer;
    transition: background var(--transition);
    border-left: 2px solid transparent;
  }
  .caption-item:hover { background: var(--color-surface-hover); }
  .caption-item.active {
    background: var(--color-accent-subtle, rgba(99,102,241,0.08));
    border-left-color: var(--color-accent);
  }
  .caption-meta { display: flex; gap: 0.5rem; align-items: baseline; }
  .cap-num {
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--color-accent);
  }
  .cap-time {
    font-size: 0.62rem;
    color: var(--color-text-muted);
    font-family: monospace;
  }
  .cap-text {
    font-size: 0.78rem;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Animations ──────────────────────────────────────────────────────────── */
  :global {
    @keyframes sub-fade     { from{opacity:0} to{opacity:1} }
    @keyframes sub-pop      { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
    @keyframes sub-slide-up { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
  }
</style>