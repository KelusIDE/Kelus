<script lang="ts">
  import { onMount } from 'svelte';
  import type { Account, CloudProject, SyncProgress } from './types';
  import { t } from './i18n.svelte';
  let { root, onClose, onError }: { root: string | null; onClose: () => void; onError: (error: unknown) => void } = $props();

  let account: Account = $state(null);
  let mode: 'sign-in' | 'sign-up' = $state('sign-in');
  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let busy = $state(false);
  let formError = $state('');

  let projects: CloudProject[] = $state([]);
  let loadingProjects = $state(false);
  let syncing = $state(false);
  let progress: SyncProgress | null = $state(null);
  let notice = $state('');
  let github: { login: string } | null = $state(null);
  let githubCode: { userCode: string; verificationUri: string } | null = $state(null);
  let githubError = $state('');
  let copied = $state(false);

  onMount(() => {
    window.kelus.accountCurrent().then(value => { account = value; if (value) loadProjects(); }).catch(onError);
    window.kelus.githubAccount().then(value => github = value).catch(onError);
    const off = window.kelus.onSyncProgress(value => progress = value);
    const offGithub = window.kelus.onGithubConnect(event => {
      githubCode = null;
      if (event.status === 'connected') github = { login: event.login }; else githubError = event.message;
    });
    return () => { off(); offGithub(); };
  });

  async function loadProjects() {
    loadingProjects = true;
    try { projects = await window.kelus.cloudList(); }
    catch (error) { onError(error); }
    finally { loadingProjects = false; }
  }

  async function submit() {
    formError = ''; busy = true;
    try {
      account = mode === 'sign-up'
        ? await window.kelus.accountSignUp(email.trim(), password, displayName.trim())
        : await window.kelus.accountSignIn(email.trim(), password);
      password = '';
      if (account) await loadProjects();
    } catch (error) { formError = String(error).replace(/^Error:\s*/, ''); }
    finally { busy = false; }
  }
  let browserProvider: 'google' | 'github' | null = $state(null);
  async function signInWithBrowser(provider: 'google' | 'github') {
    formError = ''; browserProvider = provider;
    try { account = await window.kelus.accountSignInWithBrowser(provider); if (account) await loadProjects(); }
    catch (error) { const message = String(error).replace(/^Error:\s*(Error invoking remote method '[^']+': )?(Error: )?/, ''); if (!/cancelled/.test(message)) formError = message; }
    finally { browserProvider = null; }
  }
  const cleanError = (error: unknown) => String(error).replace(/^Error:\s*(Error invoking remote method '[^']+': )?(Error: )?/, '');
  async function connectGithub() {
    githubError = ''; copied = false;
    try { githubCode = await window.kelus.githubConnect(); }
    catch (error) { githubError = cleanError(error); }
  }
  async function copyCode() {
    if (!githubCode) return;
    try { await navigator.clipboard.writeText(githubCode.userCode); copied = true; } catch { /* the code stays visible to type by hand */ }
  }
  async function cancelGithub() { githubCode = null; await window.kelus.githubCancelConnect(); }
  async function disconnectGithub() { await window.kelus.githubDisconnect(); github = null; }
  async function signOut() {
    try { await window.kelus.accountSignOut(); account = null; projects = []; }
    catch (error) { onError(error); }
  }
  async function sync() {
    if (!root) return;
    syncing = true; notice = ''; progress = null;
    try {
      const result = await window.kelus.cloudSync();
      notice = result.changed ? t('account.syncNotice') : t('account.syncUnchanged');
      if (result.skipped.length) notice += ' ' + t('account.syncSkipped', { count: result.skipped.length, files: result.skipped.slice(0, 3).join(', ') });
      await loadProjects();
    }
    catch (error) { onError(error); }
    finally { syncing = false; progress = null; }
  }
  async function download(id: string) {
    try { const destination = await window.kelus.cloudDownload(id); if (destination) notice = t('account.downloadedTo', { destination }); }
    catch (error) { onError(error); }
  }
  async function remove(id: string, name: string) {
    if (!confirm(t('account.deleteConfirm', { name }))) return;
    try { await window.kelus.cloudDelete(id); await loadProjects(); }
    catch (error) { onError(error); }
  }
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024, index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
    return `${value.toFixed(1)} ${units[index]}`;
  }
  function progressLabel(value: SyncProgress | null): string {
    if (!value) return '';
    if (value.phase === 'preparing') return t('account.progressPreparing');
    if (value.phase === 'pushing') return t('account.progressPushing');
    if (value.phase === 'writing-record') return t('account.progressSaving');
    return t('account.progressDone');
  }
</script>

<div class="settings-view account-view">
  <div class="settings-header"><div><h1>{t('account.title')}</h1><p>{t('account.subtitle')}</p></div><button aria-label={t('account.close')} onclick={onClose}>×</button></div>
  <div class="settings-content">
    {#if !account}
      <section class="settings-group">
        <h2>{mode === 'sign-up' ? t('account.createTitle') : t('account.signInTitle')}</h2>
        {#if browserProvider}
          <div class="account-browser"><span>{t('account.browserWaiting')}</span><button onclick={() => window.kelus.accountCancelBrowser()}>{t('account.cancel')}</button></div>
        {:else}
          <div class="account-providers">
            <button class="provider" onclick={() => signInWithBrowser('google')} disabled={busy}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>{t('account.continueGoogle')}</button>
            <button class="provider" onclick={() => signInWithBrowser('github')} disabled={busy}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z"/></svg>{t('account.continueGithub')}</button>
          </div>
          <div class="account-divider"><span>{t('account.orEmail')}</span></div>
        {/if}
        <form class="account-form" onsubmit={(event) => { event.preventDefault(); submit(); }}>
          {#if mode === 'sign-up'}<input bind:value={displayName} placeholder={t('account.namePlaceholder')} autocomplete="name"/>{/if}
          <input bind:value={email} type="email" placeholder={t('account.emailPlaceholder')} autocomplete="email" required/>
          <input bind:value={password} type="password" placeholder={t('account.passwordPlaceholder')} autocomplete={mode === 'sign-up' ? 'new-password' : 'current-password'} required minlength="6"/>
          <div class="account-form-actions">
            <button class="primary" type="submit" disabled={busy}>{busy ? t('common.pleaseWait') : mode === 'sign-up' ? t('account.createButton') : t('account.signInButton')}</button>
            {#if formError}<span class="error-text">{formError}</span>{/if}
          </div>
        </form>
        <p class="account-switch">
          {#if mode === 'sign-up'}{t('account.hasAccount')} <button onclick={() => { mode = 'sign-in'; formError = ''; }}>{t('account.signInButton')}</button>
          {:else}{t('account.newToKelus')} <button onclick={() => { mode = 'sign-up'; formError = ''; }}>{t('account.createAccountLink')}</button>{/if}
        </p>
      </section>
    {:else}
      <div class="account-summary">
        <div><strong>{account.displayName || account.email}</strong><span>{account.email}</span></div>
        <button class="source-button" onclick={signOut}>{t('account.signOut')}</button>
      </div>
      <section class="settings-group">
        <h2>GitHub</h2>
        {#if github}
          <div class="sync-card"><p>{t('account.githubConnected', { login: github.login })}</p><button class="source-button" onclick={disconnectGithub}>{t('account.githubDisconnect')}</button></div>
        {:else if githubCode}
          <div class="github-code">
            <p>{t('account.githubEnterCode')}</p>
            <div class="github-code-row"><code>{githubCode.userCode}</code><button class="source-button" onclick={copyCode}>{copied ? t('account.githubCopied') : t('account.githubCopy')}</button></div>
            <p class="settings-hint">{t('account.githubWaiting')} <a href={githubCode.verificationUri} target="_blank" rel="noopener">{githubCode.verificationUri}</a></p>
            <button class="source-button" onclick={cancelGithub}>{t('account.cancel')}</button>
          </div>
        {:else}
          <div class="sync-card"><p>{t('account.githubNeeded')}</p><button class="source-button primary" onclick={connectGithub}>{t('account.githubConnect')}</button></div>
        {/if}
        {#if githubError}<p class="error-text">{githubError}</p>{/if}
      </section>
      <section class="settings-group">
        <h2>{t('account.cloudSyncTitle')}</h2>
        <div class="sync-card">
          <p>{root ? t('account.syncDescription', { name: root.split(/[\\/]/).at(-1) || '' }) : t('account.syncNoProject')}</p>
          <button class="source-button primary" onclick={sync} disabled={!root || !github || syncing}>{syncing ? t('account.syncing') : t('account.syncButton')}</button>
        </div>
        {#if progress}<p class="settings-hint">{progressLabel(progress)}</p>{/if}
        {#if notice}<p class="notice-text">{notice}</p>{/if}
      </section>
      <section class="settings-group">
        <h2>{t('account.projectsTitle')}</h2>
        {#if loadingProjects}<p class="settings-hint">{t('common.loading')}</p>
        {:else if projects.length === 0}<p class="settings-hint">{t('account.noProjects')}</p>
        {:else}
          {#each projects as project (project.id)}
            <div class="cloud-project">
              <div><div class="cloud-project-name">{project.name}</div><div class="cloud-project-meta">{formatSize(project.sizeBytes)} · updated {new Date(project.updatedAt).toLocaleString()}</div></div>
              <div class="cloud-project-actions">
                {#if project.repoUrl.startsWith('https://github.com/')}<a href={project.repoUrl} target="_blank" rel="noopener">{t('account.openOnGithub')}</a>{/if}
                <button onclick={() => download(project.id)} disabled={!github}>{t('common.download')}</button>
                <button onclick={() => remove(project.id, project.name)}>{t('account.removeFromList')}</button>
              </div>
            </div>
          {/each}
        {/if}
      </section>
    {/if}
  </div>
</div>
