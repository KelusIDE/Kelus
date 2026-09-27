import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { desktopCapturer, globalShortcut, screen, shell, systemPreferences, type WebContents } from 'electron';
import { describe, helperCommand, parseAction, systemPrompt, userPrompt, type ComputerAction, type Shot } from './computerCore';
import { agentConfig, visionModel } from './settings';
import { defaultPython, enginePath } from './paths';

const STOP_HOTKEY = 'CommandOrControl+Shift+Escape';
const DRY_RUN = process.env.KELUS_COMPUTER_DRY_RUN === '1';
type Run = { web: WebContents; abort: AbortController; decide: ((approved: boolean) => void) | null };
let current: Run | null = null;

export function computerPermissions() {
  if (process.platform !== 'darwin') return { supported: false, screen: 'unsupported', accessibility: false };
  return {
    supported: true,
    screen: systemPreferences.getMediaAccessStatus('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  };
}
export function openPermissionSettings(kind: 'screen' | 'accessibility'): void {
  if (process.platform !== 'darwin') return;
  if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${kind === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility'}`);
}

async function capture(): Promise<{ shot: Shot; jpeg: string; preview: string }> {
  const display = screen.getPrimaryDisplay();
  const factor = Math.min(1, 1280 / display.size.width);
  const size = { width: Math.round(display.size.width * factor), height: Math.round(display.size.height * factor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const source = sources.find(s => s.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture the screen. Allow Screen Recording for Kelus in System Settings, then restart Kelus.');
  const image = source.thumbnail;
  const actual = image.getSize();
  return {
    shot: { width: actual.width, height: actual.height, originX: display.bounds.x, originY: display.bounds.y, scale: display.bounds.width / actual.width },
    jpeg: image.toJPEG(70).toString('base64'),
    preview: `data:image/jpeg;base64,${image.resize({ width: 480 }).toJPEG(60).toString('base64')}`
  };
}

async function ask(model: { url: string; key: string; model: string }, task: string, history: string[], jpeg: string, shot: Shot, signal: AbortSignal): Promise<string> {
  const response = await fetch(model.url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.key}` },
    body: JSON.stringify({
      model: model.model, temperature: 0, max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt(shot.width, shot.height, process.platform) },
        { role: 'user', content: [
          { type: 'text', text: userPrompt(task, history) },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } }
        ] }
      ]
    })
  });
  if (!response.ok) throw new Error(`Vision model error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Vision model returned an empty reply');
  return content;
}

function startHelper(): { send(command: Record<string, unknown>): Promise<void>; stop(): void } {
  const python = process.platform === 'darwin' && existsSync('/usr/bin/python3') ? '/usr/bin/python3' : defaultPython();
  const child: ChildProcessWithoutNullStreams = spawn(python, [enginePath('computer_input.py')], {
    stdio: 'pipe', env: { ...process.env, KELUS_COMPUTER_DRY_RUN: DRY_RUN ? '1' : '0' }
  });
  const waiting: ((reply: { ok: boolean; error?: string }) => void)[] = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { waiting.shift()?.(JSON.parse(line)); } catch { waiting.shift()?.({ ok: false, error: `Bad helper reply: ${line}` }); }
    }
  });
  child.stdin.on('error', () => undefined);
  child.on('exit', () => { while (waiting.length) waiting.shift()!({ ok: false, error: 'Input helper stopped' }); });
  return {
    send: command => new Promise((resolve, reject) => {
      waiting.push(reply => reply.ok ? resolve() : reject(new Error(reply.error || 'Input failed')));
      child.stdin.write(JSON.stringify(command) + '\n');
    }),
    stop: () => { child.stdin.end(); child.kill(); }
  };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

export async function startComputer(web: WebContents, task: string): Promise<void> {
  if (current) throw new Error('Kelus Agent is already controlling the computer');
  if (!task.trim()) throw new Error('Describe what Kelus Agent should do on the computer');
  const config = (await agentConfig()).computer;
  if (!config.enabled) throw new Error('Computer control is off. Turn it on in Settings → Kelus Agent first.');
  const permissions = computerPermissions();
  if (!permissions.supported) throw new Error('Computer control currently supports macOS only');
  if (permissions.screen !== 'granted') throw new Error('Allow Screen Recording for Kelus in System Settings → Privacy & Security, then restart Kelus.');
  if (!permissions.accessibility && !DRY_RUN) throw new Error('Allow Accessibility for Kelus in System Settings → Privacy & Security so it can use the mouse and keyboard.');
  const model = await visionModel();

  const run: Run = { web, abort: new AbortController(), decide: null };
  current = run;
  const send = (event: Record<string, unknown>) => { if (!web.isDestroyed()) web.send('computer:event', event); };
  const stop = (reason: string) => { if (!run.abort.signal.aborted) { send({ type: 'stopped', reason }); run.abort.abort(); run.decide?.(false); } };
  globalShortcut.register(STOP_HOTKEY, () => stop('Stopped with ⌘⇧Esc'));
  const helper = startHelper();
  send({ type: 'status', running: true, model: model.name, dryRun: DRY_RUN });

  (async () => {
    const history: string[] = [];
    let finished = false;
    try {
      for (let step = 1; step <= config.maxSteps && !run.abort.signal.aborted; step++) {
        const cursor = screen.getCursorScreenPoint();
        if (cursor.x <= 2 && cursor.y <= 2) { stop('Mouse moved to the top-left corner'); break; }
        const { shot, jpeg, preview } = await capture();
        send({ type: 'screenshot', step, preview });
        let action: ComputerAction;
        try { action = parseAction(await ask(model, task, history, jpeg, shot, run.abort.signal), shot); }
        catch (error) {
          if (run.abort.signal.aborted) break;
          history.push(`${step}. (invalid reply: ${String((error as Error).message).slice(0, 120)})`);
          send({ type: 'step', step, thought: '', description: `Model reply rejected: ${(error as Error).message}`, invalid: true });
          continue;
        }
        const description = describe(action);
        send({ type: 'step', step, thought: action.thought, description, action });
        if (action.action === 'done') { finished = true; send({ type: 'done', summary: action.summary }); break; }
        if (action.action === 'fail') { finished = true; send({ type: 'failed', summary: action.summary }); break; }
        if (config.confirmEachAction && action.action !== 'wait') {
          send({ type: 'approval', step, description, thought: action.thought });
          const approved = await new Promise<boolean>(resolve => { run.decide = resolve; });
          run.decide = null;
          if (!approved) { stop('You declined the action'); break; }
        }
        if (run.abort.signal.aborted) break;
        if (action.action === 'wait') await sleep((action.seconds ?? 1) * 1000, run.abort.signal);
        else await helper.send(helperCommand(action, shot)!);
        history.push(`${step}. ${description}`);
        await sleep(700, run.abort.signal);
      }
      if (!run.abort.signal.aborted && !finished) send({ type: 'failed', summary: `Reached the ${config.maxSteps}-step limit` });
    } catch (error) {
      if (!run.abort.signal.aborted) send({ type: 'error', message: (error as Error).message });
    } finally {
      globalShortcut.unregister(STOP_HOTKEY);
      helper.stop();
      current = null;
      send({ type: 'status', running: false });
    }
  })();
}
export function decideComputer(approved: boolean): void { current?.decide?.(approved); }
export function stopComputer(): void {
  if (!current) return;
  if (!current.web.isDestroyed()) current.web.send('computer:event', { type: 'stopped', reason: 'Stopped' });
  current.abort.abort(); current.decide?.(false);
}
