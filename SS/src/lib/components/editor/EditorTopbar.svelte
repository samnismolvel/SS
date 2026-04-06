<script lang="ts">
  interface Props {
    fileName: string
    isDirty: boolean
    onback: () => void
    onexport: () => void
  }
  let { fileName, isDirty, onback, onexport }: Props = $props()
</script>

<div class="topbar">
  <button class="back-btn" onclick={onback}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
    Queue
  </button>

  <div class="file-info">
    <span class="file-name">{fileName}</span>
    {#if isDirty}<span class="dirty-dot"></span>{/if}
  </div>

  <div class="spacer"></div>

  <button class="export-btn" onclick={onexport}>
    Export
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  </button>
</div>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    height: 44px;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 0.78rem;
    cursor: pointer;
    transition: all var(--transition);
  }
  .back-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }

  .file-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .file-name {
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--color-text);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning, #f59e0b);
    flex-shrink: 0;
  }

  .spacer { flex: 1; }

  .export-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 1rem;
    border-radius: var(--radius-sm);
    border: none;
    background: var(--color-accent);
    color: white;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: filter var(--transition);
  }
  .export-btn:hover { filter: brightness(1.12); }
</style>