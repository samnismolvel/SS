<script lang="ts">
  import type { Subtitle, Template } from '$lib/types'
  import { updateSubtitleOverrides, clearSubtitleOverrides, updateSubtitleTiming } from '$lib/stores/editor'

  interface Props {
    subtitle: Subtitle
    index: number
    template: Template
  }

  let { subtitle, index, template }: Props = $props()

  let overrides = $derived(subtitle.overrides ?? {})
  let effective = $derived({ ...template, ...overrides })
  let hasOverrides = $derived(!!subtitle.overrides && Object.keys(subtitle.overrides).length > 0)

  function set(key: string, value: any) {
    updateSubtitleOverrides(index, { [key]: value })
  }

  function clearAll() {
    clearSubtitleOverrides(index)
  }

  function handleTimingInput(field: 'start' | 'end', value: string) {
    updateSubtitleTiming(
      index,
      field === 'start' ? value : subtitle.start,
      field === 'end' ? value : subtitle.end
    )
  }
</script>

<div class="inspector">
  <div class="inspector-header">
    <span class="panel-label">Inspector</span>
    <span class="seg-ref">#{subtitle.index}</span>
    {#if hasOverrides}
      <button class="clear-btn" onclick={clearAll}>Clear overrides</button>
    {/if}
  </div>

  <div class="inspector-body">
    <section>
      <div class="section-label">Timing</div>
      <div class="field-row">
        <label>Start</label>
        <input type="text" value={subtitle.start}
          onchange={(e) => handleTimingInput('start', e.currentTarget.value)}
          class="mono-input" placeholder="00:00:00,000" />
      </div>
      <div class="field-row">
        <label>End</label>
        <input type="text" value={subtitle.end}
          onchange={(e) => handleTimingInput('end', e.currentTarget.value)}
          class="mono-input" placeholder="00:00:00,000" />
      </div>
    </section>

    <div class="divider"></div>

    <section>
      <div class="section-label">Font</div>
      <div class="field-row">
        <label>Family</label>
        <input type="text" value={effective.fontName}
          onchange={(e) => set('fontName', e.currentTarget.value)}
          class:overridden={'fontName' in overrides} />
      </div>
      <div class="field-row">
        <label>Size</label>
        <input type="number" min="8" max="120" value={effective.fontSize}
          onchange={(e) => set('fontSize', Number(e.currentTarget.value))}
          class="short-input" class:overridden={'fontSize' in overrides} />
      </div>
      <div class="field-row">
        <label>Style</label>
        <div class="toggle-row">
          <button class="toggle-btn" class:active={effective.bold}
            class:overridden={'bold' in overrides}
            onclick={() => set('bold', !effective.bold)}><b>B</b></button>
          <button class="toggle-btn" class:active={effective.italic}
            class:overridden={'italic' in overrides}
            onclick={() => set('italic', !effective.italic)}><i>I</i></button>
        </div>
      </div>
    </section>

    <div class="divider"></div>

    <section>
      <div class="section-label">Colors</div>
      <div class="field-row">
        <label>Text</label>
        <div class="color-row">
          <input type="color" value={effective.primaryColor}
            class:overridden={'primaryColor' in overrides}
            oninput={(e) => set('primaryColor', e.currentTarget.value)} />
          <span class="color-hex">{effective.primaryColor}</span>
        </div>
      </div>
      <div class="field-row">
        <label>Outline</label>
        <div class="color-row">
          <input type="color" value={effective.outlineColor}
            class:overridden={'outlineColor' in overrides}
            oninput={(e) => set('outlineColor', e.currentTarget.value)} />
          <span class="color-hex">{effective.outlineColor}</span>
        </div>
      </div>
    </section>

    <div class="divider"></div>

    <section>
      <div class="section-label">Geometry</div>
      <div class="field-row">
        <label>Outline</label>
        <input type="range" min="0" max="4" step="0.5" value={effective.outline}
          class:overridden={'outline' in overrides}
          oninput={(e) => set('outline', Number(e.currentTarget.value))} />
        <span class="range-val">{effective.outline}</span>
      </div>
      <div class="field-row">
        <label>Shadow</label>
        <input type="range" min="0" max="4" step="0.5" value={effective.shadow}
          class:overridden={'shadow' in overrides}
          oninput={(e) => set('shadow', Number(e.currentTarget.value))} />
        <span class="range-val">{effective.shadow}</span>
      </div>
      <div class="field-row">
        <label>Position</label>
        <select value={effective.alignment}
          class:overridden={'alignment' in overrides}
          onchange={(e) => set('alignment', Number(e.currentTarget.value))}>
          <option value={7}>Top Left</option>
          <option value={8}>Top Center</option>
          <option value={9}>Top Right</option>
          <option value={4}>Mid Left</option>
          <option value={5}>Mid Center</option>
          <option value={6}>Mid Right</option>
          <option value={1}>Bot Left</option>
          <option value={2}>Bot Center</option>
          <option value={3}>Bot Right</option>
        </select>
      </div>
    </section>
  </div>
</div>

<style>
  .inspector { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .inspector-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
  }

  .panel-label {
    font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--color-text-muted); flex: 1;
  }

  .seg-ref { font-size: 0.75rem; font-weight: 700; color: var(--color-accent); }

  .clear-btn {
    font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;
    border: 1px solid var(--color-danger); background: transparent;
    color: var(--color-danger); cursor: pointer; transition: background 0.15s;
  }
  .clear-btn:hover { background: var(--color-danger-subtle); }

  .inspector-body {
    flex: 1; overflow-y: auto; padding: 0.75rem;
    display: flex; flex-direction: column; gap: 0.75rem;
  }

  section { display: flex; flex-direction: column; gap: 0.4rem; }

  .section-label {
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--color-text-muted); margin-bottom: 0.1rem;
  }

  .divider { height: 1px; background: var(--color-border); }
  .field-row { display: flex; align-items: center; gap: 0.5rem; }

  .field-row label {
    font-size: 0.75rem; color: var(--color-text-muted); min-width: 50px;
  }

  input[type="text"], input[type="number"], select {
    flex: 1; padding: 0.3rem 0.5rem; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.8rem; font-family: inherit;
  }
  input:focus, select:focus { outline: none; border-color: var(--color-accent); }

  .mono-input { font-family: monospace; }
  .short-input { max-width: 60px; }

  .overridden {
    border-color: var(--color-accent) !important;
    background: var(--color-accent-subtle) !important;
  }

  .toggle-row { display: flex; gap: 0.25rem; }

  .toggle-btn {
    width: 28px; height: 28px; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text-muted); cursor: pointer; font-size: 0.85rem; transition: all 0.15s;
  }
  .toggle-btn.active { background: var(--color-accent); border-color: var(--color-accent); color: white; }
  .toggle-btn.overridden { border-color: var(--color-accent); }

  .color-row { display: flex; align-items: center; gap: 0.4rem; flex: 1; }

  input[type="color"] {
    width: 32px; height: 28px; padding: 2px; border-radius: 5px;
    border: 1px solid var(--color-border); cursor: pointer; flex: none;
  }

  .color-hex { font-size: 0.75rem; font-family: monospace; color: var(--color-text-muted); }

  input[type="range"] { flex: 1; accent-color: var(--color-accent); }

  .range-val { font-size: 0.75rem; color: var(--color-text-muted); min-width: 20px; text-align: right; }
</style>