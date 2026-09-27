<script lang="ts">
  import { onMount } from 'svelte';
  import type { GitSnapshot, GitHubStatus } from './types';
  import { t } from './i18n.svelte';
  let { root, onError, onChanged, onConnect }: { root: string | null; onError: (error: unknown) => void; onChanged: () => void; onConnect: () => void } = $props();
  let status: GitSnapshot | null = $state(null);
  let github: GitHubStatus | null = $state(null);
  let selected: string[] = $state([]);
  let message = $state('');
  let originUrl = $state('');
  let busy = $state(false);
  let notice = $state('');
  onMount(() => { refresh(); });
  async function refresh() {
    if (!root) return;
    try { status = await window.kelus.gitStatus(); github = await window.kelus.githubStatus(); selected = status.changes.map(change => change.path); originUrl = status.remote; }
    catch (error) { onError(error); }
  }
  function toggle(path: string) { selected = selected.includes(path) ? selected.filter(item => item !== path) : [...selected, path]; }
  async function init() { busy = true; try { status = await window.kelus.gitInit(); notice = t('sourceControl.noticeInit'); onChanged(); } catch (error) { onError(error); } finally { busy = false; } }
  async function commit() {
    busy = true; notice = '';
    try { status = await window.kelus.gitCommit(message, $state.snapshot(selected)); message = ''; selected = status.changes.map(change => change.path); notice = t('sourceControl.noticeCommit'); onChanged(); }
    catch (error) { onError(error); } finally { busy = false; }
  }
  async function saveOrigin() {
    busy = true; notice = '';
    try { status = await window.kelus.gitSetOrigin(originUrl); notice = t('sourceControl.noticeOrigin'); }
    catch (error) { onError(error); } finally { busy = false; }
  }
  async function push() {
    if (!confirm(t('sourceControl.pushConfirm', { branch: status?.branch || 'current branch' }))) return;
    busy = true; notice = '';
    try { await window.kelus.gitPush(); notice = t('sourceControl.noticePush'); await refresh(); }
    catch (error) { onError(error); } finally { busy = false; }
  }
</script>

<div class="source-control">
  <div class="side-title"><span>{t('sourceControl.title')}</span><button title={t('sourceControl.refreshTitle')} aria-label={t('sourceControl.refreshTitle')} onclick={refresh}>↻</button></div>
  {#if !root}<div class="empty-side">{t('sourceControl.emptyNoFolder')}</div>
  {:else if !status}<div class="empty-side">{t('sourceControl.loadingStatus')}</div>
  {:else if !status.repository}<div class="source-section"><p>{t('sourceControl.notRepo')}</p><button class="source-button" onclick={init} disabled={busy}>{t('sourceControl.initRepo')}</button></div>
  {:else}
    <div class="source-section"><div class="source-branch">⑂ &nbsp; {status.branch || t('sourceControl.noBranch')}</div>
      <textarea class="commit-message" bind:value={message} placeholder={t('sourceControl.commitPlaceholder')} aria-label={t('sourceControl.commitPlaceholder')}></textarea>
      <button class="source-button primary" onclick={commit} disabled={busy || !message.trim() || selected.length === 0}>{t('sourceControl.commitButton')}</button>
      <button class="source-button" onclick={push} disabled={busy || !status.remote || !status.branch}>{t('sourceControl.pushButton')}</button>
      <label class="origin-label" for="origin-url">{t('sourceControl.originLabel')}</label><input id="origin-url" class="origin-input" bind:value={originUrl} placeholder="https://github.com/user/repo.git" spellcheck="false"/>
      <button class="source-button" onclick={saveOrigin} disabled={busy || !originUrl.trim() || originUrl === status.remote}>{status.remote ? t('sourceControl.updateOrigin') : t('sourceControl.addOrigin')}</button>
    </div>
    <div class="side-section-label"><span>{t('sourceControl.changesTitle')}</span><span>{status.changes.length}</span></div>
    <div class="source-changes">{#each status.changes as change}<label class="source-change"><input type="checkbox" checked={selected.includes(change.path)} onchange={() => toggle(change.path)}/><span title={change.path}>{change.path}</span><em>{change.status.trim() || '?'}</em></label>{:else}<p class="source-hint">{t('sourceControl.workingTreeClean')}</p>{/each}</div>
  {/if}
  {#if root}<div class="github-section"><div class="side-section-label">{t('sourceControl.githubAccount')}</div>
    {#if github?.connected}<p>{t('sourceControl.connectedAs', { username: github.username })}</p>
    {:else if github?.cliAvailable}<p>{t('sourceControl.connectPrompt')}</p><button class="source-button" onclick={onConnect}>{t('sourceControl.signInGithub')}</button><button class="source-link" onclick={refresh}>{t('sourceControl.checkConnection')}</button>
    {:else}<p>{t('sourceControl.cliRequired')}</p><button class="source-button" onclick={() => window.kelus.githubDownload()}>{t('sourceControl.getCli')}</button><button class="source-link" onclick={refresh}>{t('sourceControl.checkAgain')}</button>{/if}
  </div>{/if}
  {#if notice}<p class="source-notice" role="status">{notice}</p>{/if}
</div>
