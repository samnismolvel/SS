<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { open } from '@tauri-apps/plugin-dialog'
  import { listen } from '@tauri-apps/api/event'
  import { onDestroy } from 'svelte'
  import {
    queue, processing, currentVideoIndex,
    currentStep, currentMessage,
    addToQueue, removeFromQueue, moveItem,
    clearCompleted, updateQueueItem, resetProgress
  } from '$lib/stores/queue'
  import { openSession } from '$lib/stores/editor'
  import type { ProgressEvent, QueueItem } from '$lib/types'

  const STEPS = ['extracting', 'transcribing', 'editing', 'burning', 'done'] as const

  function stepIndex(step: string) {
    return STEPS.indexOf(step as typeof STEPS[number])
  }

  function getFileName(path: string) {
    return path.split(/[\\/]/).pop() ?? path
  }

  // Listen for progress events from Rust
  const unlisten = listen<ProgressEvent>('progress', (event) => {
    currentStep.set(event.payload.step)
    currentMessage.set(event.payload.message)
  })
  onDestroy(() => unlisten.then(f => f()))

  async function addVideos() {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }]
    })
    if (selected && Array.isArray(selected)) {
      addToQueue(selected)
    }
  }

  async function processQueue() {
    if ($queue.length === 0 || $processing) return
    processing.set(true)

    for (let i = 0; i < $queue.length; i++) {
      if ($queue[i].status === 'done') continue
      await processItem(i)
      // If editor opened, stop here — continueQueue handles the rest
      if ($processing === false) return
    }

    resetProgress()
  }

  async function processItem(i: number) {
    currentVideoIndex.set(i)
    updateQueueItem($queue[i].id, { status: 'processing', error: null })
    currentStep.set('')
    currentMessage.set('')

    try {
      const result = await invoke<string>('process_video', {
        videoPath: $queue[i].inputPath,
        outputPath: $queue[i].outputPath,
        skipEditor: false
      })

      if (result && result.length > 0) {
        // Open editor — processing halts until user saves/cancels
        openSession($queue[i].id, $queue[i].inputPath, $queue[i].outputPath, result)
        processing.set(false)
        return
      }

      updateQueueItem($queue[i].id, { status: 'done' })
    } catch (e) {
      updateQueueItem($queue[i].id, { status: 'failed', error: String(e) })
    }
  }

  export async function continueQueue(fromIndex: number) {
    processing.set(true)
    for (let i = fromIndex + 1; i < $queue.length; i++) {
      if ($queue[i].status === 'done') continue
      await processItem(i)
      if ($processing === false) return
    }
    resetProgress()
  }
</script>

<div class="queue-view">
  <div class="queue-header">
    <h1 class="app-title">SubSpark</h1>
    <div class="header-actions">
      <button class="btn" on:click={addVideos} disabled={$processing}>
        + Add Videos
      </button>
      <button
        class="btn"
        on:click={clearCompleted}
        disabled={$processing || !$queue.some(q => q.status === 'done')}
      >
        Clear Done
      </button>
      <button
        class="btn btn-primary"
        on:click={processQueue}
        disabled={$processing || $queue.length === 0}
      >
        {$processing ? 'Processing...' : `Process (${$queue.length})`}
      </button>
    </div>
  </div>

  {#if $queue.length === 0}
    <div class="empty-state">
      <div class="empty-icon">▶</div>
      <p>No videos in queue</p>
      <span>Click "Add Videos" to get started</span>
    </div>
  {:else}
    <div class="queue-list">
      {#each $queue as item, index (item.id)}
        <div class="queue-item" class:active={index === $currentVideoIndex}>
          <div class="item-row">
            <div class="status-dot status-{item.status}"></div>
            <div class="item-info">
              <div class="item-name">{getFileName(item.inputPath)}</div>
              <div class="item-path">{item.inputPath}</div>
              {#if item.status === 'failed'}
                <div class="item-error">{item.error}</div>
              {/if}
            </div>
            <div class="item-actions">
              <button
                class="icon-btn"
                on:click={() => moveItem(index, 'up')}
                disabled={$processing || index === 0}
                title="Move up"
              >↑</button>
              <button
                class="icon-btn"
                on:click={() => moveItem(index, 'down')}
                disabled={$processing || index === $queue.length - 1}
                title="Move down"
              >↓</button>
              <button
                class="icon-btn danger"
                on:click={() => removeFromQueue(item.id)}
                disabled={$processing}
                title="Remove"
              >×</button>
            </div>
          </div>

          {#if index === $currentVideoIndex && $processing}
            <div class="progress-section">
              <div class="steps">
                {#each STEPS.slice(0, -1) as step}
                  <div
                    class="step"
                    class:active={$currentStep === step}
                    class:completed={stepIndex($currentStep) > stepIndex(step)}
                  >
                    <div class="step-dot"></div>
                    <span>{step}</span>
                  </div>
                {/each}
              </div>
              <p class="step-message">{$currentMessage}</p>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .queue-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    height: 100%;
  }

  .queue-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .app-title {
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--color-accent);
    margin: 0;
    flex: 1;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .btn:hover:not(:disabled) { background: var(--color-surface-hover); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-primary {
    background: var(--color-accent);
    color: white;
    border-color: var(--color-accent);
  }

  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--color-text-muted);
    text-align: center;
  }

  .empty-icon {
    font-size: 2.5rem;
    opacity: 0.3;
    margin-bottom: 0.5rem;
  }

  .empty-state p {
    font-size: 1rem;
    font-weight: 500;
    color: var(--color-text);
    margin: 0;
  }

  .empty-state span {
    font-size: 0.85rem;
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .queue-item {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.875rem 1rem;
    transition: border-color 0.15s;
  }

  .queue-item.active {
    border-color: var(--color-accent);
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.status-pending   { background: var(--color-text-muted); }
  .status-dot.status-processing { background: var(--color-accent); animation: pulse 1.5s infinite; }
  .status-dot.status-done      { background: var(--color-success); }
  .status-dot.status-failed    { background: var(--color-danger); }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .item-info {
    flex: 1;
    min-width: 0;
  }

  .item-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-path {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .item-error {
    font-size: 0.75rem;
    color: var(--color-danger);
    margin-top: 4px;
  }

  .item-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 0.9rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .icon-btn.danger:hover:not(:disabled) { background: var(--color-danger-subtle); color: var(--color-danger); }

  .progress-section {
    margin-top: 0.875rem;
    padding-top: 0.875rem;
    border-top: 1px solid var(--color-border);
  }

  .steps {
    display: flex;
    justify-content: space-between;
    position: relative;
    margin-bottom: 0.75rem;
  }

  .steps::before {
    content: '';
    position: absolute;
    top: 7px;
    left: 8px;
    right: 8px;
    height: 1px;
    background: var(--color-border);
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 0.7rem;
    color: var(--color-text-muted);
    text-transform: capitalize;
    z-index: 1;
  }

  .step-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-bg);
    border: 2px solid var(--color-border);
  }

  .step.active .step-dot   { background: var(--color-accent); border-color: var(--color-accent); }
  .step.active             { color: var(--color-accent); font-weight: 600; }
  .step.completed .step-dot { background: var(--color-success); border-color: var(--color-success); }
  .step.completed          { color: var(--color-success); }

  .step-message {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    text-align: center;
    margin: 0;
  }
</style>