<script>
  import { invoke } from '@tauri-apps/api/core';
  import { open, save } from '@tauri-apps/plugin-dialog';
  
  let videoPath = '';
  let outputPath = '';
  let processing = false;
  let progress = '';
  let error = '';

  async function selectVideo() {
    const selected = await open({
      filters: [{
        name: 'Video',
        extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm']
      }]
    });
    if (selected) {
      videoPath = selected;
      // Auto-suggest output path
      outputPath = videoPath.replace(/\.[^/.]+$/, '_subtitled.mp4');
    }
  }

  async function selectOutput() {
    const selected = await save({
      filters: [{
        name: 'Video',
        extensions: ['mp4']
      }],
      defaultPath: outputPath
    });
    if (selected) {
      outputPath = selected;
    }
  }

  async function processVideo() {
    if (!videoPath || !outputPath) {
      error = 'Please select both input and output paths';
      return;
    }

    processing = true;
    error = '';
    progress = 'Starting transcription...';

    try {
      await invoke('process_video', {
        videoPath,
        outputPath
      });
      progress = 'Complete! Video saved to: ' + outputPath;
    } catch (e) {
      error = 'Error: ' + e;
      progress = '';
    } finally {
      processing = false;
    }
  }
</script>

<main>
  <h1>Video Subtitle Burner</h1>
  
  <div class="container">
    <div class="file-section">
      <label for="input-video">Input Video:</label>
      <div class="file-input">
        <input id="input-video" type="text" readonly value={videoPath} placeholder="No file selected" />
        <button on:click={selectVideo}>Browse</button>
      </div>
    </div>

    <div class="file-section">
      <label for="output-video">Output Video:</label>
      <div class="file-input">
        <input id="output-video" type="text" bind:value={outputPath} placeholder="Output path" />
        <button on:click={selectOutput}>Browse</button>
      </div>
    </div>

    <button 
      class="process-btn" 
      on:click={processVideo} 
      disabled={processing || !videoPath}
    >
      {processing ? 'Processing...' : 'Generate Subtitled Video'}
    </button>

    {#if progress}
      <div class="progress">{progress}</div>
    {/if}

    {#if error}
      <div class="error">{error}</div>
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

  button:hover:not(:disabled) {
    background: #0052a3;
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .process-btn {
    margin-top: 1rem;
    padding: 0.75rem;
    font-size: 1rem;
  }

  .progress {
    padding: 1rem;
    background: #e7f3ff;
    border-left: 4px solid #0066cc;
    color: #333;
  }

  .error {
    padding: 1rem;
    background: #ffe7e7;
    border-left: 4px solid #cc0000;
    color: #cc0000;
  }
</style>