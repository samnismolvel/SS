<script>
  import { createEventDispatcher } from 'svelte';

  export let srtContent = '';
  export let videoPath = '';

  const dispatch = createEventDispatcher();

  let subtitles = [];
  let searchTerm = '';
  let replaceTerm = '';
  let findMode = 'all';

  // Style settings
  let fontName = 'Arial';
  let fontSize = 24;
  let primaryColor = '#FFFFFF';
  let outlineColor = '#000000';
  let alignment = 2; // Number, not string
  let wordByWord = false;

  $: parseSRT(srtContent);

  function parseSRT(content) {
    const blocks = content.trim().split(/\n\n+/);
    subtitles = blocks.map(block => {
      const lines = block.split('\n');
      const index = parseInt(lines[0]);
      const [start, end] = lines[1].split(' --> ');
      const text = lines.slice(2).join('\n');
      return { index, start, end, text, originalText: text };
    });
  }

  function serializeSRT() {
    return subtitles.map(sub => 
      `${sub.index}\n${sub.start} --> ${sub.end}\n${sub.text}`
    ).join('\n\n') + '\n';
  }

  function updateSubtitle(index, newText) {
    subtitles[index].text = newText;
  }

  function findAndReplace() {
    if (!searchTerm) return;

    let count = 0;
    subtitles = subtitles.map(sub => {
      if (findMode === 'all') {
        const regex = new RegExp(searchTerm, 'gi');
        if (regex.test(sub.text)) {
          count++;
          return { ...sub, text: sub.text.replace(regex, replaceTerm) };
        }
      } else {
        if (sub.text.includes(searchTerm)) {
          count++;
          return { ...sub, text: sub.text.replace(searchTerm, replaceTerm) };
        }
      }
      return sub;
    });

    alert(`Replaced ${count} occurrence(s)`);
  }

  function resetSubtitle(index) {
    subtitles[index].text = subtitles[index].originalText;
  }

  function saveAndBurn() {
    const finalSRT = serializeSRT();
    dispatch('save', { 
      srtContent: finalSRT,
      fontName,
      fontSize: Number(fontSize),
      primaryColor,
      outlineColor,
      alignment: Number(alignment),
      wordByWord
    });
  }

  function cancel() {
    dispatch('cancel');
  }
</script>

<div class="editor-container">
  <div class="editor-header">
    <h2>Edit Subtitles</h2>
    <div class="header-info">
      <span class="video-name">{videoPath.split(/[\\/]/).pop()}</span>
      <span class="subtitle-count">{subtitles.length} subtitles</span>
    </div>
  </div>

  <div class="find-replace-bar">
    <input type="text" bind:value={searchTerm} placeholder="Find text..." />
    <input type="text" bind:value={replaceTerm} placeholder="Replace with..." />
    <select bind:value={findMode}>
      <option value="single">First match</option>
      <option value="all">All matches</option>
    </select>
    <button on:click={findAndReplace}>Replace</button>
  </div>

  <div class="style-bar">
    <div class="style-group">
      <label>
        <input type="checkbox" bind:checked={wordByWord} />
        Word-by-Word (TikTok style)
      </label>
    </div>

    <div class="style-group">
      <label>Font</label>
      <select bind:value={fontName}>
        <option value="Arial">Arial</option>
        <option value="Times New Roman">Times New Roman</option>
        <option value="Courier New">Courier New</option>
        <option value="Comic Sans MS">Comic Sans MS</option>
        <option value="Impact">Impact</option>
        <option value="Verdana">Verdana</option>
      </select>
    </div>

    <div class="style-group">
      <label>Size</label>
      <input type="number" bind:value={fontSize} min="12" max="72" />
    </div>

    <div class="style-group">
      <label>Text Color</label>
      <input type="color" bind:value={primaryColor} />
    </div>

    <div class="style-group">
      <label>Outline</label>
      <input type="color" bind:value={outlineColor} />
    </div>

    <div class="style-group">
      <label for="alignment-select">Position</label>
      <select id="alignment-select" bind:value={alignment}>
        <option value={1}>Bottom Left</option>
        <option value={2}>Bottom Center</option>
        <option value={3}>Bottom Right</option>
        <option value={4}>Middle Left</option>
        <option value={5}>Middle Center</option>
        <option value={6}>Middle Right</option>
        <option value={7}>Top Left</option>
        <option value={8}>Top Center</option>
        <option value={9}>Top Right</option>
      </select>
    </div>
  </div>

  <div class="subtitles-list">
    {#each subtitles as subtitle, index (subtitle.index)}
      <div class="subtitle-item">
        <div class="subtitle-header">
          <span class="subtitle-index">#{subtitle.index}</span>
          <span class="subtitle-timing">{subtitle.start} → {subtitle.end}</span>
          {#if subtitle.text !== subtitle.originalText}
            <button class="reset-btn" on:click={() => resetSubtitle(index)} title="Reset to original">↺</button>
          {/if}
        </div>
        <textarea 
          value={subtitle.text}
          on:input={(e) => updateSubtitle(index, e.target.value)}
          rows="2"
        ></textarea>
      </div>
    {/each}
  </div>

  <div class="editor-footer">
    <button class="cancel-btn" on:click={cancel}>Cancel</button>
    <button class="save-btn" on:click={saveAndBurn}>Save & Burn Subtitles</button>
  </div>
</div>

<style>
  .editor-container {
    display: flex;
    flex-direction: column;
    height: 70vh;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    overflow: hidden;
  }

  .editor-header {
    padding: 1.25rem;
    border-bottom: 1px solid #eee;
    background: #f9f9f9;
  }

  .editor-header h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
    color: #333;
  }

  .header-info {
    display: flex;
    gap: 1rem;
    font-size: 0.85rem;
    color: #666;
  }

  .video-name {
    font-weight: 500;
  }

  .subtitle-count {
    color: #999;
  }

  .find-replace-bar {
    padding: 1rem;
    display: flex;
    gap: 0.5rem;
    border-bottom: 1px solid #eee;
    background: #fafafa;
  }

  .find-replace-bar input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .find-replace-bar select {
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .find-replace-bar button {
    padding: 0.5rem 1rem;
    background: #0066cc;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .find-replace-bar button:hover {
    background: #0052a3;
  }

  .style-bar {
    padding: 1rem;
    display: flex;
    gap: 1rem;
    border-bottom: 1px solid #eee;
    background: white;
    flex-wrap: wrap;
  }

  .style-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .style-group label {
    font-size: 0.75rem;
    font-weight: 500;
    color: #666;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .style-group input[type="checkbox"] {
    width: auto;
  }

  .style-group select,
  .style-group input[type="number"] {
    padding: 0.4rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .style-group input[type="color"] {
    height: 32px;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
  }

  .style-group input[type="number"] {
    width: 60px;
  }

  .subtitles-list {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }

  .subtitle-item {
    margin-bottom: 1rem;
    padding: 0.75rem;
    border: 1px solid #eee;
    border-radius: 6px;
    background: white;
  }

  .subtitle-item:hover {
    border-color: #ccc;
  }

  .subtitle-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
  }

  .subtitle-index {
    font-weight: 600;
    color: #666;
  }

  .subtitle-timing {
    color: #999;
    font-family: monospace;
  }

  .reset-btn {
    margin-left: auto;
    padding: 0.25rem 0.5rem;
    background: #f0f0f0;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
  }

  .reset-btn:hover {
    background: #e0e0e0;
  }

  textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.9rem;
    resize: vertical;
    min-height: 3rem;
  }

  textarea:focus {
    outline: none;
    border-color: #0066cc;
  }

  .editor-footer {
    padding: 1rem;
    border-top: 1px solid #eee;
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    background: #f9f9f9;
  }

  .editor-footer button {
    padding: 0.6rem 1.5rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .cancel-btn {
    background: #666;
    color: white;
  }

  .cancel-btn:hover {
    background: #555;
  }

  .save-btn {
    background: #22c55e;
    color: white;
  }

  .save-btn:hover {
    background: #16a34a;
  }
</style>