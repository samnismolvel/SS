<script lang="ts">
  import { session, isDirty, findAndReplace, selectSegment, updateSubtitleText, updateSubtitleOverrides, clearSubtitleOverrides, setDensityRatio, mergeWithNext, insertAfter, densityRatio as densityRatioStore } from '$lib/stores/editor'
  import { activeTemplate, updateActiveTemplate, allTemplates, setActiveTemplate, saveActiveAsTemplate } from '$lib/stores/templates'
  import { buildAss, parseSRT } from '$lib/utils/ass'
  import { convertFileSrc } from '@tauri-apps/api/core'
  import type { Alignment, AnimationMode } from '$lib/types'

  interface Props {
    onburn: (detail: { videoPath: string; outputPath: string; assContent: string }) => void
    oncancel: () => void
  }
  let { onburn, oncancel }: Props = $props()

  let sessionVal = $state(null as any), isDirtyVal = $state(false), templateVal = $state(null as any)
  let items = $state([] as any[]), selIdx = $state(null as number | null)
  $effect(() => {
    const u1 = session.subscribe(v => { sessionVal = v; items = v?.subtitles ?? []; selIdx = v?.selectedIndex ?? null })
    const u2 = isDirty.subscribe(v => { isDirtyVal = v })
    const u3 = activeTemplate.subscribe(v => { templateVal = v })
    return () => { u1(); u2(); u3() }
  })

  let videoEl = $state(null as HTMLVideoElement | null)
  let currentTime = $state(0), duration = $state(0), playing = $state(false), videoSrc = $state('')
  $effect(() => { if (sessionVal?.videoPath) videoSrc = convertFileSrc(sessionVal.videoPath) })

  let activeSub = $derived((() => {
    if (!items.length) return null
    return items.find((sub: any) => { const s = srtToSeconds(sub.start), e = srtToSeconds(sub.end); return currentTime >= s && currentTime <= e }) ?? null
  })())



  // ── Preview font scale ───────────────────────────────────────────────────
  // libass scales fontSize by (videoHeight / scriptHeight), where scriptHeight
  // defaults to 288. This is height-based, not width-based — so the correct
  // formula is frameHeight / 288, regardless of video aspect ratio.
  //
  // Using frameWidth/384 overestimates by ~1.33× on 16:9 videos (1280×720,
  // 1920×1080) because 384/288 ≠ 16/9, making the preview too small.
  const ASS_SCRIPT_H = 288
  let previewFontScale = $derived((() => {
    // Touch currentTime so this re-evaluates after video metadata loads
    void currentTime
    const frame = getFrameRect()
    if (!frame || frame.height === 0) return 1
    return frame.height / ASS_SCRIPT_H
  })())

  // Typewriter preview — compute revealed chars from currentTime
  let typewriterTextDerived = $derived((() => {
    if (!activeSub || templateVal?.animation !== 'typewriter') return null
    const chars = [...activeSub.text]
    const sMs = srtToSeconds(activeSub.start)*1000, eMs = srtToSeconds(activeSub.end)*1000
    const delay = Math.max(30, Math.min(80, Math.floor((eMs-sMs)/Math.max(1,chars.length))))
    const revealed = Math.min(chars.length, Math.max(0, Math.ceil((currentTime*1000-sMs)/delay)))
    return chars.slice(0, revealed).join('')
  })())

  // Preview text with textTransform and hidePunctuation applied
  let previewText = $derived((() => {
    if (!activeSub || !templateVal) return ''
    const ef = { ...templateVal, ...(activeSub?.overrides ?? {}) } as any
    let t = templateVal.animation === 'typewriter' ? (typewriterTextDerived ?? '') : activeSub.text
    if (ef.textTransform === 'uppercase') t = t.toUpperCase()
    if (ef.textTransform === 'lowercase') t = t.toLowerCase()
    if (ef.hidePunctuation) t = t.replace(/[.!?,;:]/g, '')
    return t
  })())

  // Active word index — which rawSub token is active at currentTime
  let activeWordIndexDerived = $derived((() => {
    if (!templateVal?.lineBgEnabled && templateVal?.activeWordColor === templateVal?.primaryColor) return -1
    const raw: any[] = sessionVal?.rawSubs ?? []
    const tMs = currentTime * 1000
    return raw.findIndex((sub: any) => {
      const s = srtToSeconds(sub.start) * 1000
      const e = srtToSeconds(sub.end)   * 1000
      return tMs >= s && tMs <= e
    })
  })())

  // Words of the active sub, with indices into rawSubs to check active state
  let activeSubWords = $derived((() => {
    const needsHighlight = templateVal?.lineBgEnabled ||
      (templateVal?.activeWordColor && templateVal.activeWordColor !== templateVal.primaryColor)
    if (!activeSub || !sessionVal?.rawSubs || !needsHighlight) return null
    // Find which rawSubs fall within this display sub's time range
    const subStartMs = srtToSeconds(activeSub.start) * 1000
    const subEndMs   = srtToSeconds(activeSub.end)   * 1000
    const raw: any[] = sessionVal.rawSubs
    const tokens = raw.filter((s: any) => {
      const sMs = srtToSeconds(s.start) * 1000
      return sMs >= subStartMs - 50 && sMs <= subEndMs + 50
    })
    // Build display words from previewText aligned to tokens
    const words = previewText.split(' ')
    return words.map((w: string, i: number) => ({
      word: w,
      isActive: tokens[i] ? (() => {
        const tMs = currentTime * 1000
        const s = srtToSeconds(tokens[i].start) * 1000
        const e = srtToSeconds(tokens[i].end) * 1000
        return tMs >= s && tMs <= e
      })() : false
    }))
  })())

  // CSS filter for shadow preview
  let previewShadowStyle = $derived((() => {
    if (!templateVal) return ''
    const ef = { ...templateVal, ...(activeSub?.overrides ?? {}) } as any
    if (!ef.shadowEnabled) return ''
    return `filter:drop-shadow(${ef.shadowOffsetX ?? 0}px ${ef.shadowOffsetY ?? 0}px ${ef.shadowBlur ?? 0}px ${ef.shadowColor ?? '#000'});`
  })())

  function getAnimationStyle(a: string|undefined): string {
    if (a==='fade')     return 'animation:sub-fade 300ms ease-in-out forwards;'
    if (a==='pop')      return 'animation:sub-pop 350ms cubic-bezier(0.34,1.56,0.64,1) forwards;'
    if (a==='slide-up') return 'animation:sub-slide-up 350ms ease-out forwards;'
    return ''
  }

  function getAlignmentStyle(n: number): string {
    const p: Record<number,string> = {
      1:'bottom:10%;left:5%;text-align:left;', 2:'bottom:10%;left:50%;transform:translateX(-50%);text-align:center;',
      3:'bottom:10%;right:5%;text-align:right;', 4:'top:50%;left:5%;transform:translateY(-50%);text-align:left;',
      5:'top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;', 6:'top:50%;right:5%;transform:translateY(-50%);text-align:right;',
      7:'top:5%;left:5%;text-align:left;', 8:'top:5%;left:50%;transform:translateX(-50%);text-align:center;', 9:'top:5%;right:5%;text-align:right;'
    }
    return p[n]??p[2]
  }

  function srtToSeconds(srt: string): number {
    if (!srt) return 0
    const [time,ms] = srt.split(','); const [h,m,s] = time.split(':').map(Number)
    return h*3600+m*60+s+parseInt(ms)/1000
  }
  function onTimeUpdate()     { if (videoEl) currentTime = videoEl.currentTime }
  function onLoadedMetadata() { if (videoEl) duration = videoEl.duration }
  function onVideoPlay()  { playing = true }
  function onVideoPause() { playing = false }
  function togglePlay() { if (!videoEl) return; playing ? videoEl.pause() : videoEl.play(); playing = !playing }
  function seekTo(s: number) { if (videoEl) { videoEl.currentTime = s; currentTime = s } }
  function seekToSegment(sub: any) {
    seekTo(srtToSeconds(sub.start))
    const i = items.indexOf(sub); if (i !== -1) selectSegment(i)
    if (videoEl && playing) { videoEl.pause(); playing = false }
  }
  function formatTime(s: number) { return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` }

  type PanelId = 'styles'|'customize'|'captions'
  let activePanel = $state('styles' as PanelId)

  let templatesVal = $state([] as any[]), showSaveDialog = $state(false), saveTemplateName = $state('')
  $effect(() => { const u = allTemplates.subscribe(v => { templatesVal = v }); return u })

  // Density ratio
  let densityVal = $state(0.4)
  $effect(() => { const u = densityRatioStore.subscribe(v => { densityVal = v }); return u })
  function handleDensityChange(e: Event) {
    const ratio = Number((e.currentTarget as HTMLInputElement).value)
    setDensityRatio(ratio)
  }
  function handleSaveTemplate() {
    if (!saveTemplateName.trim()) return
    saveActiveAsTemplate(saveTemplateName.trim()); saveTemplateName = ''; showSaveDialog = false
  }

  const SYSTEM_FONTS = ['Arial','Arial Black','Comic Sans MS','Courier New','Georgia','Impact','Lucida Console','Tahoma','Times New Roman','Trebuchet MS','Verdana','Segoe UI','Calibri','Cambria','Consolas']
  let customFont = $state(false)
  // Sub-sidebar state: null = main rail visible, 'customize' = sub-sidebar open
  let subSidebar = $state<'customize' | null>(null)
  type CSection = 'text' | 'layout' | 'animation' | 'activeword'
  let customSection = $state<CSection>('text')
  $effect(() => { if (templateVal?.fontName && !SYSTEM_FONTS.includes(templateVal.fontName)) customFont = true })
  function handleFontSelect(e: Event) {
    const v = (e.target as HTMLSelectElement).value
    if (v==='__custom__') customFont = true; else { customFont = false; updateActiveTemplate({fontName:v}) }
  }

  let selectedSub = $derived(selIdx !== null ? items[selIdx] : null)
  let overrides = $derived(selectedSub?.overrides ?? {})
  let effective = $derived(templateVal ? {...templateVal,...overrides} : null)
  let hasOverrides = $derived(!!selectedSub?.overrides && Object.keys(selectedSub.overrides).length > 0)

  let searchTerm = $state(''), replaceTerm = $state(''), findMode = $state('all' as 'all'|'single'), replaceMessage = $state('')
  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, findMode)
    replaceMessage = `Replaced ${count} occurrence${count!==1?'s':''}`
    setTimeout(() => replaceMessage = '', 3000)
  }
  function setOverride(key: string, value: any) { if (selIdx !== null) updateSubtitleOverrides(selIdx, {[key]:value}) }
  function clearOverrides() { if (selIdx !== null) clearSubtitleOverrides(selIdx) }

  function initTextarea(node: HTMLTextAreaElement, text: string) {
    node.value = text; node.style.height = 'auto'; node.style.height = Math.max(60,node.scrollHeight)+'px'
    return { update(t:string) { if (document.activeElement!==node) { node.value=t; node.style.height='auto'; node.style.height=Math.max(60,node.scrollHeight)+'px' } } }
  }

  function handleExportSRT() {
    if (!items.length) return
    const srt = items.map((s:any)=>`${s.index}\n${s.start} --> ${s.end}\n${s.text}`).join('\n\n')+'\n'
    const url = URL.createObjectURL(new Blob([srt],{type:'text/plain'}))
    const a = Object.assign(document.createElement('a'),{href:url,download:'subtitles.srt'}); a.click(); URL.revokeObjectURL(url)
  }
  function handleImportSRT() {
    const input = Object.assign(document.createElement('input'),{type:'file',accept:'.srt'})
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      const parsed = parseSRT(await file.text())
      session.update((s:any) => s ? {...s,subtitles:parsed,isDirty:true} : null)
    }
    input.click()
  }
  function handleBurn() {
    if (!sessionVal||!templateVal) return
    onburn({videoPath:sessionVal.videoPath,outputPath:sessionVal.outputPath,assContent:buildAss(sessionVal.subtitles,templateVal,sessionVal.rawSubs??[])})
  }
  function getFileName(p:string) { return p.split(/[\\/]/).pop()??p }

  // ── Drag-to-position ──────────────────────────────────────────────────────
  // posX / posY live on the template (affect all subs globally).
  // Stored as % of the video frame width/height (0–100).
  let videoWrapEl = $state(null as HTMLDivElement | null)
  let isDragging  = $state(false)
  let dragOffX    = $state(0)
  let dragOffY    = $state(0)
  let snapH       = $state(false)
  let snapV       = $state(false)
  const SNAP_PCT  = 3

  function getFrameRect(): DOMRect | null {
    if (!videoWrapEl || !videoEl?.videoWidth) return null
    const wrap = videoWrapEl.getBoundingClientRect()
    const vAR  = videoEl.videoWidth / videoEl.videoHeight
    const wAR  = wrap.width / wrap.height
    let fw: number, fh: number
    if (vAR > wAR) { fw = wrap.width;  fh = wrap.width  / vAR }
    else           { fh = wrap.height; fw = wrap.height * vAR }
    return new DOMRect(wrap.left + (wrap.width - fw)/2, wrap.top + (wrap.height - fh)/2, fw, fh)
  }

  function getOverlayPositionStyle(): string {
    const px = (templateVal as any)?.posX, py = (templateVal as any)?.posY
    if (px != null && py != null) {
      const frame = getFrameRect()
      const wrap  = videoWrapEl?.getBoundingClientRect()
      if (frame && wrap) {
        const ax = frame.left - wrap.left + (px / 100) * frame.width
        const ay = frame.top  - wrap.top  + (py / 100) * frame.height
        return `left:${ax}px;top:${ay}px;transform:translate(-50%,-50%);`
      }
    }
    // No drag position — use ASS alignment mapping.
    // We strip text-align from here; the sub-box sets it directly.
    const al = (templateVal as any)?.alignment ?? 2
    const p: Record<number,string> = {
      1:'bottom:10%;left:5%;',  2:'bottom:10%;left:50%;transform:translateX(-50%);',
      3:'bottom:10%;right:5%;', 4:'top:50%;left:5%;transform:translateY(-50%);',
      5:'top:50%;left:50%;transform:translate(-50%,-50%);',
      6:'top:50%;right:5%;transform:translateY(-50%);',
      7:'top:5%;left:5%;',  8:'top:5%;left:50%;transform:translateX(-50%);', 9:'top:5%;right:5%;'
    }
    return p[al] ?? p[2]
  }

  // Separate drag and resize pointer routing — drag only fires when not resizing
  function onOuterPointerDown(e: PointerEvent) {
    if (isResizing) return
    onSubPointerDown(e)
  }
  function onOuterPointerMove(e: PointerEvent) {
    if (isResizing) { onHandlePointerMove(e); return }
    onSubPointerMove(e)
  }
  function onOuterPointerUp(e: PointerEvent) {
    onSubPointerUp(); onHandlePointerUp()
  }

  function onSubPointerDown(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const r  = el.getBoundingClientRect()
    dragOffX = e.clientX - (r.left + r.width  / 2)
    dragOffY = e.clientY - (r.top  + r.height / 2)
    isDragging = true
    el.setPointerCapture(e.pointerId)
    if (activeSub) { const i = items.indexOf(activeSub); if (i !== -1) selectSegment(i) }
  }

  function onSubPointerMove(e: PointerEvent) {
    if (!isDragging) return
    e.preventDefault()
    const frame = getFrameRect(); if (!frame) return
    const rawX = e.clientX - dragOffX - frame.left
    const rawY = e.clientY - dragOffY - frame.top
    let px = Math.max(2, Math.min(98, (rawX / frame.width)  * 100))
    let py = Math.max(2, Math.min(98, (rawY / frame.height) * 100))
    snapH = Math.abs(px - 50) < SNAP_PCT; if (snapH) px = 50
    snapV = Math.abs(py - 50) < SNAP_PCT; if (snapV) py = 50
    updateActiveTemplate({ posX: px, posY: py } as any)
  }

  function onSubPointerUp() { isDragging = false; snapH = false; snapV = false }

  function resetPosition() { updateActiveTemplate({ posX: undefined, posY: undefined } as any) }

  // ── Overlay toolbar ───────────────────────────────────────────────────────
  // Visible on hover over the subtitle overlay.
  // applyToAll: true → change template (all segments); false → override current only.

  let overlayHovered  = $state(false)
  let toolbarHovered  = $state(false)
  let applyToAll      = $state(true)

  // Overlay max-width as % of the video frame. Stored on template via posX/posY
  // pattern (as any) so we don't need a types.ts change right now.
  // Default: 80%.
  let overlayWidthPct = $derived<number>((templateVal as any)?.overlayWidthPct ?? 80)

  // Show toolbar when sub or toolbar itself is hovered (keeps it visible while clicking buttons).
  let showToolbar = $derived(overlayHovered || toolbarHovered)

  // Side-handle drag state
  let isResizing      = $state(false)
  let resizeSide      = $state<'left'|'right'>('right')
  let resizeStartX    = $state(0)
  let resizeStartPct  = $state(80)

  function onHandlePointerDown(e: PointerEvent, side: 'left'|'right') {
    e.preventDefault(); e.stopPropagation()
    isResizing     = true
    resizeSide     = side
    resizeStartX   = e.clientX
    resizeStartPct = (templateVal as any)?.overlayWidthPct ?? 80
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onHandlePointerMove(e: PointerEvent) {
    if (!isResizing) return
    e.preventDefault()
    const frame = getFrameRect(); if (!frame) return
    // Moving left handle left = wider, right handle right = wider (symmetrical box).
    // Direction: rightward movement always increases width regardless of which handle.
    const sign  = resizeSide === 'right' ? 1 : -1
    const deltaPx  = (e.clientX - resizeStartX) * sign
    const deltaPct = (deltaPx / frame.width) * 100 * 2  // *2 because box expands both sides
    const next  = Math.max(20, Math.min(100, resizeStartPct + deltaPct))
    updateActiveTemplate({ overlayWidthPct: next } as any)
  }

  function onHandlePointerUp() { isResizing = false }

  // Alignment helpers
  // ASS numpad: 1=BL 2=BC 3=BR  4=ML 5=MC 6=MR  7=TL 8=TC 9=TR
  function getTextAlign(al: number): 'left'|'center'|'right' {
    if ([1,4,7].includes(al)) return 'left'
    if ([3,6,9].includes(al)) return 'right'
    return 'center'
  }
  function getBlockAlign(al: number): 'bottom'|'middle'|'top' {
    if (al <= 3) return 'bottom'
    if (al <= 6) return 'middle'
    return 'top'
  }
  function makeAlignment(textAlign: 'left'|'center'|'right', blockAlign: 'bottom'|'middle'|'top'): number {
    const col = textAlign === 'left' ? 0 : textAlign === 'center' ? 1 : 2
    const row = blockAlign === 'bottom' ? 0 : blockAlign === 'middle' ? 3 : 6
    return row + col + 1
  }

  function setTextAlign(ta: 'left'|'center'|'right') {
    const cur = (templateVal as any)?.alignment ?? 2
    const next = makeAlignment(ta, getBlockAlign(cur))
    if (applyToAll) {
      updateActiveTemplate({ alignment: next } as any)
    } else if (selIdx !== null) {
      setOverride('alignment', next)
    }
  }
  function setBlockAlign(ba: 'bottom'|'middle'|'top') {
    const cur = (templateVal as any)?.alignment ?? 2
    const next = makeAlignment(getTextAlign(cur), ba)
    if (applyToAll) {
      updateActiveTemplate({ alignment: next } as any)
    } else if (selIdx !== null) {
      setOverride('alignment', next)
    }
  }

  // Effective alignment for the active sub (template + optional override)
  let effectiveAlignment = $derived<number>(
    (effective as any)?.alignment ?? (templateVal as any)?.alignment ?? 2
  )
</script>

<svelte:head>
  <style>
    @keyframes sub-fade{from{opacity:0}to{opacity:1}}
    @keyframes sub-pop{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}
    @keyframes sub-slide-up{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
  </style>
</svelte:head>

<div class="editor">
  <div class="topbar">
    <button class="back-btn" onclick={oncancel}>← Queue</button>
    <span class="file-name">{getFileName(sessionVal?.videoPath??'')}</span>
    <span class="seg-count">{items.length} segments</span>
    {#if isDirtyVal}<span class="dirty-badge">unsaved</span>{/if}
    <div class="spacer"></div>
    <button class="btn-burn" onclick={handleBurn}>Burn Subtitles →</button>
  </div>

  <div class="body">
    <div class="video-area">
      <div class="video-wrap" bind:this={videoWrapEl}>
        {#if videoSrc}
          <video bind:this={videoEl} src={videoSrc} ontimeupdate={onTimeUpdate} onloadedmetadata={onLoadedMetadata} onplay={onVideoPlay} onpause={onVideoPause} class="video"></video>
          <!-- Guide lines (visible while dragging) -->
          {#if isDragging}
            <div class="guide guide-h" class:snapped={snapV}></div>
            <div class="guide guide-v" class:snapped={snapH}></div>
          {/if}

          {#if activeSub && templateVal}
            {@const d = activeSub}{@const ef = { ...templateVal, ...(activeSub?.overrides ?? {}) }}
            {#key activeSub?.start}

            <!-- Outer positioner — handles drag-to-position -->
            <div class="sub-outer"
              style="position:absolute;{getOverlayPositionStyle()}"
              onpointerdown={onOuterPointerDown}
              onpointermove={onOuterPointerMove}
              onpointerup={onOuterPointerUp}
              onpointercancel={onOuterPointerUp}
              onmouseenter={() => overlayHovered = true}
              onmouseleave={() => overlayHovered = false}>

              <!-- Constrained text box with side handles -->
              <div class="sub-box"
                style="width:{overlayWidthPct}%;text-align:{getTextAlign(effectiveAlignment)};cursor:{isDragging?'grabbing':'grab'};">

                <!-- Left resize handle -->
                <div class="resize-handle resize-left"
                  class:visible={showToolbar}
                  onpointerdown={(e) => { e.stopPropagation(); onHandlePointerDown(e,'left') }}
                  role="separator" aria-label="Resize left"></div>

                <!-- Subtitle text -->
                <span class="sub-text" style="
                font-family:{ef?.fontName??'Arial'};
                font-size:{(ef?.fontSize??24)*previewFontScale}px;
                font-weight:{ef?.bold?'bold':'normal'};
                font-style:{ef?.italic?'italic':'normal'};
                color:{ef?.primaryColor??'#fff'};
                line-height:{1.35 + (ef?.lineSpacing ?? 0)}em;
                word-spacing:{ef?.wordSpacing ?? 0}px;
                text-shadow:-{ef?.outline??2}px -{ef?.outline??2}px 0 {ef?.outlineColor??'#000'},
                {ef?.outline??2}px -{ef?.outline??2}px 0 {ef?.outlineColor??'#000'},
                -{ef?.outline??2}px {ef?.outline??2}px 0 {ef?.outlineColor??'#000'},
                {ef?.outline??2}px {ef?.outline??2}px 0 {ef?.outlineColor??'#000'};
                {previewShadowStyle}
                {getAnimationStyle(templateVal?.animation)}">
  <!-- active word rendering — ver cambio 2 -->
                  
                    {#if activeSubWords && (templateVal?.lineBgEnabled || (templateVal?.activeWordColor && templateVal.activeWordColor !== templateVal.primaryColor))}
                    {#each activeSubWords as {word, isActive}, wi}
                      {#if wi > 0}&nbsp;{/if}{#if isActive}<span class="aw-active-word" style="color:{templateVal?.activeWordColor ?? ef?.primaryColor};{templateVal?.lineBgEnabled ? 'background:' + (templateVal?.activeWordBgColor ?? '#ffb900') + ';padding:' + (templateVal?.activeWordBgPaddingY ?? 0.2) + 'em ' + (templateVal?.activeWordBgPaddingX ?? 0.25) + 'em;border-radius:' + (templateVal?.activeWordBgRounded ? '0.4em' : '0') + ';' : ''}">{word}</span>{:else}{word}{/if}
                    {/each}
                  {:else}
                    {previewText}
                  {/if}

                </span>

                <!-- Right resize handle -->
                <div class="resize-handle resize-right"
                  class:visible={showToolbar}
                  onpointerdown={(e) => { e.stopPropagation(); onHandlePointerDown(e,'right') }}
                  role="separator" aria-label="Resize right"></div>

              </div>

              <!-- Hover toolbar — below the text box -->
              {#if showToolbar}
                <div class="overlay-toolbar"
                  onmouseenter={() => toolbarHovered = true}
                  onmouseleave={() => toolbarHovered = false}
                  onpointerdown={(e) => e.stopPropagation()}>

                  <!-- Text alignment group -->
                  <div class="tb-group">
                    {#each [['left','left'],['center','center'],['right','right']] as [ta, label]}
                      <button class="tb-btn" class:tb-active={getTextAlign(effectiveAlignment)===ta}
                        title="Align text {label}"
                        onclick={() => setTextAlign(ta as any)}>
                        {#if ta === 'left'}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2"/><rect x="1" y="6" width="10" height="2"/><rect x="1" y="10" width="12" height="2"/><rect x="1" y="14" width="8" height="2"/></svg>
                        {:else if ta === 'center'}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2"/><rect x="3" y="6" width="10" height="2"/><rect x="2" y="10" width="12" height="2"/><rect x="4" y="14" width="8" height="2"/></svg>
                        {:else}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2"/><rect x="5" y="6" width="10" height="2"/><rect x="3" y="10" width="12" height="2"/><rect x="7" y="14" width="8" height="2"/></svg>
                        {/if}
                      </button>
                    {/each}
                  </div>

                  <div class="tb-sep"></div>

                  <!-- Block (vertical) alignment group -->
                  <div class="tb-group">
                    {#each [['top','top'],['middle','middle'],['bottom','bottom']] as [ba, label]}
                      <button class="tb-btn" class:tb-active={getBlockAlign(effectiveAlignment)===ba}
                        title="Position {label}"
                        onclick={() => setBlockAlign(ba as any)}>
                        {#if ba === 'top'}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="2"/><rect x="4" y="5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="5" width="4" height="5" fill="currentColor" opacity=".4"/></svg>
                        {:else if ba === 'middle'}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="7" width="14" height="2"/><rect x="4" y="3" width="8" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
                        {:else}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="13" width="14" height="2"/><rect x="4" y="3" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="6" width="4" height="5" fill="currentColor" opacity=".4"/></svg>
                        {/if}
                      </button>
                    {/each}
                  </div>

                  <div class="tb-sep"></div>

                  <!-- Apply scope toggle -->
                  <label class="tb-scope" title="Apply to all segments or just this one">
                    <input type="checkbox" bind:checked={applyToAll} />
                    <span>{applyToAll ? 'All segments' : 'This segment'}</span>
                  </label>

                </div>
              {/if}

            </div>
            {/key}
          {/if}
          <div class="video-controls">
            <button class="play-btn" onclick={togglePlay}>{playing?'⏸':'▶'}</button>
            <span class="time">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div class="progress-bar" onclick={(e)=>{const r=e.currentTarget.getBoundingClientRect();seekTo(((e.clientX-r.left)/r.width)*duration)}} role="slider" tabindex="0" aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration} onkeydown={(e)=>{if(e.key==='ArrowRight')seekTo(currentTime+5);if(e.key==='ArrowLeft')seekTo(currentTime-5)}}>
              <div class="progress-fill" style="width:{duration?(currentTime/duration)*100:0}%"></div>
            </div>
          </div>
        {:else}
          <div class="no-video">No video loaded</div>
        {/if}
      </div>
    </div>

    <div class="sidebar">

      {#if subSidebar === 'customize' && templateVal}
        <!-- ── Customize sub-sidebar ── -->
        <div class="sub-sidebar">

          <!-- Sub-sidebar icon rail -->
          <div class="icon-rail">
            <!-- Back button -->
            <button class="rail-btn rail-back" onclick={() => subSidebar = null} title="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div class="rail-divider"></div>
            <!-- Text sub-tab -->
            <button class="rail-btn" class:active={customSection==='text'} onclick={()=>customSection='text'} title="Text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
              <span>Text</span>
            </button>
            <!-- Layout sub-tab -->
            <button class="rail-btn" class:active={customSection==='layout'} onclick={()=>customSection='layout'} title="Layout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              <span>Layout</span>
            </button>
            <!-- Animation sub-tab -->
            <button class="rail-btn" class:active={customSection==='animation'} onclick={()=>customSection='animation'} title="Animation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              <span>Anim</span>
            </button>
            <!-- Active Word sub-tab -->
            <button class="rail-btn" class:active={customSection==='activeword'} onclick={()=>customSection='activeword'} title="Active Word">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 12h10M12 9v6"/></svg>
              <span>Word</span>
            </button>
          </div>

          <!-- Sub-sidebar panel content -->
          <div class="panel">

            {#if customSection === 'text'}
              <div class="panel-hdr"><span class="panel-title">Typography</span></div>
              <div class="panel-body">

                <!-- Font family preview card -->
                <button class="font-preview-card" onclick={() => { customFont = !customFont }}>
                  <div class="font-preview-label">{templateVal.fontName.toUpperCase()}</div>
                  <div class="font-preview-sample" style="font-family:{templateVal.fontName};font-weight:{templateVal.bold?'bold':'normal'};font-style:{templateVal.italic?'italic':'normal'};">{templateVal.fontName}</div>
                </button>
                <div class="field-row">
                  <select class="font-select" onchange={handleFontSelect} value={customFont?'__custom__':templateVal.fontName}>
                    {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
                    <option value="__custom__">Custom…</option>
                  </select>
                </div>
                {#if customFont}
                  <div class="field-row"><input type="text" value={templateVal.fontName} placeholder="Font name…" onchange={(e)=>updateActiveTemplate({fontName:e.currentTarget.value})} /></div>
                {/if}

                <!-- Size + Bold/Italic -->
                <div class="s-lbl">Font Size</div>
                <div class="field-row">
                  <input type="range" min="8" max="120" value={templateVal.fontSize} oninput={(e)=>updateActiveTemplate({fontSize:Number(e.currentTarget.value)})} />
                  <span class="rval">{templateVal.fontSize}</span>
                </div>
                <div class="field-row" style="gap:.5rem;margin-top:.1rem">
                  <button class="tog" class:active={templateVal.bold}   onclick={()=>updateActiveTemplate({bold:!templateVal.bold})}><b>B</b></button>
                  <button class="tog" class:active={templateVal.italic} onclick={()=>updateActiveTemplate({italic:!templateVal.italic})}><i>I</i></button>
                </div>

                <!-- Line / Word spacing -->
                <div class="s-lbl">Line Spacing</div>
                <div class="field-row">
                  <input type="range" min="0" max="3" step="0.1" value={(templateVal as any).lineSpacing??0} oninput={(e)=>updateActiveTemplate({lineSpacing:Number(e.currentTarget.value)} as any)} />
                  <span class="rval">{((templateVal as any).lineSpacing??0).toFixed(1)}</span>
                </div>

                <div class="s-lbl">Word Spacing</div>
                <div class="field-row">
                  <input type="range" min="0" max="20" step="0.5" value={(templateVal as any).wordSpacing??0} oninput={(e)=>updateActiveTemplate({wordSpacing:Number(e.currentTarget.value)} as any)} />
                  <span class="rval">{(templateVal as any).wordSpacing??0}</span>
                </div>

                <!-- Text alignment -->
                <div class="s-lbl">Text Alignment</div>
                <div class="chip-row">
                  {#each ([[1,'left'],[2,'center'],[3,'right']] as [number,string][]) as [anVal, label]}
                    {@const isActive = [anVal, anVal+3, anVal+6].includes(templateVal.alignment)}
                    <button class="chip-btn" class:active={isActive}
                      onclick={() => {
                        const row = Math.floor((templateVal.alignment - 1) / 3)
                        updateActiveTemplate({alignment: (row * 3 + anVal) as any})
                      }}>
                      {#if label==='left'}
                        <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor"><rect x="0" y="0" width="16" height="2"/><rect x="0" y="4" width="11" height="2"/><rect x="0" y="8" width="13" height="2"/><rect x="0" y="12" width="9" height="2"/></svg>
                      {:else if label==='center'}
                        <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor"><rect x="0" y="0" width="16" height="2"/><rect x="2.5" y="4" width="11" height="2"/><rect x="1.5" y="8" width="13" height="2"/><rect x="3.5" y="12" width="9" height="2"/></svg>
                      {:else}
                        <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor"><rect x="0" y="0" width="16" height="2"/><rect x="5" y="4" width="11" height="2"/><rect x="3" y="8" width="13" height="2"/><rect x="7" y="12" width="9" height="2"/></svg>
                      {/if}
                    </button>
                  {/each}
                </div>

                <!-- Text Color -->
                <div class="s-lbl">Text Color</div>
                <div class="color-row">
                  <input type="color" value={templateVal.primaryColor} oninput={(e)=>updateActiveTemplate({primaryColor:e.currentTarget.value})} />
                  <span class="color-value">{templateVal.primaryColor} / 100%</span>
                </div>

                <!-- Text Transform -->
                <div class="s-lbl">Text Transform</div>
                <div class="chip-row">
                  {#each [['none','off'],['lowercase','lowercase'],['uppercase','UPPERCASE']] as [val, lbl]}
                    <button class="chip-btn" class:active={((templateVal as any).textTransform ?? 'none') === val}
                      onclick={()=>updateActiveTemplate({textTransform:val} as any)}>
                      {lbl}
                    </button>
                  {/each}
                </div>

                <!-- Hide Punctuation toggle -->
                <label class="toggle-row">
                  <span class="toggle-lbl">Hide Punctuation</span>
                  <button class="toggle-switch" class:on={(templateVal as any).hidePunctuation}
                    onclick={()=>updateActiveTemplate({hidePunctuation:!(templateVal as any).hidePunctuation} as any)}>
                    <span class="toggle-thumb"></span>
                  </button>
                </label>

                <!-- Text Stroke (outline) -->
                <div class="s-lbl" style="margin-top:.6rem">Effects</div>
                <div class="section-card">
                  <div class="section-card-hdr">
                    <span>Text Stroke</span>
                    <button class="toggle-switch toggle-switch-sm" class:on={templateVal.outline > 0}
                      onclick={()=>updateActiveTemplate({outline: templateVal.outline > 0 ? 0 : 2})}>
                      <span class="toggle-thumb"></span>
                    </button>
                  </div>
                  {#if templateVal.outline > 0}
                    <div class="color-row">
                      <input type="color" value={templateVal.outlineColor} oninput={(e)=>updateActiveTemplate({outlineColor:e.currentTarget.value})} />
                      <span class="color-value">{templateVal.outlineColor} / 100%</span>
                    </div>
                    <div class="field-row" style="margin-top:.4rem">
                      <label>Width</label>
                      <input type="range" min="0" max="10" step="0.5" value={templateVal.outline} oninput={(e)=>updateActiveTemplate({outline:Number(e.currentTarget.value)})} />
                      <span class="rval">{templateVal.outline}</span>
                    </div>
                  {/if}
                </div>

                <!-- Text Shadow -->
                <div class="section-card">
                  <div class="section-card-hdr">
                    <span>Text Shadow</span>
                    <button class="toggle-switch toggle-switch-sm" class:on={(templateVal as any).shadowEnabled}
                      onclick={()=>updateActiveTemplate({shadowEnabled:!(templateVal as any).shadowEnabled} as any)}>
                      <span class="toggle-thumb"></span>
                    </button>
                  </div>
                  {#if (templateVal as any).shadowEnabled}
                    <div class="color-row">
                      <input type="color" value={(templateVal as any).shadowColor??'#000000'} oninput={(e)=>updateActiveTemplate({shadowColor:e.currentTarget.value} as any)} />
                      <span class="color-value">{(templateVal as any).shadowColor??'#000000'} / 100%</span>
                    </div>
                    <div class="field-row" style="margin-top:.4rem">
                      <label>Blur</label>
                      <input type="range" min="0" max="20" step="1" value={(templateVal as any).shadowBlur??0} oninput={(e)=>updateActiveTemplate({shadowBlur:Number(e.currentTarget.value)} as any)} />
                      <span class="rval">{(templateVal as any).shadowBlur??0}</span>
                    </div>
                    <div class="field-row">
                      <label>Offset X</label>
                      <input type="range" min="-20" max="20" step="1" value={(templateVal as any).shadowOffsetX??0} oninput={(e)=>updateActiveTemplate({shadowOffsetX:Number(e.currentTarget.value)} as any)} />
                      <span class="rval">{(templateVal as any).shadowOffsetX??0}</span>
                    </div>
                    <div class="field-row">
                      <label>Offset Y</label>
                      <input type="range" min="-20" max="20" step="1" value={(templateVal as any).shadowOffsetY??0} oninput={(e)=>updateActiveTemplate({shadowOffsetY:Number(e.currentTarget.value)} as any)} />
                      <span class="rval">{(templateVal as any).shadowOffsetY??0}</span>
                    </div>
                  {/if}
                </div>

              </div>
            {/if}

            {#if customSection === 'layout'}
              <div class="panel-hdr"><span class="panel-title">Layout</span></div>
              <div class="panel-body">
                <div class="s-lbl">Position</div>
                <div class="field-row">
                  <span style="font-size:.7rem;color:var(--color-text-muted);">Drag the subtitle in the preview to set position.</span>
                </div>
                {#if (templateVal as any)?.posX != null}
                  <div class="field-row" style="margin-top:.3rem">
                    <span style="font-size:.68rem;color:var(--color-text-muted);">
                      X: {Math.round((templateVal as any).posX)}% &nbsp; Y: {Math.round((templateVal as any).posY)}%
                    </span>
                    <button class="reset-pos-btn" onclick={resetPosition}>↺ Reset</button>
                  </div>
                {:else}
                  <div class="field-row" style="margin-top:.3rem">
                    <span style="font-size:.68rem;color:var(--color-text-muted);">Default: bottom centre</span>
                  </div>
                {/if}
                <div class="field-row mt"><label>Margin V</label><input type="range" min="0" max="100" value={templateVal.marginV} oninput={(e)=>updateActiveTemplate({marginV:Number(e.currentTarget.value)})} /><span class="rval">{templateVal.marginV}</span></div>
                <div class="s-lbl">Timing</div>
                <div class="field-row"><label>Sync</label><input type="range" min="0" max="300" step="10" value={templateVal.syncOffset??50} oninput={(e)=>updateActiveTemplate({syncOffset:Number(e.currentTarget.value)})} /><span class="rval">{templateVal.syncOffset??50}ms</span></div>
                <div class="field-row"><label>Pause</label><input type="range" min="200" max="800" step="50" value={templateVal.pauseThreshold??500} oninput={(e)=>updateActiveTemplate({pauseThreshold:Number(e.currentTarget.value)})} /><span class="rval">{templateVal.pauseThreshold??500}ms</span></div>
              </div>
            {/if}

            {#if customSection === 'animation'}
              <div class="panel-hdr"><span class="panel-title">Animation</span></div>
              <div class="panel-body">
                <div class="s-lbl">Caption transition</div>
                <div class="anim-grid">
                  {#each [['none','None'],['fade','Fade'],['pop','Pop'],['slide-up','Slide up'],['typewriter','Typewriter']] as [val,lbl]}
                    <button class="anim-btn" class:active={templateVal.animation===val} onclick={()=>updateActiveTemplate({animation:val as AnimationMode})}>{lbl}</button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if customSection === 'activeword'}
              <div class="panel-hdr"><span class="panel-title">Active Word</span></div>
              <div class="panel-body">

                <!-- Live preview -->
                <div class="aw-preview">
                  <span class="aw-prev-word" style="
                    color:{(templateVal as any).activeWordColor ?? templateVal.primaryColor};
                    font-family:{templateVal.fontName};
                    font-weight:{templateVal.bold ? 'bold' : 'normal'};
                    font-style:{templateVal.italic ? 'italic' : 'normal'};
                  ">
                    {#if (templateVal as any).lineBgEnabled}
                      <span class="aw-prev-bg" style="
                        background:{(templateVal as any).activeWordBgColor ?? '#ffb900'};
                        padding:{((templateVal as any).activeWordBgPaddingY ?? 0.2)}em {((templateVal as any).activeWordBgPaddingX ?? 0.25)}em;
                        border-radius:{(templateVal as any).activeWordBgRounded ? '0.4em' : '0'};
                      ">YOUR</span>
                    {:else}
                      YOUR
                    {/if}
                  </span>
                  <span class="aw-prev-word" style="
                    color:{templateVal.primaryColor};
                    font-family:{templateVal.fontName};
                    font-weight:{templateVal.bold ? 'bold' : 'normal'};
                  "> VOICE</span>
                </div>

                <!-- Active word text color -->
                <div class="s-lbl">Active Word Color</div>
                <div class="color-row">
                  <input type="color"
                    value={(templateVal as any).activeWordColor ?? templateVal.primaryColor}
                    oninput={(e)=>updateActiveTemplate({activeWordColor:e.currentTarget.value} as any)} />
                  <span class="color-value">{(templateVal as any).activeWordColor ?? templateVal.primaryColor} / 100%</span>
                </div>

                <!-- Active word background -->
                <div class="s-lbl" style="margin-top:.6rem">Active Word Background</div>
                <div class="section-card">
                  <div class="section-card-hdr">
                    <span>Background</span>
                    <button class="toggle-switch toggle-switch-sm"
                      class:on={(templateVal as any).lineBgEnabled}
                      onclick={()=>updateActiveTemplate({lineBgEnabled:!(templateVal as any).lineBgEnabled} as any)}>
                      <span class="toggle-thumb"></span>
                    </button>
                  </div>
                  {#if (templateVal as any).lineBgEnabled}
                    <div class="color-row">
                      <input type="color"
                        value={(templateVal as any).activeWordBgColor ?? '#ffb900'}
                        oninput={(e)=>updateActiveTemplate({activeWordBgColor:e.currentTarget.value} as any)} />
                      <span class="color-value">{(templateVal as any).activeWordBgColor ?? '#ffb900'} / 100%</span>
                    </div>
                    <div class="field-row" style="margin-top:.4rem">
                      <label>Padding X</label>
                      <input type="range" min="0" max="1" step="0.05"
                        value={(templateVal as any).activeWordBgPaddingX ?? 0.25}
                        oninput={(e)=>updateActiveTemplate({activeWordBgPaddingX:Number(e.currentTarget.value)} as any)} />
                      <span class="rval">{((templateVal as any).activeWordBgPaddingX ?? 0.25).toFixed(2)}</span>
                    </div>
                    <div class="field-row">
                      <label>Padding Y</label>
                      <input type="range" min="0" max="1" step="0.05"
                        value={(templateVal as any).activeWordBgPaddingY ?? 0.2}
                        oninput={(e)=>updateActiveTemplate({activeWordBgPaddingY:Number(e.currentTarget.value)} as any)} />
                      <span class="rval">{((templateVal as any).activeWordBgPaddingY ?? 0.2).toFixed(2)}</span>
                    </div>
                    <!-- Rounded vs sharp corners -->
                    <div class="field-row" style="margin-top:.2rem">
                      <label style="font-size:.7rem;color:var(--color-text-muted);">Corners</label>
                      <div class="chip-row" style="flex:1">
                        <button class="chip-btn" class:active={!((templateVal as any).activeWordBgRounded)}
                          onclick={()=>updateActiveTemplate({activeWordBgRounded:false} as any)}>Sharp</button>
                        <button class="chip-btn" class:active={(templateVal as any).activeWordBgRounded}
                          onclick={()=>updateActiveTemplate({activeWordBgRounded:true} as any)}>Rounded</button>
                      </div>
                    </div>
                  {/if}
                </div>

              </div>
            {/if}

          </div>
        </div>

      {:else}
        <!-- ── Main icon rail ── -->
        <div class="icon-rail">
          <button class="rail-btn" class:active={activePanel==='styles'} onclick={()=>activePanel='styles'} title="Styles">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span>Styles</span>
          </button>
          <button class="rail-btn" onclick={() => { subSidebar = 'customize'; customSection = 'text' }} title="Customize">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
            <span>Customize</span>
          </button>
          <button class="rail-btn" class:active={activePanel==='captions'} onclick={()=>activePanel='captions'} title="Captions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 9h10M7 13h6"/></svg>
            <span>Captions</span>
          </button>
        </div>

        <div class="panel">

          {#if activePanel==='styles'}
            <div class="panel-hdr">
              <span class="panel-title">Styles</span>
              <button class="hdr-btn" onclick={()=>showSaveDialog=!showSaveDialog}>+ Save</button>
            </div>
            {#if showSaveDialog}
              <div class="save-row">
                <input type="text" bind:value={saveTemplateName} placeholder="Template name..." onkeydown={(e)=>e.key==='Enter'&&handleSaveTemplate()} />
                <button onclick={handleSaveTemplate}>Save</button>
                <button onclick={()=>showSaveDialog=false}>✕</button>
              </div>
            {/if}
            <div class="style-grid">
              {#each templatesVal as t}
                <button class="style-card" class:active={templateVal?.id===t.id} onclick={()=>setActiveTemplate(t)}>
                  <div class="style-preview" style="font-family:{t.fontName};color:{t.primaryColor};font-weight:{t.bold?'bold':'normal'};font-style:{t.italic?'italic':'normal'};text-shadow:-{t.outline}px -{t.outline}px 0 {t.outlineColor},{t.outline}px {t.outline}px 0 {t.outlineColor};">Aa</div>
                  <span class="style-name">{t.name}</span>
                </button>
              {/each}
            </div>
          {/if}

          {#if activePanel==='captions'}
            <div class="panel-hdr">
              <span class="panel-title">Captions</span>
              <div class="cap-acts"><button class="hdr-btn" onclick={handleExportSRT}>↓ SRT</button><button class="hdr-btn" onclick={handleImportSRT}>↑ SRT</button></div>
            </div>
          <!-- Density slider -->
          <div class="density-row">
            <span class="density-lbl">Segment length</span>
            <div class="density-track">
              <span class="density-hint">1 word</span>
              <input type="range" min="0" max="1" step="0.01" value={densityVal} oninput={handleDensityChange} class="density-slider" />
              <span class="density-hint">Full pause</span>
            </div>
          </div>
          <div class="find-row">
            <input type="text" bind:value={searchTerm} placeholder="Find..." class="fr-in" />
            <input type="text" bind:value={replaceTerm} placeholder="Replace..." class="fr-in" />
            <select bind:value={findMode} class="fr-sel"><option value="all">All</option><option value="single">First</option></select>
            <button class="btn-sm" onclick={handleFindReplace}>Go</button>
          </div>
          {#if replaceMessage}<div class="rep-msg">{replaceMessage}</div>{/if}
          {#if selectedSub && effective}
            <div class="seg-editor">
              <div class="seg-hdr">
                <span class="seg-ref">#{selectedSub.index}</span>
                <span class="seg-time">{selectedSub.start.slice(0,8)} → {selectedSub.end.slice(0,8)}</span>
                {#if hasOverrides}<button class="clr-btn" onclick={clearOverrides}>Clear</button>{/if}
                <button class="cls-btn" onclick={()=>selectSegment(null)}>✕</button>
              </div>
              <textarea class="seg-ta" use:initTextarea={selectedSub.text} oninput={(e)=>updateSubtitleText(selIdx!,(e.currentTarget as HTMLTextAreaElement).value)}></textarea>
              <div class="seg-ov">
                <div class="ov-row"><label>Color</label><input type="color" value={effective.primaryColor} oninput={(e)=>setOverride('primaryColor',e.currentTarget.value)} />{#if 'primaryColor' in overrides}<span class="ov-dot"></span>{/if}</div>
                <div class="ov-row"><label>Outline</label><input type="color" value={effective.outlineColor} oninput={(e)=>setOverride('outlineColor',e.currentTarget.value)} />{#if 'outlineColor' in overrides}<span class="ov-dot"></span>{/if}</div>
                <div class="ov-row"><label>Size</label><input type="number" min="8" max="120" value={effective.fontSize} onchange={(e)=>setOverride('fontSize',Number(e.currentTarget.value))} />{#if 'fontSize' in overrides}<span class="ov-dot"></span>{/if}</div>

              </div>
            </div>
          {/if}
          <div class="cap-list">
            {#each items as sub,i}
              <div class="cap-item" class:active={selIdx===i} onclick={()=>seekToSegment(sub)} role="button" tabindex="0" onkeydown={(e)=>e.key==='Enter'&&seekToSegment(sub)}>
                <span class="cap-num">#{sub.index}</span>
                <span class="cap-time">{sub.start.slice(0,8)}</span>
                <span class="cap-text">{sub.text}</span>
              </div>
              <!-- Between-segment actions -->
              {#if i < items.length - 1}
                <div class="cap-between">
                  <button class="cap-action-btn merge-btn" title="Merge with next segment" onclick={()=>mergeWithNext(i)}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1 4h6v2H3.5l4.5 4 4.5-4H10V4h5l-7 7.5L1 4z"/></svg>
                    merge
                  </button>
                  <button class="cap-action-btn insert-btn" title="Insert new segment after" onclick={()=>insertAfter(i)}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1v6H2v2h6v6h2V9h6V7H10V1H8z"/></svg>
                    +
                  </button>
                </div>
              {/if}
            {/each}
            <!-- Insert after last -->
            {#if items.length > 0}
              <div class="cap-between cap-between-last">
                <button class="cap-action-btn insert-btn" onclick={()=>insertAfter(items.length-1)}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1v6H2v2h6v6h2V9h6V7H10V1H8z"/></svg>
                  + Add segment
                </button>
              </div>
            {/if}
          </div>
        {/if}

        </div><!-- /.panel -->
      {/if}<!-- end {#if subSidebar} -->
    </div><!-- /.sidebar -->
  </div>
</div>

<style>
  .editor{display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--color-bg)}
  .topbar{display:flex;align-items:center;gap:.75rem;padding:.5rem 1rem;border-bottom:1px solid var(--color-border);background:var(--color-surface);flex-shrink:0}
  .back-btn{padding:.3rem .75rem;border-radius:6px;border:1px solid var(--color-border);background:transparent;color:var(--color-text-muted);font-size:.8rem;cursor:pointer}
  .back-btn:hover{background:var(--color-surface-hover);color:var(--color-text)}
  .file-name{font-weight:600;font-size:.9rem}.seg-count{font-size:.8rem;color:var(--color-text-muted)}
  .dirty-badge{font-size:.7rem;padding:2px 6px;border-radius:20px;background:var(--color-warning-subtle);color:var(--color-warning)}
  .spacer{flex:1}
  .btn-burn{padding:.35rem 1rem;border-radius:6px;border:none;background:var(--color-accent);color:white;font-size:.85rem;font-weight:500;cursor:pointer;white-space:nowrap}
  .btn-burn:hover{filter:brightness(1.1)}
  .body{display:flex;flex:1;overflow:hidden}
  .video-area{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .video-wrap{flex:1;position:relative;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .video{width:100%;height:100%;object-fit:contain;display:block}.no-video{color:#666;font-size:.9rem}
  /* ── Subtitle overlay ── */
  .sub-outer{pointer-events:auto;display:inline-flex;flex-direction:column;align-items:center;gap:0}
  .sub-box{position:relative;display:inline-block;min-width:60px;box-sizing:border-box;padding:0 18px}
  .sub-box:hover .resize-handle{opacity:1}
  .sub-text{display:block;line-height:1.35;white-space:pre-wrap;word-break:break-word;padding:2px 0}

  /* Resize handles */
  .resize-handle{position:absolute;top:50%;transform:translateY(-50%);width:12px;height:12px;border-radius:50%;background:white;box-shadow:0 0 4px rgba(0,0,0,.6);cursor:ew-resize;opacity:0;transition:opacity .15s;z-index:10}
  .resize-handle.visible{opacity:1}
  .resize-left{left:-6px}
  .resize-right{right:-6px}

  /* Overlay toolbar */
  .overlay-toolbar{display:flex;align-items:center;gap:3px;padding:4px 6px;border-radius:8px;background:rgba(20,20,30,.88);backdrop-filter:blur(6px);margin-top:6px;white-space:nowrap;pointer-events:auto;user-select:none;flex-wrap:nowrap}
  .tb-group{display:flex;gap:1px}
  .tb-btn{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:5px;border:none;background:transparent;color:rgba(255,255,255,.7);cursor:pointer;transition:background .1s,color .1s;flex-shrink:0}
  .tb-btn:hover{background:rgba(255,255,255,.15);color:white}
  .tb-btn.tb-active{background:rgba(255,255,255,.22);color:white}
  .tb-sep{width:1px;height:18px;background:rgba(255,255,255,.2);margin:0 3px;flex-shrink:0}
  .tb-scope{display:flex;align-items:center;gap:4px;font-size:.62rem;color:rgba(255,255,255,.75);cursor:pointer;padding:0 2px;flex-shrink:0}
  .tb-scope input[type=checkbox]{width:12px;height:12px;cursor:pointer;accent-color:var(--color-accent)}
  .video-controls{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;background:linear-gradient(transparent,rgba(0,0,0,.7))}
  .play-btn{background:none;border:none;color:white;font-size:1rem;cursor:pointer;padding:0;width:28px}
  .time{color:white;font-size:.75rem;white-space:nowrap;font-family:monospace}
  .progress-bar{flex:1;height:4px;background:rgba(255,255,255,.3);border-radius:2px;cursor:pointer;position:relative}
  .progress-fill{height:100%;background:var(--color-accent);border-radius:2px;pointer-events:none}
  .sidebar{display:flex;width:320px;flex-shrink:0;border-left:1px solid var(--color-border)}
  /* Sub-sidebar takes full sidebar width with its own rail */
  .sub-sidebar{display:flex;width:100%;overflow:hidden}
  .icon-rail{display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:.75rem 0;width:58px;flex-shrink:0;border-right:1px solid var(--color-border);background:var(--color-bg)}
  .rail-back{color:var(--color-text-muted)!important}
  .rail-divider{width:32px;height:1px;background:var(--color-border);margin:.25rem 0}
  .rail-btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:.5rem .25rem;border-radius:8px;border:none;background:transparent;color:var(--color-text-muted);cursor:pointer;width:50px;font-size:.58rem;line-height:1.2;transition:background .15s,color .15s}
  .rail-btn svg{width:20px;height:20px}.rail-btn:hover{background:var(--color-surface-hover);color:var(--color-text)}.rail-btn.active{background:var(--color-accent-subtle);color:var(--color-accent)}
  .panel{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
  .panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:.6rem .7rem;border-bottom:1px solid var(--color-border);flex-shrink:0}
  .panel-title{font-size:.78rem;font-weight:600;color:var(--color-text)}
  .hdr-btn{padding:.2rem .45rem;border-radius:4px;border:1px solid var(--color-border);background:transparent;color:var(--color-text-muted);font-size:.7rem;cursor:pointer}
  .hdr-btn:hover{background:var(--color-surface-hover);color:var(--color-text)}.cap-acts{display:flex;gap:.25rem}
  .style-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;padding:.6rem;overflow-y:auto;flex:1}
  .style-card{display:flex;flex-direction:column;align-items:center;gap:.3rem;padding:.5rem .3rem;border-radius:8px;border:2px solid transparent;background:var(--color-bg);cursor:pointer;transition:border-color .15s}
  .style-card:hover{border-color:var(--color-border)}.style-card.active{border-color:var(--color-accent)}
  .style-preview{width:100%;height:40px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:#111;font-size:14px;letter-spacing:.04em}
  .style-name{font-size:.65rem;color:var(--color-text-muted)}
  .save-row{display:flex;gap:.25rem;padding:.35rem .6rem;border-bottom:1px solid var(--color-border);flex-shrink:0}
  .save-row input{flex:1;padding:.22rem .4rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.73rem}
  .save-row button{padding:.22rem .45rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:.73rem;cursor:pointer}
  /* Remove old sub-tabs now replaced by sub-sidebar rail */
  .panel-body{flex:1;overflow-y:auto;padding:.55rem .7rem;display:flex;flex-direction:column;gap:.38rem}
  .s-lbl{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--color-text-muted);margin-top:.35rem}
  .mt{margin-top:.35rem}
  .field-row{display:flex;align-items:center;gap:.35rem}
  .field-row label{font-size:.7rem;color:var(--color-text-muted);min-width:52px}
  .checkbox-label{display:flex;align-items:center;gap:.3rem;font-size:.78rem;color:var(--color-text);cursor:pointer}
  .field-row input[type="text"],.field-row input[type="number"],.field-row select{flex:1;padding:.22rem .38rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.73rem;outline:none}
  .field-row input:focus,.field-row select:focus{border-color:var(--color-accent)}
  .short-in{max-width:52px;flex:none !important}
  .field-row input[type="color"]{width:26px;height:22px;padding:1px;border-radius:3px;border:1px solid var(--color-border);cursor:pointer;flex:none}
  .field-row input[type="range"]{flex:1;accent-color:var(--color-accent)}
  .hex{font-size:.68rem;font-family:monospace;color:var(--color-text-muted)}
  .rval{font-size:.68rem;color:var(--color-text-muted);min-width:30px;text-align:right}
  .tog{width:24px;height:24px;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text-muted);cursor:pointer;font-size:.78rem}
  .tog.active{background:var(--color-accent);border-color:var(--color-accent);color:white}
  .anim-grid{display:grid;grid-template-columns:1fr 1fr;gap:.35rem;margin-top:.2rem}
  .anim-btn{padding:.45rem;border-radius:6px;border:2px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.73rem;cursor:pointer;transition:border-color .15s,background .15s}
  .anim-btn:hover{border-color:var(--color-text-muted)}.anim-btn.active{border-color:var(--color-accent);background:var(--color-accent-subtle);color:var(--color-accent)}
  .find-row{display:flex;gap:.25rem;padding:.38rem .6rem;flex-shrink:0;border-bottom:1px solid var(--color-border)}
  .fr-in{flex:1;padding:.22rem .35rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.72rem;outline:none;min-width:0}
  .fr-in:focus{border-color:var(--color-accent)}
  .fr-sel{padding:.22rem .3rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.72rem}
  .btn-sm{padding:.22rem .45rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:.72rem;cursor:pointer;white-space:nowrap}
  .btn-sm:hover{background:var(--color-surface-hover)}
  .rep-msg{font-size:.7rem;color:var(--color-success);padding:.2rem .6rem;flex-shrink:0}
  .seg-editor{flex-shrink:0;border-bottom:1px solid var(--color-border);background:var(--color-surface);padding:.55rem .7rem}
  .seg-hdr{display:flex;align-items:center;gap:.35rem;margin-bottom:.35rem}
  .seg-ref{font-size:.7rem;font-weight:700;color:var(--color-accent)}
  .seg-time{font-size:.65rem;color:var(--color-text-muted);font-family:monospace;flex:1}
  .clr-btn{font-size:.65rem;padding:1px 5px;border-radius:4px;border:1px solid var(--color-danger);background:transparent;color:var(--color-danger);cursor:pointer}
  .cls-btn{background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:.82rem;padding:2px 3px}
  .seg-ta{width:100%;padding:.32rem .48rem;border-radius:5px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.8rem;font-family:inherit;resize:none;overflow:hidden;min-height:50px;box-sizing:border-box;line-height:1.5;outline:none}
  .seg-ta:focus{border-color:var(--color-accent)}
  .seg-ov{display:flex;flex-direction:column;gap:.28rem;margin-top:.35rem}
  .ov-row{display:flex;align-items:center;gap:.35rem}
  .ov-row label{font-size:.68rem;color:var(--color-text-muted);min-width:46px}
  .ov-row input[type="color"]{width:24px;height:20px;padding:1px;border-radius:3px;border:1px solid var(--color-border);cursor:pointer}
  .ov-row input[type="number"]{width:50px;padding:.18rem .3rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.7rem}
  .ov-row select{flex:1;padding:.18rem .3rem;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.7rem}
  .ov-dot{width:5px;height:5px;border-radius:50%;background:var(--color-accent);flex-shrink:0}
  .cap-list{flex:1;overflow-y:auto}
  .cap-item{display:flex;align-items:baseline;gap:.3rem;padding:.28rem .6rem;cursor:pointer;font-size:.74rem;border-bottom:1px solid var(--color-border)}
  .cap-item:hover{background:var(--color-surface-hover)}.cap-item.active{background:var(--color-accent-subtle)}
  .cap-num{font-size:.62rem;color:var(--color-accent);font-weight:700;min-width:20px}
  .cap-time{font-size:.62rem;color:var(--color-text-muted);font-family:monospace;min-width:56px}
  .cap-text{color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* Guide lines */
  .guide{position:absolute;pointer-events:none;transition:background .1s}
  .guide-h{left:0;right:0;top:50%;height:1px;background:rgba(255,255,255,.3);transform:translateY(-50%)}
  .guide-v{top:0;bottom:0;left:50%;width:1px;background:rgba(255,255,255,.3);transform:translateX(-50%)}
  .guide.snapped{background:rgba(99,179,237,.8);box-shadow:0 0 4px rgba(99,179,237,.6)}
  /* Reset position button */
  .reset-pos-btn{padding:.15rem .4rem;border-radius:4px;border:1px solid var(--color-border);background:transparent;color:var(--color-text-muted);font-size:.65rem;cursor:pointer;margin-left:auto}
  .reset-pos-btn:hover{background:var(--color-surface-hover);color:var(--color-text)}
  /* Density slider */
  .density-row{padding:.45rem .6rem;border-bottom:1px solid var(--color-border);flex-shrink:0}
  .density-lbl{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-muted);display:block;margin-bottom:.3rem}
  .density-track{display:flex;align-items:center;gap:.4rem}
  .density-hint{font-size:.6rem;color:var(--color-text-muted);white-space:nowrap}
  .density-slider{flex:1;accent-color:var(--color-accent);height:4px}
  /* Between-segment actions */
  .cap-between{display:flex;align-items:center;gap:.3rem;padding:.1rem .6rem;background:var(--color-bg);border-bottom:1px solid var(--color-border)}
  .cap-between-last{padding:.3rem .6rem;border-bottom:none}
  .cap-action-btn{display:flex;align-items:center;gap:.25rem;padding:.15rem .35rem;border-radius:4px;border:1px solid transparent;background:transparent;font-size:.62rem;cursor:pointer;color:var(--color-text-muted);transition:all .12s}
  .merge-btn:hover{background:var(--color-accent-subtle);border-color:var(--color-accent);color:var(--color-accent)}
  .insert-btn:hover{background:var(--color-surface-hover);border-color:var(--color-border);color:var(--color-text)}
  
  /* Font preview card */
  .font-preview-card{width:100%;padding:.65rem .75rem;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);cursor:pointer;text-align:center;transition:border-color .15s;margin-bottom:.25rem}
  .font-preview-card:hover{border-color:var(--color-text-muted)}
  .font-preview-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:.25rem}
  .font-preview-sample{font-size:1.35rem;color:var(--color-text);line-height:1.2}
  .font-select{width:100%;padding:.25rem .4rem;border-radius:5px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:.73rem;outline:none}
  .font-select:focus{border-color:var(--color-accent)}
  /* Chip row (text align, transform) */
  .chip-row{display:flex;gap:.35rem}
  .chip-btn{flex:1;display:flex;align-items:center;justify-content:center;padding:.4rem;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text-muted);font-size:.7rem;cursor:pointer;transition:all .15s;min-height:32px}
  .chip-btn:hover{border-color:var(--color-text-muted);color:var(--color-text)}
  .chip-btn.active{border-color:var(--color-accent);background:var(--color-accent-subtle);color:var(--color-accent)}
  /* Color row */
  .color-row{display:flex;align-items:center;gap:.5rem;padding:.4rem .5rem;border-radius:6px;border:1px solid var(--color-border);background:var(--color-surface)}
  .color-row input[type="color"]{width:32px;height:28px;padding:1px;border:none;border-radius:4px;cursor:pointer;flex-shrink:0;background:none}
  .color-value{font-size:.72rem;color:var(--color-text-muted);font-family:monospace}
  /* Toggle row */
  .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:.3rem 0;cursor:pointer}
  .toggle-lbl{font-size:.75rem;color:var(--color-text)}
  /* Toggle switch (shared) */
  .toggle-switch{width:36px;height:20px;border-radius:10px;border:none;background:var(--color-border);position:relative;cursor:pointer;transition:background .15s;flex-shrink:0}
  .toggle-switch.on{background:var(--color-accent)}
  .toggle-thumb{position:absolute;width:14px;height:14px;border-radius:50%;background:white;top:3px;left:3px;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none}
  .toggle-switch.on .toggle-thumb{transform:translateX(16px)}
  .toggle-switch-sm{width:30px;height:17px}
  .toggle-switch-sm .toggle-thumb{width:11px;height:11px;top:3px;left:3px}
  .toggle-switch-sm.on .toggle-thumb{transform:translateX(13px)}
  /* Section cards (stroke/shadow) */
  .section-card{border:1px solid var(--color-border);border-radius:8px;padding:.55rem .65rem;display:flex;flex-direction:column;gap:.4rem;background:var(--color-surface)}
  .section-card-hdr{display:flex;align-items:center;justify-content:space-between;font-size:.75rem;color:var(--color-text);font-weight:500}
  /* Active Word preview */
  .aw-preview{display:flex;align-items:center;justify-content:center;padding:.9rem .5rem;border-radius:8px;background:#111;gap:.25em;margin-bottom:.25rem}
  .aw-prev-word{font-size:1.3rem;font-weight:700;line-height:1.3;white-space:nowrap}
  .aw-prev-bg{display:inline;line-height:inherit}
  .aw-active-word{display:inline;line-height:inherit;white-space:nowrap}
  /* Remove old sub-tabs now replaced by sub-sidebar rail */
  @keyframes sub-fade{from{opacity:0}to{opacity:1}}
  @keyframes sub-pop{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}
  @keyframes sub-slide-up{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}


</style>