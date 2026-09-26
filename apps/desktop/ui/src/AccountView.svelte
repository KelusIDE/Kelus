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

  onMount(() => {
    window.kelus.accountCurrent().then(value => { account = value; if (value) loadProjects(); }).catch(onError);
    const off = window.kelus.onSyncProgress(value => progress = value);
    return () => off();
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
  async function signOut() {
    try { await window.kelus.accountSignOut(); account = null; projects = []; }
    catch (error) { onError(error); }
  }
  async function sync() {
    if (!root) return;
    syncing = true; notice = ''; progress = null;
    try { await window.kelus.cloudSync(); notice = t('account.syncNotice'); await loadProjects(); }
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
    if (value.phase === 'zipping') return t('account.progressZipping', { percent: value.percent ?? 0 });
    if (value.phase === 'uploading') return t('account.progressUploading');
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
        <h2>{t('account.cloudSyncTitle')}</h2>
        <div class="sync-card">
          <p>{root ? t('account.syncDescription', { name: root.split(/[\\/]/).at(-1) || '' }) : t('account.syncNoProject')}</p>
          <button class="source-button primary" onclick={sync} disabled={!root || syncing}>{syncing ? t('account.syncing') : t('account.syncButton')}</button>
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
                <button onclick={() => download(project.id)}>{t('common.download')}</button>
                <button onclick={() => remove(project.id, project.name)}>{t('common.delete')}</button>
              </div>
            </div>
          {/each}
        {/if}
      </section>
    {/if}
  </div>
</div>
