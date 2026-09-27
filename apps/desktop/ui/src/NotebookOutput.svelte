<script lang="ts">
  import { onMount } from 'svelte';
  import type { NotebookOutput } from './types';
  import { ansiToHtml, joinText, outputDocument, pickMime, renderMarkdown, terminalText } from './notebookRender';

  let { output }: { output: NotebookOutput } = $props();
  const frameId = Math.random().toString(36).slice(2);

  let rich = $derived(output.output_type === 'display_data' || output.output_type === 'execute_result' ? pickMime(output.data) : null);
  let srcdoc = $derived(rich?.kind === 'html' ? outputDocument(rich.value, frameId) : '');

  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.kelusFrame !== frameId) return;
      const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-frame="${frameId}"]`);
      if (!frame || event.source !== frame.contentWindow) return;
      const height = Number(event.data.height);
      if (Number.isFinite(height) && height > 0) frame.style.height = `${Math.min(height, 5000)}px`;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });
</script>

{#if output.output_type === 'stream'}
  <pre class="nb-out-text" class:stderr={output.name === 'stderr'}>{@html ansiToHtml(terminalText(joinText(output.text)))}</pre>
{:else if output.output_type === 'error'}
  <pre class="nb-out-text nb-out-error">{@html ansiToHtml((output.traceback || []).join('\n') || `${output.ename}: ${output.evalue}`)}</pre>
{:else if rich}
  {#if rich.kind === 'html'}
    <iframe data-frame={frameId} class="nb-out-frame" title="Cell output" sandbox="allow-scripts" {srcdoc}></iframe>
  {:else if rich.kind === 'png' || rich.kind === 'jpeg'}
    <img class="nb-out-image" src={`data:image/${rich.kind};base64,${rich.value}`} alt="Cell output"/>
  {:else if rich.kind === 'svg'}
    <img class="nb-out-image" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(rich.value)}`} alt="Cell output"/>
  {:else if rich.kind === 'markdown'}
    <div class="nb-markdown">{@html renderMarkdown(rich.value)}</div>
  {:else if rich.kind === 'text'}
    <pre class="nb-out-text">{@html ansiToHtml(rich.value)}</pre>
  {:else if rich.kind !== 'none'}
    <pre class="nb-out-text">{rich.value}</pre>
  {/if}
{/if}

<style>
  .nb-out-text { margin: 0; padding: 4px 0; white-space: pre-wrap; word-break: break-word; font-family: SFMono-Regular, Consolas, monospace; font-size: 12.5px; line-height: 1.45; color: var(--text); max-height: 520px; overflow-y: auto; }
  .nb-out-text.stderr { background: rgba(229, 161, 150, 0.08); }
  .nb-out-error { max-height: none; }
  .nb-out-frame { display: block; width: 100%; height: 40px; border: 0; background: transparent; }
  .nb-out-image { display: block; max-width: 100%; margin: 4px 0; background: #fff; border-radius: 2px; }
</style>
