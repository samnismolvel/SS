<script lang="ts">
  import { activeTemplate, updateActiveTemplate, allTemplates, setActiveTemplate, saveActiveAsTemplate } from '$lib/stores/templates'
  import type { WordMode, Alignment } from '$lib/types'

  export let advanced = false

  const SYSTEM_FONTS = [
    'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
    'Impact', 'Lucida Console', 'Palatino Linotype', 'Tahoma',
    'Times New Roman', 'Trebuchet MS', 'Verdana',
    'Segoe UI', 'Calibri', 'Cambria', 'Consolas',
  ]

  let customFont = false
  let saveTemplateName = ''
  let showSaveDialog = false

  $: if ($activeTemplate.fontName && !SYSTEM_FONTS.includes($activeTemplate.fontName)) {
    customFont = true
  }

  function handleFontSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value
    if (val === '__custom__') { customFont = true }
    else { customFont = false; updateActiveTemplate({ fontName: val }) }
  }

  function handlePresetSelect(e: Event) {
    const id = (e.target as HTMLSelectElement).value
    const found = $allTemplates.find(t => t.id === id)
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
    <select class="preset-select" on:change={handlePresetSelect} value={$activeTemplate.id}>
      {#each $allTemplates as t}
        <option value={t.id}>{t.name}</option>
      {/each}
    </select>
    <button class="icon-text-btn" on:click={() => showSaveDialog = !showSaveDialog}>+ Save</button>
    <button class="mode-toggle" class:active={advanced} on:click={() => advanced = !advanced}>
      {advanced ? 'Simple' : 'Advanced'}
    </button>
  </div>

  {#if showSaveDialog}
    <div class="save-dialog">
      <input type="text" bind:value={saveTemplateName} placeholder="Template name..."
        on:keydown={(e) => e.key === 'Enter' && handleSave()} />
      <button class="btn-save" on:click={handleSave}>Save</button>
      <button on:click={() => showSaveDialog = false}>✕</button>
    </div>
  {/if}

  <div class="panel-body">
    <!-- Animation section (shared) -->
    <section>
      <div class="section-label">Animation</div>
      <div class="field-row">
        <label class="checkbox-label">
          <input type="checkbox" checked={$activeTemplate.wordByWord}
            on:change={(e) => updateActiveTemplate({ wordByWord: e.currentTarget.checked })} />
          Word-by-word
        </label>
      </div>
      {#if $activeTemplate.wordByWord}
        <div class="field-row">
          <label>Mode</label>
          <select value={$activeTemplate.wordMode}
            on:change={(e) => updateActiveTemplate({ wordMode: e.currentTarget.value as WordMode })}>
            <option value="highlight">Highlight active word</option>
            <option value="solo">Show only active word</option>
          </select>
        </div>
        <div class="field-row">
          <label>Highlight</label>
          <input type="color" value={$activeTemplate.highlightColor}
            on:input={(e) => updateActiveTemplate({ highlightColor: e.currentTarget.value })} />
          <span class="color-hex">{$activeTemplate.highlightColor}</span>
        </div>
      {/if}
    </section>

    <div class="divider"></div>

    <!-- Font -->
    <section>
      <div class="section-label">Font</div>
      <div class="field-row">
        <label>Family</label>
        <select on:change={handleFontSelect} value={customFont ? '__custom__' : $activeTemplate.fontName}>
          {#each SYSTEM_FONTS as f}<option value={f}>{f}</option>{/each}
          <option value="__custom__">Custom...</option>
        </select>
      </div>
      {#if customFont}
        <div class="field-row">
          <label></label>
          <input type="text" value={$activeTemplate.fontName} placeholder="Type font name..."
            on:change={(e) => updateActiveTemplate({ fontName: e.currentTarget.value })} />
        </div>
      {/if}
      <div class="field-row">
        <label>Size</label>
        <input type="number" min="8" max="120" value={$activeTemplate.fontSize}
          on:change={(e) => updateActiveTemplate({ fontSize: Number(e.currentTarget.value) })}
          class="short-input" />
        {#if advanced}
          <div class="toggle-row">
            <button class="toggle-btn" class:active={$activeTemplate.bold}
              on:click={() => updateActiveTemplate({ bold: !$activeTemplate.bold })}><b>B</b></button>
            <button class="toggle-btn" class:active={$activeTemplate.italic}
              on:click={() => updateActiveTemplate({ italic: !$activeTemplate.italic })}><i>I</i></button>
          </div>
        {/if}
      </div>
    </section>

    <div class="divider"></div>

    <!-- Colors -->
    <section>
      <div class="section-label">Colors</div>
      <div class="field-row">
        <label>Text</label>
        <input type="color" value={$activeTemplate.primaryColor}
          on:input={(e) => updateActiveTemplate({ primaryColor: e.currentTarget.value })} />
        <span class="color-hex">{$activeTemplate.primaryColor}</span>
      </div>
      <div class="field-row">
        <label>Outline</label>
        <input type="color" value={$activeTemplate.outlineColor}
          on:input={(e) => updateActiveTemplate({ outlineColor: e.currentTarget.value })} />
        <span class="color-hex">{$activeTemplate.outlineColor}</span>
      </div>
      {#if advanced}
        <div class="field-row">
          <label>Back</label>
          <input type="color" value={$activeTemplate.backColor}
            on:input={(e) => updateActiveTemplate({ backColor: e.currentTarget.value })} />
          <span class="color-hex">{$activeTemplate.backColor}</span>
        </div>
        <div class="field-row">
          <label>Secondary</label>
          <input type="color" value={$activeTemplate.secondaryColor}
            on:input={(e) => updateActiveTemplate({ secondaryColor: e.currentTarget.value })} />
          <span class="color-hex">{$activeTemplate.secondaryColor}</span>
        </div>
      {/if}
    </section>

    <div class="divider"></div>

    <!-- Geometry — advanced only -->
    {#if advanced}
      <section>
        <div class="section-label">Geometry</div>
        <div class="field-row">
          <label>Outline</label>
          <input type="range" min="0" max="4" step="0.5" value={$activeTemplate.outline}
            on:input={(e) => updateActiveTemplate({ outline: Number(e.currentTarget.value) })} />
          <span class="range-val">{$activeTemplate.outline}</span>
        </div>
        <div class="field-row">
          <label>Shadow</label>
          <input type="range" min="0" max="4" step="0.5" value={$activeTemplate.shadow}
            on:input={(e) => updateActiveTemplate({ shadow: Number(e.currentTarget.value) })} />
          <span class="range-val">{$activeTemplate.shadow}</span>
        </div>
        <div class="field-row">
          <label>Spacing</label>
          <input type="range" min="0" max="10" step="0.5" value={$activeTemplate.spacing}
            on:input={(e) => updateActiveTemplate({ spacing: Number(e.currentTarget.value) })} />
          <span class="range-val">{$activeTemplate.spacing}</span>
        </div>
        <div class="field-row">
          <label>Scale X</label>
          <input type="range" min="50" max="200" value={$activeTemplate.scaleX}
            on:input={(e) => updateActiveTemplate({ scaleX: Number(e.currentTarget.value) })} />
          <span class="range-val">{$activeTemplate.scaleX}%</span>
        </div>
        <div class="field-row">
          <label>Margin V</label>
          <input type="range" min="0" max="100" value={$activeTemplate.marginV}
            on:input={(e) => updateActiveTemplate({ marginV: Number(e.currentTarget.value) })} />
          <span class="range-val">{$activeTemplate.marginV}</span>
        </div>
        <div class="field-row">
          <label>Margin L</label>
          <input type="range" min="0" max="100" value={$activeTemplate.marginL}
            on:input={(e) => updateActiveTemplate({ marginL: Number(e.currentTarget.value) })} />
          <span class="range-val">{$activeTemplate.marginL}</span>
        </div>
        <div class="field-row">
          <label>Margin R</label>
          <input type="range" min="0" max="100" value={$activeTemplate.marginR}
            on:input={(e) => updateActiveTemplate({ marginR: Number(e.currentTarget.value) })} />
          <span class="range-val">{$activeTemplate.marginR}</span>
        </div>
      </section>
      <div class="divider"></div>
    {/if}

    <!-- Position -->
    <section>
      <div class="section-label">Position</div>
      <div class="alignment-grid">
        {#each [7,8,9,4,5,6,1,2,3] as pos}
          <button class="align-btn" class:active={$activeTemplate.alignment === pos}
            on:click={() => updateActiveTemplate({ alignment: pos as Alignment })}></button>
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
    color: var(--color-text); -webkit-text-fill-color: var(--color-text); font-size: 0.8rem;
  }

  .icon-text-btn {
    padding: 0.3rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted);
    font-size: 0.75rem; cursor: pointer; white-space: nowrap; transition: background 0.15s;
  }
  .icon-text-btn:hover { background: var(--color-surface-hover); -webkit-text-fill-color: var(--color-text); }

  .mode-toggle {
    padding: 0.3rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted);
    font-size: 0.75rem; cursor: pointer; white-space: nowrap; transition: all 0.15s;
  }
  .mode-toggle.active {
    background: var(--color-accent-subtle); border-color: var(--color-accent);
    -webkit-text-fill-color: var(--color-accent);
  }

  .save-dialog {
    display: flex; gap: 0.35rem; padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-border); background: var(--color-surface-hover);
  }
  .save-dialog input {
    flex: 1; padding: 0.3rem 0.5rem; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); -webkit-text-fill-color: var(--color-text); font-size: 0.8rem;
  }
  .save-dialog button {
    padding: 0.3rem 0.6rem; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text);
    -webkit-text-fill-color: var(--color-text); font-size: 0.8rem; cursor: pointer;
  }
  .btn-save {
    background: var(--color-accent) !important; border-color: var(--color-accent) !important;
    -webkit-text-fill-color: white !important;
  }

  .panel-body {
    flex: 1; overflow-y: auto; padding: 0.75rem 1rem;
    display: flex; flex-direction: column; gap: 0.75rem;
  }

  section { display: flex; flex-direction: column; gap: 0.5rem; }

  .section-label {
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted);
  }

  .divider { height: 1px; background: var(--color-border); }
  .field-row { display: flex; align-items: center; gap: 0.5rem; }

  .field-row label {
    font-size: 0.75rem; color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted); min-width: 55px;
  }

  .checkbox-label {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.8rem; color: var(--color-text);
    -webkit-text-fill-color: var(--color-text); cursor: pointer; min-width: unset !important;
  }

  input[type="text"], input[type="number"], select {
    flex: 1; padding: 0.3rem 0.5rem; border-radius: 5px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); -webkit-text-fill-color: var(--color-text); font-size: 0.8rem;
  }
  input:focus, select:focus { outline: none; border-color: var(--color-accent); }

  .short-input { max-width: 60px; flex: none; }
  .toggle-row { display: flex; gap: 0.25rem; }

  .toggle-btn {
    width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--color-border);
    background: var(--color-bg); color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted); cursor: pointer; font-size: 0.85rem; transition: all 0.15s;
  }
  .toggle-btn.active {
    background: var(--color-accent); border-color: var(--color-accent);
    -webkit-text-fill-color: white;
  }

  input[type="color"] {
    width: 32px; height: 28px; padding: 2px; border-radius: 5px;
    border: 1px solid var(--color-border); cursor: pointer; flex: none;
  }

  .color-hex {
    font-size: 0.75rem; font-family: monospace;
    color: var(--color-text-muted); -webkit-text-fill-color: var(--color-text-muted);
  }

  input[type="range"] { flex: 1; accent-color: var(--color-accent); }

  .range-val {
    font-size: 0.75rem; min-width: 30px; text-align: right;
    color: var(--color-text-muted); -webkit-text-fill-color: var(--color-text-muted);
  }

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