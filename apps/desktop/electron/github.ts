import { app, safeStorage, shell, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { githubClientId } from './githubConfig';

/** GitHub account used for Kelus Cloud sync, connected with GitHub's device flow (no client secret in the app). */
type Stored = { login: string; id: number; encryptedToken?: string };
let sessionToken: string | null = null;
let pending: { cancelled: boolean } | null = null;

const location = () => path.join(app.getPath('userData'), 'github.json');
const encryptionAvailable = () => safeStorage.isEncryptionAvailable();

async function load(): Promise<Stored | null> {
  try { return JSON.parse(await fs.readFile(location(), 'utf8')) as Stored; } catch { return null; }
}
function tokenOf(stored: Stored): string | null {
  if (sessionToken) return sessionToken;
  if (!stored.encryptedToken || !encryptionAvailable()) return null;
  try { return safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64')); } catch { return null; }
}

export async function githubAccount(): Promise<{ login: string } | null> {
  const stored = await load();
  return stored && tokenOf(stored) ? { login: stored.login } : null;
}
export async function disconnectGithub(): Promise<void> {
  pending && (pending.cancelled = true);
  sessionToken = null;
  await fs.rm(location(), { force: true });
}
export function cancelGithubConnect(): void { if (pending) pending.cancelled = true; }

async function post(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json() as Promise<Record<string, unknown>>;
}

/** Starts the device flow and returns the code to show; completion is reported on the `github:connect` channel. */
export async function startGithubConnect(web: WebContents): Promise<{ userCode: string; verificationUri: string }> {
  // Developer setup, done once per build: users never see or edit githubConfig.ts.
  if (!githubClientId) throw new Error('GitHub sync is not available in this build of Kelus yet.');
  cancelGithubConnect();
  const start = await post('https://github.com/login/device/code', { client_id: githubClientId, scope: 'repo' });
  if (!start.device_code) {
    throw new Error(start.error === 'device_flow_disabled'
      ? 'Enable "Device Flow" in the GitHub OAuth app settings first.'
      : `GitHub refused the request: ${start.error_description || start.error || 'unknown error'}`);
  }
  const flow = { cancelled: false };
  pending = flow;
  const send = (event: Record<string, unknown>) => { if (!web.isDestroyed()) web.send('github:connect', event); };
  shell.openExternal(String(start.verification_uri));
  (async () => {
    let interval = Number(start.interval || 5) * 1000;
    const deadline = Date.now() + Number(start.expires_in || 900) * 1000;
    while (!flow.cancelled && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, interval));
      if (flow.cancelled) return;
      const result = await post('https://github.com/login/oauth/access_token', {
        client_id: githubClientId, device_code: String(start.device_code), grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }).catch(() => ({ error: 'network' }) as Record<string, unknown>);
      if (result.access_token) {
        const token = String(result.access_token);
        const user = await fetch('https://api.github.com/user', { headers: apiHeaders(token) }).then(r => r.json()) as { login?: string; id?: number };
        if (!user.login || !user.id) { send({ status: 'error', message: 'Could not read your GitHub profile.' }); return; }
        sessionToken = token;
        const stored: Stored = { login: user.login, id: user.id, encryptedToken: encryptionAvailable() ? safeStorage.encryptString(token).toString('base64') : undefined };
        await fs.mkdir(path.dirname(location()), { recursive: true });
        await fs.writeFile(location(), JSON.stringify(stored, null, 2), { mode: 0o600 });
        pending = null;
        send({ status: 'connected', login: user.login });
        return;
      }
      if (result.error === 'slow_down') interval += 5000;
      else if (result.error === 'access_denied') { pending = null; send({ status: 'error', message: 'GitHub access was denied.' }); return; }
      else if (result.error === 'expired_token') break;
    }
    if (!flow.cancelled) { pending = null; send({ status: 'error', message: 'The GitHub code expired. Try again.' }); }
  })();
  return { userCode: String(start.user_code), verificationUri: String(start.verification_uri) };
}

function apiHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Kelus' };
}
export async function githubSession(): Promise<{ token: string; login: string; id: number }> {
  const stored = await load();
  const token = stored && tokenOf(stored);
  if (!stored || !token) throw new Error('Connect GitHub in the Account panel to sync projects.');
  return { token, login: stored.login, id: stored.id };
}
export async function githubApi(pathname: string, init: RequestInit = {}): Promise<Response> {
  const { token } = await githubSession();
  const response = await fetch(`https://api.github.com${pathname}`, { ...init, headers: { ...apiHeaders(token), 'Content-Type': 'application/json', ...init.headers } });
  if (response.status === 401) { await disconnectGithub(); throw new Error('GitHub access expired or was revoked. Connect GitHub again.'); }
  return response;
}
