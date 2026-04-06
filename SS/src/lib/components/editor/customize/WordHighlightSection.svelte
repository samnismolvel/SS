<script lang="ts">
  import { activeTemplate, updateActiveTemplate } from '$lib/stores/templates'
  import type { Template, WordMode } from '$lib/types'

  let { open = false, ontoggle }: { open?: boolean; ontoggle: () => void } = $props()

  let t = $state(null as Template | null)
  $effect(() => { const u = activeTemplate.subscribe(v => { t = v }); return u })
</script>

<div class="accordion-item">
  <button class="accordion-btn {open ? 'open' : ''}" onclick={ontoggle}>
    <span class="acc-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="8" width="6" height="8" rx="1"/>
        <rect x="11" y="8" width="10" height="8" rx="1" fill="currentColor" fill-opacity="0.2"/>
        <path d="M11 12h10"/>
      </svg>
    </span>
    <span class="acc-label">Word Highlight</span>
    {#if t?.wordByWord}
      <span class="acc-badge">ON</span>
    {/if}
    <svg class="acc-chevron {open ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  </button>

  {#if open && t}
    <div class="accordion-body">
      <div class="field-row">
        <label class="toggle-label">
          <span>Enable word-by-word</span>
          <button class="toggle-switch {t.wordByWord ? 'on' : ''}"
            onclick={() => updateActiveTemplate({ wordByWord: !t!.wordByWord })}>
            <span class="toggle-thumb"></span>
          </button>
        </label>
      </div>
      {#if t.wordByWord}
        <div class="field-row">
          <label class="field-label">Mode</label>
          <div class="chip-group">
            <button class="chip {t.wordMode === 'highlight' ? 'active' : ''}"
              onclick={() => updateActiveTemplate({ wordMode: 'highlight' })}>Highlight</button>
            <button class="chip {t.wordMode === 'solo' ? 'active' : ''}"
              onclick={() => updateActiveTemplate({ wordMode: 'solo' })}>Solo</button>
          </div>
        </div>
        <div class="field-row">
          <label class="field-label">Color</label>
          <input type="color" class="color-swatch" value={t.highlightColor}
            oninput={(e) => updateActiveTemplate({ highlightColor: e.currentTarget.value })} />
          <span class="hex-label">{t.highlightColor}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .accordion-item { border-bottom: 1px solid var(--color-border); }

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
  .accordion-btn.open .acc-icon { color: var(--color-accent); }

  .acc-icon { display: flex; align-items: center; color: var(--color-text-muted); flex-shrink: 0; }
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
  .acc-chevron { color: var(--color-text-muted); transition: transform 0.2s ease; flex-shrink: 0; }
  .acc-chevron.rotated { transform: rotate(180deg); }

  .accordion-body {
    padding: 0.6rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    background: var(--color-bg);
  }

  .field-row { display: flex; align-items: center; gap: 0.5rem; min-height: 26px; }
  .field-label { font-size: 0.7rem; color: var(--color-text-muted); min-width: 68px; flex-shrink: 0; }
  .color-swatch {
    width: 24px; height: 22px;
    padding: 1px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    cursor: pointer;
    flex-shrink: 0;
    background: none;
  }
  .hex-label { font-size: 0.68rem; font-family: monospace; color: var(--color-text-muted); }

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

  .chip-group { display: flex; gap: 0.3rem; }
  .chip {
    padding: 0.2rem 0.5rem;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    transition: all var(--transition);
  }
  .chip:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .chip.active {
    background: var(--color-accent-subtle, rgba(99,102,241,0.12));
    border-color: var(--color-accent);
    color: var(--color-accent);
    font-weight: 600;
  }
</style>