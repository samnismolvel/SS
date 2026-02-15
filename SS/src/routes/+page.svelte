<script>
  import { invoke } from '@tauri-apps/api/core';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { listen } from '@tauri-apps/api/event';
  import { onDestroy } from 'svelte';

  let videoPath = '';
  let outputPath = '';
  let processing = false;
  let error = '';
  let currentStep = '';
  let currentMessage = '';

  const steps = ['extracting', 'transcribing', 'burning', 'done'];

  // Listen for progress events from Rust
  const unlisten = listen('progress', (event) => {
    currentStep = event.payload.step;
    currentMessage = event.payload.message;
  });

  // Cleanup listener on component destroy
  onDestroy(() => unlisten.then(f => f()));

  async function selectVideo() {
    const selected = await open({
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }]
    });
    if (selected) {
      videoPath = selected;
      outputPath = videoPath.replace(/\.[^/.]+$/, '_subtitled.mp4');
    }
  }

  async function selectOutput() {
    const selected = await save({
      filters: [{ name: 'Video', extensions: ['mp4'] }],
      defaultPath: outputPath
    });
    if (selected) outputPath = selected;
  }

  async function processVideo() {
    if (!videoPath || !outputPath) {
      error = 'Please select both input and output paths.';
      return;
    }

    processing = true;
    error = '';
    currentStep = '';
    currentMessage = '';

    try {
      await invoke('process_video', { videoPath, outputPath });
    } catch (e) {
      error = e;
      currentStep = '';
      currentMessage = '';
    } finally {
      processing = false;
    }
  }

  function stepIndex(step) {
    return steps.indexOf(step);
  }
</script>

<main>
  <h1>Video Subtitle Burner</h1>

  <div class="container">
    <div class="file-section">
      <label for="input-video">Input Video:</label>
      <div class="file-input">
        <input id="input-video" type="text" readonly value={videoPath} placeholder="No file selected" />
        <button on:click={selectVideo} disabled={processing}>Browse</button>
      </div>
    </div>

    <div class="file-section">
      <label for="output-video">Output Video:</label>
      <div class="file-input">
        <input id="output-video" type="text" bind:value={outputPath} placeholder="Output path" />
        <button on:click={selectOutput} disabled={processing}>Browse</button>
      </div>
    </div>

    <button class="process-btn" on:click={processVideo} disabled={processing || !videoPath}>
      {processing ? 'Processing...' : 'Generate Subtitled Video'}
    </button>

    {#if processing || currentStep === 'done'}
      <div class="progress-section">
        <div class="steps">
          {#each [['extracting', 'Extract Audio'], ['transcribing', 'Transcribe'], ['burning', 'Burn Subtitles'], ['done', 'Done']] as [step, label]}
            <div class="step" class:active={currentStep === step} class:completed={stepIndex(currentStep) > stepIndex(step) || currentStep === 'done' && step !== 'done'}>
              <div class="step-dot"></div>
              <span>{label}</span>
            </div>
          {/each}
        </div>
        <p class="step-message">{currentMessage}</p>
      </div>
    {/if}

    {#if currentStep === 'done' && !processing}
      <div class="success">
        ✅ Video saved to: {outputPath}
      </div>
    {/if}

    {#if error}
      <div class="error">⚠️ {error}</div>
    {/if}
  </div>
</main>

<style>
  main {
    padding: 2rem;
    max-width: 600px;
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

  .file-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-weight: 500;
    color: #555;
  }

  .file-input {
    display: flex;
    gap: 0.5rem;
  }

  input[type="text"] {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #f9f9f9;
  }

  button {
    padding: 0.5rem 1rem;
    background: #0066cc;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  button:hover:not(:disabled) { background: #0052a3; }
  button:disabled { background: #ccc; cursor: not-allowed; }

  .process-btn {
    margin-top: 0.5rem;
    padding: 0.75rem;
    font-size: 1rem;
  }

  .progress-section {
    padding: 1rem;
    background: #f5f5f5;
    border-radius: 8px;
  }

  .steps {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1rem;
    position: relative;
  }

  .steps::before {
    content: '';
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    height: 2px;
    background: #ddd;
    z-index: 0;
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: #999;
    z-index: 1;
  }

  .step-dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ddd;
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
    font-size: 0.9rem;
    color: #555;
    text-align: center;
    margin: 0;
  }

  .success {
    padding: 1rem;
    background: #e7ffe7;
    border-left: 4px solid #22c55e;
    color: #166534;
    border-radius: 4px;
  }

  .error {
    padding: 1rem;
    background: #ffe7e7;
    border-left: 4px solid #cc0000;
    color: #cc0000;
    border-radius: 4px;
  }
</style>