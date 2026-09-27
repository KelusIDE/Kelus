<script lang="ts">
  import { t } from './i18n.svelte';
  import type { AgentConfig, ProviderProfile } from './types';

  let { config, profiles, activeProfileId, disabled = false, onChange }: {
    config: AgentConfig; profiles: ProviderProfile[]; activeProfileId: string; disabled?: boolean;
    onChange: (next: AgentConfig) => void;
  } = $props();

  const name = (id: string) => profiles.find(p => p.id === id)?.name ?? '';
  let coderId = $derived(config.coderId || activeProfileId);
  let seats = $derived(new Set([coderId, ...config.criticIds, config.judgeId, ...(config.panel ? config.panelIds : [])].filter(Boolean)).size);
  let summary = $derived(config.debate || config.panel ? t('team.summary', { count: seats }) : t('team.off'));

  function update(patch: Partial<AgentConfig>) { onChange({ ...config, ...patch }); }
  function setCritic(index: number, id: string) {
    const critics = [...config.criticIds];
    if (id) critics[index] = id; else critics.splice(index, 1);
    update({ criticIds: [...new Set(critics.filter(Boolean))] });
  }
  function togglePanelist(id: string, on: boolean) {
    const ids = on ? [...config.panelIds, id].slice(0, 4) : config.panelIds.filter(x => x !== id);
    update({ panelIds: ids });
  }
</script>

<details class="team">
  <summary><span>{t('team.title')}</span><span class="team-summary" class:on={config.debate || config.panel}>{summary}</span></summary>
  <fieldset {disabled}>
    <label class="team-toggle"><input type="checkbox" checked={config.debate} onchange={(e) => update({ debate: e.currentTarget.checked, criticIds: config.criticIds.length ? config.criticIds : [activeProfileId] })}/>{t('team.debate')}</label>
    {#if config.debate}
      <div class="team-grid">
        <span>{t('team.coder')}</span>
        <select value={coderId} onchange={(e) => update({ coderId: e.currentTarget.value })}>
          {#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}
        </select>
        <span>{t('team.critic1')}</span>
        <select value={config.criticIds[0] ?? activeProfileId} onchange={(e) => setCritic(0, e.currentTarget.value)}>
          {#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}
        </select>
        <span>{t('team.critic2')}</span>
        <select value={config.criticIds[1] ?? ''} onchange={(e) => setCritic(1, e.currentTarget.value)}>
          <option value="">{t('team.none')}</option>
          {#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}
        </select>
        <span>{t('team.judge')}</span>
        <select value={config.judgeId} onchange={(e) => update({ judgeId: e.currentTarget.value })}>
          <option value="">{t('team.judgeRules')}</option>
          {#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}
        </select>
      </div>
    {/if}
    <label class="team-toggle"><input type="checkbox" checked={config.panel} onchange={(e) => update({ panel: e.currentTarget.checked })}/>{t('team.panel')}</label>
    {#if config.panel}
      <div class="team-panel">
        <span class="team-label">{t('team.panelMembers')}</span>
        {#each profiles as profile (profile.id)}
          <label class="team-member"><input type="checkbox" checked={config.panelIds.includes(profile.id)}
            disabled={!config.panelIds.includes(profile.id) && config.panelIds.length >= 4}
            onchange={(e) => togglePanelist(profile.id, e.currentTarget.checked)}/>{profile.name}</label>
        {/each}
        <label class="team-member">{t('team.rounds')}
          <select value={config.panelRounds} onchange={(e) => update({ panelRounds: Number(e.currentTarget.value) })}>
            {#each [1, 2, 3] as rounds}<option value={rounds}>{rounds}</option>{/each}
          </select>
        </label>
      </div>
    {/if}
    {#if config.debate}<p class="team-lineup">{name(coderId)} → {config.criticIds.map(name).join(' · ')} → {config.judgeId ? name(config.judgeId) : t('team.judgeRules')}</p>{/if}
  </fieldset>
</details>

<style>
  .team { border-top: 1px solid var(--border); padding: 6px 12px; font-size: 11px; color: var(--text-muted); }
  .team summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; list-style: none; font-weight: 600; letter-spacing: 0.03em; }
  .team summary::-webkit-details-marker { display: none; }
  .team-summary { font-weight: 400; color: var(--text-faint); }
  .team-summary.on { color: var(--accent); }
  fieldset { border: 0; padding: 6px 0 2px; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .team-toggle, .team-member { display: flex; align-items: center; gap: 6px; color: var(--text); }
  .team-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; padding-left: 20px; }
  .team-panel { display: flex; flex-direction: column; gap: 3px; padding-left: 20px; }
  .team-label { color: var(--text-faint); }
  select { min-width: 0; background: var(--bg-input); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; padding: 2px 4px; }
  .team-lineup { margin: 0; padding-left: 20px; color: var(--text-faint); font-size: 10px; }
</style>
