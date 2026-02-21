<script>
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { listen } from '@tauri-apps/api/event';
  import { onDestroy } from 'svelte';

  let queue = [];
  let processing = false;
  let currentVideoIndex = -1;
  let currentStep = '';
  let currentMessage = '';

  const steps = ['extracting', 'transcribing', 'burning', 'done'];

  // Listen for progress events
  const unlisten = listen('progress', (event) => {
    currentStep = event.payload.step;
    currentMessage = event.payload.message;
  });

  onDestroy(() => unlisten.then(f => f()));

  async function addVideos() {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }]
    });
    
    if (selected && Array.isArray(selected)) {
      const newItems = selected.map(path => ({
        id: crypto.randomUUID(),
        inputPath: path,
        outputPath: path.replace(/\.[^/.]+$/, '_subtitled.mp4'),
        status: 'pending', // pending, processing, done, failed
        error: null
      }));
      queue = [...queue, ...newItems];
    }
  }

  function removeFromQueue(id) {
    if (processing) return;
    queue = queue.filter(item => item.id !== id);
  }

  function moveUp(index) {
    if (processing || index === 0) return;
    const temp = queue[index];
    queue[index] = queue[index - 1];
    queue[index - 1] = temp;
    queue = queue;
  }

  function moveDown(index) {
    if (processing || index === queue.length - 1) return;
    const temp = queue[index];
    queue[index] = queue[index + 1];
    queue[index + 1] = temp;
    queue = queue;
  }

  async function processQueue() {
    if (queue.length === 0 || processing) return;

    processing = true;

    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status === 'done') continue;

      currentVideoIndex = i;
      queue[i].status = 'processing';
      queue[i].error = null;
      queue = queue;

      currentStep = '';
      currentMessage = '';

      try {
        await invoke('process_video', {
          videoPath: queue[i].inputPath,
          outputPath: queue[i].outputPath
        });
        queue[i].status = 'done';
      } catch (e) {
        queue[i].status = 'failed';
        queue[i].error = e;
      }
      queue = queue;
    }

    processing = false;
    currentVideoIndex = -1;
    currentStep = '';
    currentMessage = '';
  }

  function clearCompleted() {
    if (processing) return;
    queue = queue.filter(item => item.status !== 'done');
  }

  function stepIndex(step) {
    return steps.indexOf(step);
  }

  function getFileName(path) {
    return path.split(/[\\/]/).pop();
  }
</script>

<main>
  <h1>Video Subtitle Burner</h1>

  <div class="container">
    <div class="queue-header">
      <button on:click={addVideos} disabled={processing} class="add-btn">
        + Add Videos
      </button>
      <button on:click={clearCompleted} disabled={processing || queue.every(q => q.status !== 'done')} class="clear-btn">
        Clear Completed
      </button>
      <button on:click={processQueue} disabled={processing || queue.length === 0} class="process-btn">
        {processing ? 'Processing...' : `Process Queue (${queue.length})`}
      </button>
    </div>

    {#if queue.length === 0}
      <div class="empty-state">
        <p>No videos in queue</p>
        <p class="hint">Click "Add Videos" to get started</p>
      </div>
    {/if}

    {#if queue.length > 0}
      <div class="queue-list">
        {#each queue as item, index (item.id)}
          <div class="queue-item" class:active={index === currentVideoIndex}>
            <div class="item-main">
              <div class="status-indicator" class:pending={item.status === 'pending'} 
                   class:processing={item.status === 'processing'} 
                   class:done={item.status === 'done'} 
                   class:failed={item.status === 'failed'}>
              </div>
              <div class="item-info">
                <div class="item-name">{getFileName(item.inputPath)}</div>
                <div class="item-path">{item.inputPath}</div>
                {#if item.status === 'failed'}
                  <div class="item-error">Error: {item.error}</div>
                {/if}
              </div>
              <div class="item-actions">
                <button on:click={() => moveUp(index)} disabled={processing || index === 0} title="Move up">↑</button>
                <button on:click={() => moveDown(index)} disabled={processing || index === queue.length - 1} title="Move down">↓</button>
                <button on:click={() => removeFromQueue(item.id)} disabled={processing} class="remove-btn" title="Remove">×</button>
              </div>
            </div>

            {#if index === currentVideoIndex && processing}
              <div class="progress-section">
                <div class="steps">
                  {#each [['extracting', 'Extract'], ['transcribing', 'Transcribe'], ['burning', 'Burn'], ['done', 'Done']] as [step, label]}
                    <div class="step" class:active={currentStep === step} 
                         class:completed={stepIndex(currentStep) > stepIndex(step) || currentStep === 'done' && step !== 'done'}>
                      <div class="step-dot"></div>
                      <span>{label}</span>
                    </div>
                  {/each}
                </div>
                <p class="step-message">{currentMessage}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</main>

<style>
  main {
    padding: 2rem;
    max-width: 800px;
    margin: 0 auto;
    font-family: system-ui, -apple-system, sans-serif;
  }

  h1 {
    color: #333;
    margin-bottom: 2rem;
  }

  .container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .queue-header {
    display: flex;
    gap: 0.75rem;
  }

  button {
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.9rem;
  }

  .add-btn {
    background: #0066cc;
    color: white;
  }

  .add-btn:hover:not(:disabled) { background: #0052a3; }

  .clear-btn {
    background: #666;
    color: white;
  }

  .clear-btn:hover:not(:disabled) { background: #555; }

  .process-btn {
    background: #22c55e;
    color: white;
    margin-left: auto;
  }

  .process-btn:hover:not(:disabled) { background: #16a34a; }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    color: #999;
  }

  .empty-state .hint {
    font-size: 0.9rem;
    margin-top: 0.5rem;
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .queue-item {
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
    transition: all 0.2s;
  }

  .queue-item.active {
    border-color: #0066cc;
    box-shadow: 0 2px 8px rgba(0, 102, 204, 0.1);
  }

  .item-main {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .status-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-indicator.pending { background: #ccc; }
  .status-indicator.processing { background: #0066cc; animation: pulse 1.5s infinite; }
  .status-indicator.done { background: #22c55e; }
  .status-indicator.failed { background: #ef4444; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .item-info {
    flex: 1;
    min-width: 0;
  }

  .item-name {
    font-weight: 600;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-path {
    font-size: 0.8rem;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-error {
    font-size: 0.8rem;
    color: #ef4444;
    margin-top: 0.25rem;
  }

  .item-actions {
    display: flex;
    gap: 0.25rem;
  }

  .item-actions button {
    width: 32px;
    height: 32px;
    padding: 0;
    background: #f5f5f5;
    color: #666;
    font-size: 1rem;
  }

  .item-actions button:hover:not(:disabled) {
    background: #e5e5e5;
  }

  .item-actions .remove-btn {
    color: #ef4444;
    font-size: 1.5rem;
    line-height: 1;
  }

  .item-actions .remove-btn:hover:not(:disabled) {
    background: #fee;
  }

  .progress-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #eee;
  }

  .steps {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    position: relative;
  }

  .steps::before {
    content: '';
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    height: 2px;
    background: #ddd;
    z-index: 0;
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: #999;
    z-index: 1;
  }

  .step-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    border: 2px solid #ddd;
  }

  .step.active .step-dot {
    background: #0066cc;
    border-color: #0066cc;
  }

  .step.active {
    color: #0066cc;
    font-weight: 600;
  }

  .step.completed .step-dot {
    background: #22c55e;
    border-color: #22c55e;
  }

  .step.completed { color: #22c55e; }

  .step-message {
    font-size: 0.85rem;
    color: #555;
    text-align: center;
    margin: 0;
  }
</style>