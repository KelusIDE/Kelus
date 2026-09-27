/** One-click free local vision model through Ollama, used by computer control instead of a paid API. */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { shell, type WebContents } from 'electron';
import { useLocalVisionModel } from './settings';

/** Downloaded only when no vision model is installed yet; it located 4/4 targets in Kelus's screen test. */
export const LOCAL_VISION_MODEL = 'gemma4:12b';
const PREFERRED = [/^gemma4/, /^qwen2\.5vl/, /^qwen3-vl/, /^gemma3/, /^llama3\.2-vision/, /^llava/];
const BASE = 'http://127.0.0.1:11434';
const run = promisify(execFile);

async function running(): Promise<string[] | null> {
  try {
    const response = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const data = await response.json() as { models?: { name: string }[] };
    return (data.models ?? []).map(m => m.name);
  } catch { return null; }
}
async function installed(): Promise<boolean> {
  if (process.platform === 'darwin' && existsSync('/Applications/Ollama.app')) return true;
  try { await run(process.platform === 'win32' ? 'where' : 'which', ['ollama']); return true; } catch { return false; }
}

/** Installed models that can read images (cloud-proxied models are skipped: they are neither local nor free). */
async function visionModel(names: string[]): Promise<string | null> {
  const vision: string[] = [];
  for (const name of names.filter(n => !n.endsWith(':cloud') && !n.includes('-cloud'))) {
    try {
      const info = await (await fetch(`${BASE}/api/show`, { method: 'POST', body: JSON.stringify({ model: name }) })).json() as { capabilities?: string[] };
      if (info.capabilities?.includes('vision')) vision.push(name);
    } catch { /* skip */ }
  }
  for (const pattern of PREFERRED) { const match = vision.find(name => pattern.test(name)); if (match) return match; }
  return vision[0] ?? null;
}
export async function ollamaStatus() {
  const models = await running();
  const found = models ? await visionModel(models) : null;
  return { installed: models !== null || await installed(), running: models !== null, hasModel: Boolean(found), model: found ?? LOCAL_VISION_MODEL };
}

async function start(): Promise<void> {
  if (await running()) return;
  if (process.platform === 'darwin' && existsSync('/Applications/Ollama.app')) spawn('open', ['-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40; i++) { if (await running()) return; await new Promise(r => setTimeout(r, 500)); }
  throw new Error('Ollama did not start. Open the Ollama app, then try again.');
}

let pulling = false;
/** Starts Ollama, downloads the model if needed (progress on `ollama:progress`), then selects it for computer control. */
export async function setupLocalVision(web: WebContents): Promise<void> {
  if (!await installed()) { shell.openExternal('https://ollama.com/download'); throw new Error('Install Ollama (free) from ollama.com, then click again.'); }
  if (pulling) return;
  pulling = true;
  const send = (event: Record<string, unknown>) => { if (!web.isDestroyed()) web.send('ollama:progress', event); };
  try {
    send({ status: 'Starting Ollama…' });
    await start();
    const model = await visionModel((await running()) ?? []) ?? LOCAL_VISION_MODEL;
    if (!(await running())?.includes(model)) {
      const response = await fetch(`${BASE}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
      if (!response.ok || !response.body) throw new Error(`Ollama could not download ${model} (${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const update = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
          if (update.error) throw new Error(update.error);
          send({ status: update.status || '', percent: update.total ? Math.round(((update.completed ?? 0) / update.total) * 100) : undefined });
        }
      }
    }
    await useLocalVisionModel(model, `${BASE.replace('127.0.0.1', 'localhost')}/v1/chat/completions`);
    send({ status: 'ready', done: true });
  } catch (error) {
    send({ status: (error as Error).message, error: true });
    throw error;
  } finally { pulling = false; }
}
