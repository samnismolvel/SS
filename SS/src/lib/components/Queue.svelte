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
  import type { ProgressEvent, QueueItem, Template } from '$lib/types'

  const STEPS = ['extracting', 'transcribing', 'burning', 'done'] as const

  function stepIndex(step: string) {
    return STEPS.indexOf(step as typeof STEPS[number])
  }

  function getFileName(path: string) {
    return path.split(/[\\/]/).pop() ?? path
  }

  let queueVal = $state<QueueItem[]>([])
  let processingVal = $state(false)
  let currentIdxVal = $state(-1)
  let currentStepVal = $state('')
  let currentMsgVal = $state('')
  let phaseVal = $state('')
  let templatesVal = $state<Template[]>([])

  $effect(() => {
    const u1 = queue.subscribe(v => { queueVal = v })
    const u2 = processing.subscribe(v => { processingVal = v })
    const u3 = currentVideoIndex.subscribe(v => { currentIdxVal = v })
    const u4 = currentStep.subscribe(v => { currentStepVal = v })
    const u5 = currentMessage.subscribe(v => { currentMsgVal = v })
    const u6 = processingPhase.subscribe(v => { phaseVal = v })
    const u7 = allTemplates.subscribe(v => { templatesVal = v })
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7() }
  })

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

  async function processQueue() {
    if (queueVal.length === 0 || processingVal) return
    processing.set(true)
    processingPhase.set('transcribing')

    for (let i = 0; i < queueVal.length; i++) {
      if (queueVal[i].status === 'done' || queueVal[i].srtContent) continue
      currentVideoIndex.set(i)
      updateQueueItem(queueVal[i].id, { status: 'processing', error: null })
      currentStep.set('')
      currentMessage.set('')

      try {
        const srt = await invoke<string>('process_video', {
          videoPath: queueVal[i].inputPath,
          outputPath: queueVal[i].outputPath,
          skipEditor: true
        })
        if (!srt || srt.length === 0) throw new Error('No transcription returned')
        updateQueueItem(queueVal[i].id, { srtContent: srt, status: 'pending' })
      } catch (e) {
        updateQueueItem(queueVal[i].id, { status: 'failed', error: String(e) })
      }
    }

    processingPhase.set('burning')

    for (let i = 0; i < queueVal.length; i++) {
      const item = queueVal[i]
      if (item.status === 'failed' || item.status === 'done') continue
      if (item.mode !== 'template' || !item.srtContent) continue

      currentVideoIndex.set(i)
      updateQueueItem(item.id, { status: 'processing' })
      currentStep.set('burning')
      currentMessage.set('Burning subtitles...')

      const template = templatesVal.find(t => t.id === item.templateId) ?? templatesVal[0]
      const subtitles = parseSRT(item.srtContent)
      const assContent = buildAss(subtitles, template)

      try {
        await invoke('burn_subtitles', { videoPath: item.inputPath, outputPath: item.outputPath, assContent })
        updateQueueItem(item.id, { status: 'done' })
      } catch (e) {
        updateQueueItem(item.id, { status: 'failed', error: String(e) })
      }
    }

    processingPhase.set('editing')
    processing.set(false)

    for (let i = 0; i < queueVal.length; i++) {
      const item = queueVal[i]
      if (item.status === 'failed' || item.status === 'done') continue
      if (item.mode !== 'manual' || !item.srtContent) continue
      currentVideoIndex.set(i)
      openSession(item.id, item.inputPath, item.outputPath, item.srtContent)
      return
    }

    resetProgress()
  }

  export async function continueManual(fromId: string) {
    const items = queueVal
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
      <button class="btn" onclick={addVideos} disabled={processingVal}>+ Add Videos</button>
      <button class="btn" onclick={clearCompleted}
        disabled={processingVal || !queueVal.some(q => q.status === 'done')}>
        Clear Done
      </button>
      <button class="btn btn-primary" onclick={processQueue}
        disabled={processingVal || queueVal.length === 0}>
        {#if processingVal}
          {phaseVal === 'transcribing' ? 'Transcribing...'
            : phaseVal === 'burning' ? 'Burning...'
            : 'Processing...'}
        {:else}
          Process ({queueVal.length})
        {/if}
      </button>
    </div>
  </div>

  {#if queueVal.length === 0}
    <div class="empty-state">
      <div class="empty-icon">▶</div>
      <p>No videos in queue</p>
      <span>Click "Add Videos" to get started</span>
    </div>
  {:else}
    <div class="queue-list">
      {#each queueVal as item, index}
        <div class="queue-item" class:active={index === currentIdxVal}>
          <div class="item-row">
            <div class="status-dot status-{item.status}"></div>
            <div class="item-info">
              <div class="item-name">{getFileName(item.inputPath)}</div>
              <div class="item-path">{item.inputPath}</div>
              {#if item.status === 'failed'}
                <div class="item-error">{item.error}</div>
              {/if}
            </div>

            <div class="item-mode">
              <div class="mode-tabs">
                <button class="mode-tab" class:active={item.mode === 'manual'}
                  onclick={() => setItemMode(item.id, 'manual')} disabled={processingVal}>Manual</button>
                <button class="mode-tab" class:active={item.mode === 'template'}
                  onclick={() => setItemMode(item.id, 'template')} disabled={processingVal}>Template</button>
              </div>
              {#if item.mode === 'template'}
                <select class="template-select"
                  value={item.templateId ?? templatesVal[0]?.id}
                  onchange={(e) => setItemTemplate(item.id, e.currentTarget.value)}
                  disabled={processingVal}>
                  {#each templatesVal as t}
                    <option value={t.id}>{t.name}</option>
                  {/each}
                </select>
              {/if}
            </div>

            <div class="item-actions">
              <button class="icon-btn" onclick={() => moveItem(index, 'up')}
                disabled={processingVal || index === 0}>↑</button>
              <button class="icon-btn" onclick={() => moveItem(index, 'down')}
                disabled={processingVal || index === queueVal.length - 1}>↓</button>
              <button class="icon-btn danger" onclick={() => removeFromQueue(item.id)}
                disabled={processingVal}>×</button>
            </div>
          </div>

          {#if index === currentIdxVal && processingVal}
            <div class="progress-section">
              <div class="steps">
                {#each STEPS.slice(0, -1) as step}
                  <div class="step"
                    class:active={currentStepVal === step}
                    class:completed={stepIndex(currentStepVal) > stepIndex(step)}>
                    <div class="step-dot"></div>
                    <span>{step}</span>
                  </div>
                {/each}
              </div>
              <p class="step-message">{currentMsgVal}</p>
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

  .app-title { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.5px; color: var(--color-accent); margin: 0; flex: 1; }
  .header-actions { display: flex; gap: 0.5rem; }

  .btn {
    padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid var(--color-border);
    background: var(--color-surface); color: var(--color-text);
    font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: background 0.15s, opacity 0.15s;
  }
  .btn:hover:not(:disabled) { background: var(--color-surface-hover); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary { background: var(--color-accent); color: white; border-color: var(--color-accent); }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }

  .empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 0.5rem; color: var(--color-text-muted); text-align: center;
  }
  .empty-icon { font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem; }
  .empty-state p { font-size: 1rem; font-weight: 500; color: var(--color-text); margin: 0; }
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
  .item-name { font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-path { font-size: 0.75rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .item-error { font-size: 0.75rem; color: var(--color-danger); margin-top: 4px; }

  .item-mode { display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-end; }
  .mode-tabs { display: flex; border-radius: 5px; overflow: hidden; border: 1px solid var(--color-border); }
  .mode-tab {
    padding: 0.25rem 0.6rem; font-size: 0.72rem; font-weight: 500;
    border: none; background: var(--color-bg); color: var(--color-text-muted); cursor: pointer;
  }
  .mode-tab:first-child { border-right: 1px solid var(--color-border); }
  .mode-tab.active { background: var(--color-accent-subtle); color: var(--color-accent); }
  .mode-tab:disabled { opacity: 0.4; cursor: not-allowed; }

  .template-select {
    font-size: 0.72rem; padding: 0.2rem 0.4rem; border-radius: 4px;
    border: 1px solid var(--color-border); background: var(--color-bg);
    color: var(--color-text); max-width: 140px;
  }

  .item-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }
  .icon-btn {
    width: 28px; height: 28px; padding: 0; border-radius: 4px;
    border: 1px solid var(--color-border); background: transparent;
    color: var(--color-text-muted); font-size: 0.9rem; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .icon-btn:hover:not(:disabled) { background: var(--color-surface-hover); }
  .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .icon-btn.danger:hover:not(:disabled) { background: var(--color-danger-subtle); color: var(--color-danger); }

  .progress-section { margin-top: 0.875rem; padding-top: 0.875rem; border-top: 1px solid var(--color-border); }

  .steps { display: flex; justify-content: space-between; position: relative; margin-bottom: 0.75rem; }
  .steps::before {
    content: ''; position: absolute; top: 7px; left: 8px; right: 8px;
    height: 1px; background: var(--color-border);
  }
  .step {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    font-size: 0.7rem; color: var(--color-text-muted); text-transform: capitalize; z-index: 1;
  }
  .step-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--color-bg); border: 2px solid var(--color-border); }
  .step.active .step-dot { background: var(--color-accent); border-color: var(--color-accent); }
  .step.active { color: var(--color-accent); font-weight: 600; }
  .step.completed .step-dot { background: var(--color-success); border-color: var(--color-success); }
  .step.completed { color: var(--color-success); }
  .step-message { font-size: 0.8rem; color: var(--color-text-muted); text-align: center; margin: 0; }
</style>