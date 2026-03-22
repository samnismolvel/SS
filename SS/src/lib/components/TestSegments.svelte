<script lang="ts">
  import { session } from '$lib/stores/editor'

  let items = $derived($session?.subtitles ?? [])
</script>

<div style="color: white; padding: 1rem;">
  <p>Count: {items.length}</p>
  {#each items as item}
    <p>{item.text}</p>
  {/each}
</div>