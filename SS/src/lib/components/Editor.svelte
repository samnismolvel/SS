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
  // panels: 'styles' | 'customize' | 'captions'
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
  let selectedSub = $derived(selIdx !== null ? items[selIdx] : null)
  let overrides   = $derived(selectedSub?.overrides ?? {})
  let effective   = $derived(templateVal ? { ...templateVal, ...overrides } : null)
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
  let searchTerm    = $state('')
  let replaceTerm   = $state('')
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
    <button class="back-btn" onclick={oncancel}>← Queue</button>
    <span class="file-name">{getFileName(sessionVal?.videoPath ?? '')}</span>
    {#if isDirtyVal}<span class="dirty-badge">●</span>{/if}
    <div class="spacer"></div>
    <button class="burn-btn" onclick={handleBurn}>Export →</button>
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
            <button class="play-btn" onclick={togglePlay}>{playing ? '⏸' : '▶'}</button>
            <span class="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div class="progress-bar" role="slider" tabindex="0"
              aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration}
              onclick={(e) => { const r=e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX-r.left)/r.width)*duration) }}
              onkeydown={(e) => { if(e.key==='ArrowRight') seekTo(currentTime+5); if(e.key==='ArrowLeft') seekTo(currentTime-5) }}>
              <div class="progress-fill" style="width:{duration?(currentTime/duration)*100:0}%"></div>
            </div>
          </div>
        {:else}
          <div class="no-video">No video loaded</div>
        {/if}
      </div>

      <!-- Selected segment editor (below video) -->
      {#if selectedSub && effective}
        <div class="seg-editor">
          <div class="seg-header">
            <span class="seg-badge">#{selectedSub.index}</span>
            <span class="seg-time">{selectedSub.start.slice(0,8)} → {selectedSub.end.slice(0,8)}</span>
            {#if hasOverrides}
              <button class="chip-btn danger" onclick={clearOverrides}>Clear overrides</button>
            {/if}
            <button class="close-btn" onclick={() => selectSegment(null)}>✕</button>
          </div>
          <textarea class="seg-textarea"
            use:initTextarea={selectedSub.text}
            oninput={(e) => updateSubtitleText(selIdx!, (e.currentTarget as HTMLTextAreaElement).value)}>
          </textarea>
          <div class="seg-overrides">
            <div class="or">
              <label>Color</label>
              <input type="color" value={effective.primaryColor} oninput={(e)=>setOverride('primaryColor',e.currentTarget.value)} />
              {#if 'primaryColor' in overrides}<span class="dot"></span>{/if}
            </div>
            <div class="or">
              <label>Outline</label>
              <input type="color" value={effective.outlineColor} oninput={(e)=>setOverride('outlineColor',e.currentTarget.value)} />
              {#if 'outlineColor' in overrides}<span class="dot"></span>{/if}
            </div>
            <div class="or">
              <label>Size</label>
              <input type="number" min="8" max="120" value={effective.fontSize} onchange={(e)=>setOverride('fontSize',Number(e.currentTarget.value))} />
              {#if 'fontSize' in overrides}<span class="dot"></span>{/if}
            </div>
            <div class="or">
              <label>Position</label>
              <select value={effective.alignment} onchange={(e)=>setOverride('alignment',Number(e.currentTarget.value))}>
                <option value={7}>Top Left</option><option value={8}>Top Center</option><option value={9}>Top Right</option>
                <option value={4}>Mid Left</option><option value={5}>Mid Center</option><option value={6}>Mid Right</option>
                <option value={1}>Bot Left</option><option value={2}>Bot Center</option><option value={3}>Bot Right</option>
              </select>
              {#if 'alignment' in overrides}<span class="dot"></span>{/if}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Right sidebar: icon strip + panel -->
    <div class="sidebar">

      <!-- Icon strip -->
      <div class="icon-strip">
        <button class="nav-btn" class:active={activePanel==='styles'}   onclick={()=>activePanel='styles'}   title="Styles">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          <span>Styles</span>
        </button>
        <button class="nav-btn" class:active={activePanel==='customize'} onclick={()=>activePanel='customize'} title="Customize">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M8.46 8.46a5 5 0 0 0 0 7.07"/></svg>
          <span>Customize</span>
        </button>
        <button class="nav-btn" class:active={activePanel==='captions'}  onclick={()=>activePanel='captions'}  title="Captions">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M6 10h6M6 14h4"/></svg>
          <span>Captions</span>
        </button>
      </div>

      <!-- Panel content -->
      <div class="panel">

        <!-- ── STYLES panel ───────────────────────────────────────────── -->
        {#if activePanel === 'styles'}
          <div class="panel-header">
            <span class="panel-title">Styles</span>
            <button class="chip-btn" onclick={()=>showSaveDialog=!showSaveDialog}>+ Save</button>
          </div>
          {#if showSaveDialog}
            <div class="save-row">
              <input type="text" bind:value={saveTemplateName} placeholder="Template name…"
                onkeydown={(e)=>e.key==='Enter'&&handleSaveTemplate()} />
              <button onclick={handleSaveTemplate}>Save</button>
              <button onclick={()=>showSaveDialog=false}>✕</button>
            </div>
          {/if}
          <div class="styles-grid">
            {#each templatesVal as t}
              <button
                class="style-card"
                class:active={templateVal?.id === t.id}
                onclick={() => handlePresetSelect(t.id)}
              >
                <div class="style-preview" style="font-family:{t.fontName};color:{t.primaryColor};background:{t.outlineColor === '#000000' ? '#111' : '#fff'};">
                  <span style="font-size:11px;font-weight:{t.bold?'700':'400'};font-style:{t.italic?'italic':'normal'};
                    text-shadow:-1px -1px 0 {t.outlineColor},1px -1px 0 {t.outlineColor},-1px 1px 0 {t.outlineColor},1px 1px 0 {t.outlineColor};">
                    Aa
                  </span>
                </div>
                <span class="style-name">{t.name}</span>
              </button>
            {/each}
          </div>
        {/if}

        <!-- ── CUSTOMIZE panel ────────────────────────────────────────── -->
        {#if activePanel === 'customize' && templateVal}

          <!-- Layout section -->
          <button class="section-btn" onclick={()=>toggleSection('layout')}>
            <span>Layout</span><span class="chevron" class:open={openSection==='layout'}>›</span>
          </button>
          {#if openSection === 'layout'}
            <div class="section-body">
              <div class="field">
                <label>Position</label>
                <div class="align-grid">
                  {#each [7,8,9,4,5,6,1,2,3] as pos}
                    <button class="align-btn" class:active={templateVal.alignment===pos}
                      onclick={()=>updateActiveTemplate({alignment:pos as Alignment})}></button>
                  {/each}
                </div>
              </div>
              <div class="field">
                <label>Margin V</label>
                <input type="range" min="0" max="100" value={templateVal.marginV}
                  oninput={(e)=>updateActiveTemplate({marginV:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.marginV}</span>
              </div>
              <div class="field">
                <label>Margin L</label>
                <input type="range" min="0" max="100" value={templateVal.marginL}
                  oninput={(e)=>updateActiveTemplate({marginL:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.marginL}</span>
              </div>
              <div class="field">
                <label>Margin R</label>
                <input type="range" min="0" max="100" value={templateVal.marginR}
                  oninput={(e)=>updateActiveTemplate({marginR:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.marginR}</span>
              </div>
            </div>
          {/if}

          <!-- Text section -->
          <button class="section-btn" onclick={()=>toggleSection('text')}>
            <span>Text</span><span class="chevron" class:open={openSection==='text'}>›</span>
          </button>
          {#if openSection === 'text'}
            <div class="section-body">
              <div class="field">
                <label>Font</label>
                <select onchange={handleFontSelect} value={customFont?'__custom__':templateVal.fontName}>
                  {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
                  <option value="__custom__">Custom…</option>
                </select>
              </div>
              {#if customFont}
                <div class="field">
                  <label></label>
                  <input type="text" value={templateVal.fontName} placeholder="Font name…"
                    onchange={(e)=>updateActiveTemplate({fontName:e.currentTarget.value})} />
                </div>
              {/if}
              <div class="field">
                <label>Size</label>
                <input type="number" min="8" max="120" value={templateVal.fontSize} class="short"
                  onchange={(e)=>updateActiveTemplate({fontSize:Number(e.currentTarget.value)})} />
                <button class="tog" class:on={templateVal.bold}    onclick={()=>updateActiveTemplate({bold:!templateVal.bold})}><b>B</b></button>
                <button class="tog" class:on={templateVal.italic}  onclick={()=>updateActiveTemplate({italic:!templateVal.italic})}><i>I</i></button>
              </div>
              <div class="field">
                <label>Color</label>
                <input type="color" value={templateVal.primaryColor} oninput={(e)=>updateActiveTemplate({primaryColor:e.currentTarget.value})} />
                <span class="hex">{templateVal.primaryColor}</span>
              </div>
              <div class="field">
                <label>Outline color</label>
                <input type="color" value={templateVal.outlineColor} oninput={(e)=>updateActiveTemplate({outlineColor:e.currentTarget.value})} />
              </div>
              <div class="field">
                <label>Outline</label>
                <input type="range" min="0" max="4" step="0.5" value={templateVal.outline}
                  oninput={(e)=>updateActiveTemplate({outline:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.outline}</span>
              </div>
              <div class="field">
                <label>Shadow</label>
                <input type="range" min="0" max="4" step="0.5" value={templateVal.shadow}
                  oninput={(e)=>updateActiveTemplate({shadow:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.shadow}</span>
              </div>
              <div class="field">
                <label>Spacing</label>
                <input type="range" min="0" max="10" step="0.5" value={templateVal.spacing}
                  oninput={(e)=>updateActiveTemplate({spacing:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.spacing}</span>
              </div>
            </div>
          {/if}

          <!-- Animation section -->
          <button class="section-btn" onclick={()=>toggleSection('animation')}>
            <span>Animation</span><span class="chevron" class:open={openSection==='animation'}>›</span>
          </button>
          {#if openSection === 'animation'}
            <div class="section-body">
              <div class="field">
                <label>Type</label>
                <select value={templateVal.animation??'none'}
                  onchange={(e)=>updateActiveTemplate({animation:e.currentTarget.value as AnimationMode})}>
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="pop">Pop</option>
                  <option value="slide-up">Slide up</option>
                  <option value="typewriter">Typewriter</option>
                </select>
              </div>
              <div class="field">
                <label title="Push subtitle start times forward to compensate for whisper early onset.">Sync offset</label>
                <input type="range" min="0" max="300" step="10" value={templateVal.syncOffset??50}
                  oninput={(e)=>updateActiveTemplate({syncOffset:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.syncOffset??50}ms</span>
              </div>
              <div class="field">
                <label title="Inter-word gap that triggers a new line.">Pause split</label>
                <input type="range" min="200" max="800" step="50" value={templateVal.pauseThreshold??500}
                  oninput={(e)=>updateActiveTemplate({pauseThreshold:Number(e.currentTarget.value)})} />
                <span class="val">{templateVal.pauseThreshold??500}ms</span>
              </div>
            </div>
          {/if}

          <!-- Word-by-word section -->
          <button class="section-btn" onclick={()=>toggleSection('wordbyword')}>
            <span>Word by word</span><span class="chevron" class:open={openSection==='wordbyword'}>›</span>
          </button>
          {#if openSection === 'wordbyword'}
            <div class="section-body">
              <div class="field">
                <label class="check-label">
                  <input type="checkbox" checked={templateVal.wordByWord}
                    onchange={(e)=>updateActiveTemplate({wordByWord:e.currentTarget.checked})} />
                  Enabled
                </label>
              </div>
              {#if templateVal.wordByWord}
                <div class="field">
                  <label>Mode</label>
                  <select value={templateVal.wordMode}
                    onchange={(e)=>updateActiveTemplate({wordMode:e.currentTarget.value as WordMode})}>
                    <option value="highlight">Highlight</option>
                    <option value="solo">Solo</option>
                  </select>
                </div>
                <div class="field">
                  <label>Highlight color</label>
                  <input type="color" value={templateVal.highlightColor}
                    oninput={(e)=>updateActiveTemplate({highlightColor:e.currentTarget.value})} />
                  <span class="hex">{templateVal.highlightColor}</span>
                </div>
              {/if}
            </div>
          {/if}

        {/if}

        <!-- ── CAPTIONS panel ──────────────────────────────────────────── -->
        {#if activePanel === 'captions'}
          <div class="panel-header">
            <span class="panel-title">Captions</span>
          </div>

          <!-- Find & replace -->
          <div class="find-row">
            <input type="text" bind:value={searchTerm} placeholder="Find…" />
            <input type="text" bind:value={replaceTerm} placeholder="Replace…" />
            <button onclick={handleFindReplace}>Replace</button>
            {#if replaceMessage}<span class="replace-msg">{replaceMessage}</span>{/if}
          </div>

          <!-- Segment list -->
          <div class="caption-list">
            {#each items as sub, i}
              <div class="caption-item" class:active={selIdx===i} onclick={()=>seekToSegment(sub)}
                role="button" tabindex="0" onkeydown={(e)=>e.key==='Enter'&&seekToSegment(sub)}>
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
  /* ── Reset & layout ────────────────────────────────────────────────────── */
  .editor { display:flex; flex-direction:column; height:100%; overflow:hidden; background:var(--color-bg); }

  /* Topbar */
  .topbar {
    display:flex; align-items:center; gap:0.75rem; padding:0.45rem 1rem;
    background:var(--color-surface); border-bottom:1px solid var(--color-border);
    flex-shrink:0;
  }
  .back-btn {
    padding:0.28rem 0.7rem; border-radius:6px; border:1px solid var(--color-border);
    background:transparent; color:var(--color-text-muted); font-size:0.78rem; cursor:pointer;
  }
  .back-btn:hover { background:var(--color-surface-hover); color:var(--color-text); }
  .file-name { font-size:0.85rem; font-weight:600; color:var(--color-text); }
  .dirty-badge { color:var(--color-warning); font-size:0.6rem; }
  .spacer { flex:1; }
  .burn-btn {
    padding:0.3rem 1rem; border-radius:6px; border:none;
    background:var(--color-accent); color:white; font-size:0.82rem;
    font-weight:600; cursor:pointer; letter-spacing:0.02em;
  }
  .burn-btn:hover { filter:brightness(1.1); }

  /* Body */
  .body { display:flex; flex:1; overflow:hidden; }

  /* Video column */
  .video-col { flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0; }

  .video-wrap {
    flex:1; position:relative; background:#000;
    display:flex; align-items:center; justify-content:center; overflow:hidden;
  }
  .video { width:100%; height:100%; object-fit:contain; display:block; }
  .no-video { color:#666; font-size:0.9rem; }

  .sub-overlay { position:absolute; line-height:1.3; }
  .sub-overlay:hover { outline:1px dashed rgba(255,255,255,0.35); }

  .video-controls {
    position:absolute; bottom:0; left:0; right:0;
    display:flex; align-items:center; gap:0.5rem; padding:0.45rem 0.75rem;
    background:linear-gradient(transparent,rgba(0,0,0,0.75));
  }
  .play-btn { background:none; border:none; color:white; font-size:1rem; cursor:pointer; padding:0; width:26px; }
  .time-display { color:white; font-size:0.72rem; font-family:monospace; white-space:nowrap; }
  .progress-bar { flex:1; height:4px; background:rgba(255,255,255,0.25); border-radius:2px; cursor:pointer; position:relative; }
  .progress-fill { height:100%; background:var(--color-accent); border-radius:2px; pointer-events:none; }

  /* Segment editor (below video) */
  .seg-editor {
    flex-shrink:0; padding:0.6rem 0.75rem;
    background:var(--color-surface); border-top:1px solid var(--color-border);
  }
  .seg-header { display:flex; align-items:center; gap:0.4rem; margin-bottom:0.4rem; }
  .seg-badge { font-size:0.7rem; font-weight:700; color:var(--color-accent); }
  .seg-time { font-size:0.68rem; color:var(--color-text-muted); font-family:monospace; flex:1; }
  .close-btn { background:none; border:none; color:var(--color-text-muted); cursor:pointer; font-size:0.85rem; }
  .close-btn:hover { color:var(--color-text); }
  .seg-textarea {
    width:100%; padding:0.35rem 0.55rem; border-radius:5px;
    border:1px solid var(--color-border); background:var(--color-bg);
    color:var(--color-text); font-size:0.82rem; font-family:inherit;
    resize:none; overflow:hidden; min-height:48px; box-sizing:border-box;
    line-height:1.5; outline:none;
  }
  .seg-textarea:focus { border-color:var(--color-accent); }
  .seg-overrides { display:flex; gap:0.5rem; margin-top:0.4rem; flex-wrap:wrap; }
  .or { display:flex; align-items:center; gap:0.3rem; }
  .or label { font-size:0.68rem; color:var(--color-text-muted); }
  .or input[type="color"] { width:24px; height:20px; padding:1px; border-radius:3px; border:1px solid var(--color-border); cursor:pointer; }
  .or input[type="number"] { width:48px; padding:0.15rem 0.3rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.72rem; }
  .or select { padding:0.15rem 0.3rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.72rem; }
  .dot { width:5px; height:5px; border-radius:50%; background:var(--color-accent); flex-shrink:0; }

  /* ── Sidebar ───────────────────────────────────────────────────────────── */
  .sidebar {
    display:flex; flex-direction:row;
    border-left:1px solid var(--color-border);
    width:320px; flex-shrink:0; overflow:hidden;
  }

  /* Icon strip */
  .icon-strip {
    display:flex; flex-direction:column; align-items:center;
    gap:0; padding:0.5rem 0;
    background:var(--color-surface); border-right:1px solid var(--color-border);
    width:60px; flex-shrink:0;
  }
  .nav-btn {
    display:flex; flex-direction:column; align-items:center; gap:0.2rem;
    width:100%; padding:0.6rem 0.2rem; border:none; background:transparent;
    color:var(--color-text-muted); cursor:pointer; font-size:0.6rem;
    letter-spacing:0.03em; transition:color 0.15s, background 0.15s;
  }
  .nav-btn:hover { color:var(--color-text); background:var(--color-surface-hover); }
  .nav-btn.active { color:var(--color-accent); background:var(--color-accent-subtle); }
  .nav-btn svg { flex-shrink:0; }

  /* Panel */
  .panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }

  .panel-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:0.65rem 0.85rem; border-bottom:1px solid var(--color-border);
    flex-shrink:0;
  }
  .panel-title { font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--color-text-muted); }

  /* Styles panel — card grid */
  .styles-grid {
    display:grid; grid-template-columns:1fr 1fr; gap:0.6rem;
    padding:0.75rem; overflow-y:auto; flex:1;
  }
  .style-card {
    display:flex; flex-direction:column; align-items:center; gap:0.35rem;
    border:1px solid var(--color-border); border-radius:8px; padding:0.5rem;
    background:var(--color-surface); cursor:pointer; transition:border-color 0.15s, background 0.15s;
  }
  .style-card:hover { border-color:var(--color-text-muted); }
  .style-card.active { border-color:var(--color-accent); background:var(--color-accent-subtle); }
  .style-preview {
    width:100%; height:48px; border-radius:5px;
    display:flex; align-items:center; justify-content:center;
  }
  .style-name { font-size:0.65rem; color:var(--color-text-muted); font-weight:500; }

  /* Customize panel — accordion sections */
  .section-btn {
    display:flex; align-items:center; justify-content:space-between;
    width:100%; padding:0.6rem 0.85rem;
    border:none; border-bottom:1px solid var(--color-border);
    background:var(--color-surface); color:var(--color-text);
    font-size:0.78rem; font-weight:600; cursor:pointer; text-align:left;
    flex-shrink:0;
  }
  .section-btn:hover { background:var(--color-surface-hover); }
  .chevron { font-size:1rem; color:var(--color-text-muted); transition:transform 0.2s; display:inline-block; }
  .chevron.open { transform:rotate(90deg); }

  .section-body {
    display:flex; flex-direction:column; gap:0.4rem;
    padding:0.6rem 0.85rem; border-bottom:1px solid var(--color-border);
    background:var(--color-bg); overflow-y:auto;
  }

  /* Fields inside sections */
  .field { display:flex; align-items:center; gap:0.4rem; }
  .field label { font-size:0.7rem; color:var(--color-text-muted); min-width:72px; }
  .field input[type="text"], .field input[type="number"], .field select {
    flex:1; padding:0.22rem 0.4rem; border-radius:4px;
    border:1px solid var(--color-border); background:var(--color-bg);
    color:var(--color-text); font-size:0.73rem;
  }
  .field input:focus, .field select:focus { outline:none; border-color:var(--color-accent); }
  .field input[type="range"] { flex:1; accent-color:var(--color-accent); }
  .field input[type="color"] { width:26px; height:22px; padding:1px; border-radius:3px; border:1px solid var(--color-border); cursor:pointer; flex:none; }
  .short { max-width:52px; flex:none!important; }
  .val { font-size:0.68rem; color:var(--color-text-muted); min-width:28px; text-align:right; }
  .hex { font-size:0.68rem; font-family:monospace; color:var(--color-text-muted); }
  .tog { width:24px; height:24px; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text-muted); cursor:pointer; font-size:0.78rem; flex-shrink:0; }
  .tog.on { background:var(--color-accent); border-color:var(--color-accent); color:white; }
  .check-label { display:flex; align-items:center; gap:0.35rem; font-size:0.78rem; cursor:pointer; }

  /* Align grid */
  .align-grid { display:grid; grid-template-columns:repeat(3,22px); gap:2px; }
  .align-btn { width:22px; height:22px; border-radius:3px; border:1px solid var(--color-border); background:var(--color-bg); cursor:pointer; position:relative; }
  .align-btn::after { content:''; position:absolute; width:5px; height:5px; border-radius:50%; background:var(--color-text-muted); top:50%; left:50%; transform:translate(-50%,-50%); }
  .align-btn.active { background:var(--color-accent-subtle); border-color:var(--color-accent); }
  .align-btn.active::after { background:var(--color-accent); }
  .align-btn:hover:not(.active) { background:var(--color-surface-hover); }

  /* Captions panel */
  .find-row {
    display:flex; gap:0.3rem; padding:0.5rem 0.75rem;
    border-bottom:1px solid var(--color-border); flex-shrink:0; flex-wrap:wrap;
  }
  .find-row input { flex:1; min-width:60px; padding:0.25rem 0.4rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.73rem; }
  .find-row button { padding:0.25rem 0.5rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:0.73rem; cursor:pointer; }
  .find-row button:hover { background:var(--color-surface-hover); }
  .replace-msg { font-size:0.7rem; color:var(--color-success); align-self:center; }

  .caption-list { flex:1; overflow-y:auto; }
  .caption-item {
    display:flex; flex-direction:column; gap:0.15rem;
    padding:0.45rem 0.85rem; border-bottom:1px solid var(--color-border);
    cursor:pointer; transition:background 0.1s;
  }
  .caption-item:hover { background:var(--color-surface-hover); }
  .caption-item.active { background:var(--color-accent-subtle); border-left:2px solid var(--color-accent); }
  .caption-meta { display:flex; gap:0.5rem; align-items:baseline; }
  .cap-num { font-size:0.65rem; font-weight:700; color:var(--color-accent); }
  .cap-time { font-size:0.65rem; color:var(--color-text-muted); font-family:monospace; }
  .cap-text { font-size:0.78rem; color:var(--color-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* Shared chips */
  .chip-btn {
    padding:0.2rem 0.55rem; border-radius:5px; border:1px solid var(--color-border);
    background:var(--color-surface); color:var(--color-text-muted); font-size:0.7rem; cursor:pointer;
  }
  .chip-btn:hover { background:var(--color-surface-hover); color:var(--color-text); }
  .chip-btn.danger { border-color:var(--color-danger); color:var(--color-danger); }
  .chip-btn.danger:hover { background:var(--color-danger-subtle); }

  .save-row {
    display:flex; gap:0.3rem; padding:0.4rem 0.75rem;
    border-bottom:1px solid var(--color-border); background:var(--color-surface-hover);
  }
  .save-row input { flex:1; padding:0.22rem 0.4rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:0.73rem; }
  .save-row button { padding:0.22rem 0.5rem; border-radius:4px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:0.73rem; cursor:pointer; }
  .save-row button:first-of-type { background:var(--color-accent); border-color:var(--color-accent); color:white; }

  /* Animate keyframes — :global so Svelte doesn't scope the name */
  :global {
    @keyframes sub-fade     { from{opacity:0} to{opacity:1} }
    @keyframes sub-pop      { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
    @keyframes sub-slide-up { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
  }
</style>