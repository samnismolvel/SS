<script lang="ts">
  import LayoutSection       from './customize/LayoutSection.svelte'
  import TextSection         from './customize/TextSection.svelte'
  import WordHighlightSection from './customize/WordHighlightSection.svelte'
  import AnimationSection    from './customize/AnimationSection.svelte'
  import { activeTemplate }  from '$lib/stores/templates'
  import type { Template }   from '$lib/types'

  type Section = 'layout' | 'text' | 'wordbyword' | 'animation'
  let openSection = $state<Section | null>('text')

  function toggle(s: Section) { openSection = openSection === s ? null : s }

  let templateName = $state('')
  $effect(() => { const u = activeTemplate.subscribe(v => { templateName = v?.name ?? '' }); return u })
</script>

<div class="panel-header">
  <span class="panel-title">Customize</span>
  <span class="panel-subtitle">{templateName}</span>
</div>

<div class="accordion-list">
  <LayoutSection        open={openSection === 'layout'}    ontoggle={() => toggle('layout')} />
  <TextSection          open={openSection === 'text'}      ontoggle={() => toggle('text')} />
  <WordHighlightSection open={openSection === 'wordbyword'} ontoggle={() => toggle('wordbyword')} />
  <AnimationSection     open={openSection === 'animation'} ontoggle={() => toggle('animation')} />
</div>

<style>
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
  }
  .panel-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
  }
  .panel-subtitle {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .accordion-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
</style>