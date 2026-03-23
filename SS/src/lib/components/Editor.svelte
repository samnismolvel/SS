<script lang="ts">
  import { session, isDirty, findAndReplace, selectSegment, updateSubtitleText, resetSubtitleText } from '$lib/stores/editor'
  import { activeTemplate } from '$lib/stores/templates'
  import { buildAss } from '$lib/utils/ass'
  import SegmentInspector from './SegmentInspector.svelte'
  import TemplatePanel from './TemplatePanel.svelte'

  interface Props {
    onburn: (detail: { videoPath: string; outputPath: string; assContent: string }) => void
    oncancel: () => void
  }
  let { onburn, oncancel }: Props = $props()

  // All state via explicit subscribe
  let sessionVal = $state(null as any)
  let isDirtyVal = $state(false)
  let templateVal = $state(null as any)
  let items = $state([] as any[])
  let selIdx = $state(null as number | null)
  let searchTerm = $state('')
  let replaceTerm = $state('')
  let findMode = $state('all' as 'all' | 'single')
  let replaceMessage = $state('')

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

  let selectedSub = $derived(
    sessionVal && selIdx !== null ? sessionVal.subtitles[selIdx] : null
  )

  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, findMode)
    replaceMessage = `Replaced ${count} occurrence${count !== 1 ? 's' : ''}`
    setTimeout(() => replaceMessage = '', 3000)
  }

  function handleBurn() {
    if (!sessionVal || !templateVal) return
    const assContent = buildAss(sessionVal.subtitles, templateVal)
    onburn({ videoPath: sessionVal.videoPath, outputPath: sessionVal.outputPath, assContent })
  }

  function handleSegmentClick(index: number) {
    selectSegment(selIdx === index ? null : index)
  }

  function getFileName(path: string) {
    return path.split(/[\\/]/).pop() ?? path
  }

  function initTextarea(node: HTMLTextAreaElement, text: string) {
  node.value = text
  node.style.height = 'auto'
  node.style.height = node.scrollHeight + 'px'
  return {
    update(newText: string) {
      if (document.activeElement !== node) {
        node.value = newText
        node.style.height = 'auto'
        node.style.height = node.scrollHeight + 'px'
      }
    }
  }
}
</script>

<div class="editor">
  <!-- Top bar -->
  <div class="editor-topbar">
    <div class="topbar-left">
      <button class="back-btn" onclick={oncancel}>← Queue</button>
      <div class="file-info">
        <span class="file-name">{getFileName(sessionVal?.videoPath ?? '')}</span>
        <span class="sub-count">{items.length} segments</span>
        {#if isDirtyVal}<span class="dirty-badge">unsaved</span>{/if}
      </div>
    </div>
    <div class="topbar-right">
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
      <button class="btn-sm btn-burn" onclick={handleBurn}>Burn Subtitles →</button>
    </div>
  </div>

  <!-- Three panels -->
  <div class="editor-body">

    <!-- LEFT: Segment list inlined -->
    <div class="panel panel-left">
      <div class="segment-list-header">
        <span class="panel-label">Segments</span>
        <span class="count">{items.length}</span>
      </div>
      <div class="segment-list">
        {#each items as sub, index}
          <div
            class="segment"
            class:selected={selIdx === index}
            class:modified={sub.text !== sub.originalText}
          >
            <div class="segment-header"
              role="button" tabindex="0"
              onclick={() => handleSegmentClick(index)}
              onkeydown={(e) => e.key === 'Enter' && handleSegmentClick(index)}
            >
              <span class="seg-index">#{sub.index}</span>
              <span class="seg-timing">{sub.start} → {sub.end}</span>
              {#if sub.text !== sub.originalText}
                <button class="reset-btn"
                  onclick={(e) => { e.stopPropagation(); resetSubtitleText(index) }}>↺</button>
              {/if}
            </div>
            <textarea
              class="seg-text"
              
              use:initTextarea={sub.text}
              oninput={(e) => updateSubtitleText(index, (e.currentTarget as HTMLTextAreaElement).value)}
              onfocus={() => selectSegment(index)}
            ></textarea>
          </div>
        {/each}
      </div>
    </div>

    <!-- CENTER: Template panel -->
    <div class="panel panel-center">
      <TemplatePanel />
    </div>

    <!-- RIGHT: Inspector -->
    <div class="panel panel-right">
      {#if selectedSub !== null && selIdx !== null && templateVal !== null}
        <SegmentInspector subtitle={selectedSub} index={selIdx} template={templateVal} />
      {:else}
        <div class="inspector-empty">
          <span>Select a segment<br/>to inspect</span>
        </div>
      {/if}
    </div>

  </div>
</div>

<style>
  .editor { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .editor-topbar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);
    background: var(--color-surface); flex-shrink: 0; flex-wrap: wrap;
  }
  .topbar-left { display: flex; align-items: center; gap: 0.75rem; }
  .back-btn {
    padding: 0.35rem 0.75rem; border-radius: 6px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted); font-size: 0.8rem; cursor: pointer;
  }
  .back-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .file-info { display: flex; align-items: center; gap: 0.5rem; }
  .file-name { font-weight: 600; font-size: 0.9rem; }
  .sub-count { font-size: 0.8rem; color: var(--color-text-muted); }
  .dirty-badge {
    font-size: 0.7rem; padding: 2px 6px; border-radius: 20px;
    background: var(--color-warning-subtle); color: var(--color-warning);
  }
  .topbar-right { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .find-replace { display: flex; align-items: center; gap: 0.35rem; }
  .fr-input {
    padding: 0.35rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-bg); color: var(--color-text); font-size: 0.8rem; width: 120px;
  }
  .fr-input:focus { outline: none; border-color: var(--color-accent); }
  .fr-select {
    padding: 0.35rem 0.5rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-bg); color: var(--color-text); font-size: 0.8rem;
  }
  .btn-sm {
    padding: 0.35rem 0.75rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text); font-size: 0.8rem;
    font-weight: 500; cursor: pointer; white-space: nowrap;
  }
  .btn-sm:hover { background: var(--color-surface-hover); }
  .btn-burn { background: var(--color-accent); color: white; border-color: var(--color-accent); }
  .btn-burn:hover { filter: brightness(1.1); }
  .replace-msg { font-size: 0.75rem; color: var(--color-success); white-space: nowrap; }

  .editor-body {
    display: grid; grid-template-columns: 280px 1fr 260px; flex: 1; overflow: hidden;
  }
  .panel { display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--color-border); }
  .panel:last-child { border-right: none; }
  .panel-left { background: var(--color-bg); }
  .panel-center { background: var(--color-surface); }
  .panel-right { background: var(--color-bg); }
  .inspector-empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    text-align: center; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.6; padding: 2rem;
  }

  /* Segment list */
  .segment-list-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
  }
  .panel-label {
    font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--color-text-muted);
  }
  .count {
    font-size: 0.75rem; color: var(--color-text-muted);
    background: var(--color-surface-hover); padding: 1px 6px; border-radius: 10px;
  }
  .segment-list {
    flex: 1; overflow-y: auto; padding: 0.5rem;
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .segment {
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow: visible;  /* changed from hidden */
  transition: border-color 0.15s;
  min-height: 60px;   /* add this */
}
  .segment:hover { border-color: var(--color-border-hover); }
  .segment.selected { border-color: var(--color-accent); }
  .segment-header {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.6rem;
    cursor: pointer; user-select: none; background: var(--color-surface-hover);
  }
  .segment.selected .segment-header { background: var(--color-accent-subtle); }
  .seg-index { font-size: 0.7rem; font-weight: 700; color: var(--color-text-muted); min-width: 24px; }
  .seg-timing { font-size: 0.7rem; font-family: monospace; color: var(--color-text-muted); flex: 1; }
  .reset-btn {
    background: none; border: none; cursor: pointer;
    color: var(--color-text-muted); font-size: 0.85rem; padding: 0 2px; line-height: 1;
  }
  .reset-btn:hover { color: var(--color-text); }
  .seg-text {
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: none;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.82rem;
    font-family: inherit;
    box-sizing: border-box;
    line-height: 1.5;
    resize: none;
    overflow: hidden;
    outline: none;
    min-height: 2rem;
    display: block;
  }
  .seg-text:focus { background: var(--color-surface); outline: none; }

  @media (max-width: 768px) {
    .editor-body { grid-template-columns: 1fr; grid-template-rows: auto auto auto; }
    .panel { border-right: none; border-bottom: 1px solid var(--color-border); max-height: 40vh; }
  }
</style>