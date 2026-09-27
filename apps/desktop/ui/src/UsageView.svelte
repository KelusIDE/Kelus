<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from './i18n.svelte';
  import type { Settings, UsageRange, UsageStats } from './types';

  let { settings, onSettings, onOpenSettings, onClose, onError }: {
    settings: Settings | null; onSettings: (value: Settings) => void; onOpenSettings: () => void; onClose: () => void; onError: (error: unknown) => void;
  } = $props();

  let range = $state<UsageRange>('30d');
  let stats = $state<UsageStats | null>(null);
  let budget = $state('');

  async function load() {
    try { stats = await window.kelus.usageStats(range); budget = stats.monthlyBudget ? String(stats.monthlyBudget) : ''; }
    catch (error) { onError(error); }
  }
  onMount(load);

  const number = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(value);
  const money = (value: number) => value === 0 ? '$0' : value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;
  const duration = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(1)}s`;
  let maxTokens = $derived(Math.max(1, ...(stats?.days.map(d => d.tokens) ?? [1])));
  let anyUnpriced = $derived(stats?.models.some(m => !m.priced) ?? false);
  let budgetPercent = $derived(stats?.monthlyBudget ? Math.min(100, (stats.monthCost / stats.monthlyBudget) * 100) : 0);

  async function setBudget() {
    try { onSettings(await window.kelus.setMonthlyBudget(Number(budget) || 0)); await load(); } catch (error) { onError(error); }
  }
  async function setActive(id: string) {
    try { onSettings(await window.kelus.setActiveProfile(id)); } catch (error) { onError(error); }
  }
  const outcomeClass = (outcome: string) => ['verified', 'reviewed_without_tests', 'done'].includes(outcome) ? 'good' : ['declined', 'stopped'].includes(outcome) ? '' : 'bad';
</script>

<div class="settings-view usage-view">
  <div class="settings-header"><div><h1>{t('usage.title')}</h1><p>{t('usage.subtitle')}</p></div><button aria-label={t('common.done')} onclick={onClose}>×</button></div>
  <div class="settings-content">
    <div class="usage-toolbar">
      {#each [['7d', t('usage.range7')], ['30d', t('usage.range30')], ['all', t('usage.rangeAll')]] as [value, label]}
        <button class:chosen={range === value} onclick={() => { range = value as UsageRange; load(); }}>{label}</button>
      {/each}
      <button class="usage-refresh" onclick={load}>↻ {t('common.refresh')}</button>
    </div>

    {#if stats}
      <section class="usage-budget" class:over={stats.monthlyBudget > 0 && stats.monthCost > stats.monthlyBudget}>
        <div class="usage-budget-head">
          <strong>{t('usage.budget')}</strong>
          <span>{stats.monthlyBudget ? t('usage.budgetOf', { spent: money(stats.monthCost), budget: money(stats.monthlyBudget) }) : t('usage.budgetNone', { spent: money(stats.monthCost) })}</span>
          {#if stats.monthlyBudget > 0 && stats.monthCost > stats.monthlyBudget}<em>{t('usage.budgetOver')}</em>{/if}
        </div>
        {#if stats.monthlyBudget}<div class="usage-bar"><div style:width={`${budgetPercent}%`}></div></div>{/if}
        <form class="usage-budget-form" onsubmit={(e) => { e.preventDefault(); setBudget(); }}>
          <span>$</span><input type="number" min="0" step="1" bind:value={budget} placeholder="10"/><button type="submit">{t('usage.budgetSave')}</button>
        </form>
      </section>

      <div class="usage-cards">
        <div class="usage-card"><span>{t('usage.runs')}</span><strong>{stats.totals.runs}</strong><em>{t('usage.succeeded', { count: stats.totals.succeeded })} · {t('usage.failed', { count: stats.totals.failed })}</em></div>
        <div class="usage-card"><span>{t('usage.calls')}</span><strong>{number(stats.totals.calls)}</strong><em>{stats.totals.runs ? t('usage.avgTime') + ' ' + duration(stats.totals.runtime / stats.totals.runs) : ''}</em></div>
        <div class="usage-card"><span>{t('usage.tokens')}</span><strong>{number(stats.totals.inputTokens + stats.totals.outputTokens)}</strong><em>{t('usage.tokensSplit', { input: number(stats.totals.inputTokens), output: number(stats.totals.outputTokens) })}</em></div>
        <div class="usage-card"><span>{t('usage.cost')}</span><strong>{money(stats.totals.cost)}</strong><em>{anyUnpriced ? t('usage.costHint') : ''}</em></div>
      </div>

      {#if range !== 'all'}
        <h2 class="usage-heading">{t('usage.daily')}</h2>
        <div class="usage-chart">
          {#each stats.days as day (day.date)}
            <div class="usage-day" title={`${day.date} · ${day.runs} · ${number(day.tokens)} · ${money(day.cost)}`}>
              <div class="usage-column" style:height={`${Math.max(day.tokens ? 4 : 0, (day.tokens / maxTokens) * 100)}%`}></div>
              <span>{day.date.slice(8)}</span>
            </div>
          {/each}
        </div>
      {/if}

      <h2 class="usage-heading">{t('usage.models')}</h2>
      {#if stats.models.length}
        <table class="usage-table">
          <thead><tr><th>{t('usage.model')}</th><th>{t('usage.calls')}</th><th>{t('usage.input')}</th><th>{t('usage.output')}</th><th>{t('usage.cost')}</th></tr></thead>
          <tbody>
            {#each stats.models as model (model.model)}
              <tr><td>{model.model}</td><td>{number(model.calls)}</td><td>{number(model.input_tokens)}</td><td>{number(model.output_tokens)}</td>
                <td>{#if model.cost != null}{money(model.cost)}{:else}<button class="link" onclick={onOpenSettings}>{t('usage.setPrices')}</button>{/if}</td></tr>
            {/each}
          </tbody>
        </table>
      {:else}<p class="settings-hint">{t('usage.empty')}</p>{/if}

      {#if settings}
        <h2 class="usage-heading">{t('usage.active')}</h2>
        <p class="settings-hint">{t('usage.activeHint')}</p>
        <div class="usage-profiles">
          {#each settings.profiles as profile (profile.id)}
            <label class:chosen={settings.activeProfileId === profile.id}>
              <input type="radio" name="usage-active" checked={settings.activeProfileId === profile.id} onchange={() => setActive(profile.id)}/>
              <span><strong>{profile.name}</strong>{#if profile.modelName}<em>{profile.modelName}</em>{/if}</span>
            </label>
          {/each}
        </div>
      {/if}

      <h2 class="usage-heading">{t('usage.recent')}</h2>
      {#if stats.recent.length}
        <div class="usage-runs">
          {#each stats.recent as run (run.startedAt + run.task)}
            <div class="usage-run">
              <span class="usage-kind">{run.kind === 'computer' ? t('usage.kindComputer') : t('usage.kindAgent')}</span>
              <span class="usage-task" title={run.task}>{run.task || '—'}</span>
              <span class="usage-outcome {outcomeClass(run.outcome)}">{run.outcome}</span>
              <span class="usage-meta">{number(run.tokens)} · {run.cost != null ? money(run.cost) : '—'} · {new Date(run.startedAt).toLocaleString()}</span>
            </div>
          {/each}
        </div>
      {:else}<p class="settings-hint">{t('usage.empty')}</p>{/if}
    {/if}
  </div>
</div>

<style>
  .usage-toolbar { display: flex; gap: 4px; margin: 14px 0 6px; }
  .usage-toolbar button { padding: 5px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 11px; color: var(--text-muted); }
  .usage-toolbar button.chosen { border-color: var(--accent); color: var(--text-heading); background: var(--bg-elevated); }
  .usage-refresh { margin-left: auto; }
  .usage-budget { margin: 10px 0; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: 8px; display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
  .usage-budget.over { border-color: var(--status-bad); }
  .usage-budget-head { display: flex; gap: 10px; align-items: baseline; font-size: 12px; }
  .usage-budget-head span { color: var(--text-muted); }
  .usage-budget-head em { margin-left: auto; font-style: normal; color: var(--status-bad); font-weight: 600; }
  .usage-bar { height: 6px; border-radius: 3px; background: var(--bg-elevated); overflow: hidden; }
  .usage-bar div { height: 100%; background: var(--accent); }
  .usage-budget.over .usage-bar div { background: var(--status-bad); }
  .usage-budget-form { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
  .usage-budget-form input { width: 90px; height: 26px; padding: 0 6px; background: var(--bg-input); color: var(--text); border: 1px solid var(--border-strong); border-radius: 3px; }
  .usage-budget-form button { padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: 3px; font-size: 11px; color: var(--text); }
  .usage-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; max-width: 720px; }
  .usage-card { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
  .usage-card span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); }
  .usage-card strong { font-size: 22px; color: var(--text-heading); font-weight: 600; }
  .usage-card em { font-style: normal; font-size: 11px; color: var(--text-muted); min-height: 14px; }
  .usage-heading { margin: 22px 0 8px; font-size: 13px; font-weight: 600; }
  .usage-chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; max-width: 720px; padding: 8px 0 0; border-bottom: 1px solid var(--border); }
  .usage-day { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; }
  .usage-column { width: 100%; max-width: 22px; background: var(--accent); border-radius: 2px 2px 0 0; opacity: 0.85; }
  .usage-day span { font-size: 9px; color: var(--text-faint); height: 12px; }
  .usage-table { border-collapse: collapse; font-size: 12px; max-width: 720px; width: 100%; }
  .usage-table th { text-align: left; font-weight: 500; color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px; border-bottom: 1px solid var(--border-strong); }
  .usage-table td { padding: 7px 8px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  .usage-table .link { color: var(--accent); font-size: 11px; }
  .usage-profiles { display: flex; flex-direction: column; gap: 6px; max-width: 520px; }
  .usage-profiles label { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; cursor: pointer; }
  .usage-profiles label.chosen { border-color: var(--accent); }
  .usage-profiles em { display: block; font-style: normal; color: var(--text-faint); font-size: 11px; }
  .usage-runs { display: flex; flex-direction: column; max-width: 720px; }
  .usage-run { display: grid; grid-template-columns: 70px 1fr auto; grid-template-areas: 'kind task outcome' 'kind meta meta'; gap: 2px 10px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .usage-kind { grid-area: kind; color: var(--text-faint); font-size: 10px; text-transform: uppercase; padding-top: 2px; }
  .usage-task { grid-area: task; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-heading); }
  .usage-outcome { grid-area: outcome; font-size: 10px; color: var(--text-muted); }
  .usage-outcome.good { color: var(--status-good); }
  .usage-outcome.bad { color: var(--status-bad); }
  .usage-meta { grid-area: meta; color: var(--text-faint); font-size: 11px; }
</style>
