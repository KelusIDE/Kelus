/** AI usage dashboard data: agent runs from the engine's SQLite history plus computer-control runs. */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pricing } from './settings';

type ModelUsage = { calls: number; input_tokens: number; output_tokens: number };
type Run = { kind: 'agent' | 'computer'; task: string; outcome: string; startedAt: string; runtime: number | null; usage: Record<string, ModelUsage> };
export type UsageRange = '7d' | '30d' | 'all';

const computerLog = () => path.join(app.getPath('userData'), 'computer-usage.jsonl');
const engineDb = () => path.join(process.env.KELUS_DATA_DIR || path.join(os.homedir(), '.kelus'), 'runs.db');

export async function recordComputerRun(task: string, outcome: string, startedAt: Date, usage: Record<string, ModelUsage>): Promise<void> {
  const run: Run = { kind: 'computer', task: task.slice(0, 200), outcome, startedAt: startedAt.toISOString(), runtime: (Date.now() - startedAt.getTime()) / 1000, usage };
  await fs.mkdir(path.dirname(computerLog()), { recursive: true });
  await fs.appendFile(computerLog(), JSON.stringify(run) + '\n');
}

function agentRuns(): Run[] {
  let db: DatabaseSync;
  try { db = new DatabaseSync(engineDb(), { readOnly: true }); } catch { return []; }
  try {
    const columns = new Set((db.prepare('PRAGMA table_info(runs)').all() as { name: string }[]).map(c => c.name));
    if (!columns.size) return [];
    const usageColumn = columns.has('usage') ? 'usage' : 'NULL AS usage';
    const rows = db.prepare(`SELECT task_description, final_outcome, started_at, runtime_seconds, models, model_calls, input_tokens, output_tokens, ${usageColumn} FROM runs`).all() as Record<string, unknown>[];
    return rows.map(row => {
      let usage: Record<string, ModelUsage> = {};
      try { usage = JSON.parse(String(row.usage || '{}')); } catch { /* older rows */ }
      if (!Object.keys(usage).length && Number(row.model_calls)) {
        // Runs from before per-model tracking: attribute totals to the model(s) recorded for them.
        let models: string[] = [];
        try { models = [...new Set(Object.values(JSON.parse(String(row.models || '{}'))).map(String))]; } catch { /* none */ }
        usage[models.join(' + ') || 'unknown'] = { calls: Number(row.model_calls) || 0, input_tokens: Number(row.input_tokens) || 0, output_tokens: Number(row.output_tokens) || 0 };
      }
      return { kind: 'agent' as const, task: String(row.task_description || ''), outcome: String(row.final_outcome || ''), startedAt: String(row.started_at || ''),
        runtime: row.runtime_seconds == null ? null : Number(row.runtime_seconds), usage };
    });
  } finally { db.close(); }
}
async function computerRuns(): Promise<Run[]> {
  try {
    return (await fs.readFile(computerLog(), 'utf8')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as Run]; } catch { return []; } });
  } catch { return []; }
}

export async function usageStats(range: UsageRange) {
  const { profiles, monthlyBudget } = await pricing();
  const priceFor = (model: string) => profiles.find(p => p.modelName && p.modelName === model && (p.inputPrice != null || p.outputPrice != null));
  const costOf = (model: string, usage: ModelUsage) => {
    if (model === 'mock') return 0;
    const price = priceFor(model);
    if (!price) return null;
    return (usage.input_tokens * (price.inputPrice ?? 0) + usage.output_tokens * (price.outputPrice ?? 0)) / 1_000_000;
  };
  const runCost = (run: Run) => Object.entries(run.usage).reduce<number | null>((sum, [model, usage]) => {
    const cost = costOf(model, usage);
    return cost == null ? sum : (sum ?? 0) + cost;
  }, null);

  const since = range === 'all' ? 0 : Date.now() - (range === '7d' ? 7 : 30) * 86_400_000;
  const all = [...agentRuns(), ...await computerRuns()].filter(r => Date.parse(r.startedAt)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const runs = all.filter(r => Date.parse(r.startedAt) >= since);

  const byModel = new Map<string, ModelUsage & { cost: number | null }>();
  const byDay = new Map<string, { runs: number; tokens: number; cost: number }>();
  const totals = { runs: runs.length, succeeded: 0, failed: 0, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, runtime: 0 };
  for (const run of runs) {
    if (['verified', 'reviewed_without_tests', 'done'].includes(run.outcome)) totals.succeeded++;
    else if (!['declined', 'stopped'].includes(run.outcome)) totals.failed++;
    totals.runtime += run.runtime ?? 0;
    const day = run.startedAt.slice(0, 10);
    const daily = byDay.get(day) ?? { runs: 0, tokens: 0, cost: 0 };
    daily.runs++;
    for (const [model, usage] of Object.entries(run.usage)) {
      const entry = byModel.get(model) ?? { calls: 0, input_tokens: 0, output_tokens: 0, cost: null };
      entry.calls += usage.calls; entry.input_tokens += usage.input_tokens; entry.output_tokens += usage.output_tokens;
      const cost = costOf(model, usage);
      if (cost != null) { entry.cost = (entry.cost ?? 0) + cost; totals.cost += cost; daily.cost += cost; }
      byModel.set(model, entry);
      totals.calls += usage.calls; totals.inputTokens += usage.input_tokens; totals.outputTokens += usage.output_tokens;
      daily.tokens += usage.input_tokens + usage.output_tokens;
    }
    byDay.set(day, daily);
  }
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthCost = all.filter(r => Date.parse(r.startedAt) >= monthStart.getTime()).reduce((sum, run) => sum + (runCost(run) ?? 0), 0);

  const days: { date: string; runs: number; tokens: number; cost: number }[] = [];
  const span = range === '7d' ? 7 : 30;
  for (let i = span - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    days.push({ date, ...(byDay.get(date) ?? { runs: 0, tokens: 0, cost: 0 }) });
  }
  return {
    totals, monthCost, monthlyBudget, days,
    models: [...byModel.entries()].map(([model, usage]) => ({ model, ...usage, priced: model === 'mock' || Boolean(priceFor(model)) }))
      .sort((a, b) => (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens) || b.calls - a.calls),
    recent: runs.slice(0, 25).map(run => ({
      kind: run.kind, task: run.task, outcome: run.outcome, startedAt: run.startedAt, runtime: run.runtime,
      tokens: Object.values(run.usage).reduce((sum, u) => sum + u.input_tokens + u.output_tokens, 0),
      models: Object.keys(run.usage), cost: runCost(run)
    }))
  };
}
