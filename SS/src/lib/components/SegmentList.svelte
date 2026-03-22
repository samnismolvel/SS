<script lang="ts">
  import { subtitles, selectedIndex, selectSegment, updateSubtitleText, resetSubtitleText } from '$lib/stores/editor'

  function handleClick(index: number) {
    selectSegment($selectedIndex === index ? null : index)
  }

  function handleTextInput(index: number, e: Event) {
    updateSubtitleText(index, (e.target as HTMLTextAreaElement).value)
  }
</script>

<div class="segment-list-header">
  <span class="panel-label">Segments</span>
  <span class="count">{$subtitles.length}</span>
</div>

<div class="segment-list">

  <p style="color: red; padding: 0.5rem;">DEBUG: {$subtitles.length} subtitles, first: {$subtitles[0]?.text ?? 'none'}</p>
  {#each $subtitles as sub, index (sub.index)}
    <div
      class="segment"
      class:selected={$selectedIndex === index}
      class:modified={sub.text !== sub.originalText}
      class:has-overrides={!!sub.overrides && Object.keys(sub.overrides).length > 0}
    >
      <div class="segment-header" on:click={() => handleClick(index)} role="button" tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && handleClick(index)}
      >
        <span class="seg-index">#{sub.index}</span>
        <span class="seg-timing">{sub.start} → {sub.end}</span>
        <div class="seg-badges">
          {#if sub.text !== sub.originalText}
            <span class="badge badge-modified" title="Text edited">E</span>
          {/if}
          {#if sub.overrides && Object.keys(sub.overrides).length > 0}
            <span class="badge badge-styled" title="Has style overrides">S</span>
          {/if}
        </div>
        {#if sub.text !== sub.originalText}
          <button
            class="reset-btn"
            on:click|stopPropagation={() => resetSubtitleText(index)}
            title="Reset text"
          >↺</button>
        {/if}
      </div>

      <div
        class="seg-text"
        class:focused={$selectedIndex === index}
        contenteditable="true"
        on:input={(e) => updateSubtitleText(index, e.currentTarget.textContent ?? '')}
        on:focus={() => selectSegment(index)}
      >
        {sub.text}
      </div>
      
    </div>
  {/each}
</div>

<style>
  .segment-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .panel-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-muted);
  }

  .count {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    background: var(--color-surface-hover);
    padding: 1px 6px;
    border-radius: 10px;
  }

  .segment-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .segment {
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .segment:hover { border-color: var(--color-border-hover); }
  .segment.selected { border-color: var(--color-accent); }
  .segment.has-overrides { border-left: 3px solid var(--color-accent-subtle); }

  .segment-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    user-select: none;
    background: var(--color-surface-hover);
  }

  .segment.selected .segment-header {
    background: var(--color-accent-subtle);
  }

  .seg-index {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--color-text-muted);
    min-width: 24px;
  }

  .seg-timing {
    font-size: 0.7rem;
    font-family: monospace;
    color: var(--color-text-muted);
    flex: 1;
  }

  .seg-badges {
    display: flex;
    gap: 3px;
  }

  .badge {
    font-size: 0.6rem;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
  }

  .badge-modified {
    background: var(--color-warning-subtle);
    color: var(--color-warning);
  }

  .badge-styled {
    background: var(--color-accent-subtle);
    color: var(--color-accent);
  }

  .reset-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 0.85rem;
    padding: 0 2px;
    line-height: 1;
    transition: color 0.15s;
  }

  .reset-btn:hover { color: var(--color-text); }

  .seg-text {
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: none;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text) !important;
    -webkit-text-fill-color: var(--color-text) !important;
    font-size: 0.82rem;
    font-family: inherit;
    min-height: 2.5rem;
    box-sizing: border-box;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    outline: none;
    cursor: text;
  }

  .seg-text:focus {
    background: var(--color-surface);
  }

  .seg-text.focused {
    background: var(--color-surface);
  }
</style>