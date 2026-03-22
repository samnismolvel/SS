<script lang="ts">
  import { session, isDirty, findAndReplace } from '$lib/stores/editor'
  import { activeTemplate } from '$lib/stores/templates'
  import { buildAss } from '$lib/utils/ass'
  import SegmentList from './SegmentList.svelte'
  import SegmentInspector from './SegmentInspector.svelte'
  import TemplatePanel from './TemplatePanel.svelte'

  interface Props {
    onburn: (detail: { videoPath: string; outputPath: string; assContent: string }) => void
    oncancel: () => void
  }

  let { onburn, oncancel }: Props = $props()

  let searchTerm = $state('')
  let replaceTerm = $state('')
  let findMode = $state<'all' | 'single'>('all')
  let replaceMessage = $state('')

  let sessionVal = $derived($session)
  let isDirtyVal = $derived($isDirty)
  let selectedSub = $derived($session?.selectedIndex !== null && $session?.selectedIndex !== undefined
    ? $session.subtitles[$session.selectedIndex]
    : null)
  let selectedIdx = $derived($session?.selectedIndex ?? null)
  let templateVal = $derived($activeTemplate)

  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, findMode)
    replaceMessage = `Replaced ${count} occurrence${count !== 1 ? 's' : ''}`
    setTimeout(() => replaceMessage = '', 3000)
  }

  function handleBurn() {
    if (!sessionVal) return
    const assContent = buildAss(sessionVal.subtitles, templateVal)
    onburn({ videoPath: sessionVal.videoPath, outputPath: sessionVal.outputPath, assContent })
  }

  function getFileName(path: string) {
    return path.split(/[\\/]/).pop() ?? path
  }
</script>

<div class="editor">
  <div class="editor-topbar">
    <div class="topbar-left">
      <button class="back-btn" onclick={oncancel}>← Queue</button>
      <div class="file-info">
        <span class="file-name">{getFileName(sessionVal?.videoPath ?? '')}</span>
        <span class="sub-count">{sessionVal?.subtitles.length ?? 0} segments</span>
        {#if isDirtyVal}
          <span class="dirty-badge">unsaved</span>
        {/if}
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
        {#if replaceMessage}
          <span class="replace-msg">{replaceMessage}</span>
        {/if}
      </div>
      <button class="btn-sm btn-burn" onclick={handleBurn}>Burn Subtitles →</button>
    </div>
  </div>

  <div class="editor-body">
    <div class="panel panel-left">
      <SegmentList />
    </div>
    <div class="panel panel-center">
      <TemplatePanel />
    </div>
    <div class="panel panel-right">
      {#if selectedSub !== null && selectedIdx !== null}
        <SegmentInspector
          subtitle={selectedSub}
          index={selectedIdx}
          template={templateVal}
        />
      {:else}
        <div class="inspector-empty">
          <span>Select a segment<br/>to inspect</span>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .editor-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .topbar-left { display: flex; align-items: center; gap: 0.75rem; }

  .back-btn {
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s;
  }
  .back-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }

  .file-info { display: flex; align-items: center; gap: 0.5rem; }

  .file-name { font-weight: 600; font-size: 0.9rem; }

  .sub-count { font-size: 0.8rem; color: var(--color-text-muted); }

  .dirty-badge {
    font-size: 0.7rem;
    padding: 2px 6px;
    border-radius: 20px;
    background: var(--color-warning-subtle);
    color: var(--color-warning);
  }

  .topbar-right { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }

  .find-replace { display: flex; align-items: center; gap: 0.35rem; }

  .fr-input {
    padding: 0.35rem 0.6rem;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.8rem;
    width: 120px;
  }
  .fr-input:focus { outline: none; border-color: var(--color-accent); }

  .fr-select {
    padding: 0.35rem 0.5rem;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.8rem;
  }

  .btn-sm {
    padding: 0.35rem 0.75rem;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .btn-sm:hover { background: var(--color-surface-hover); }

  .btn-burn {
    background: var(--color-accent);
    color: white;
    border-color: var(--color-accent);
  }
  .btn-burn:hover { filter: brightness(1.1); }

  .replace-msg { font-size: 0.75rem; color: var(--color-success); white-space: nowrap; }

  .editor-body {
    display: grid;
    grid-template-columns: 280px 1fr 260px;
    flex: 1;
    overflow: hidden;
  }

  .panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--color-border);
  }
  .panel:last-child { border-right: none; }
  .panel-left { background: var(--color-bg); }
  .panel-center { background: var(--color-surface); }
  .panel-right { background: var(--color-bg); }

  .inspector-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--color-text-muted);
    font-size: 0.85rem;
    line-height: 1.6;
    padding: 2rem;
  }

  @media (max-width: 768px) {
    .editor-body {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
    }
    .panel { border-right: none; border-bottom: 1px solid var(--color-border); max-height: 40vh; }
  }
</style>