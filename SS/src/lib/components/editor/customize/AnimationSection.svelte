<script lang="ts">
  import { activeTemplate, updateActiveTemplate } from '$lib/stores/templates'
  import type { Template, AnimationMode } from '$lib/types'

  let { open = false, ontoggle }: { open?: boolean; ontoggle: () => void } = $props()

  let t = $state(null as Template | null)
  $effect(() => { const u = activeTemplate.subscribe(v => { t = v }); return u })

  const ANIMATIONS: { value: AnimationMode; label: string }[] = [
    { value: 'none',       label: 'None' },
    { value: 'fade',       label: 'Fade' },
    { value: 'pop',        label: 'Pop' },
    { value: 'slide-up',   label: 'Slide' },
    { value: 'typewriter', label: 'Typewriter' },
  ]
</script>

<div class="accordion-item">
  <button class="accordion-btn {open ? 'open' : ''}" onclick={ontoggle}>
    <span class="acc-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12h14M12 5l7 7-7 7"/>
        <circle cx="5" cy="12" r="2" fill="currentColor" stroke="none"/>
      </svg>
    </span>
    <span class="acc-label">Animation</span>
    {#if t?.animation && t.animation !== 'none'}
      <span class="acc-badge">{t.animation}</span>
    {/if}
    <svg class="acc-chevron {open ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  </button>

  {#if open && t}
    <div class="accordion-body">
      <div class="field-row top">
        <label class="field-label">Transition</label>
        <div class="chip-group wrap">
          {#each ANIMATIONS as anim}
            <button class="chip {(t.animation ?? 'none') === anim.value ? 'active' : ''}"
              onclick={() => updateActiveTemplate({ animation: anim.value })}>
              {anim.label}
            </button>
          {/each}
        </div>
      </div>
      <div class="field-row">
        <label class="field-label" title="Push subtitle start times forward to compensate for whisper early onset.">
          Sync offset
        </label>
        <input type="range" class="field-range" min="0" max="300" step="10" value={t.syncOffset ?? 50}
          oninput={(e) => updateActiveTemplate({ syncOffset: Number(e.currentTarget.value) })} />
        <span class="field-val">{t.syncOffset ?? 50}ms</span>
      </div>
      <div class="field-row">
        <label class="field-label" title="Inter-word gap that triggers a new line.">
          Pause split
        </label>
        <input type="range" class="field-range" min="200" max="800" step="50" value={t.pauseThreshold ?? 500}
          oninput={(e) => updateActiveTemplate({ pauseThreshold: Number(e.currentTarget.value) })} />
        <span class="field-val">{t.pauseThreshold ?? 500}ms</span>
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
  .field-row.top { align-items: flex-start; }
  .field-label { font-size: 0.7rem; color: var(--color-text-muted); min-width: 68px; flex-shrink: 0; padding-top: 2px; }
  .field-range { flex: 1; accent-color: var(--color-accent); height: 3px; }
  .field-val { font-size: 0.68rem; color: var(--color-text-muted); min-width: 36px; text-align: right; font-family: monospace; }

  .chip-group { display: flex; gap: 0.3rem; }
  .chip-group.wrap { flex-wrap: wrap; flex: 1; }
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
</style>