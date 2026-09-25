<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import FileTree from './FileTree.svelte';
  import FileIcon from './FileIcon.svelte';
  import { monaco } from './monaco';
  import type { AgentEvent, RunRecord } from './types';

  type Tab = { path: string; content: string; saved: string };
  let root: string | null = null;
  let tabs: Tab[] = [];
  let active = '';
  let refresh = 0;
  let error = '';
  let task = '';
  let testCommand = '';
  let running = false;
  let events: AgentEvent[] = [];
  let pending: AgentEvent | null = null;
  let summary: RunRecord | null = null;
  let bottom: 'terminal' | 'tests' | 'logs' = 'terminal';
  let terminalCommand = '';
  let explorerVisible = true;
  let agentVisible = true;
  let bottomVisible = true;
  let explorerMenu = false;
  let editorHost: HTMLDivElement;
  let terminalHost: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor;
  let diff: monaco.editor.IStandaloneDiffEditor | null = null;
  let terminal: Terminal;
  let fit: FitAddon;
  let tabModels = new Map<string, monaco.editor.ITextModel>();

  function createEditor() {
    editor = monaco.editor.create(editorHost, { theme: 'kelus', automaticLayout: true, minimap: { enabled: false },
      fontFamily: 'SFMono-Regular, Consolas, monospace', fontSize: 13, padding: { top: 20 },
      scrollBeyondLastLine: false, model: null });
    editor.onDidChangeModelContent(() => {
      const tab = tabs.find(t => t.path === active);
      if (tab && editor.getModel()) { tab.content = editor.getValue(); tabs = [...tabs]; }
    });
  }
  onMount(() => {
    createEditor();
    terminal = new Terminal({ convertEol: true, theme: { background: '#241c13', foreground: '#d7cabb', cursor: '#c7a982' }, fontSize: 12 });
    fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(terminalHost); fit.fit();
    terminal.onData(data => window.kelus.writeTerminal(data));
    const terminalResize = terminal.onResize(({ cols, rows }) => window.kelus.resizeTerminal(cols, rows));
    const offTerminal = window.kelus.onTerminalData(data => terminal.write(data));
    const offAgent = window.kelus.onAgentEvent(handleAgent);
    const observer = new ResizeObserver(() => { fit.fit(); if (diff) diff.layout(); else editor.layout(); });
    observer.observe(editorHost); observer.observe(terminalHost);
    window.kelus.getRoot().then(value => root = value);
    window.kelus.startTerminal(terminal.cols, terminal.rows).catch(report);
    return () => { terminalResize.dispose(); offTerminal(); offAgent(); observer.disconnect(); terminal.dispose(); editor.dispose(); diff?.dispose(); tabModels.forEach(m => m.dispose()); };
  });

  function report(errorValue: unknown) { error = String(errorValue); }
  async function openWorkspace() {
    if (running) return;
    try {
      const value = await window.kelus.openWorkspace();
      if (!value) return;
      root = value; refresh++; closeAll(); terminal.clear(); await window.kelus.startTerminal(terminal.cols, terminal.rows);
    } catch (cause) { report(cause); }
  }
  function closeAll() { tabs = []; active = ''; editor.setModel(null); tabModels.forEach(m => m.dispose()); tabModels.clear(); }
  function language(path: string) {
    const ext = path.split('.').pop()?.toLowerCase();
    return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', json: 'json', css: 'css', html: 'html', md: 'markdown', yml: 'yaml', yaml: 'yaml' } as Record<string, string>)[ext || ''] || 'plaintext';
  }
  async function openFile(path: string) {
    if (pending) return;
    try {
      let tab = tabs.find(t => t.path === path);
      if (!tab) {
        const content = await window.kelus.readFile(path);
        tab = { path, content, saved: content }; tabs = [...tabs, tab];
        tabModels.set(path, monaco.editor.createModel(content, language(path), monaco.Uri.file(path)));
      }
      active = path; editor.setModel(tabModels.get(path)!); editor.focus();
    } catch (cause) { report(cause); }
  }
  async function save() {
    if (pending) return;
    const tab = tabs.find(t => t.path === active);
    if (!tab) return;
    try { await window.kelus.writeFile(tab.path, tab.content); tab.saved = tab.content; tabs = [...tabs]; refresh++; }
    catch (cause) { report(cause); }
  }
  function closeTab(path: string) {
    if (pending) return;
    const tab = tabs.find(t => t.path === path);
    if (tab && tab.content !== tab.saved && !confirm(`Discard unsaved changes to ${path}?`)) return;
    tabs = tabs.filter(t => t.path !== path); tabModels.get(path)?.dispose(); tabModels.delete(path);
    if (active === path) { active = tabs.at(-1)?.path || ''; editor.setModel(active ? tabModels.get(active)! : null); }
  }
  async function entryAction(action: 'file' | 'folder' | 'rename' | 'delete') {
    if (!root) return;
    const label = action === 'rename' || action === 'delete' ? 'Relative path' : 'New relative path';
    const from = prompt(label, active || '')?.trim(); if (!from) return;
    try {
      if (action === 'file' || action === 'folder') await window.kelus.createEntry(from, action === 'folder');
      if (action === 'rename') { const to = prompt('New relative path', from)?.trim(); if (!to) return; await window.kelus.renameEntry(from, to); }
      if (action === 'delete' && confirm(`Delete ${from}? This cannot be undone.`)) await window.kelus.deleteEntry(from);
      refresh++;
    } catch (cause) { report(cause); }
  }
  async function submitTask() {
    if (!task.trim() || !root || running) return;
    error = ''; events = []; summary = null; pending = null; running = true;
    try { await window.kelus.startTask(task.trim(), testCommand.trim()); }
    catch (cause) { running = false; report(cause); }
  }
  function handleAgent(event: AgentEvent) {
    if (event.type === 'approval') { pending = event; showDiff(event); }
    if (event.type === 'summary' && event.record) summary = event.record;
    if (event.type === 'exit') { running = false; pending = null; refresh++; if (active) reloadActive(); }
    if (event.type === 'error') report(event.message);
    events = [...events, event];
  }
  async function reloadActive() {
    const tab = tabs.find(t => t.path === active);
    if (!tab || tab.content !== tab.saved) return;
    try { const content = await window.kelus.readFile(active); tab.content = content; tab.saved = content; tabModels.get(active)?.setValue(content); tabs = [...tabs]; }
    catch { /* File may have been removed outside Kelus. */ }
  }
  function showDiff(proposal: AgentEvent) {
    if (!proposal.path) return;
    diff?.getModel()?.original.dispose(); diff?.getModel()?.modified.dispose(); diff?.dispose(); diff = null;
    editor.dispose(); editorHost.innerHTML = '';
    diff = monaco.editor.createDiffEditor(editorHost, { theme: 'kelus', automaticLayout: true, readOnly: true, renderSideBySide: true });
    const before = monaco.editor.createModel(proposal.before || '', language(proposal.path));
    const after = monaco.editor.createModel(proposal.after || '', language(proposal.path));
    diff.setModel({ original: before, modified: after });
  }
  async function decide(approved: boolean) {
    try { pending = null; diff?.getModel()?.original.dispose(); diff?.getModel()?.modified.dispose(); diff?.dispose(); diff = null;
      editorHost.innerHTML = ''; createEditor(); editor.setModel(active ? tabModels.get(active)! : null); await window.kelus.decide(approved);
    } catch (cause) { report(cause); }
  }
  function onKey(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } }
  function sendTerminalCommand() {
    if (!terminalCommand.trim()) return;
    window.kelus.writeTerminal(terminalCommand + '\r');
    terminalCommand = '';
  }
</script>

<svelte:window onkeydown={onKey}/>
<div class="app-shell" class:mac={window.kelus.platform === 'darwin'}>
  <header class="topbar">
    <div class="title-spacer"></div>
    <div class="title-actions">
      <button aria-label="Back" title="Back" disabled>‹</button>
      <button aria-label="Forward" title="Forward" disabled>›</button>
    </div>
    <button class="command-center" onclick={openWorkspace} disabled={running} title="Open a project folder">
      <span class="command-icon">⌕</span>
      <span>{root ? root.split(/[\\/]/).at(-1) : 'Kelus'}</span>
      <span class="command-shortcut">⌘ O</span>
    </button>
    <div class="title-layout">
      <button class:chosen={explorerVisible} aria-label="Toggle explorer" title="Toggle Explorer" onclick={() => explorerVisible = !explorerVisible}>▣</button>
      <button class:chosen={bottomVisible} aria-label="Toggle bottom panel" title="Toggle Panel" onclick={() => bottomVisible = !bottomVisible}>▤</button>
      <button class:chosen={agentVisible} aria-label="Toggle agents" title="Toggle Agent Room" onclick={() => agentVisible = !agentVisible}>◧</button>
    </div>
  </header>
  <div class="main-grid" class:no-explorer={!explorerVisible} class:no-agent={!agentVisible}>
    <nav class="activity-bar" aria-label="Activity">
      <div class="activity-top">
        <button class:active={explorerVisible} aria-label="Explorer" title="Explorer" onclick={() => explorerVisible = !explorerVisible}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h9l5 5V21H5zM14 2.5V8h5M8 12h8M8 16h8"/></svg>
        </button>
        <button aria-label="Open folder" title="Open Folder" onclick={openWorkspace} disabled={running}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 6.5h7l2 2h10v11h-19zM2.5 6.5v-2h7l2 2"/></svg>
        </button>
        <button class:active={agentVisible} aria-label="Agent Room" title="Agent Room" onclick={() => agentVisible = !agentVisible}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5"/></svg>
        </button>
        <button class:active={bottomVisible} aria-label="Terminal" title="Terminal" onclick={() => { bottomVisible = !bottomVisible; bottom = 'terminal'; }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v16H3zM6 8l3 3-3 3M11 15h6"/></svg>
        </button>
      </div>
      <div class="activity-bottom"><img src="./icon.png" alt="Kelus" title="Kelus"/></div>
    </nav>
    {#if explorerVisible}
      <aside class="explorer">
        <div class="side-title"><span>EXPLORER</span><button aria-label="Explorer actions" title="Explorer actions" onclick={() => explorerMenu = !explorerMenu}>···</button></div>
        {#if explorerMenu}
          <div class="explorer-menu">
            <button onclick={() => { explorerMenu = false; entryAction('file'); }}>New File</button>
            <button onclick={() => { explorerMenu = false; entryAction('folder'); }}>New Folder</button>
            <button onclick={() => { explorerMenu = false; entryAction('rename'); }}>Rename</button>
            <button onclick={() => { explorerMenu = false; entryAction('delete'); }}>Delete</button>
            <button onclick={() => { explorerMenu = false; refresh++; }}>Refresh</button>
          </div>
        {/if}
        <div class="side-section-label">⌄ &nbsp; OPEN EDITORS <span>{tabs.length}</span></div>
        {#each tabs as tab}
          <div class="open-editor" class:selected={active === tab.path}>
            <button class="open-editor-name" onclick={() => openFile(tab.path)}><FileIcon name={tab.path}/>{tab.path.split('/').at(-1)}{tab.content !== tab.saved ? ' ●' : ''}</button>
            <button class="open-editor-close" aria-label={`Close ${tab.path}`} onclick={() => closeTab(tab.path)}>×</button>
          </div>
        {/each}
        <div class="side-section-label project-heading"><span>⌄ &nbsp; {root ? root.split(/[\\/]/).at(-1)?.toUpperCase() : 'NO FOLDER OPEN'}</span><div class="project-actions"><button title="New file" aria-label="New file" onclick={() => entryAction('file')}>＋</button><button title="New folder" aria-label="New folder" onclick={() => entryAction('folder')}>▣</button><button title="Refresh" aria-label="Refresh" onclick={() => refresh++}>↻</button></div></div>
        {#if root}<FileTree {refresh} {openFile} onError={report}/>{:else}<div class="empty-side"><p>You have not yet opened a folder.</p><button onclick={openWorkspace}>Open Folder</button></div>{/if}
      </aside>
    {/if}
    <main class="work-area">
      <div class="tabs">
        {#each tabs as tab}
          <div class="tab-item" class:active={active === tab.path}>
            <button class="tab-name" onclick={() => openFile(tab.path)}><FileIcon name={tab.path}/>{tab.path.split('/').at(-1)}{tab.content !== tab.saved ? ' ●' : ''}</button>
            <button class="tab-close" aria-label={`Close ${tab.path}`} onclick={() => closeTab(tab.path)}>×</button>
          </div>
        {/each}
        {#if tabs.length === 0}<span class="tab-placeholder">No open editors</span>{/if}
        <button class="save-button" title="Save file" onclick={save} disabled={!active || !!pending}>Save</button>
      </div>
      {#if active && !pending}<div class="breadcrumbs">{active.split('/').join('  ›  ')}</div>{/if}
      <div class="editor-wrap"><div bind:this={editorHost} class="editor-host"></div>{#if !active && !pending}<div class="editor-empty"><img class="welcome-mark" src="./icon.png" alt="Kelus icon"/><h2>Kelus</h2><p>Open a file or ask the agents to work on your project.</p><div class="welcome-actions"><button onclick={openWorkspace}>Open Folder</button><button onclick={() => agentVisible = true}>Open Agent Room</button></div></div>{/if}</div>
        <div class="bottom-panel" class:collapsed={!bottomVisible}><div class="bottom-tabs"><button class:active={bottom === 'terminal'} onclick={() => bottom = 'terminal'}>TERMINAL</button><button class:active={bottom === 'tests'} onclick={() => bottom = 'tests'}>TEST OUTPUT</button><button class:active={bottom === 'logs'} onclick={() => bottom = 'logs'}>LOGS</button><div class="panel-tools"><button aria-label="Hide panel" title="Hide Panel" onclick={() => bottomVisible = false}>×</button></div></div><div class="bottom-content"><div class="terminal-section" style:display={bottom === 'terminal' ? 'flex' : 'none'}><div bind:this={terminalHost} class="terminal-host"></div><div class="terminal-command"><span>›</span><input bind:value={terminalCommand} placeholder="Enter a shell command" onkeydown={(event) => { if (event.key === 'Enter') sendTerminalCommand(); }}/><button onclick={sendTerminalCommand}>Run</button></div></div>{#if bottom === 'tests'}<pre>{events.filter(e => e.agent === 'Tester').map(e => JSON.stringify(e.evidence || e.message, null, 2)).join('\n\n') || 'No test run yet.'}</pre>{/if}{#if bottom === 'logs'}<pre>{events.filter(e => e.type === 'log' || e.type === 'error').map(e => e.message).join('\n') || 'No logs.'}</pre>{/if}</div></div>
    </main>
    {#if agentVisible}
      <aside class="agent-panel">
        <div class="agent-heading"><strong>AGENTS</strong><div><span class="live-dot" class:busy={running}></span><button aria-label="Close Agent Room" title="Close Agent Room" onclick={() => agentVisible = false}>×</button></div></div>
        <div class="agent-scroll">
          {#if events.length === 0}<div class="agent-empty"><div class="agent-empty-icon">◇</div><h3>Agent Room</h3><p>Give Kelus a coding task. Agent decisions and evidence will appear here.</p></div>{/if}
          {#if pending}<div class="approval-card"><div class="eyebrow">APPROVAL REQUIRED</div><h3>{pending.path}</h3><p>Review the proposed diff. Approval permits this file write{pending.test_command ? ` and the command: ${pending.test_command}` : ''}.</p><div class="approval-actions"><button onclick={() => decide(false)}>Decline</button><button class="approve" onclick={() => decide(true)}>Approve</button></div></div>{/if}
          {#each events.filter(e => e.type === 'agent') as event}<div class="agent-event"><div class="agent-event-head"><span class="agent-avatar">{event.agent?.slice(0, 1)}</span><strong>{event.agent}</strong><span class="status" class:good={event.status === 'approved' || event.status === 'passed' || event.status === 'complete'} class:bad={event.status === 'failed' || event.status === 'rejected'}>{event.status}</span></div><p>{event.message}</p>{#if event.evidence}<details><summary>Evidence</summary><pre>{JSON.stringify(event.evidence, null, 2)}</pre></details>{/if}</div>{/each}
        </div>
        <details class="verification"><summary>VERIFICATION <span>{summary?.final_outcome || 'Unavailable'}</span></summary><div class="verification-grid"><div class="metric"><span>Test command</span><strong>{summary?.test_exit_code == null ? 'Unavailable' : (summary.test_exit_code === 0 ? 'Passed' : `Failed (${summary.test_exit_code})`)}</strong></div><div class="metric"><span>Tests</span><strong>{summary?.tests_total == null ? 'Unavailable' : `${summary.tests_passed}/${summary.tests_total}`}</strong></div><div class="metric"><span>Security</span><strong>{summary?.security_findings ?? 'Unavailable'}</strong></div><div class="metric"><span>Requirements</span><strong>Unavailable</strong></div><div class="metric"><span>Disagreements</span><strong>{summary?.disagreements ?? 'Unavailable'}</strong></div><div class="metric"><span>Revisions</span><strong>{summary?.revisions ?? 'Unavailable'}</strong></div><div class="metric"><span>Model calls</span><strong>{summary?.model_calls ?? 'Unavailable'}</strong></div><div class="metric"><span>Tokens</span><strong>{summary?.input_tokens == null ? 'Unavailable' : (summary.input_tokens + (summary.output_tokens || 0))}</strong></div><div class="metric"><span>Time</span><strong>{summary?.runtime_seconds == null ? 'Unavailable' : `${summary.runtime_seconds}s`}</strong></div><div class="metric"><span>Cost</span><strong>{summary?.estimated_cost == null ? 'Unavailable' : `$${summary.estimated_cost}`}</strong></div></div></details>
        <div class="task-card"><textarea bind:value={task} aria-label="Coding task" placeholder="Ask Kelus to change your project…"></textarea><div class="task-footer"><input bind:value={testCommand} aria-label="Test command" placeholder="Test command (optional)"/><button class="run-button" aria-label="Run agents" title="Run agents" onclick={submitTask} disabled={!root || running || !task.trim()}>{running ? '···' : '↑'}</button></div></div>
      </aside>
    {/if}
  </div>
  <footer class="statusbar"><span class="status-brand">◇</span><span>{error || (root ? root : 'No folder open')}</span><span class="status-right">{active ? `${language(active)}  •  UTF-8` : ''}</span><span>{running ? '● Agents working' : 'Kelus'}</span></footer>
</div>
