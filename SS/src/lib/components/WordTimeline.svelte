<script lang="ts">
  interface RawSub { start: string; end: string; text: string }
  interface Props {
    rawSubs: RawSub[]
    currentTime: number
    duration: number
    onseek: (t: number) => void
    onchange: (updated: RawSub[]) => void
  }
  let { rawSubs, currentTime, duration, onseek, onchange }: Props = $props()

  function srtToMs(srt: string): number {
    if (!srt) return 0
    const [time, ms] = srt.split(',')
    const [h, m, s] = time.split(':').map(Number)
    return (h * 3600 + m * 60 + s) * 1000 + parseInt(ms)
  }
  function msToSrt(ms: number): string {
    const h = Math.floor(ms / 3600000); ms %= 3600000
    const m = Math.floor(ms / 60000);   ms %= 60000
    const s = Math.floor(ms / 1000);    ms %= 1000
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(Math.round(ms)).padStart(3,'0')}`
  }

  let trackEl = $state<HTMLDivElement | null>(null)
  let draggingIdx = $state<number | null>(null)
  let dragEdge = $state<'start'|'end'>('start')
  let totalMs = $derived(duration * 1000)

  // Viewport: zona visible centrada en currentTime. Ancho = viewportMs ms.
  const viewportMs = 6000   // 6 segundos visibles
  let viewStart = $derived(Math.max(0, currentTime * 1000 - viewportMs / 2))

  function pct(ms: number): number {
    return ((ms - viewStart) / viewportMs) * 100
  }
  function msToPct(ms: number) { return Math.max(0, Math.min(100, pct(ms))) }

  // Drag de borde de palabra para ajustar timing
  function onEdgePointerDown(e: PointerEvent, idx: number, edge: 'start'|'end') {
    e.preventDefault()
    e.stopPropagation()
    draggingIdx = idx
    dragEdge = edge
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onTrackPointerMove(e: PointerEvent) {
    if (draggingIdx === null || !trackEl) return
    e.preventDefault()
    const rect = trackEl.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const newMs = Math.round(viewStart + ratio * viewportMs)
    const updated = rawSubs.map((s, i) => {
      if (i !== draggingIdx) return s
      if (dragEdge === 'start') {
        const endMs = srtToMs(s.end)
        const clampedMs = Math.min(newMs, endMs - 50)
        return { ...s, start: msToSrt(Math.max(0, clampedMs)) }
      } else {
        const startMs = srtToMs(s.start)
        const clampedMs = Math.max(newMs, startMs + 50)
        return { ...s, end: msToSrt(Math.min(totalMs, clampedMs)) }
      }
    })
    onchange(updated)
  }

  function onTrackPointerUp() { draggingIdx = null }

  // Click en el track (no en palabra) → seek
  function onTrackClick(e: MouseEvent) {
    if (draggingIdx !== null || !trackEl) return
    const rect = trackEl.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onseek((viewStart + ratio * viewportMs) / 1000)
  }
</script>

<div class="timeline-root">
  <!-- Regla de tiempo -->
  <div class="ruler">
    {#each Array.from({length: 7}, (_, i) => viewStart + i * (viewportMs / 6)) as t}
      <div class="ruler-tick" style="left:{((t - viewStart) / viewportMs * 100).toFixed(2)}%">
        <span>{Math.floor(t/60000)}:{String(Math.floor((t%60000)/1000)).padStart(2,'0')}</span>
      </div>
    {/each}
  </div>

  <!-- Track principal -->
  <div class="track" bind:this={trackEl}
    onclick={onTrackClick}
    onpointermove={onTrackPointerMove}
    onpointerup={onTrackPointerUp}
    onpointercancel={onTrackPointerUp}>

    <!-- Playhead -->
    <div class="playhead" style="left:{((currentTime * 1000 - viewStart) / viewportMs * 100).toFixed(2)}%"></div>

    <!-- Palabras -->
    {#each rawSubs as sub, i}
      {@const startMs = srtToMs(sub.start)}
      {@const endMs   = srtToMs(sub.end)}
      {@const left    = msToPct(startMs)}
      {@const right   = msToPct(endMs)}
      {@const width   = right - left}
      {@const isActive = currentTime * 1000 >= startMs && currentTime * 1000 <= endMs}

      {#if right > 0 && left < 100}
        <div class="word-block"
          class:active={isActive}
          style="left:{left.toFixed(2)}%;width:{Math.max(width, 0.5).toFixed(2)}%"
          title="{sub.text} ({sub.start} → {sub.end})">

          <!-- Handle izquierdo (ajusta start) -->
          <div class="edge-handle edge-left"
            onpointerdown={(e) => onEdgePointerDown(e, i, 'start')}
            role="slider" tabindex="0" aria-label="Move start of {sub.text}"
            aria-valuenow={startMs}></div>

          <span class="word-label">{sub.text.trim()}</span>

          <!-- Handle derecho (ajusta end) -->
          <div class="edge-handle edge-right"
            onpointerdown={(e) => onEdgePointerDown(e, i, 'end')}
            role="slider" tabindex="0" aria-label="Move end of {sub.text}"
            aria-valuenow={endMs}></div>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .timeline-root {
    display: flex; flex-direction: column; gap: 0;
    background: var(--color-bg); border-top: 1px solid var(--color-border);
    user-select: none;
  }
  .ruler {
    position: relative; height: 18px;
    background: var(--color-surface); border-bottom: 1px solid var(--color-border);
    overflow: hidden;
  }
  .ruler-tick {
    position: absolute; top: 0; bottom: 0;
    display: flex; align-items: center;
    transform: translateX(-50%);
  }
  .ruler-tick span {
    font-size: .58rem; color: var(--color-text-muted);
    font-family: monospace; white-space: nowrap;
  }
  .track {
    position: relative; height: 40px;
    cursor: crosshair; overflow: hidden;
  }
  .playhead {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: #e53e3e; pointer-events: none; z-index: 10;
    transform: translateX(-50%);
  }
  .word-block {
    position: absolute; top: 5px; bottom: 5px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    display: flex; align-items: center;
    cursor: default; overflow: hidden;
    transition: background .1s, border-color .1s;
    box-sizing: border-box;
  }
  .word-block.active {
    background: var(--color-accent-subtle);
    border-color: var(--color-accent);
  }
  .word-label {
    flex: 1; font-size: .62rem; color: var(--color-text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    padding: 0 6px; pointer-events: none; text-align: center;
  }
  .edge-handle {
    flex-shrink: 0; width: 6px; height: 100%;
    cursor: ew-resize; z-index: 2;
    display: flex; align-items: center; justify-content: center;
  }
  .edge-handle::after {
    content: ''; display: block;
    width: 2px; height: 12px; border-radius: 1px;
    background: var(--color-border);
  }
  .edge-handle:hover::after { background: var(--color-accent); }
  .edge-left  { border-right: 1px solid var(--color-border); }
  .edge-right { border-left:  1px solid var(--color-border); }
</style>