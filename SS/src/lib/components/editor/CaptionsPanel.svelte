<script lang="ts">
  import { session, findAndReplace, selectSegment } from '$lib/stores/editor'
  import type { Subtitle } from '$lib/types'

  interface Props {
    onsrtexport?: () => void
    onsrtimport?: () => void
  }
  let { onsrtexport, onsrtimport }: Props = $props()

  let items  = $state([] as Subtitle[])
  let selIdx = $state(null as number | null)

  $effect(() => {
    const u = session.subscribe(v => {
      items  = v?.subtitles ?? []
      selIdx = v?.selectedIndex ?? null
    })
    return u
  })

  function srtToSeconds(srt: string): number {
    if (!srt) return 0
    const [time, ms] = srt.split(',')
    const [h, m, s] = time.split(':').map(Number)
    return h * 3600 + m * 60 + s + (parseInt(ms) / 1000)
  }

  function seekToSegment(sub: Subtitle) {
    const idx = items.indexOf(sub)
    if (idx !== -1) selectSegment(idx)
  }

  let searchTerm     = $state('')
  let replaceTerm    = $state('')
  let replaceMessage = $state('')

  function handleFindReplace() {
    if (!searchTerm) return
    const count = findAndReplace(searchTerm, replaceTerm, 'all')
    replaceMessage = `${count} replaced`
    setTimeout(() => replaceMessage = '', 2500)
  }
</script>

<div class="panel-header">
  <span class="panel-title">Captions</span>
  <span class="panel-count">{items.length}</span>
</div>

<!-- Actions -->
<div class="captions-actions">
  <button class="captions-action-btn" onclick={onsrtexport}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Export SRT
  </button>
  <button class="captions-action-btn" onclick={onsrtimport}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    Import SRT
  </button>
</div>

<!-- Find & replace -->
<div class="find-row">
  <div class="find-inputs">
    <input type="text" class="find-input" bind:value={searchTerm} placeholder="Find…" />
    <input type="text" class="find-input" bind:value={replaceTerm} placeholder="Replace with…" />
  </div>
  <div class="find-footer">
    <button class="replace-btn" onclick={handleFindReplace}>Replace all</button>
    {#if replaceMessage}<span class="replace-msg">{replaceMessage}</span>{/if}
  </div>
</div>

<!-- Segment list -->
<div class="caption-list">
  {#each items as sub, i}
    <div class="caption-item {selIdx === i ? 'active' : ''}"
      onclick={() => seekToSegment(sub)}
      role="button" tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && seekToSegment(sub)}>
      <div class="caption-meta">
        <span class="cap-num">#{sub.index}</span>
        <span class="cap-time">{sub.start.slice(0, 8)}</span>
      </div>
      <div class="cap-text">{sub.text}</div>
    </div>
  {/each}
</div>

<style>
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  .panel-count {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    background: var(--color-surface-hover, rgba(255,255,255,0.06));
    padding: 0.1rem 0.45rem;
    border-radius: 99px;
  }

  .captions-actions {
    display: flex;
    gap: 0.4rem;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .captions-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: 0.7rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition);
  }
  .captions-action-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }

  .find-row {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .find-inputs { display: flex; flex-direction: column; gap: 0.25rem; }
  .find-input {
    padding: 0.25rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.73rem;
    outline: none;
    transition: border-color var(--transition);
  }
  .find-input:focus { border-color: var(--color-accent); }
  .find-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .replace-btn {
    padding: 0.22rem 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: 0.72rem;
    cursor: pointer;
    transition: all var(--transition);
  }
  .replace-btn:hover { background: var(--color-surface-hover); color: var(--color-text); }
  .replace-msg { font-size: 0.7rem; color: var(--color-success, #22c55e); }

  .caption-list { flex: 1; overflow-y: auto; }
  .caption-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.45rem 0.85rem;
    border-bottom: 1px solid var(--color-border);
    border-left: 2px solid transparent;
    cursor: pointer;
    transition: background var(--transition);
  }
  .caption-item:hover { background: var(--color-surface-hover); }
  .caption-item.active {
    background: var(--color-accent-subtle, rgba(99,102,241,0.08));
    border-left-color: var(--color-accent);
  }
  .caption-meta { display: flex; gap: 0.5rem; align-items: baseline; }
  .cap-num { font-size: 0.62rem; font-weight: 700; color: var(--color-accent); }
  .cap-time { font-size: 0.62rem; color: var(--color-text-muted); font-family: monospace; }
  .cap-text { font-size: 0.78rem; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>