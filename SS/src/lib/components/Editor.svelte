<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import type { Subtitle } from '$lib/types'
  import { createEventDispatcher } from 'svelte'
  import {
    session, subtitles, selectedIndex, selectedSubtitle,
    isDirty, closeSession, selectSegment,
    updateSubtitleText, resetSubtitleText,
    updateSubtitleOverrides, clearSubtitleOverrides,
    findAndReplace
  } from '$lib/stores/editor'
  import { activeTemplate, updateActiveTemplate, allTemplates, setActiveTemplate, saveActiveAsTemplate } from '$lib/stores/templates'
  import { buildAss, serializeSRT } from '$lib/utils/ass'
  import SegmentList from './SegmentList.svelte'
  import SegmentInspector from './SegmentInspector.svelte'
  import TemplatePanel from './TemplatePanel.svelte'

  const dispatch = createEventDispatcher<{
    burn: { videoPath: string; outputPath: string; assContent: string }
    cancel: void
  }>()

  // Find & replace state
  let searchTerm = ''
  let replaceTerm = ''
  let findMode: 'all' | 'single' = 'all'
  let replaceMessage = ''

  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, findMode)
    replaceMessage = `Replaced ${count} occurrence${count !== 1 ? 's' : ''}`
    setTimeout(() => replaceMessage = '', 3000)
  }

  function handleBurn() {
    if (!$session) return
    const assContent = buildAss($subtitles, $activeTemplate)
    dispatch('burn', {
      videoPath: $session.videoPath,
      outputPath: $session.outputPath,
      assContent
    })
  }

  function handleCancel() {
    closeSession()
    dispatch('cancel')
  }

  function getFileName(path: string) {
    return path.split(/[\\/]/).pop() ?? path
  }
</script>

<div class="editor">
  <!-- Top bar -->
  <div class="editor-topbar">
    <div class="topbar-left">
      <button class="back-btn" on:click={handleCancel} title="Back to queue">← Queue</button>
      <div class="file-info">
        <span class="file-name">{getFileName($session?.videoPath ?? '')}</span>
        <span class="sub-count">{$subtitles.length} segments</span>
        {#if $isDirty}
          <span class="dirty-badge">unsaved</span>
        {/if}
      </div>
    </div>
    <div class="topbar-right">
      <div class="find-replace">
        <input
          type="text"
          bind:value={searchTerm}
          placeholder="Find..."
          class="fr-input"
        />
        <input
          type="text"
          bind:value={replaceTerm}
          placeholder="Replace..."
          class="fr-input"
        />
        <select bind:value={findMode} class="fr-select">
          <option value="all">All</option>
          <option value="single">First</option>
        </select>
        <button class="btn-sm" on:click={handleFindReplace}>Replace</button>
        {#if replaceMessage}
          <span class="replace-msg">{replaceMessage}</span>
        {/if}
      </div>
      <button class="btn-sm btn-burn" on:click={handleBurn}>
        Burn Subtitles →
      </button>
    </div>
  </div>

  <!-- Three-panel body -->
  <div class="editor-body">
    <!-- Left: Segment list -->
    <div class="panel panel-left">
      <SegmentList />
    </div>

    <!-- Center: Template panel -->
    <div class="panel panel-center">
      <TemplatePanel />
    </div>

    <!-- Right: Segment inspector -->
    <div class="panel panel-right">
      {#if $selectedSubtitle !== null && $selectedIndex !== null}
        {@const sub = $selectedSubtitle}
        {@const idx = $selectedIndex}
        {@const tpl = $activeTemplate}
        <SegmentInspector
          subtitle={sub}
          index={idx}
          template={tpl}
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

  /* ── Top bar ── */
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

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .back-btn {
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .back-btn:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .file-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-text);
  }

  .sub-count {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .dirty-badge {
    font-size: 0.7rem;
    padding: 2px 6px;
    border-radius: 20px;
    background: var(--color-warning-subtle);
    color: var(--color-warning);
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .find-replace {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .fr-input {
    padding: 0.35rem 0.6rem;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.8rem;
    width: 120px;
  }

  .fr-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }

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

  .replace-msg {
    font-size: 0.75rem;
    color: var(--color-success);
    white-space: nowrap;
  }

  /* ── Three-panel body ── */
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

  .panel-left   { background: var(--color-bg); }
  .panel-center { background: var(--color-surface); }
  .panel-right  { background: var(--color-bg); }

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

  /* ── Mobile future-proofing ── */
  @media (max-width: 768px) {
    .editor-body {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
    }

    .panel {
      border-right: none;
      border-bottom: 1px solid var(--color-border);
      max-height: 40vh;
    }
  }
</style>