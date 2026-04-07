<script lang="ts">
  import { invoke }          from '@tauri-apps/api/core'
  import { session, isDirty } from '$lib/stores/editor'
  import { activeTemplate }  from '$lib/stores/templates'
  import { buildAss }        from '$lib/utils/ass'
  import type { Template, AspectRatio } from '$lib/types'

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

  // ── Video panel state ──────────────────────────────────────────────────────
  let ratio:  AspectRatio = $state('original')
  let offset: number      = $state(50)

  // ── Derived ────────────────────────────────────────────────────────────────
  let fileName = $derived(
    (sessionVal?.videoPath ?? '').split(/[\\/]/).pop() ?? ''
  )

  // ── Export / burn ──────────────────────────────────────────────────────────
  // We call burn_subtitles directly here so we can pass crop_ratio and
  // crop_offset alongside the ASS content. The parent onburn prop is kept
  // for callers that manage the progress UI externally — we still invoke it
  // after building the payload so existing wiring isn't broken.
  function handleExport() {
    if (!sessionVal || !templateVal) return

    const assContent = buildAss(sessionVal.subtitles, templateVal)

    // Derive the crop_ratio string FFmpeg expects ("9:16", "16:9", etc.)
    // "original" means no crop — pass undefined so Rust uses its None branch.
    const cropRatio  = ratio === 'original' ? undefined : ratio
    const cropOffset = ratio === 'original' ? undefined : offset

    // Notify parent (progress UI, queue status, etc.)
    onburn({ videoPath: sessionVal.videoPath, outputPath: sessionVal.outputPath, assContent })

    // The actual Tauri invoke with crop params.
    // If your parent already calls burn_subtitles itself, remove this block
    // and add crop_ratio / crop_offset to whatever invoke call it makes.
    invoke('burn_subtitles', {
      videoPath:   sessionVal.videoPath,
      outputPath:  sessionVal.outputPath,
      assContent,
      cropRatio,
      cropOffset,
    }).catch((e: unknown) => console.error('burn_subtitles failed:', e))
  }

  function handleSrtExport() { /* TODO: invoke Tauri dialog */ }
  function handleSrtImport() { /* TODO: invoke Tauri dialog */ }
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
      {ratio}
      {offset}
    />
    <EditorSidebar
      {ratio}
      {offset}
      onratiochange={(r) => ratio = r}
      onoffsetchange={(v) => offset = v}
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