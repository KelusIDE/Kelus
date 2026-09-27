<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import NotebookCellEditor from './NotebookCellEditor.svelte';
  import NotebookOutput from './NotebookOutput.svelte';
  import { joinText, renderMarkdown } from './notebookRender';
  import { t } from './i18n.svelte';
  import type { Interpreter, KernelEvent, KernelState, NotebookOutput as Output } from './types';

  let { path, content, visible, onChange, onTerminal }: {
    path: string; content: string; visible: boolean;
    onChange: (json: string) => void; onTerminal: (command: string) => void;
  } = $props();

  type CellType = 'code' | 'markdown' | 'raw';
  type StoredOutput = Output & { displayId?: string };
  type Cell = {
    uid: string; id?: string; cell_type: CellType; source: string; metadata: Record<string, unknown>; attachments?: unknown;
    outputs: StoredOutput[]; execution_count: number | null; status: 'idle' | 'queued' | 'running'; clearOnNext: boolean; editing: boolean;
  };

  let meta: Record<string, unknown> = {};
  let cells: Cell[] = $state([]);
  let parseError = $state(false);
  let activeUid = $state('');
  let focusRequest = $state({ uid: '', n: 0 });
  let kernelState: KernelState | 'none' = $state('none');
  let kernelMessage = $state('');
  let missing: { packages: string[]; python: string } | null = $state(null);
  let interpreters: Interpreter[] | null = $state(null);
  let python = $state('');
  let lastSeen = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let starting: Promise<boolean> | null = null;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const withIds = () => meta.nbformat === 4 && Number(meta.nbformat_minor) >= 5;
  const blankNotebook = () => ({
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } },
    nbformat: 4, nbformat_minor: 5
  });
  function makeCell(type: CellType, source = ''): Cell {
    return { uid: uid(), id: withIds() ? crypto.randomUUID() : undefined, cell_type: type, source, metadata: {}, outputs: [],
      execution_count: null, status: 'idle', clearOnNext: false, editing: type === 'markdown' };
  }

  function load(text: string) {
    lastSeen = text;
    try {
      if (!text.trim()) { meta = blankNotebook(); cells = [makeCell('code')]; parseError = false; return; }
      const notebook = JSON.parse(text);
      if (!notebook || !Array.isArray(notebook.cells)) throw new Error('not a notebook');
      const { cells: raw, ...rest } = notebook;
      meta = rest;
      cells = raw.map((c: Record<string, any>): Cell => ({
        uid: uid(), id: typeof c.id === 'string' ? c.id : undefined,
        cell_type: c.cell_type === 'markdown' || c.cell_type === 'raw' ? c.cell_type : 'code',
        source: joinText(c.source), metadata: c.metadata ?? {}, attachments: c.attachments,
        outputs: Array.isArray(c.outputs) ? c.outputs : [], execution_count: c.execution_count ?? null,
        status: 'idle', clearOnNext: false, editing: false
      }));
      parseError = false;
    } catch { parseError = true; }
  }
  untrack(() => load(content));

  $effect(() => {
    if (visible && content !== lastSeen) untrack(() => { if (timer) { clearTimeout(timer); timer = null; } load(content); });
  });

  const lines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const splitMime = (key: string) => key.startsWith('text/') || key === 'image/svg+xml' || key === 'application/javascript';
  function cleanOutput(output: StoredOutput): Record<string, unknown> {
    const { displayId: _displayId, ...rest } = output;
    const out: Record<string, unknown> = { ...rest };
    if (typeof out.text === 'string') out.text = lines(out.text);
    if (out.data && typeof out.data === 'object') {
      out.data = Object.fromEntries(Object.entries(out.data as Record<string, unknown>)
        .map(([key, value]) => [key, typeof value === 'string' && splitMime(key) ? lines(value) : value]));
    }
    return out;
  }
  function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(object).sort().filter(k => object[k] !== undefined).map(k => [k, sortKeys(object[k])]));
    }
    return value;
  }
  function serialize(): string {
    cells.forEach(c => { if (!c.id && withIds()) c.id = crypto.randomUUID(); });
    const snapshot = $state.snapshot(cells) as Cell[];
    const notebook = { ...meta, cells: snapshot.map(c => {
      const cell: Record<string, unknown> = { cell_type: c.cell_type, metadata: c.metadata, source: lines(c.source), id: c.id };
      if (c.cell_type === 'markdown' && c.attachments) cell.attachments = c.attachments;
      if (c.cell_type === 'code') { cell.execution_count = c.execution_count; cell.outputs = c.outputs.map(cleanOutput); }
      return cell;
    }) };
    return JSON.stringify(sortKeys(notebook), null, 1) + '\n';
  }
  function markDirty() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 300);
  }
  export function flush() {
    if (!timer) return;
    clearTimeout(timer); timer = null;
    if (parseError) return;
    const json = serialize();
    lastSeen = json;
    onChange(json);
  }

  const findCell = (id: string) => cells.find(c => c.uid === id);
  function handleKernel(e: KernelEvent) {
    if (e.path !== path) return;
    if (e.event === 'status') {
      kernelState = e.state;
      if (e.state === 'dead' || e.state === 'restarting') for (const c of cells) c.status = 'idle';
    } else if (e.event === 'ready') { kernelMessage = ''; missing = null; }
    else if (e.event === 'missing') missing = { packages: e.packages, python: e.python };
    else if (e.event === 'error') kernelMessage = e.message;
    else if (e.event === 'count') {
      const c = findCell(e.cell); if (!c) return;
      c.execution_count = e.count; c.status = 'running'; markDirty();
    } else if (e.event === 'output') {
      const c = findCell(e.cell); if (!c) return;
      if (c.clearOnNext) { c.outputs = []; c.clearOnNext = false; }
      const previous = c.outputs.at(-1);
      if (e.output.output_type === 'stream' && previous?.output_type === 'stream' && previous.name === e.output.name) {
        previous.text = joinText(previous.text) + joinText(e.output.text);
      } else c.outputs.push(e.display_id ? { ...e.output, displayId: e.display_id } : e.output);
      markDirty();
    } else if (e.event === 'update') {
      for (const c of cells) c.outputs.forEach((o, i) => { if (o.displayId === e.display_id) c.outputs[i] = { ...e.output, displayId: e.display_id }; });
      markDirty();
    } else if (e.event === 'clear') {
      const c = findCell(e.cell); if (!c) return;
      if (e.wait) c.clearOnNext = true; else c.outputs = [];
      markDirty();
    } else if (e.event === 'done') {
      const c = findCell(e.cell); if (c) c.status = 'idle';
    }
  }

  function ensureKernel(): Promise<boolean> {
    if (kernelState !== 'none' && kernelState !== 'dead') return Promise.resolve(true);
    starting ??= (async () => {
      kernelState = 'starting'; kernelMessage = ''; missing = null;
      try { python = (await window.kelus.kernelStart(path, python || undefined)).python; return true; }
      catch (error) { kernelMessage = String(error); kernelState = 'dead'; return false; }
      finally { starting = null; }
    })();
    return starting;
  }
  async function runCell(cell: Cell) {
    if (cell.cell_type === 'markdown') { cell.editing = false; return; }
    if (cell.cell_type !== 'code' || !cell.source.trim()) return;
    if (!(await ensureKernel())) return;
    cell.outputs = []; cell.execution_count = null; cell.status = 'queued'; cell.clearOnNext = false; markDirty();
    try { await window.kelus.kernelExecute(path, cell.uid, cell.source); }
    catch (error) { cell.status = 'idle'; kernelMessage = String(error); }
  }
  function focusCell(cell: Cell) {
    activeUid = cell.uid;
    if (cell.cell_type === 'markdown') cell.editing = true;
    focusRequest = { uid: cell.uid, n: focusRequest.n + 1 };
  }
  function insertCell(index: number, type: CellType): Cell {
    cells.splice(index, 0, makeCell(type));
    markDirty();
    return cells[index];
  }
  function onRun(cell: Cell, mode: 'stay' | 'next' | 'insert') {
    runCell(cell);
    const index = cells.findIndex(c => c.uid === cell.uid);
    if (mode === 'next') focusCell(cells[index + 1] ?? insertCell(index + 1, 'code'));
    if (mode === 'insert') focusCell(insertCell(index + 1, 'code'));
  }
  async function runAll() {
    for (const cell of cells) {
      if (cell.cell_type === 'markdown') cell.editing = false;
      else if (cell.cell_type === 'code') await runCell(cell);
    }
  }
  function clearOutputs() {
    for (const c of cells) if (c.cell_type === 'code') { c.outputs = []; c.execution_count = null; }
    markDirty();
  }
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= cells.length) return;
    const [cell] = cells.splice(index, 1);
    cells.splice(target, 0, cell);
    markDirty();
  }
  function remove(index: number) { cells.splice(index, 1); markDirty(); }
  function toggleType(cell: Cell) {
    cell.cell_type = cell.cell_type === 'code' ? 'markdown' : 'code';
    cell.outputs = []; cell.execution_count = null; cell.editing = cell.cell_type === 'markdown';
    markDirty();
  }
  async function interrupt() { try { await window.kelus.kernelInterrupt(path); } catch (error) { kernelMessage = String(error); } }
  async function restart() {
    if (kernelState === 'none' || kernelState === 'dead') { await ensureKernel(); return; }
    try { await window.kelus.kernelRestart(path); } catch (error) { kernelMessage = String(error); }
  }
  async function chooseInterpreter(value: string) {
    python = value;
    if (kernelState === 'none' || kernelState === 'dead') return;
    kernelState = 'starting';
    try { await window.kelus.kernelStart(path, value); } catch (error) { kernelMessage = String(error); kernelState = 'dead'; }
  }
  function installMissing() {
    if (!missing) return;
    const windows = window.kelus.platform === 'win32';
    const quoted = windows ? `& '${missing.python.replace(/'/g, "''")}'` : `'${missing.python.replace(/'/g, `'\\''`)}'`;
    onTerminal(`${quoted} -m pip install ${missing.packages.join(' ')}`);
  }
  const stateLabel: Record<KernelState | 'none', () => string> = {
    none: () => t('notebook.kernelNone'), starting: () => t('notebook.kernelStarting'), idle: () => t('notebook.kernelIdle'),
    busy: () => t('notebook.kernelBusy'), restarting: () => t('notebook.kernelRestarting'), dead: () => t('notebook.kernelDead')
  };
  const languageOf = (type: CellType) => type === 'code' ? 'python' : type === 'markdown' ? 'markdown' : 'plaintext';

  onMount(() => {
    const off = window.kelus.onKernelEvent(handleKernel);
    window.kelus.kernelInterpreters(path)
      .then(list => { interpreters = list; if (!python && list[0]) python = list[0].path; })
      .catch(() => { interpreters = []; });
    return () => { off(); flush(); window.kelus.kernelShutdown(path).catch(() => undefined); };
  });
</script>

<div class="nb">
  <div class="nb-toolbar">
    <button onclick={() => focusCell(insertCell(cells.length, 'code'))}>＋ {t('notebook.addCode')}</button>
    <button onclick={() => focusCell(insertCell(cells.length, 'markdown'))}>＋ {t('notebook.addMarkdown')}</button>
    <span class="nb-sep"></span>
    <button onclick={runAll} disabled={parseError}>▶ {t('notebook.runAll')}</button>
    <button onclick={interrupt} disabled={kernelState !== 'busy'}>■ {t('notebook.interrupt')}</button>
    <button onclick={restart}>↻ {t('notebook.restart')}</button>
    <button onclick={clearOutputs} disabled={parseError}>⌫ {t('notebook.clearOutputs')}</button>
    <div class="nb-kernel">
      <span class="nb-dot {kernelState}"></span><span class="nb-state">{stateLabel[kernelState]()}</span>
      <select title={t('notebook.interpreter')} aria-label={t('notebook.interpreter')} value={python} onchange={(e) => chooseInterpreter(e.currentTarget.value)} disabled={!interpreters?.length}>
        {#if interpreters === null}<option value="">{t('notebook.findingInterpreters')}</option>
        {:else if interpreters.length === 0}<option value="">{t('notebook.noInterpreter')}</option>
        {:else}{#each interpreters as option (option.path)}<option value={option.path} title={option.path}>{option.label} · Python {option.version}</option>{/each}{/if}
      </select>
    </div>
  </div>
  {#if missing}<div class="nb-banner">{t('notebook.missing', { packages: missing.packages.join(', '), python: missing.python })}<button onclick={installMissing}>{t('notebook.install')}</button></div>{/if}
  {#if kernelMessage}<pre class="nb-banner nb-error">{kernelMessage}</pre>{/if}
  {#if parseError}
    <div class="nb-banner nb-error">{t('notebook.parseError')}</div>
  {:else}
    <div class="nb-cells">
      {#each cells as cell, index (cell.uid)}
        <div class="nb-cell" class:active={activeUid === cell.uid} class:running={cell.status !== 'idle'} onfocusin={() => activeUid = cell.uid}>
          <div class="nb-gutter">
            {#if cell.cell_type === 'code'}
              <button class="nb-run" title={t('notebook.runCell')} aria-label={t('notebook.runCell')} onclick={() => runCell(cell)}>▶</button>
              <span class="nb-count">[{cell.status !== 'idle' ? '*' : (cell.execution_count ?? ' ')}]</span>
            {/if}
          </div>
          <div class="nb-body">
            {#if cell.cell_type === 'markdown' && !cell.editing}
              <div class="nb-markdown" role="button" tabindex="0" ondblclick={() => focusCell(cell)} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusCell(cell); } }}>
                {#if cell.source.trim()}{@html renderMarkdown(cell.source)}{:else}<span class="nb-placeholder">{t('notebook.emptyMarkdown')}</span>{/if}
              </div>
            {:else}
              <div class="nb-input">
                {#key cell.cell_type}
                  <NotebookCellEditor value={cell.source} language={languageOf(cell.cell_type)}
                    focusToken={focusRequest.uid === cell.uid ? focusRequest.n : 0}
                    onChange={(value) => { cell.source = value; markDirty(); }}
                    onRun={(mode) => onRun(cell, mode)}
                    onFocus={() => activeUid = cell.uid}
                    onEscape={() => { if (cell.cell_type === 'markdown') cell.editing = false; }}/>
                {/key}
              </div>
            {/if}
            {#if cell.cell_type === 'code' && cell.outputs.length}
              <div class="nb-outputs">{#each cell.outputs as output}<NotebookOutput {output}/>{/each}</div>
            {/if}
          </div>
          <div class="nb-cell-tools">
            {#if cell.cell_type === 'markdown' && cell.editing}<button title={t('notebook.runCell')} aria-label={t('notebook.runCell')} onclick={() => cell.editing = false}>✓</button>{/if}
            <button title={t('notebook.moveUp')} aria-label={t('notebook.moveUp')} disabled={index === 0} onclick={() => move(index, -1)}>↑</button>
            <button title={t('notebook.moveDown')} aria-label={t('notebook.moveDown')} disabled={index === cells.length - 1} onclick={() => move(index, 1)}>↓</button>
            <button title={cell.cell_type === 'code' ? t('notebook.toMarkdown') : t('notebook.toCode')} aria-label={cell.cell_type === 'code' ? t('notebook.toMarkdown') : t('notebook.toCode')} onclick={() => toggleType(cell)}>{cell.cell_type === 'code' ? 'M↓' : '{ }'}</button>
            <button title={t('notebook.deleteCell')} aria-label={t('notebook.deleteCell')} onclick={() => remove(index)}>✕</button>
          </div>
        </div>
        <div class="nb-insert">
          <button onclick={() => focusCell(insertCell(index + 1, 'code'))}>＋ {t('notebook.addCode')}</button>
          <button onclick={() => focusCell(insertCell(index + 1, 'markdown'))}>＋ {t('notebook.addMarkdown')}</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .nb { min-height: 100%; padding-bottom: 120px; color: var(--text); }
  .nb-toolbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 2px; padding: 5px 14px; background: var(--bg-app); border-bottom: 1px solid var(--border); font-size: 11px; flex-wrap: wrap; }
  .nb-toolbar button { padding: 3px 8px; border-radius: 4px; color: var(--text-muted); font-size: 11px; }
  .nb-toolbar button:hover:not(:disabled) { background: var(--bg-elevated); color: var(--text-heading); }
  .nb-toolbar button:disabled { opacity: 0.4; }
  .nb-sep { width: 1px; height: 14px; background: var(--border); margin: 0 6px; }
  .nb-kernel { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--text-muted); }
  .nb-kernel select { max-width: 260px; background: var(--bg-input); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; padding: 2px 4px; }
  .nb-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--text-faint); }
  .nb-dot.idle { background: var(--status-good); border-color: var(--status-good); }
  .nb-dot.busy, .nb-dot.starting, .nb-dot.restarting { background: var(--status-warn); border-color: var(--status-warn); }
  .nb-dot.dead { background: var(--status-bad); border-color: var(--status-bad); }
  .nb-banner { margin: 10px 24px 0; padding: 8px 12px; border-radius: 6px; background: var(--bg-elevated); font-size: 12px; display: flex; align-items: center; gap: 12px; white-space: pre-wrap; font-family: inherit; }
  .nb-banner button { color: var(--accent); font-size: 12px; }
  .nb-error { color: var(--status-bad); }
  .nb-cells { padding: 12px 24px 0 8px; max-width: 1100px; }
  .nb-cell { position: relative; display: flex; gap: 6px; padding: 4px 0; border-left: 2px solid transparent; }
  .nb-cell.active { border-left-color: var(--accent); }
  .nb-gutter { flex: 0 0 52px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; padding-top: 6px; }
  .nb-run { width: 22px; height: 22px; border-radius: 50%; color: var(--text-muted); font-size: 10px; opacity: 0; }
  .nb-cell:hover .nb-run, .nb-cell.active .nb-run { opacity: 1; }
  .nb-run:hover { background: var(--bg-elevated); color: var(--status-good); }
  .nb-count { font-family: SFMono-Regular, Consolas, monospace; font-size: 11px; color: var(--text-faint); }
  .nb-cell.running .nb-count { color: var(--status-warn); }
  .nb-body { flex: 1; min-width: 0; }
  .nb-input { border: 1px solid var(--border); border-radius: 5px; overflow: hidden; background: var(--bg-surface); }
  .nb-cell.active .nb-input { border-color: var(--border-strong); }
  .nb-outputs { padding: 6px 4px 2px; overflow-x: auto; }
  .nb-markdown { padding: 4px 12px; line-height: 1.6; font-size: 13.5px; cursor: default; outline: none; overflow-wrap: anywhere; }
  .nb-markdown :global(h1) { font-size: 1.7em; margin: 0.5em 0 0.3em; color: var(--text-heading); }
  .nb-markdown :global(h2) { font-size: 1.4em; margin: 0.5em 0 0.3em; color: var(--text-heading); }
  .nb-markdown :global(h3), .nb-markdown :global(h4) { font-size: 1.15em; margin: 0.5em 0 0.3em; color: var(--text-heading); }
  .nb-markdown :global(p) { margin: 0.4em 0; }
  .nb-markdown :global(a) { color: var(--accent); }
  .nb-markdown :global(code) { font-family: SFMono-Regular, Consolas, monospace; font-size: 0.9em; background: var(--bg-elevated); padding: 0.1em 0.35em; border-radius: 3px; }
  .nb-markdown :global(pre) { background: var(--bg-surface); padding: 10px 12px; border-radius: 5px; overflow-x: auto; }
  .nb-markdown :global(pre code) { background: none; padding: 0; }
  .nb-markdown :global(table) { border-collapse: collapse; margin: 0.5em 0; }
  .nb-markdown :global(th), .nb-markdown :global(td) { border: 1px solid var(--border); padding: 4px 10px; }
  .nb-markdown :global(blockquote) { margin: 0.5em 0; padding-left: 12px; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
  .nb-markdown :global(img) { max-width: 100%; }
  .nb-markdown :global(.nb-math) { font-family: 'Times New Roman', serif; font-style: italic; }
  .nb-placeholder { color: var(--text-faint); font-style: italic; }
  .nb-cell-tools { position: absolute; top: -6px; right: 4px; z-index: 3; display: none; gap: 1px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 5px; padding: 1px; }
  .nb-cell:hover .nb-cell-tools, .nb-cell.active .nb-cell-tools { display: flex; }
  .nb-cell-tools button { min-width: 22px; height: 20px; padding: 0 4px; font-size: 11px; color: var(--text-muted); border-radius: 3px; }
  .nb-cell-tools button:hover:not(:disabled) { background: var(--bg-active); color: var(--text-heading); }
  .nb-cell-tools button:disabled { opacity: 0.35; }
  .nb-insert { display: flex; justify-content: center; gap: 8px; height: 14px; opacity: 0; transition: opacity 0.1s; }
  .nb-insert:hover { opacity: 1; }
  .nb-insert button { font-size: 10px; color: var(--text-muted); padding: 0 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-app); line-height: 12px; }
  .nb-insert button:hover { color: var(--accent); border-color: var(--accent); }
</style>
