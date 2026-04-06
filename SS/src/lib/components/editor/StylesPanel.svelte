<script lang="ts">
  import { activeTemplate, updateActiveTemplate, allTemplates, setActiveTemplate, saveActiveAsTemplate } from '$lib/stores/templates'
  import type { Template } from '$lib/types'

  let templateVal  = $state(null as Template | null)
  let templatesVal = $state([] as Template[])
  let showSaveDialog   = $state(false)
  let saveTemplateName = $state('')

  $effect(() => {
    const u1 = activeTemplate.subscribe(v => { templateVal = v })
    const u2 = allTemplates.subscribe(v => { templatesVal = v })
    return () => { u1(); u2() }
  })

  function handlePresetSelect(id: string) {
    const found = templatesVal.find(t => t.id === id)
    if (found) setActiveTemplate(found)
  }

  function handleSaveTemplate() {
    if (!saveTemplateName.trim()) return
    saveActiveAsTemplate(saveTemplateName.trim())
    saveTemplateName = ''
    showSaveDialog = false
  }
</script>

<div class="panel-header">
  <span class="panel-title">Styles</span>
  <button class="header-action-btn" onclick={() => showSaveDialog = !showSaveDialog}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M12 5v14M5 12h14"/>
    </svg>
    Save current
  </button>
</div>

{#if showSaveDialog}
  <div class="save-row">
    <input type="text" bind:value={saveTemplateName} placeholder="Template name…"
      onkeydown={(e) => e.key === 'Enter' && handleSaveTemplate()} />
    <button class="save-confirm-btn" onclick={handleSaveTemplate}>Save</button>
    <button class="save-cancel-btn" onclick={() => showSaveDialog = false}>✕</button>
  </div>
{/if}

<div class="styles-grid">
  {#each templatesVal as t}
    {@const isActive = templateVal?.id === t.id}
    <button class="style-card {isActive ? 'active' : ''}" onclick={() => handlePresetSelect(t.id)}>
      <div class="style-preview"
        style="background:{t.outlineColor === '#000000' || t.outlineColor === '#1A1A1A' ? '#141414' : '#f0f0f0'};">
        <div class="preview-inner">
          {#if t.wordByWord && t.wordMode !== 'none'}
            <span style="font-family:{t.fontName};font-weight:{t.bold?'700':'400'};font-style:{t.italic?'italic':'normal'};color:{t.primaryColor};font-size:10px;text-shadow:-1px -1px 0 {t.outlineColor},1px -1px 0 {t.outlineColor},-1px 1px 0 {t.outlineColor},1px 1px 0 {t.outlineColor};">Every </span><span
            style="font-family:{t.fontName};font-weight:{t.bold?'700':'400'};font-style:{t.italic?'italic':'normal'};color:{t.highlightColor};font-size:10px;text-shadow:-1px -1px 0 {t.outlineColor},1px -1px 0 {t.outlineColor},-1px 1px 0 {t.outlineColor},1px 1px 0 {t.outlineColor};">word</span>
          {:else}
            <span style="font-family:{t.fontName};font-weight:{t.bold?'700':'400'};font-style:{t.italic?'italic':'normal'};color:{t.primaryColor};font-size:11px;text-shadow:-1px -1px 0 {t.outlineColor},1px -1px 0 {t.outlineColor},-1px 1px 0 {t.outlineColor},1px 1px 0 {t.outlineColor};">Subtitle text</span>
          {/if}
        </div>
      </div>
      <div class="style-footer">
        <span class="style-name">{t.name}</span>
        {#if isActive}<span class="style-active-dot"></span>{/if}
      </div>
    </button>
  {/each}
</div>

<style>
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
  }
  .panel-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
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
</style>