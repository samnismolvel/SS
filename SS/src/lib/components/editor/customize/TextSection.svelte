<script lang="ts">
  import { activeTemplate, updateActiveTemplate } from '$lib/stores/templates'
  import type { Template } from '$lib/types'

  let { open = false, ontoggle }: { open?: boolean; ontoggle: () => void } = $props()

  const SYSTEM_FONTS = [
    'Arial','Arial Black','Comic Sans MS','Courier New','Georgia',
    'Impact','Lucida Console','Tahoma','Times New Roman',
    'Trebuchet MS','Verdana','Segoe UI','Calibri','Cambria','Consolas',
  ]

  let t          = $state(null as Template | null)
  let customFont = $state(false)

  $effect(() => {
    const u = activeTemplate.subscribe(v => {
      t = v
      if (v?.fontName && !SYSTEM_FONTS.includes(v.fontName)) customFont = true
    })
    return u
  })

  function handleFontSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value
    if (val === '__custom__') customFont = true
    else { customFont = false; updateActiveTemplate({ fontName: val }) }
  }
</script>

<div class="accordion-item">
  <button class="accordion-btn {open ? 'open' : ''}" onclick={ontoggle}>
    <span class="acc-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 7V4h16v3M9 20h6M12 4v16"/>
      </svg>
    </span>
    <span class="acc-label">Text</span>
    <svg class="acc-chevron {open ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  </button>

  {#if open && t}
    <div class="accordion-body">
      <div class="field-row">
        <label class="field-label">Font</label>
        <select class="field-select" onchange={handleFontSelect} value={customFont ? '__custom__' : t.fontName}>
          {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
          <option value="__custom__">Custom…</option>
        </select>
      </div>
      {#if customFont}
        <div class="field-row">
          <label class="field-label"></label>
          <input class="field-input" type="text" value={t.fontName} placeholder="Font name…"
            onchange={(e) => updateActiveTemplate({ fontName: e.currentTarget.value })} />
        </div>
      {/if}
      <div class="field-row">
        <label class="field-label">Size</label>
        <input class="field-input short" type="number" min="8" max="120" value={t.fontSize}
          onchange={(e) => updateActiveTemplate({ fontSize: Number(e.currentTarget.value) })} />
        <button class="tog-btn {t.bold ? 'on' : ''}" onclick={() => updateActiveTemplate({ bold: !t!.bold })}><b>B</b></button>
        <button class="tog-btn {t.italic ? 'on' : ''}" onclick={() => updateActiveTemplate({ italic: !t!.italic })}><i>I</i></button>
      </div>
      <div class="field-row">
        <label class="field-label">Color</label>
        <input type="color" class="color-swatch" value={t.primaryColor}
          oninput={(e) => updateActiveTemplate({ primaryColor: e.currentTarget.value })} />
        <span class="hex-label">{t.primaryColor}</span>
      </div>
      <div class="field-row">
        <label class="field-label">Outline</label>
        <input type="color" class="color-swatch" value={t.outlineColor}
          oninput={(e) => updateActiveTemplate({ outlineColor: e.currentTarget.value })} />
        <input type="range" class="field-range sm" min="0" max="4" step="0.5" value={t.outline}
          oninput={(e) => updateActiveTemplate({ outline: Number(e.currentTarget.value) })} />
        <span class="field-val">{t.outline}</span>
      </div>
      <div class="field-row">
        <label class="field-label">Shadow</label>
        <input type="range" class="field-range" min="0" max="4" step="0.5" value={t.shadow}
          oninput={(e) => updateActiveTemplate({ shadow: Number(e.currentTarget.value) })} />
        <span class="field-val">{t.shadow}</span>
      </div>
      <div class="field-row">
        <label class="field-label">Spacing</label>
        <input type="range" class="field-range" min="0" max="10" step="0.5" value={t.spacing}
          oninput={(e) => updateActiveTemplate({ spacing: Number(e.currentTarget.value) })} />
        <span class="field-val">{t.spacing}</span>
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
  .field-range.sm { flex: 0 0 60px; }
  .field-val { font-size: 0.68rem; color: var(--color-text-muted); min-width: 32px; text-align: right; font-family: monospace; }
  .field-select, .field-input {
    flex: 1;
    padding: 0.22rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.73rem;
    outline: none;
  }
  .field-select:focus, .field-input:focus { border-color: var(--color-accent); }
  .field-input.short { flex: 0 0 52px; }
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
  .tog-btn {
    width: 26px; height: 26px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 0.78rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
    flex-shrink: 0;
  }
  .tog-btn.on { background: var(--color-accent); border-color: var(--color-accent); color: white; }
</style>