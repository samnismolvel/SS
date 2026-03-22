<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { session, closeSession } from '$lib/stores/editor'
  import { queue, processing, currentVideoIndex, updateQueueItem, resetProgress } from '$lib/stores/queue'
  import type { EditorSession, QueueItem } from '$lib/types'
  import Queue from '$lib/components/Queue.svelte'
  import Editor from '$lib/components/Editor.svelte'

  let dark = $state(true)
  let queueRef: Queue

  let sessionVal = $state<EditorSession | null>(null)
  let queueVal = $state<QueueItem[]>([])
  let currentIdxVal = $state(-1)

  $effect(() => {
    const u1 = session.subscribe(v => { sessionVal = v })
    const u2 = queue.subscribe(v => { queueVal = v })
    const u3 = currentVideoIndex.subscribe(v => { currentIdxVal = v })
    return () => { u1(); u2(); u3() }
  })

  function toggleDark() { dark = !dark }

  async function handleBurn(detail: { videoPath: string; outputPath: string; assContent: string }) {
    const { videoPath, outputPath, assContent } = detail
    const item = queueVal[currentIdxVal]
    closeSession()
    processing.set(true)

    try {
      await invoke('burn_subtitles', { videoPath, outputPath, assContent })
      updateQueueItem(item.id, { status: 'done' })
    } catch (err) {
      updateQueueItem(item.id, { status: 'failed', error: String(err) })
    }

    await queueRef.continueManual(item.id)
  }

  function handleCancel() {
    const item = queueVal[currentIdxVal]
    updateQueueItem(item.id, { status: 'failed', error: 'Editing cancelled' })
    closeSession()
    queueRef.continueManual(item.id)
  }
</script>

<div class="app" class:dark>
  <div class="theme-toggle">
    <button onclick={toggleDark} title="Toggle dark mode" aria-label="Toggle theme">
      {dark ? '☀' : '☾'}
    </button>
  </div>

  <div class="app-content">
    {#if sessionVal}
      <Editor onburn={handleBurn} oncancel={handleCancel} />
    {:else}
      <Queue bind:this={queueRef} />
    {/if}
  </div>
</div>

<style>
  .app {
    --color-bg:             #f5f5f4;
    --color-surface:        #ffffff;
    --color-surface-hover:  #f0f0ef;
    --color-border:         #e2e2e0;
    --color-border-hover:   #c8c8c5;
    --color-text:           #1a1a18;
    --color-text-muted:     #6b6b68;
    --color-accent:         #5b4fcf;
    --color-accent-subtle:  #eeecfb;
    --color-success:        #16a34a;
    --color-danger:         #dc2626;
    --color-danger-subtle:  #fef2f2;
    --color-warning:        #d97706;
    --color-warning-subtle: #fffbeb;

    height: 100vh; display: flex; flex-direction: column;
    background: var(--color-bg); color: var(--color-text);
    font-family: system-ui, -apple-system, sans-serif;
    position: relative; transition: background 0.2s, color 0.2s;
  }

  .app.dark {
    --color-bg:             #0f0f0e;
    --color-surface:        #1a1a19;
    --color-surface-hover:  #252523;
    --color-border:         #2e2e2c;
    --color-border-hover:   #424240;
    --color-text:           #f0f0ee;
    --color-text-muted:     #888885;
    --color-accent:         #7c6fef;
    --color-accent-subtle:  #1e1a3a;
    --color-success:        #22c55e;
    --color-danger:         #ef4444;
    --color-danger-subtle:  #2d1515;
    --color-warning:        #f59e0b;
    --color-warning-subtle: #2d2000;
  }

  .theme-toggle { position: fixed; top: 0.75rem; right: 1rem; z-index: 100; }

  .theme-toggle button {
    width: 32px; height: 32px; border-radius: 50%;
    border: 1px solid var(--color-border); background: var(--color-surface);
    color: var(--color-text); font-size: 1rem; cursor: pointer;
    display: flex; align-items: center; justify-content: center; line-height: 1;
  }
  .theme-toggle button:hover { background: var(--color-surface-hover); }

  .app-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; padding: 1rem; }
</style>