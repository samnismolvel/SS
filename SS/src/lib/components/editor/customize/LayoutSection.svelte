<script lang="ts">
  import { activeTemplate, updateActiveTemplate } from '$lib/stores/templates'
  import type { Template, Alignment } from '$lib/types'

  let { open = false, ontoggle }: { open?: boolean; ontoggle: () => void } = $props()

  let t = $state(null as Template | null)
  $effect(() => { const u = activeTemplate.subscribe(v => { t = v }); return u })
</script>

<div class="accordion-item">
  <button class="accordion-btn {open ? 'open' : ''}" onclick={ontoggle}>
    <span class="acc-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
    </span>
    <span class="acc-label">Layout</span>
    <svg class="acc-chevron {open ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  </button>

  {#if open && t}
    <div class="accordion-body">
      <div class="field-row">
        <label class="field-label">Position</label>
        <div class="align-grid">
          {#each [7,8,9,4,5,6,1,2,3] as pos}
            <button class="align-btn {t.alignment === pos ? 'active' : ''}"
              onclick={() => updateActiveTemplate({ alignment: pos as Alignment })}
              title={['','Bot L','Bot C','Bot R','Mid L','Mid C','Mid R','Top L','Top C','Top R'][pos]}>
            </button>
          {/each}
        </div>
      </div>
      <div class="field-row">
        <label class="field-label">Margin V</label>
        <input type="range" class="field-range" min="0" max="100" value={t.marginV}
          oninput={(e) => updateActiveTemplate({ marginV: Number(e.currentTarget.value) })} />
        <span class="field-val">{t.marginV}</span>
      </div>
      <div class="field-row">
        <label class="field-label">Margin L/R</label>
        <input type="range" class="field-range" min="0" max="100" value={t.marginL}
          oninput={(e) => updateActiveTemplate({ marginL: Number(e.currentTarget.value), marginR: Number(e.currentTarget.value) })} />
        <span class="field-val">{t.marginL}</span>
      </div>
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
  .field-range { flex: 1; accent-color: var(--color-accent); height: 3px; }
  .field-val { font-size: 0.68rem; color: var(--color-text-muted); min-width: 32px; text-align: right; font-family: monospace; }

  .align-grid { display: grid; grid-template-columns: repeat(3, 24px); gap: 3px; }
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
  .align-btn.active { background: var(--color-accent-subtle, rgba(99,102,241,0.12)); border-color: var(--color-accent); }
  .align-btn.active::after { background: var(--color-accent); }
  .align-btn:hover:not(.active) { background: var(--color-surface-hover); }
</style>