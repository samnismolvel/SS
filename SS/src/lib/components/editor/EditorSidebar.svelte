<script lang="ts">
  import StylesPanel   from './StylesPanel.svelte'
  import CustomizePanel from './CustomizePanel.svelte'
  import CaptionsPanel from './CaptionsPanel.svelte'

  interface Props {
    onsrtexport?: () => void
    onsrtimport?: () => void
  }
  let { onsrtexport, onsrtimport }: Props = $props()

  type PanelId = 'styles' | 'customize' | 'captions'
  let activePanel = $state<PanelId>('styles')
</script>

<div class="sidebar">

  <!-- Icon strip -->
  <div class="icon-strip">
    <button class="nav-btn {activePanel === 'styles' ? 'active' : ''}"
      onclick={() => activePanel = 'styles'} title="Styles">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
        <path d="M12 2l2.4 6.4L21 10l-6.6 2.4L12 19l-2.4-6.6L3 10l6.6-2.6z"/>
      </svg>
      <span class="nav-label">Styles</span>
    </button>

    <button class="nav-btn {activePanel === 'customize' ? 'active' : ''}"
      onclick={() => activePanel = 'customize'} title="Customize">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
        <line x1="4" y1="6" x2="20" y2="6"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/>
        <line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/>
        <line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/>
      </svg>
      <span class="nav-label">Customize</span>
    </button>

    <button class="nav-btn {activePanel === 'captions' ? 'active' : ''}"
      onclick={() => activePanel = 'captions'} title="Captions">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
        <rect x="3" y="5" width="18" height="14" rx="2"/>
        <path d="M7 9h6M7 13h4"/>
      </svg>
      <span class="nav-label">Captions</span>
    </button>
  </div>

  <!-- Panel -->
  <div class="panel">
    {#if activePanel === 'styles'}
      <StylesPanel />
    {:else if activePanel === 'customize'}
      <CustomizePanel />
    {:else if activePanel === 'captions'}
      <CaptionsPanel {onsrtexport} {onsrtimport} />
    {/if}
  </div>

</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: row;
    border-left: 1px solid var(--color-border);
    width: calc(var(--strip-w, 56px) + var(--panel-w, 300px));
    flex-shrink: 0;
    overflow: hidden;
  }

  /* Icon strip */
  .icon-strip {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.6rem 0;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    width: var(--strip-w, 56px);
    flex-shrink: 0;
    gap: 0.1rem;
  }

  .nav-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    width: 44px;
    height: 50px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all var(--transition);
  }
  .nav-btn:hover { color: var(--color-text); background: var(--color-surface-hover); }
  .nav-btn.active {
    color: var(--color-accent);
    background: var(--color-accent-subtle, rgba(99,102,241,0.12));
  }
  .nav-label {
    font-size: 0.58rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    line-height: 1;
  }

  /* Panel */
  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-bg);
  }
</style>