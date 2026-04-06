<script lang="ts">
  import { session, isDirty } from '$lib/stores/editor'
  import { activeTemplate }  from '$lib/stores/templates'
  import { buildAss }        from '$lib/utils/ass'
  import type { Template }   from '$lib/types'

  import EditorTopbar  from './editor/EditorTopbar.svelte'
  import VideoPlayer   from './editor/VideoPlayer.svelte'
  import EditorSidebar from './editor/EditorSidebar.svelte'

  interface Props {
    onburn:   (detail: { videoPath: string; outputPath: string; assContent: string }) => void
    oncancel: () => void
  }
  let { onburn, oncancel }: Props = $props()

  // ── Store values ───────────────────────────────────────────────────────────
  let sessionVal  = $state(null as any)
  let isDirtyVal  = $state(false)
  let templateVal = $state(null as Template | null)

  $effect(() => {
    const u1 = session.subscribe(v  => { sessionVal  = v })
    const u2 = isDirty.subscribe(v  => { isDirtyVal  = v })
    const u3 = activeTemplate.subscribe(v => { templateVal = v })
    return () => { u1(); u2(); u3() }
  })

  // ── Derived helpers ────────────────────────────────────────────────────────
  let fileName = $derived(
    (sessionVal?.videoPath ?? '').split(/[\\/]/).pop() ?? ''
  )

  // ── Actions ────────────────────────────────────────────────────────────────
  function handleExport() {
    if (!sessionVal || !templateVal) return
    const assContent = buildAss(sessionVal.subtitles, templateVal)
    onburn({ videoPath: sessionVal.videoPath, outputPath: sessionVal.outputPath, assContent })
  }

  // SRT export / import — wire up to your Tauri dialog calls here
  function handleSrtExport() { /* TODO: invoke('export_srt', ...) */ }
  function handleSrtImport() { /* TODO: invoke('import_srt', ...) */ }
</script>

<svelte:head>
  <style>
    @keyframes sub-fade     { from{opacity:0} to{opacity:1} }
    @keyframes sub-pop      { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
    @keyframes sub-slide-up { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
  </style>
</svelte:head>

<div class="editor">
  <EditorTopbar
    {fileName}
    isDirty={isDirtyVal}
    onback={oncancel}
    onexport={handleExport}
  />

  <div class="body">
    <VideoPlayer
      videoPath={sessionVal?.videoPath ?? ''}
      subtitles={sessionVal?.subtitles ?? []}
      selectedIndex={sessionVal?.selectedIndex ?? null}
      template={templateVal}
    />
    <EditorSidebar
      onsrtexport={handleSrtExport}
      onsrtimport={handleSrtImport}
    />
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-bg);
    font-size: 0.82rem;
  }
  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
</style>