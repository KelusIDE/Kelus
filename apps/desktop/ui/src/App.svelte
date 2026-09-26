<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import FileTree from './FileTree.svelte';
  import FileIcon from './FileIcon.svelte';
  import SourceControl from './SourceControl.svelte';
  import SettingsView from './SettingsView.svelte';
  import AccountView from './AccountView.svelte';
  import { monaco, applyEditorTheme, terminalTheme } from './monaco';
  import { language } from './language';
  import { t, setLocale } from './i18n.svelte';
  import type { AgentEvent, RunRecord, Settings, Theme } from './types';

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
  let sideMode: 'explorer' | 'source' = 'explorer';
  let settingsOpen = false;
  let accountOpen = false;
  let settings: Settings | null = null;
  let theme: Theme = 'warm';
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
    editor = monaco.editor.create(editorHost, { theme: `kelus-${theme}`, automaticLayout: true, minimap: { enabled: false },
      fontFamily: 'SFMono-Regular, Consolas, monospace', fontSize: 13, padding: { top: 20 },
      scrollBeyondLastLine: false, model: null });
    editor.onDidChangeModelContent(() => {
      const tab = tabs.find(t => t.path === active);
      if (tab && editor.getModel()) { tab.content = editor.getValue(); tabs = [...tabs]; }
    });
  }
  onMount(() => {
    createEditor();
    terminal = new Terminal({ convertEol: true, theme: terminalTheme(theme), fontSize: 12 });
    fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(terminalHost); fit.fit();
    terminal.onData(data => window.kelus.writeTerminal(data));
    const terminalResize = terminal.onResize(({ cols, rows }) => window.kelus.resizeTerminal(cols, rows));
    const offTerminal = window.kelus.onTerminalData(data => terminal.write(data));
    const offAgent = window.kelus.onAgentEvent(handleAgent);
    const observer = new ResizeObserver(() => { fit.fit(); if (diff) diff.layout(); else editor.layout(); });
    observer.observe(editorHost); observer.observe(terminalHost);
    window.kelus.getRoot().then(value => root = value);
    window.kelus.getSettings().then(value => { settings = value; setTheme(value.theme); setLocale(value.locale); }).catch(report);
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
  function setTheme(value: Theme) { theme = value; document.documentElement.dataset.theme = value; applyEditorTheme(value); if (terminal) terminal.options.theme = terminalTheme(value); }
  async function openSettings() { try { settings = await window.kelus.getSettings(); settingsOpen = true; accountOpen = false; } catch (cause) { report(cause); } }
  function closeSettings() { settingsOpen = false; if (settings) { setTheme(settings.theme); setLocale(settings.locale); } }
  function connectGithub() {
    bottom = 'terminal'; bottomVisible = true;
    window.kelus.writeTerminal('gh auth login -h github.com -p https -w && gh auth setup-git\r');
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
    diff = monaco.editor.createDiffEditor(editorHost, { theme: `kelus-${theme}`, automaticLayout: true, readOnly: true, renderSideBySide: true });
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
  function kindLabel(kind: string): string {
    if (kind === 'claim') return t('agentPanel.kindClaim');
    if (kind === 'evidence') return t('agentPanel.kindEvidence');
    if (kind === 'counterargument') return t('agentPanel.kindCounterargument');
    if (kind === 'decision') return t('agentPanel.kindDecision');
    return kind;
  }
</script>

<svelte:window onkeydown={onKey}/>
<div class="app-shell" class:mac={window.kelus.platform === 'darwin'}>
  <header class="topbar">
    <div class="title-spacer"></div>
    <div class="title-actions">
      <button aria-label={t('topbar.back')} title={t('topbar.back')} disabled>‹</button>
      <button aria-label={t('topbar.forward')} title={t('topbar.forward')} disabled>›</button>
    </div>
    <button class="command-center" onclick={openWorkspace} disabled={running} title={t('topbar.openFolderTitle')}>
      <span class="command-icon">⌕</span>
      <span>{root ? root.split(/[\\/]/).at(-1) : 'Kelus'}</span>
      <span class="command-shortcut">⌘ O</span>
    </button>
    <div class="title-layout">
      <button class:chosen={explorerVisible} aria-label={t('topbar.toggleExplorer')} title={t('topbar.toggleExplorer')} onclick={() => explorerVisible = !explorerVisible}>▣</button>
      <button class:chosen={bottomVisible} aria-label={t('topbar.togglePanel')} title={t('topbar.togglePanel')} onclick={() => bottomVisible = !bottomVisible}>▤</button>
      <button class:chosen={agentVisible} aria-label={t('topbar.toggleAgentRoom')} title={t('topbar.toggleAgentRoom')} onclick={() => agentVisible = !agentVisible}>◧</button>
    </div>
  </header>
  <div class="main-grid" class:no-explorer={!explorerVisible} class:no-agent={!agentVisible}>
    <nav class="activity-bar" aria-label="Activity">
      <div class="activity-top">
        <button class:active={explorerVisible && sideMode === 'explorer'} aria-label={t('sidebar.explorer')} title={t('sidebar.explorer')} onclick={() => { explorerVisible = true; sideMode = 'explorer'; }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h9l5 5V21H5zM14 2.5V8h5M8 12h8M8 16h8"/></svg>
        </button>
        <button class:active={explorerVisible && sideMode === 'source'} aria-label={t('sidebar.sourceControl')} title={t('sidebar.sourceControl')} onclick={() => { explorerVisible = true; sideMode = 'source'; }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="16" r="2"/><path d="M7 7v10m0-4c0-4 10 0 10-5v6"/></svg>
        </button>
        <button aria-label={t('sidebar.openFolder')} title={t('sidebar.openFolder')} onclick={openWorkspace} disabled={running}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 6.5h7l2 2h10v11h-19zM2.5 6.5v-2h7l2 2"/></svg>
        </button>
        <button class:active={agentVisible} aria-label={t('sidebar.agentRoom')} title={t('sidebar.agentRoom')} onclick={() => agentVisible = !agentVisible}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5"/></svg>
        </button>
        <button class:active={bottomVisible} aria-label={t('sidebar.terminal')} title={t('sidebar.terminal')} onclick={() => { bottomVisible = !bottomVisible; bottom = 'terminal'; }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v16H3zM6 8l3 3-3 3M11 15h6"/></svg>
        </button>
      </div>
      <div class="activity-bottom"><button aria-label={t('sidebar.account')} title={t('sidebar.account')} class:active={accountOpen} onclick={() => { accountOpen = true; settingsOpen = false; }}>◍</button><button aria-label={t('sidebar.settings')} title={t('sidebar.settings')} class:active={settingsOpen} onclick={openSettings}>⚙</button><img src="./icon.png" alt="Kelus" title="Kelus"/></div>
    </nav>
    {#if explorerVisible}
      {#if sideMode === 'source'}<aside class="explorer">{#key root}<SourceControl {root} onError={report} onChanged={() => refresh++} onConnect={connectGithub}/>{/key}</aside>{:else}<aside class="explorer">
        <div class="side-title"><span>{t('explorer.title')}</span><button aria-label={t('explorer.actionsTitle')} title={t('explorer.actionsTitle')} onclick={() => explorerMenu = !explorerMenu}>···</button></div>
        {#if explorerMenu}
          <div class="explorer-menu">
            <button onclick={() => { explorerMenu = false; entryAction('file'); }}>{t('explorer.newFile')}</button>
            <button onclick={() => { explorerMenu = false; entryAction('folder'); }}>{t('explorer.newFolder')}</button>
            <button onclick={() => { explorerMenu = false; entryAction('rename'); }}>{t('explorer.rename')}</button>
            <button onclick={() => { explorerMenu = false; entryAction('delete'); }}>{t('explorer.delete')}</button>
            <button onclick={() => { explorerMenu = false; refresh++; }}>{t('explorer.refresh')}</button>
          </div>
        {/if}
        <div class="side-section-label">⌄ &nbsp; {t('explorer.openEditors')} <span>{tabs.length}</span></div>
        {#each tabs as tab}
          <div class="open-editor" class:selected={active === tab.path}>
            <button class="open-editor-name" onclick={() => openFile(tab.path)}><FileIcon name={tab.path}/>{tab.path.split('/').at(-1)}{tab.content !== tab.saved ? ' ●' : ''}</button>
            <button class="open-editor-close" aria-label={t('explorer.closeTab', { path: tab.path })} onclick={() => closeTab(tab.path)}>×</button>
          </div>
        {/each}
        <div class="side-section-label project-heading"><span>⌄ &nbsp; {root ? root.split(/[\\/]/).at(-1)?.toUpperCase() : t('explorer.noFolderOpen')}</span><div class="project-actions"><button title={t('explorer.newFileShort')} aria-label={t('explorer.newFileShort')} onclick={() => entryAction('file')}>＋</button><button title={t('explorer.newFolderShort')} aria-label={t('explorer.newFolderShort')} onclick={() => entryAction('folder')}>▣</button><button title={t('explorer.refresh')} aria-label={t('explorer.refresh')} onclick={() => refresh++}>↻</button></div></div>
        {#if root}<FileTree {refresh} {openFile} onError={report}/>{:else}<div class="empty-side"><p>{t('explorer.emptyMessage')}</p><button onclick={openWorkspace}>{t('common.openFolder')}</button></div>{/if}
      </aside>
      {/if}
    {/if}
    <main class="work-area">
      <div class="tabs">
        {#each tabs as tab}
          <div class="tab-item" class:active={active === tab.path}>
            <button class="tab-name" onclick={() => openFile(tab.path)}><FileIcon name={tab.path}/>{tab.path.split('/').at(-1)}{tab.content !== tab.saved ? ' ●' : ''}</button>
            <button class="tab-close" aria-label={t('explorer.closeTab', { path: tab.path })} onclick={() => closeTab(tab.path)}>×</button>
          </div>
        {/each}
        {#if tabs.length === 0}<span class="tab-placeholder">{t('tabs.empty')}</span>{/if}
        <button class="save-button" title={t('tabs.saveTitle')} onclick={save} disabled={!active || !!pending}>{t('common.save')}</button>
      </div>
      {#if active && !pending}<div class="breadcrumbs">{active.split('/').join('  ›  ')}</div>{/if}
      <div class="editor-wrap"><div bind:this={editorHost} class="editor-host"></div>{#if !active && !pending && !settingsOpen && !accountOpen}<div class="editor-empty"><img class="welcome-mark" src="./icon.png" alt="Kelus icon"/><h2>Kelus</h2><p>{t('editorEmpty.subtitle')}</p><div class="welcome-actions"><button onclick={openWorkspace}>{t('common.openFolder')}</button><button onclick={() => agentVisible = true}>{t('editorEmpty.openAgentRoom')}</button></div></div>{/if}{#if settingsOpen && settings}<SettingsView {settings} onSaved={(value) => { settings = value; setTheme(value.theme); setLocale(value.locale); }} onClose={closeSettings} onPreview={setTheme} onPreviewLocale={setLocale}/>{/if}{#if accountOpen}<AccountView {root} onError={report} onClose={() => accountOpen = false}/>{/if}</div>
        <div class="bottom-panel" class:collapsed={!bottomVisible}><div class="bottom-tabs"><button class:active={bottom === 'terminal'} onclick={() => bottom = 'terminal'}>{t('bottomPanel.terminal')}</button><button class:active={bottom === 'tests'} onclick={() => bottom = 'tests'}>{t('bottomPanel.testOutput')}</button><button class:active={bottom === 'logs'} onclick={() => bottom = 'logs'}>{t('bottomPanel.logs')}</button><div class="panel-tools"><button aria-label={t('bottomPanel.hide')} title={t('bottomPanel.hide')} onclick={() => bottomVisible = false}>×</button></div></div><div class="bottom-content"><div class="terminal-section" style:display={bottom === 'terminal' ? 'flex' : 'none'}><div bind:this={terminalHost} class="terminal-host"></div><div class="terminal-command"><span>›</span><input bind:value={terminalCommand} placeholder={t('bottomPanel.terminalPlaceholder')} onkeydown={(event) => { if (event.key === 'Enter') sendTerminalCommand(); }}/><button onclick={sendTerminalCommand}>{t('common.run')}</button></div></div>{#if bottom === 'tests'}<pre>{events.filter(e => e.agent === 'Tester').map(e => JSON.stringify(e.evidence || e.message, null, 2)).join('\n\n') || t('bottomPanel.noTestRun')}</pre>{/if}{#if bottom === 'logs'}<pre>{events.filter(e => e.type === 'log' || e.type === 'error').map(e => e.message).join('\n') || t('bottomPanel.noLogs')}</pre>{/if}</div></div>
    </main>
    {#if agentVisible}
      <aside class="agent-panel">
        <div class="agent-heading"><strong>{t('agentPanel.title')}</strong><div><span class="live-dot" class:busy={running}></span><button aria-label={t('agentPanel.close')} title={t('agentPanel.close')} onclick={() => agentVisible = false}>×</button></div></div>
        <div class="agent-scroll">
          {#if events.length === 0}<div class="agent-empty"><div class="agent-empty-icon">◇</div><h3>{t('agentPanel.emptyTitle')}</h3><p>{t('agentPanel.emptyBody')}</p></div>{/if}
          {#if pending}<div class="approval-card"><div class="eyebrow">{t('agentPanel.approvalRequired')}</div><h3>{pending.path}</h3><p>{pending.test_command ? t('agentPanel.approvalDescriptionWithCommand', { command: pending.test_command }) : t('agentPanel.approvalDescription')}</p><div class="approval-actions"><button onclick={() => decide(false)}>{t('common.decline')}</button><button class="approve" onclick={() => decide(true)}>{t('common.approve')}</button></div></div>{/if}
          {#each events.filter(e => e.type === 'agent') as event}<div class="agent-event" class:debate={event.debate}><div class="agent-event-head"><span class="agent-avatar">{event.agent?.slice(0, 1)}</span><strong>{event.agent}</strong>{#if event.kind}<span class="kind-tag {event.kind}">{kindLabel(event.kind)}</span>{/if}<span class="status" class:good={event.status === 'approved' || event.status === 'passed' || event.status === 'complete'} class:bad={event.status === 'failed' || event.status === 'rejected'}>{event.status}</span></div><p class:debate-text={event.debate}>{event.message}</p>{#if event.evidence}<details><summary>{t('agentPanel.evidenceSummary')}</summary><pre>{JSON.stringify(event.evidence, null, 2)}</pre></details>{/if}</div>{/each}
        </div>
        <details class="verification"><summary>{t('verification.title')} <span>{summary?.final_outcome || t('verification.unavailable')}</span></summary><div class="verification-grid"><div class="metric"><span>{t('verification.testCommand')}</span><strong>{summary?.test_exit_code == null ? t('verification.unavailable') : (summary.test_exit_code === 0 ? t('verification.passed') : t('verification.failed', { code: summary.test_exit_code }))}</strong></div><div class="metric"><span>{t('verification.tests')}</span><strong>{summary?.tests_total == null ? t('verification.unavailable') : `${summary.tests_passed}/${summary.tests_total}`}</strong></div><div class="metric"><span>{t('verification.security')}</span><strong>{summary?.security_findings ?? t('verification.unavailable')}</strong></div><div class="metric"><span>{t('verification.requirements')}</span><strong>{t('verification.unavailable')}</strong></div><div class="metric"><span>{t('verification.disagreements')}</span><strong>{summary?.disagreements ?? t('verification.unavailable')}</strong></div><div class="metric"><span>{t('verification.revisions')}</span><strong>{summary?.revisions ?? t('verification.unavailable')}</strong></div><div class="metric"><span>{t('verification.modelCalls')}</span><strong>{summary?.model_calls ?? t('verification.unavailable')}</strong></div><div class="metric"><span>{t('verification.tokens')}</span><strong>{summary?.input_tokens == null ? t('verification.unavailable') : (summary.input_tokens + (summary.output_tokens || 0))}</strong></div><div class="metric"><span>{t('verification.time')}</span><strong>{summary?.runtime_seconds == null ? t('verification.unavailable') : `${summary.runtime_seconds}s`}</strong></div><div class="metric"><span>{t('verification.cost')}</span><strong>{summary?.estimated_cost == null ? t('verification.unavailable') : `$${summary.estimated_cost}`}</strong></div></div></details>
        <div class="task-card"><textarea bind:value={task} aria-label={t('agentPanel.taskPlaceholder')} placeholder={t('agentPanel.taskPlaceholder')}></textarea><div class="task-footer"><input bind:value={testCommand} aria-label={t('agentPanel.testCommandPlaceholder')} placeholder={t('agentPanel.testCommandPlaceholder')}/><button class="run-button" aria-label={t('agentPanel.runAgents')} title={t('agentPanel.runAgents')} onclick={submitTask} disabled={!root || running || !task.trim()}>{running ? '···' : '↑'}</button></div></div>
      </aside>
    {/if}
  </div>
  <footer class="statusbar"><span class="status-brand">◇</span><span>{error || (root ? root : t('statusbar.noFolderOpen'))}</span><span class="status-right">{active ? `${language(active)}  •  UTF-8` : ''}</span><span>{running ? `● ${t('statusbar.agentsWorking')}` : 'Kelus'}</span></footer>
</div>
