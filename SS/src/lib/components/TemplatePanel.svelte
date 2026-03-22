<script lang="ts">
  import { activeTemplate, updateActiveTemplate, allTemplates, setActiveTemplate, saveActiveAsTemplate } from '$lib/stores/templates'
  import type { WordMode, Alignment } from '$lib/types'

  const SYSTEM_FONTS = [
    'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
    'Impact', 'Lucida Console', 'Palatino Linotype', 'Tahoma',
    'Times New Roman', 'Trebuchet MS', 'Verdana',
    'Segoe UI', 'Calibri', 'Cambria', 'Consolas',
  ]

  let advanced = $state(false)
  let customFont = $state(false)
  let saveTemplateName = $state('')
  let showSaveDialog = $state(false)

  let templateVal = $derived($activeTemplate)
  let templatesVal = $derived($allTemplates)

  $effect(() => {
    if (templateVal.fontName && !SYSTEM_FONTS.includes(templateVal.fontName)) {
      customFont = true
    }
  })

  function handleFontSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value
    if (val === '__custom__') { customFont = true }
    else { customFont = false; updateActiveTemplate({ fontName: val }) }
  }

  function handlePresetSelect(e: Event) {
    const id = (e.target as HTMLSelectElement).value
    const found = templatesVal.find(t => t.id === id)
    if (found) setActiveTemplate(found)
  }

  function handleSave() {
    if (!saveTemplateName.trim()) return
    saveActiveAsTemplate(saveTemplateName.trim())
    saveTemplateName = ''
    showSaveDialog = false
  }
</script>

<div class="template-panel">
  <div class="panel-header">
    <span class="panel-label">Style</span>
    <select class="preset-select" onchange={handlePresetSelect} value={templateVal.id}>
      {#each templatesVal as t}
        <option value={t.id}>{t.name}</option>
      {/each}
    </select>
    <button class="icon-text-btn" onclick={() => showSaveDialog = !showSaveDialog}>+ Save</button>
    <button class="mode-toggle" class:active={advanced} onclick={() => advanced = !advanced}>
      {advanced ? 'Simple' : 'Advanced'}
    </button>
  </div>

  {#if showSaveDialog}
    <div class="save-dialog">
      <input type="text" bind:value={saveTemplateName} placeholder="Template name..."
        onkeydown={(e) => e.key === 'Enter' && handleSave()} />
      <button class="btn-save" onclick={handleSave}>Save</button>
      <button onclick={() => showSaveDialog = false}>✕</button>
    </div>
  {/if}

  <div class="panel-body">
    <section>
      <div class="section-label">Animation</div>
      <div class="field-row">
        <label class="checkbox-label">
          <input type="checkbox" checked={templateVal.wordByWord}
            onchange={(e) => updateActiveTemplate({ wordByWord: e.currentTarget.checked })} />
          Word-by-word
        </label>
      </div>
      {#if templateVal.wordByWord}
        <div class="field-row">
          <label>Mode</label>
          <select value={templateVal.wordMode}
            onchange={(e) => updateActiveTemplate({ wordMode: e.currentTarget.value as WordMode })}>
            <option value="highlight">Highlight active word</option>
            <option value="solo">Show only active word</option>
          </select>
        </div>
        <div class="field-row">
          <label>Highlight</label>
          <input type="color" value={templateVal.highlightColor}
            oninput={(e) => updateActiveTemplate({ highlightColor: e.currentTarget.value })} />
          <span class="color-hex">{templateVal.highlightColor}</span>
        </div>
      {/if}
    </section>

    <div class="divider"></div>

    <section>
      <div class="section-label">Font</div>
      <div class="field-row">
        <label>Family</label>
        <select onchange={handleFontSelect} value={customFont ? '__custom__' : templateVal.fontName}>
          {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
          <option value="__custom__">Custom...</option>
        </select>
      </div>
      {#if customFont}
        <div class="field-row">
          <label></label>
          <input type="text" value={templateVal.fontName} placeholder="Type font name..."
            onchange={(e) => updateActiveTemplate({ fontName: e.currentTarget.value })} />
        </div>
      {/if}
      <div class="field-row">
        <label>Size</label>
        <input type="number" min="8" max="120" value={templateVal.fontSize}
          onchange={(e) => updateActiveTemplate({ fontSize: Number(e.currentTarget.value) })}
          class="short-input" />
        {#if advanced}
          <div class="toggle-row">
            <button class="toggle-btn" class:active={templateVal.bold}
              onclick={() => updateActiveTemplate({ bold: !templateVal.bold })}><b>B</b></button>
            <button class="toggle-btn" class:active={templateVal.italic}
              onclick={() => updateActiveTemplate({ italic: !templateVal.italic })}><i>I</i></button>
          </div>
        {/if}
      </div>
    </section>

    <div class="divider"></div>

    <section>
      <div class="section-label">Colors</div>
      <div class="field-row">
        <label>Text</label>
        <input type="color" value={templateVal.primaryColor}
          oninput={(e) => updateActiveTemplate({ primaryColor: e.currentTarget.value })} />
        <span class="color-hex">{templateVal.primaryColor}</span>
      </div>
      <div class="field-row">
        <label>Outline</label>
        <input type="color" value={templateVal.outlineColor}
          oninput={(e) => updateActiveTemplate({ outlineColor: e.currentTarget.value })} />
        <span class="color-hex">{templateVal.outlineColor}</span>
      </div>
      {#if advanced}
        <div class="field-row">
          <label>Back</label>
          <input type="color" value={templateVal.backColor}
            oninput={(e) => updateActiveTemplate({ backColor: e.currentTarget.value })} />
          <span class="color-hex">{templateVal.backColor}</span>
        </div>
        <div class="field-row">
          <label>Secondary</label>
          <input type="color" value={templateVal.secondaryColor}
            oninput={(e) => updateActiveTemplate({ secondaryColor: e.currentTarget.value })} />
          <span class="color-hex">{templateVal.secondaryColor}</span>
        </div>
      {/if}
    </section>

    <div class="divider"></div>

    {#if advanced}
      <section>
        <div class="section-label">Geometry</div>
        <div class="field-row">
          <label>Outline</label>
          <input type="range" min="0" max="4" step="0.5" value={templateVal.outline}
            oninput={(e) => updateActiveTemplate({ outline: Number(e.currentTarget.value) })} />
          <span class="range-val">{templateVal.outline}</span>
        </div>
        <div class="field-row">
          <label>Shadow</label>
          <input type="range" min="0" max="4" step="0.5" value={templateVal.shadow}
            oninput={(e) => updateActiveTemplate({ shadow: Number(e.currentTarget.value) })} />
          <span class="range-val">{templateVal.shadow}</span>
        </div>
        <div class="field-row">
          <label>Spacing</label>
          <input type="range" min="0" max="10" step="0.5" value={templateVal.spacing}
            oninput={(e) => updateActiveTemplate({ spacing: Number(e.currentTarget.value) })} />
          <span class="range-val">{templateVal.spacing}</span>
        </div>
        <div class="field-row">
          <label>Scale X</label>
          <input type="range" min="50" max="200" value={templateVal.scaleX}
            oninput={(e) => updateActiveTemplate({ scaleX: Number(e.currentTarget.value) })} />
          <span class="range-val">{templateVal.scaleX}%</span>
        </div>
        <div class="field-row">
          <label>Margin V</label>
          <input type="range" min="0" max="100" value={templateVal.marginV}
            oninput={(e) => updateActiveTemplate({ marginV: Number(e.currentTarget.value) })} />
          <span class="range-val">{templateVal.marginV}</span>
        </div>
        <div class="field-row">
          <label>Margin L</label>
          <input type="range" min="0" max="100" value={templateVal.marginL}
            oninput={(e) => updateActiveTemplate({ marginL: Number(e.currentTarget.value) })} />
          <span class="range-val">{templateVal.marginL}</span>
        </div>
        <div class="field-row">
          <label>Margin R</label>
          <input type="range" min="0" max="100" value={templateVal.marginR}
            oninput={(e) => updateActiveTemplate({ marginR: Number(e.currentTarget.value) })} />
          <span class="range-val">{templateVal.marginR}</span>
        </div>
      </section>
      <div class="divider"></div>
    {/if}

    <section>
      <div class="section-label">Position</div>
      <div class="alignment-grid">
        {#each [7,8,9,4,5,6,1,2,3] as pos}
          <button class="align-btn" class:active={templateVal.alignment === pos}
            onclick={() => updateActiveTemplate({ alignment: pos as Alignment })}></button>
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .template-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .panel-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border);
    flex-shrink: 0; flex-wrap: wrap;
  }

  .panel-label {
    font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--color-text-muted);
  }

  .preset-select {
    flex: 1; padding: 0.3rem 0.5rem; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.8rem;
  }

  .icon-text-btn {
    padding: 0.3rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted); font-size: 0.75rem;
    cursor: pointer; white-space: nowrap; transition: background 0.15s;
  }
  .icon-text-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }

  .mode-toggle {
    padding: 0.3rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted); font-size: 0.75rem;
    cursor: pointer; white-space: nowrap; transition: all 0.15s;
  }
  .mode-toggle.active { background: var(--color-accent-subtle); border-color: var(--color-accent); color: var(--color-accent); }

  .save-dialog {
    display: flex; gap: 0.35rem; padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-border); background: var(--color-surface-hover);
  }
  .save-dialog input {
    flex: 1; padding: 0.3rem 0.5rem; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.8rem;
  }
  .save-dialog button {
    padding: 0.3rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text); font-size: 0.8rem; cursor: pointer;
  }
  .btn-save { background: var(--color-accent) !important; border-color: var(--color-accent) !important; color: white !important; }

  .panel-body { flex: 1; overflow-y: auto; padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }

  section { display: flex; flex-direction: column; gap: 0.5rem; }

  .section-label {
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--color-text-muted);
  }

  .divider { height: 1px; background: var(--color-border); }
  .field-row { display: flex; align-items: center; gap: 0.5rem; }

  .field-row label { font-size: 0.75rem; color: var(--color-text-muted); min-width: 55px; }

  .checkbox-label {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.8rem; color: var(--color-text); cursor: pointer; min-width: unset !important;
  }

  input[type="text"], input[type="number"], select {
    flex: 1; padding: 0.3rem 0.5rem; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); font-size: 0.8rem;
  }
  input:focus, select:focus { outline: none; border-color: var(--color-accent); }

  .short-input { max-width: 60px; flex: none; }
  .toggle-row { display: flex; gap: 0.25rem; }

  .toggle-btn {
    width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-bg); color: var(--color-text-muted); cursor: pointer;
    font-size: 0.85rem; transition: all 0.15s;
  }
  .toggle-btn.active { background: var(--color-accent); border-color: var(--color-accent); color: white; }

  input[type="color"] {
    width: 32px; height: 28px; padding: 2px; border-radius: 5px;
    border: 1px solid var(--color-border); cursor: pointer; flex: none;
  }

  .color-hex { font-size: 0.75rem; font-family: monospace; color: var(--color-text-muted); }

  input[type="range"] { flex: 1; accent-color: var(--color-accent); }

  .range-val { font-size: 0.75rem; color: var(--color-text-muted); min-width: 30px; text-align: right; }

  .alignment-grid { display: grid; grid-template-columns: repeat(3, 28px); gap: 3px; }

  .align-btn {
    width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--color-border);
    background: var(--color-bg); cursor: pointer; transition: all 0.15s; position: relative;
  }
  .align-btn::after {
    content: ''; position: absolute; width: 6px; height: 6px; border-radius: 50%;
    background: var(--color-text-muted); top: 50%; left: 50%; transform: translate(-50%, -50%);
  }
  .align-btn.active { background: var(--color-accent-subtle); border-color: var(--color-accent); }
  .align-btn.active::after { background: var(--color-accent); }
  .align-btn:hover:not(.active) { background: var(--color-surface-hover); }
</style>