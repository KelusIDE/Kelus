<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from './i18n.svelte';
  import type { AgentConfig, ComputerEvent, ComputerPermissions, ProviderProfile } from './types';

  let { config, profiles, activeProfileId, onChange, onProfilesChanged }: {
    config: AgentConfig; profiles: ProviderProfile[]; activeProfileId: string; onChange: (next: AgentConfig) => void;
    onProfilesChanged: () => Promise<void>;
  } = $props();
  let local = $state<{ installed: boolean; running: boolean; hasModel: boolean; model: string } | null>(null);
  let localProgress = $state<{ status: string; percent?: number; error?: boolean } | null>(null);
  let usingLocal = $derived(profiles.some(p => p.id === config.computer.profileId && /localhost|127\.0\.0\.1/.test(p.modelUrl)));
  async function setupLocal() {
    localProgress = { status: '…' };
    try { await window.kelus.ollamaSetup(); await onProfilesChanged(); local = await window.kelus.ollamaStatus(); localProgress = null; }
    catch (cause) { localProgress = { status: String(cause).replace(/^Error:\s*(Error invoking remote method '[^']+': )?(Error: )?/, ''), error: true }; }
  }

  type LogLine = { kind: 'step' | 'done' | 'failed' | 'stopped' | 'error' | 'invalid'; text: string; detail?: string };
  let permissions = $state<ComputerPermissions | null>(null);
  let running = $state(false);
  let modelName = $state('');
  let dryRun = $state(false);
  let task = $state('');
  let log: LogLine[] = $state([]);
  let preview = $state('');
  let approval = $state<{ description: string; thought: string } | null>(null);
  let error = $state('');
  let logHost: HTMLDivElement | undefined = $state();

  let computer = $derived(config.computer);
  let ready = $derived(!!permissions?.supported && permissions.screen === 'granted' && permissions.accessibility);
  const setComputer = (patch: Partial<AgentConfig['computer']>) => onChange({ ...config, computer: { ...config.computer, ...patch } });

  async function refreshPermissions() { try { permissions = await window.kelus.computerPermissions(); } catch (cause) { error = String(cause); } }
  function push(line: LogLine) { log.push(line); queueMicrotask(() => logHost?.scrollTo({ top: logHost.scrollHeight })); }
  function handle(event: ComputerEvent) {
    if (event.type === 'status') { running = event.running; if (event.model) modelName = event.model; dryRun = !!event.dryRun; if (!event.running) approval = null; }
    else if (event.type === 'screenshot') preview = event.preview;
    else if (event.type === 'step') push({ kind: event.invalid ? 'invalid' : 'step', text: `${event.step}. ${event.description}`, detail: event.thought });
    else if (event.type === 'approval') approval = { description: event.description, thought: event.thought };
    else if (event.type === 'done') push({ kind: 'done', text: `${t('computer.done')}: ${event.summary ?? ''}` });
    else if (event.type === 'failed') push({ kind: 'failed', text: `${t('computer.failed')}: ${event.summary ?? ''}` });
    else if (event.type === 'stopped') { approval = null; push({ kind: 'stopped', text: `${t('computer.stopped')}: ${event.reason}` }); }
    else if (event.type === 'error') push({ kind: 'error', text: event.message });
  }
  async function start() {
    error = ''; log = []; preview = '';
    try { await window.kelus.computerStart(task.trim()); } catch (cause) { error = String(cause).replace(/^Error:\s*(Error invoking remote method '[^']+': )?(Error: )?/, ''); }
  }
  async function decide(approved: boolean) { approval = null; await window.kelus.computerDecide(approved); }

  onMount(() => {
    refreshPermissions();
    window.kelus.ollamaStatus().then(value => local = value).catch(() => undefined);
    const offOllama = window.kelus.onOllamaProgress(event => { if (!event.done) localProgress = { status: event.status, percent: event.percent, error: event.error }; });
    const off = window.kelus.onComputerEvent(handle);
    const onFocus = () => refreshPermissions();
    window.addEventListener('focus', onFocus);
    return () => { off(); offOllama(); window.removeEventListener('focus', onFocus); };
  });
</script>

<div class="computer">
  <label class="allow"><input type="checkbox" checked={computer.enabled} disabled={running} onchange={(e) => setComputer({ enabled: e.currentTarget.checked })}/><strong>{t('computer.allow')}</strong></label>
  <p class="warning">{t('computer.warning')}</p>

  {#if computer.enabled}
    {#if permissions && !permissions.supported}
      <p class="error">{t('computer.unsupported')}</p>
    {:else if permissions}
      <div class="grid">
        <span>{t('computer.screen')}</span>
        {#if permissions.screen === 'granted'}<span class="ok">✓ {t('computer.granted')}</span>{:else}<button onclick={() => window.kelus.computerOpenPermission('screen')}>{t('computer.grant')}</button>{/if}
        <span>{t('computer.accessibility')}</span>
        {#if permissions.accessibility}<span class="ok">✓ {t('computer.granted')}</span>{:else}<button onclick={() => window.kelus.computerOpenPermission('accessibility')}>{t('computer.grant')}</button>{/if}
        <span>{t('computer.model')}</span>
        <select value={computer.profileId || (profiles.find(p => p.id === activeProfileId && p.provider !== 'mock') ?? profiles.find(p => p.provider !== 'mock'))?.id || ''} disabled={running} onchange={(e) => setComputer({ profileId: e.currentTarget.value })}>
          {#each profiles.filter(p => p.provider !== 'mock') as profile (profile.id)}<option value={profile.id}>{profile.name} · {profile.modelName}</option>{/each}
          {#if !profiles.some(p => p.provider !== 'mock')}<option value="">—</option>{/if}
        </select>
        <span>{t('computer.maxSteps')}</span>
        <input type="number" min="1" max="100" value={computer.maxSteps} disabled={running} onchange={(e) => setComputer({ maxSteps: Number(e.currentTarget.value) || 30 })}/>
      </div>
      {#if !usingLocal}
        <div class="free-card">
          <strong>{t('computer.freeTitle')}</strong>
          <p>{t('computer.freeBody', { model: local?.model ?? 'qwen2.5vl:7b' })}</p>
          {#if localProgress && !localProgress.error}
            <div class="free-progress"><div style:width={`${localProgress.percent ?? 0}%`}></div></div>
            <span class="free-status">{localProgress.status}{localProgress.percent != null ? ` · ${localProgress.percent}%` : ''}</span>
          {:else}
            <button onclick={setupLocal} disabled={running}>{local?.hasModel ? t('computer.freeUse') : t('computer.freeSetup')}</button>
            {#if localProgress?.error}<span class="error">{localProgress.status}</span>{/if}
          {/if}
        </div>
      {/if}
      <label class="confirm"><input type="checkbox" checked={computer.confirmEachAction} disabled={running} onchange={(e) => setComputer({ confirmEachAction: e.currentTarget.checked })}/>{t('computer.confirm')}</label>
      {#if !ready}<p class="hint">{t('computer.restartHint')}</p>{/if}
    {/if}

    {#if running}<p class="status">● {t('computer.running', { model: modelName })}{dryRun ? ` — ${t('computer.dryRun')}` : ''}</p>{/if}
    {#if preview}<img class="preview" src={preview} alt="Latest screenshot"/>{/if}
    {#if log.length}
      <div class="log" bind:this={logHost}>
        {#each log as line}<div class="line {line.kind}" title={line.detail}>{line.text}{#if line.detail}<span class="thought">{line.detail}</span>{/if}</div>{/each}
      </div>
    {/if}
    {#if approval}
      <div class="approval">
        <div class="eyebrow">{t('computer.approvalTitle')}</div>
        <strong>{approval.description}</strong>
        {#if approval.thought}<p>{approval.thought}</p>{/if}
        <div class="actions"><button onclick={() => decide(false)}>{t('computer.deny')}</button><button class="approve" onclick={() => decide(true)}>{t('computer.approve')}</button></div>
      </div>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  {/if}
</div>
<div class="task-card">
  <textarea bind:value={task} aria-label={t('computer.placeholder')} placeholder={t('computer.placeholder')} disabled={!computer.enabled || running}></textarea>
  <div class="task-footer">
    <span class="hotkey">⌘⇧Esc</span>
    {#if running}<button class="stop" onclick={() => window.kelus.computerStop()}>■ {t('computer.stop')}</button>
    {:else}<button class="run-button" aria-label={t('computer.start')} title={t('computer.start')} onclick={start} disabled={!computer.enabled || !ready || !task.trim()}>↑</button>{/if}
  </div>
</div>

<style>
  .computer { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
  .allow { display: flex; gap: 8px; align-items: flex-start; color: var(--text-heading); }
  .allow input { margin-top: 2px; }
  .warning { margin: 0; padding: 8px 10px; border-radius: 6px; background: rgba(229, 161, 150, 0.1); color: var(--status-bad); font-size: 11px; line-height: 1.45; }
  .grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; color: var(--text-muted); }
  .grid button { justify-self: start; color: var(--accent); font-size: 11px; }
  .grid select, .grid input { min-width: 0; background: var(--bg-input); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; padding: 2px 4px; }
  .ok { color: var(--status-good); }
  .free-card { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; background: var(--bg-elevated); }
  .free-card p { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .free-card button { align-self: flex-start; padding: 5px 12px; border-radius: 4px; background: var(--accent); color: var(--accent-contrast); font-size: 11px; }
  .free-progress { height: 5px; border-radius: 3px; background: var(--bg-input); overflow: hidden; }
  .free-progress div { height: 100%; background: var(--accent); transition: width 0.3s; }
  .free-status { font-size: 10px; color: var(--text-faint); }
  .confirm { display: flex; gap: 6px; align-items: center; color: var(--text); }
  .hint { margin: 0; color: var(--text-faint); font-size: 11px; }
  .status { margin: 0; color: var(--status-warn); }
  .preview { width: 100%; border-radius: 6px; border: 1px solid var(--border); }
  .log { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; font-family: SFMono-Regular, Consolas, monospace; font-size: 11px; }
  .line { color: var(--text); }
  .line .thought { display: block; color: var(--text-faint); font-family: -apple-system, sans-serif; }
  .line.done { color: var(--status-good); }
  .line.failed, .line.error { color: var(--status-bad); }
  .line.stopped, .line.invalid { color: var(--status-warn); }
  .approval { border: 1px solid var(--accent); border-radius: 8px; padding: 10px; background: var(--bg-elevated); }
  .approval p { margin: 6px 0 0; color: var(--text-muted); font-size: 11px; }
  .eyebrow { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 4px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .actions button { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border); color: var(--text); }
  .actions .approve { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
  .error { margin: 0; color: var(--status-bad); font-size: 11px; white-space: pre-wrap; }
  .hotkey { flex: 1; color: var(--text-faint); font-size: 10px; }
  .stop { color: var(--status-bad); font-size: 11px; padding: 4px 10px; border: 1px solid var(--status-bad); border-radius: 4px; }
</style>
