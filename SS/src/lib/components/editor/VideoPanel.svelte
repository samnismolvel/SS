<script lang="ts">
  import type { AspectRatio } from '$lib/types'

  interface Props {
    ratio: AspectRatio
    offset: number           // 0–100, vertical crop offset %
    onratiochange: (r: AspectRatio) => void
    onoffsetchange: (v: number) => void
  }
  let { ratio, offset, onratiochange, onoffsetchange }: Props = $props()

  const RATIOS: { id: AspectRatio; label: string; icon: string; w: number; h: number }[] = [
    { id: 'original', label: 'Original', w: 0,  h: 0,  icon: 'original' },
    { id: '1:1',      label: '1:1',      w: 1,  h: 1,  icon: 'square'   },
    { id: '9:16',     label: '9:16',     w: 9,  h: 16, icon: 'portrait'  },
    { id: '16:9',     label: '16:9',     w: 16, h: 9,  icon: 'landscape' },
    { id: '4:3',      label: '4:3',      w: 4,  h: 3,  icon: 'wide'      },
    { id: '3:4',      label: '3:4',      w: 3,  h: 4,  icon: 'tall'      },
  ]
</script>

<div class="panel-header">
  <span class="panel-title">Video</span>
</div>

<div class="panel-body">

  <!-- Aspect Ratio -->
  <section class="section">
    <h3 class="section-title">Aspect Ratio</h3>
    <div class="ratio-grid">
      {#each RATIOS as r}
        <button
          class="ratio-btn {ratio === r.id ? 'active' : ''}"
          onclick={() => onratiochange(r.id)}
          title={r.label}
        >
          <!-- Tiny icon representing the ratio shape -->
          <span class="ratio-icon" aria-hidden="true">
            {#if r.icon === 'original'}
              <!-- Four corners -->
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M1 4V1h3M10 1h3v3M13 10v3h-3M4 13H1v-3"/>
              </svg>
            {:else if r.icon === 'square'}
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="1" width="11" height="11" rx="1"/>
              </svg>
            {:else if r.icon === 'portrait'}
              <!-- Phone / 9:16 -->
              <svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="1" width="8" height="12" rx="1.5"/>
                <line x1="3.5" y1="11.5" x2="6.5" y2="11.5" stroke-linecap="round"/>
              </svg>
            {:else if r.icon === 'landscape'}
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="1" width="12" height="8" rx="1"/>
              </svg>
            {:else if r.icon === 'wide'}
              <svg width="14" height="11" viewBox="0 0 14 11" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="1" width="12" height="9" rx="1"/>
              </svg>
            {:else if r.icon === 'tall'}
              <svg width="11" height="14" viewBox="0 0 11 14" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="1" width="9" height="12" rx="1"/>
              </svg>
            {/if}
          </span>
          <span class="ratio-label">{r.label}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Vertical Offset (only meaningful when ratio ≠ original) -->
  {#if ratio !== 'original'}
    <section class="section">
      <div class="offset-header">
        <span class="section-label">Offset</span>
        <span class="offset-val">{offset}%</span>
      </div>
      <input
        type="range"
        class="offset-slider"
        min="0"
        max="100"
        step="1"
        value={offset}
        oninput={(e) => onoffsetchange(Number(e.currentTarget.value))}
      />
    </section>
  {/if}

  <!-- Safe Area -->
  <section class="section">
    <h3 class="section-title">Safe Area</h3>
    <div class="safe-card">
      <div class="safe-row">
        <div>
          <div class="safe-card-title">Platform Safe Zone</div>
          <div class="safe-card-desc">Show areas where platform UI may overlap your content. Actual overlay may vary.</div>
        </div>
        <!-- toggle — purely visual for now, wire via prop if needed -->
        <button class="toggle-switch" aria-label="Toggle safe zone">
          <span class="toggle-thumb"></span>
        </button>
      </div>
    </div>
  </section>

</div>

<style>
  .panel-header {
    display: flex;
    align-items: center;
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

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* Sections */
  .section { display: flex; flex-direction: column; gap: 0.55rem; }
  .section-title {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    margin: 0;
  }
  .section-label {
    font-size: 0.72rem;
    color: var(--color-text);
    font-weight: 500;
  }

  /* Ratio grid — 3 columns */
  .ratio-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
  }

  .ratio-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.55rem 0.3rem;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: border-color var(--transition), background var(--transition), color var(--transition);
    min-height: 56px;
  }
  .ratio-btn:hover {
    border-color: var(--color-text-muted);
    color: var(--color-text);
  }
  .ratio-btn.active {
    border-color: var(--color-accent, #f59e0b);
    background: var(--color-accent-subtle, rgba(245,158,11,0.08));
    color: var(--color-text);
  }
  /* Use amber/gold for ratio active, matching the reference screenshot */
  .ratio-btn.active {
    border-color: #d97706;
    box-shadow: 0 0 0 1px #d97706;
    background: rgba(217,119,6,0.08);
  }

  .ratio-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 16px;
  }

  .ratio-label {
    font-size: 0.68rem;
    font-weight: 500;
    line-height: 1;
  }

  /* Offset slider */
  .offset-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .offset-val {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    font-family: monospace;
  }
  .offset-slider {
    width: 100%;
    accent-color: var(--color-accent, #f59e0b);
    height: 4px;
    cursor: pointer;
  }

  /* Safe area card */
  .safe-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.75rem 0.85rem;
  }
  .safe-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-content: space-between;
  }
  .safe-card-title {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: 0.25rem;
  }
  .safe-card-desc {
    font-size: 0.68rem;
    color: var(--color-text-muted);
    line-height: 1.45;
    max-width: 180px;
  }

  /* Toggle switch */
  .toggle-switch {
    width: 40px;
    height: 22px;
    border-radius: 11px;
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
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    top: 3px;
    left: 3px;
    transition: transform var(--transition);
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }
  .toggle-switch.on .toggle-thumb { transform: translateX(18px); }
</style>