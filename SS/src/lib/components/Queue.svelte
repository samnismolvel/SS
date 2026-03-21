<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { open } from '@tauri-apps/plugin-dialog'
  import { listen } from '@tauri-apps/api/event'
  import { onDestroy } from 'svelte'
  import {
    queue, processing, currentVideoIndex, currentStep, currentMessage,
    processingPhase, addToQueue, removeFromQueue, moveItem, clearCompleted,
    updateQueueItem, setItemMode, setItemTemplate, resetProgress
  } from '$lib/stores/queue'
  import { openSession } from '$lib/stores/editor'
  import { allTemplates } from '$lib/stores/templates'
  import { parseSRT, buildAss } from '$lib/utils/ass'
  import type { ProgressEvent, QueueItemMode } from '$lib/types'

  const STEPS = ['extracting', 'transcribing', 'burning', 'done'] as const

  function stepIndex(step: string) {
    return STEPS.indexOf(step as typeof STEPS[number])
  }

  function getFileName(path: string) {
    return path.split(/[\\/]/).pop() ?? path
  }

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
    if (selected && Array.isArray(selected)) addToQueue(selected)
  }

  // ── Phase 1: Transcribe all ──────────────────────────────────────────────
  async function processQueue() {
    if ($queue.length === 0 || $processing) return
    processing.set(true)
    processingPhase.set('transcribing')

    for (let i = 0; i < $queue.length; i++) {
      if ($queue[i].status === 'done' || $queue[i].srtContent) continue
      currentVideoIndex.set(i)
      updateQueueItem($queue[i].id, { status: 'processing', error: null })
      currentStep.set('')
      currentMessage.set('')

      try {
        const srt = await invoke<string>('process_video', {
          videoPath: $queue[i].inputPath,
          outputPath: $queue[i].outputPath,
          skipEditor: true
        })
        if (!srt || srt.length === 0) throw new Error('No transcription returned')
        updateQueueItem($queue[i].id, { srtContent: srt, status: 'pending' })
      } catch (e) {
        updateQueueItem($queue[i].id, { status: 'failed', error: String(e) })
      }
    }

    // ── Phase 2: Burn template items ─────────────────────────────────────
    processingPhase.set('burning')

    for (let i = 0; i < $queue.length; i++) {
      const item = $queue[i]
      if (item.status === 'failed' || item.status === 'done') continue
      if (item.mode !== 'template' || !item.srtContent) continue

      currentVideoIndex.set(i)
      updateQueueItem(item.id, { status: 'processing' })
      currentStep.set('burning')
      currentMessage.set('Burning subtitles...')

      const template = $allTemplates.find(t => t.id === item.templateId) ?? $allTemplates[0]
      const subtitles = parseSRT(item.srtContent)
      const assContent = buildAss(subtitles, template)

      try {
        await invoke('burn_subtitles', {
          videoPath: item.inputPath,
          outputPath: item.outputPath,
          assContent
        })
        updateQueueItem(item.id, { status: 'done' })
      } catch (e) {
        updateQueueItem(item.id, { status: 'failed', error: String(e) })
      }
    }

    // ── Phase 3: Open editor for manual items one by one ─────────────────
    processingPhase.set('editing')
    processing.set(false)

    for (let i = 0; i < $queue.length; i++) {
      const item = $queue[i]
      if (item.status === 'failed' || item.status === 'done') continue
      if (item.mode !== 'manual' || !item.srtContent) continue

      currentVideoIndex.set(i)
      openSession(item.id, item.inputPath, item.outputPath, item.srtContent)
      return
    }

    resetProgress()
  }

  // Called from +page.svelte after each manual item is burned
  export async function continueManual(fromId: string) {
    const items = $queue
    const fromIndex = items.findIndex(i => i.id === fromId)

    for (let i = fromIndex + 1; i < items.length; i++) {
      const item = items[i]
      if (item.status === 'failed' || item.status === 'done') continue
      if (item.mode !== 'manual' || !item.srtContent) continue

      currentVideoIndex.set(i)
      openSession(item.id, item.inputPath, item.outputPath, item.srtContent!)
      return
    }

    resetProgress()
  }
</script>

<div class="queue-view">
  <div class="queue-header">
    <h1 class="app-title">SubSpark</h1>
    <div class="header-actions">
      <button class="btn" on:click={addVideos} disabled={$processing}>+ Add Videos</button>
      <button class="btn" on:click={clearCompleted}
        disabled={$processing || !$queue.some(q => q.status === 'done')}>
        Clear Done
      </button>
      <button class="btn btn-primary" on:click={processQueue}
        disabled={$processing || $queue.length === 0}>
        {#if $processing}
          {$processingPhase === 'transcribing' ? 'Transcribing...'
            : $processingPhase === 'burning' ? 'Burning...'
            : 'Processing...'}
        {:else}
          Process ({$queue.length})
        {/if}
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

            <!-- Mode + template selector -->
            <div class="item-mode">
              <div class="mode-tabs">
                <button
                  class="mode-tab"
                  class:active={item.mode === 'manual'}
                  on:click={() => setItemMode(item.id, 'manual')}
                  disabled={$processing}
                >Manual</button>
                <button
                  class="mode-tab"
                  class:active={item.mode === 'template'}
                  on:click={() => setItemMode(item.id, 'template')}
                  disabled={$processing}
                >Template</button>
              </div>
              {#if item.mode === 'template'}
                <select
                  class="template-select"
                  value={item.templateId ?? $allTemplates[0]?.id}
                  on:change={(e) => setItemTemplate(item.id, e.currentTarget.value)}
                  disabled={$processing}
                >
                  {#each $allTemplates as t}
                    <option value={t.id}>{t.name}</option>
                  {/each}
                </select>
              {/if}
            </div>

            <div class="item-actions">
              <button class="icon-btn" on:click={() => moveItem(index, 'up')}
                disabled={$processing || index === 0} title="Move up">↑</button>
              <button class="icon-btn" on:click={() => moveItem(index, 'down')}
                disabled={$processing || index === $queue.length - 1} title="Move down">↓</button>
              <button class="icon-btn danger" on:click={() => removeFromQueue(item.id)}
                disabled={$processing} title="Remove">×</button>
            </div>
          </div>

          {#if index === $currentVideoIndex && $processing}
            <div class="progress-section">
              <div class="steps">
                {#each STEPS.slice(0, -1) as step}
                  <div class="step"
                    class:active={$currentStep === step}
                    class:completed={stepIndex($currentStep) > stepIndex(step)}>
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
  .queue-view { display: flex; flex-direction: column; gap: 1.5rem; height: 100%; }

  .queue-header { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }

  .app-title {
    font-size: 1.4rem; font-weight: 700; letter-spacing: -0.5px;
    color: var(--color-accent); -webkit-text-fill-color: var(--color-accent); margin: 0; flex: 1;
  }

  .header-actions { display: flex; gap: 0.5rem; }

  .btn {
    padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text);
    -webkit-text-fill-color: var(--color-text);
    font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: background 0.15s, opacity 0.15s;
  }
  .btn:hover:not(:disabled) { background: var(--color-surface-hover); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary {
    background: var(--color-accent); -webkit-text-fill-color: white; border-color: var(--color-accent);
  }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }

  .empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 0.5rem; color: var(--color-text-muted); text-align: center;
  }
  .empty-icon { font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem; }
  .empty-state p {
    font-size: 1rem; font-weight: 500; color: var(--color-text);
    -webkit-text-fill-color: var(--color-text); margin: 0;
  }
  .empty-state span { font-size: 0.85rem; }

  .queue-list { display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; flex: 1; }

  .queue-item {
    background: var(--color-surface); border: 1px solid var(--color-border);
    border-radius: 8px; padding: 0.875rem 1rem; transition: border-color 0.15s;
  }
  .queue-item.active { border-color: var(--color-accent); }

  .item-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }

  .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .status-dot.status-pending   { background: var(--color-text-muted); }
  .status-dot.status-processing { background: var(--color-accent); animation: pulse 1.5s infinite; }
  .status-dot.status-done      { background: var(--color-success); }
  .status-dot.status-failed    { background: var(--color-danger); }

  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .item-info { flex: 1; min-width: 0; }

  .item-name {
    font-weight: 600; font-size: 0.9rem; color: var(--color-text);
    -webkit-text-fill-color: var(--color-text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .item-path {
    font-size: 0.75rem; color: var(--color-text-muted); -webkit-text-fill-color: var(--color-text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;
  }
  .item-error {
    font-size: 0.75rem; color: var(--color-danger); -webkit-text-fill-color: var(--color-danger); margin-top: 4px;
  }

  /* Mode selector */
  .item-mode { display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-end; }

  .mode-tabs { display: flex; border-radius: 5px; overflow: hidden; border: 1px solid var(--color-border); }

  .mode-tab {
    padding: 0.25rem 0.6rem; font-size: 0.72rem; font-weight: 500;
    border: none; background: var(--color-bg); color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted); cursor: pointer; transition: all 0.15s;
  }
  .mode-tab:first-child { border-right: 1px solid var(--color-border); }
  .mode-tab.active {
    background: var(--color-accent-subtle); -webkit-text-fill-color: var(--color-accent);
  }
  .mode-tab:disabled { opacity: 0.4; cursor: not-allowed; }

  .template-select {
    font-size: 0.72rem; padding: 0.2rem 0.4rem; border-radius: 4px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); -webkit-text-fill-color: var(--color-text); max-width: 140px;
  }

  .item-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }

  .icon-btn {
    width: 28px; height: 28px; padding: 0; border-radius: 4px;
    border: 1px solid var(--color-border); background: transparent;
    color: var(--color-text-muted); -webkit-text-fill-color: var(--color-text-muted);
    font-size: 0.9rem; cursor: pointer; display: flex; align-items: center;
    justify-content: center; transition: background 0.15s;
  }
  .icon-btn:hover:not(:disabled) { background: var(--color-surface-hover); -webkit-text-fill-color: var(--color-text); }
  .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .icon-btn.danger:hover:not(:disabled) { background: var(--color-danger-subtle); -webkit-text-fill-color: var(--color-danger); }

  .progress-section {
    margin-top: 0.875rem; padding-top: 0.875rem; border-top: 1px solid var(--color-border);
  }

  .steps { display: flex; justify-content: space-between; position: relative; margin-bottom: 0.75rem; }
  .steps::before {
    content: ''; position: absolute; top: 7px; left: 8px; right: 8px;
    height: 1px; background: var(--color-border);
  }

  .step {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    font-size: 0.7rem; color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted); text-transform: capitalize; z-index: 1;
  }
  .step-dot {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--color-bg); border: 2px solid var(--color-border);
  }
  .step.active .step-dot   { background: var(--color-accent); border-color: var(--color-accent); }
  .step.active             { -webkit-text-fill-color: var(--color-accent); font-weight: 600; }
  .step.completed .step-dot { background: var(--color-success); border-color: var(--color-success); }
  .step.completed          { -webkit-text-fill-color: var(--color-success); }

  .step-message {
    font-size: 0.8rem; color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted); text-align: center; margin: 0;
  }
</style>