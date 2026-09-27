<script lang="ts">
  import { onMount } from 'svelte';
  import FileIcon from './FileIcon.svelte';
  import RemoteTree from './RemoteTree.svelte';
  import { listRemote, openRemote } from './liveshare.svelte';
  import type { Entry } from './types';

  let { dir = '', depth = 0, onError }: { dir?: string; depth?: number; onError: (error: unknown) => void } = $props();
  let entries = $state<Entry[]>([]);
  let expanded = $state<Record<string, boolean>>({});

  onMount(() => { listRemote(dir).then(list => entries = list).catch(onError); });
  function open(entry: Entry) {
    if (entry.directory) expanded[entry.path] = !expanded[entry.path];
    else openRemote(entry.path).catch(onError);
  }
</script>

{#each entries as entry (entry.path)}
  <button class="tree-row" style:padding-left={`${depth * 14 + 12}px`} title={entry.path} onclick={() => open(entry)}>
    <span class="twisty">{entry.directory ? (expanded[entry.path] ? '⌄' : '›') : ' '}</span>
    <FileIcon name={entry.name} directory={entry.directory} expanded={Boolean(expanded[entry.path])}/>
    <span class="file-name">{entry.name}</span>
  </button>
  {#if entry.directory && expanded[entry.path]}<RemoteTree dir={entry.path} depth={depth + 1} {onError}/>{/if}
{/each}
