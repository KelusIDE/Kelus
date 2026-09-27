import { app, safeStorage, shell } from 'electron';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { firebaseConfig } from './firebaseConfig';

export type Account = { uid: string; email: string; displayName: string };
type StoredAccount = Account & { encryptedRefreshToken: string };
type Session = { idToken: string; refreshToken: string; expiresAt: number };

let current: StoredAccount | null = null;
let session: Session | null = null;
let loaded = false;

function location(): string { return path.join(app.getPath('userData'), 'account.json'); }
function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const backend = (safeStorage as typeof safeStorage & { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
  if (process.platform === 'linux' && typeof backend !== 'function') return false;
  return typeof backend !== 'function' || backend() !== 'basic_text';
}

async function loadStored(): Promise<StoredAccount | null> {
  if (loaded) return current;
  loaded = true;
  try {
    current = JSON.parse(await fs.readFile(location(), 'utf8')) as StoredAccount;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    current = null;
  }
  return current;
}

async function persist(account: StoredAccount | null): Promise<void> {
  current = account;
  await fs.mkdir(path.dirname(location()), { recursive: true });
  if (!account) {
    await fs.rm(location(), { force: true });
    return;
  }
  const temporary = `${location()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(account, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, location());
}

async function identityToolkit(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${firebaseConfig.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = (await response.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!response.ok) throw new Error(readableAuthError(data.error?.message));
  return data;
}
function readableAuthError(code: string | undefined): string {
  switch (code) {
    case 'EMAIL_EXISTS': return 'An account with this email already exists.';
    case 'EMAIL_NOT_FOUND': case 'INVALID_LOGIN_CREDENTIALS': case 'INVALID_PASSWORD': return 'Incorrect email or password.';
    case 'WEAK_PASSWORD : Password should be at least 6 characters': case 'WEAK_PASSWORD': return 'Password must be at least 6 characters.';
    case 'INVALID_EMAIL': return 'Enter a valid email address.';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER': return 'Too many attempts. Try again later.';
    case 'CONFIGURATION_NOT_FOUND': case 'OPERATION_NOT_ALLOWED':
      return 'Kelus sign-in is not switched on yet: enable Email/Password in Firebase Authentication for this project.';
    default: return code || 'Sign-in failed.';
  }
}

function publicAccount(account: StoredAccount | null): Account | null {
  if (!account) return null;
  return { uid: account.uid, email: account.email, displayName: account.displayName };
}

export async function currentAccount(): Promise<Account | null> {
  return publicAccount(await loadStored());
}

export async function signUp(email: string, password: string, displayName: string): Promise<Account | null> {
  const data = await identityToolkit('signUp', { email, password, returnSecureToken: true });
  if (displayName.trim()) await identityToolkit('update', { idToken: data.idToken, displayName: displayName.trim(), returnSecureToken: false }).catch(() => {});
  return storeSession(data, displayName.trim());
}
export async function signIn(email: string, password: string): Promise<Account | null> {
  const data = await identityToolkit('signInWithPassword', { email, password, returnSecureToken: true });
  return storeSession(data, '');
}
export async function signOut(): Promise<void> {
  session = null;
  await persist(null);
}

const WEBSITE = 'https://kelus-ide.web.app';
let pendingBrowser: { cancel: (error: Error) => void } | null = null;

function resultPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Kelus</title><body style="font:15px -apple-system,sans-serif;background:#211b14;color:#e2d1b9;display:grid;place-items:center;height:100vh;margin:0"><p>${message}</p></body>`;
}
export function cancelBrowserSignIn(): void { pendingBrowser?.cancel(new Error('Browser sign-in was cancelled.')); }

/**
 * Google/GitHub sign-in through the Kelus website: the page signs in with Firebase's popup, then
 * form-POSTs the refresh token to a one-time listener on 127.0.0.1. The random state (sent in the URL
 * fragment, never to a server) stops other sites from pushing their own session into Kelus.
 */
export async function signInWithBrowser(provider: 'google' | 'github'): Promise<Account | null> {
  cancelBrowserSignIn();
  const state = randomBytes(24).toString('hex');
  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== '/callback') { response.writeHead(404).end(); return; }
      let body = '';
      request.on('data', chunk => { body += chunk; if (body.length > 20_000) request.destroy(); });
      request.on('end', () => {
        const form = new URLSearchParams(body);
        const received = Buffer.from(form.get('state') || ''), expected = Buffer.from(state);
        const token = form.get('refresh_token') || '';
        if (received.length !== expected.length || !timingSafeEqual(received, expected) || !token) {
          response.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' }).end(resultPage('This sign-in link is invalid or expired. Start again from Kelus.'));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(resultPage('Signed in to Kelus. You can close this tab and return to the app.'));
        finish(); resolve(token);
      });
    });
    const timer = setTimeout(() => { finish(); reject(new Error('Browser sign-in timed out. Try again.')); }, 5 * 60_000);
    const finish = () => { clearTimeout(timer); server.close(); pendingBrowser = null; };
    pendingBrowser = { cancel: error => { finish(); reject(error); } };
    server.on('error', error => { finish(); reject(error); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const url = `${WEBSITE}/#/desktop?port=${port}&provider=${provider}&state=${state}`;
      // End-to-end tests drive their own isolated browser instead of the user's default one.
      if (process.env.KELUS_AUTH_URL_FILE) fs.writeFile(process.env.KELUS_AUTH_URL_FILE, url).catch(() => undefined);
      else shell.openExternal(url);
    });
  });
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  });
  const tokens = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error('The browser sign-in could not be completed. Try again.');
  const lookup = await identityToolkit('lookup', { idToken: tokens.id_token });
  const user = ((lookup.users as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
  return storeSession({
    localId: tokens.user_id, idToken: tokens.id_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in,
    email: user.email, displayName: user.displayName
  }, '');
}

async function storeSession(data: Record<string, unknown>, fallbackName: string): Promise<Account | null> {
  const uid = String(data.localId || '');
  const email = String(data.email || '');
  const idToken = String(data.idToken || '');
  const refreshToken = String(data.refreshToken || '');
  const expiresIn = Number(data.expiresIn || 3600);
  if (!uid || !idToken || !refreshToken) throw new Error('Sign-in response was missing required fields.');
  const displayName = String(data.displayName || fallbackName || email.split('@')[0] || 'Kelus user');
  session = { idToken, refreshToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  const account: StoredAccount = {
    uid, email, displayName,
    encryptedRefreshToken: secureStorageAvailable() ? safeStorage.encryptString(refreshToken).toString('base64') : refreshToken
  };
  await persist(account);
  return publicAccount(account);
}

/** Returns a live ID token for Firestore/Storage REST calls, refreshing it if needed. Throws if signed out. */
export async function idToken(): Promise<{ token: string; uid: string }> {
  const account = await loadStored();
  if (!account) throw new Error('Sign in to Kelus first (Account panel, bottom left).');
  if (session && session.expiresAt > Date.now()) return { token: session.idToken, uid: account.uid };
  let refreshToken: string;
  try {
    refreshToken = secureStorageAvailable() && account.encryptedRefreshToken
      ? safeStorage.decryptString(Buffer.from(account.encryptedRefreshToken, 'base64'))
      : account.encryptedRefreshToken;
  } catch { throw new Error('Your saved Kelus sign-in could not be read by this build. Sign out and sign in again.'); }
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  });
  const data = (await response.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!response.ok) {
    await persist(null);
    throw new Error('Your Kelus session expired. Sign in again.');
  }
  session = { idToken: String(data.id_token), refreshToken: String(data.refresh_token), expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
  return { token: session.idToken, uid: account.uid };
}
