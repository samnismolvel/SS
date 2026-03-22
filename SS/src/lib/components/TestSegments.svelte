<script lang="ts">
  import { session } from '$lib/stores/editor'
  import { get } from 'svelte/store'

  // Use $state + $effect instead of $derived with store
  let items = $state<any[]>([])

  $effect(() => {
    const unsub = session.subscribe(val => {
      items = val?.subtitles ?? []
    })
    return unsub
  })
</script>

<div style="color: white; padding: 1rem;">
  <p>Count: {items.length}</p>
  {#each items as item}
    <p>{item.text}</p>
  {/each}
</div>