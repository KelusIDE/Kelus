<script lang="ts">
  import type { Entry } from './types';
  import FileIcon from './FileIcon.svelte';
  export let path = '';
  export let refresh = 0;
  export let openFile: (path: string) => void;
  export let onError: (message: string) => void;
  let entries: Entry[] = [];
  let expanded: Record<string, boolean> = {};
  $: load(path, refresh);
  async function load(folder: string, _refresh: number) {
    try { entries = await window.kelus.listFiles(folder); }
    catch (error) { onError(String(error)); }
  }
  function select(entry: Entry) {
    if (entry.directory) expanded[entry.path] = !expanded[entry.path];
    else openFile(entry.path);
  }
</script>

{#each entries as entry (entry.path)}
  <button class="tree-row" style:padding-left={`${path.split('/').filter(Boolean).length * 14 + 12}px`} onclick={() => select(entry)} title={entry.path}>
    <span class="twisty">{entry.directory ? (expanded[entry.path] ? '⌄' : '›') : ' '}</span>
    <FileIcon name={entry.name} directory={entry.directory}/>
    <span class="file-name">{entry.name}</span>
    {#if entry.git}<span class="git-mark">{entry.git}</span>{/if}
  </button>
  {#if entry.directory && expanded[entry.path]}
    <svelte:self path={entry.path} {refresh} {openFile} {onError}/>
  {/if}
{/each}
