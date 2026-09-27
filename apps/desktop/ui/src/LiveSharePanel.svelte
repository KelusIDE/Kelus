<script lang="ts">
  import RemoteTree from './RemoteTree.svelte';
  import { t } from './i18n.svelte';
  import { approveRequest, denyRequest, joinSession, leaveSession, live, startHosting, stopHosting } from './liveshare.svelte';

  let { root, onError }: { root: string | null; onError: (error: unknown) => void } = $props();
  let code = $state('');
  let copied = $state(false);
  let busy = $state(false);

  async function share() { busy = true; await startHosting(root?.split(/[\\/]/).at(-1) || 'project'); busy = false; }
  async function copy() { try { await navigator.clipboard.writeText(live.code); copied = true; setTimeout(() => copied = false, 1500); } catch { /* code stays visible */ } }
</script>

<div class="live">
  <div class="side-title"><span>{t('live.title')}</span></div>
  <div class="live-body">
    {#if live.role === 'none'}
      <p class="live-hint">{t('live.intro')}</p>
      <button class="source-button primary" onclick={share} disabled={!root || busy}>{t('live.share')}</button>
      <p class="live-hint">{root ? t('live.shareHint') : t('live.noFolder')}</p>
      <div class="live-section">{t('live.joinTitle')}</div>
      <form class="live-join" onsubmit={(e) => { e.preventDefault(); if (code.trim()) joinSession(code); }}>
        <input bind:value={code} placeholder="ABCD-2345" aria-label={t('live.codePlaceholder')} autocomplete="off" spellcheck="false"/>
        <button class="source-button" type="submit" disabled={!code.trim()}>{t('live.join')}</button>
      </form>
    {:else if live.role === 'joining'}
      <p class="live-status">{live.status}</p>
      <button class="source-button" onclick={leaveSession}>{t('live.cancel')}</button>
    {:else}
      {#if live.role === 'host'}
        <div class="live-section">{t('live.inviteCode')}</div>
        <div class="live-code"><code>{live.code}</code><button class="source-button" onclick={copy}>{copied ? t('live.copied') : t('live.copy')}</button></div>
        {#each live.requests as request (request.uid)}
          <div class="live-request">
            <span>{t('live.wantsToJoin', { name: request.name || request.email })}{#if request.email && request.name}<em>{request.email}</em>{/if}</span>
            <div><button class="source-button primary" onclick={() => approveRequest(request)}>{t('live.allow')}</button><button class="source-button" onclick={() => denyRequest(request)}>{t('live.deny')}</button></div>
          </div>
        {/each}
      {:else}
        <p class="live-status">{t('live.joinedTitle', { host: live.hostName, project: live.project })}</p>
      {/if}
      <div class="live-section">{t('live.participants')}</div>
      {#each live.participants as person (person.id)}
        <div class="live-person"><span class="live-dot" style:background={person.color}></span>{person.name}{#if person.host}<em>{t('live.host')}</em>{/if}</div>
      {/each}
      {#if live.role === 'guest'}
        <div class="live-section">{t('live.files')}</div>
        <div class="live-tree"><RemoteTree {onError}/></div>
      {/if}
      <button class="source-button" onclick={() => live.role === 'host' ? stopHosting() : leaveSession()}>{live.role === 'host' ? t('live.stop') : t('live.leave')}</button>
    {/if}
    {#if live.error}<p class="error-text">{live.error}</p>{/if}
  </div>
</div>

<style>
  .live { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .live-body { flex: 1; overflow-y: auto; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 11px; }
  .live-hint { margin: 0; color: var(--text-faint); line-height: 1.45; }
  .live-status { margin: 0; color: var(--text-heading); }
  .live-section { margin-top: 10px; color: var(--text-muted); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
  .live-join { display: flex; gap: 6px; align-items: stretch; }
  .live-join :global(.source-button), .live-code :global(.source-button), .live-request :global(.source-button) { width: auto; flex: 0 0 auto; margin-top: 0; padding: 5px 14px; }
  .live-body > :global(.source-button) { margin-top: 0; }
  .live-join input { flex: 1; min-width: 0; height: 30px; padding: 0 8px; background: var(--bg-input); color: var(--text); border: 1px solid var(--border-strong); border-radius: 3px; font-family: SFMono-Regular, Consolas, monospace; text-transform: uppercase; }
  .live-code { display: flex; align-items: center; gap: 8px; }
  .live-code code { font-size: 15px; letter-spacing: 0.08em; white-space: nowrap; color: var(--text-heading); }
  .live-request { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--accent); border-radius: 5px; }
  .live-request em, .live-person em { display: block; font-style: normal; color: var(--text-faint); }
  .live-request div { display: flex; gap: 6px; }
  .live-person { display: flex; align-items: center; gap: 8px; color: var(--text); }
  .live-person em { display: inline; margin-left: auto; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
  .live-tree { margin: 0 -14px; }
</style>
