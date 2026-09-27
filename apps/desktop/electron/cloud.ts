import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import { firebaseConfig } from './firebaseConfig';
import { idToken } from './account';
import { githubApi, githubSession } from './github';
import { restore, snapshotAndPush, type SyncTarget } from './syncGit';

/** Kelus Cloud: project files go to a private repo on the user's own GitHub; Firestore keeps the project list. */
export type CloudProject = { id: string; name: string; sizeBytes: number; updatedAt: string; repo: string; repoUrl: string };
export type SyncProgress = { phase: 'preparing' | 'pushing' | 'writing-record' | 'done'; percent?: number };
export type SyncResult = CloudProject & { skipped: string[]; changed: boolean };

const REPO_DESCRIPTION = 'Synced by Kelus';
const syncDir = () => path.join(app.getPath('userData'), 'sync');
const registryFile = () => path.join(syncDir(), 'registry.json');
/** Private git dir per local folder (so two copies of one project never share an index). */
const gitDirFor = (root: string) => path.join(syncDir(), `${createHash('sha1').update(root).digest('hex').slice(0, 20)}.git`);
function firestoreBase(): string { return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`; }

async function readRegistry(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(registryFile(), 'utf8')) as Record<string, string>; } catch { return {}; }
}
async function writeRegistry(registry: Record<string, string>): Promise<void> {
  await fs.mkdir(syncDir(), { recursive: true });
  await fs.writeFile(registryFile(), JSON.stringify(registry, null, 2));
}

async function firestoreFetch(url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown> & { error?: { message?: string } }) : {};
  if (!response.ok) throw new Error(data.error?.message || `Firestore request failed (${response.status})`);
  return data;
}
function fromFirestoreDocument(doc: Record<string, unknown>): CloudProject {
  const fields = (doc.fields || {}) as Record<string, Record<string, string>>;
  const id = String(doc.name || '').split('/').pop() || '';
  return {
    id, name: fields.name?.stringValue || id,
    sizeBytes: Number(fields.sizeBytes?.integerValue || 0),
    updatedAt: fields.updatedAt?.timestampValue || '',
    repo: fields.repo?.stringValue || '', repoUrl: fields.repoUrl?.stringValue || ''
  };
}
async function getRecord(uid: string, token: string, id: string): Promise<CloudProject | null> {
  try { return fromFirestoreDocument(await firestoreFetch(`${firestoreBase()}/users/${uid}/projects/${id}`, token)); }
  catch (error) { if (/not found|NOT_FOUND/i.test(String((error as Error).message))) return null; throw error; }
}

async function createRepo(name: string, login: string): Promise<{ repo: string; url: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'project';
  for (let attempt = 1; attempt <= 20; attempt++) {
    const repoName = attempt === 1 ? `${slug}-kelus` : `${slug}-kelus-${attempt}`;
    const response = await githubApi('/user/repos', {
      method: 'POST', body: JSON.stringify({ name: repoName, private: true, description: REPO_DESCRIPTION, auto_init: false, has_issues: false, has_wiki: false })
    });
    const data = await response.json() as { full_name?: string; html_url?: string; message?: string; errors?: { message?: string }[] };
    if (response.ok && data.full_name) return { repo: data.full_name, url: data.html_url || `https://github.com/${data.full_name}` };
    const nameTaken = response.status === 422 && (data.errors ?? []).some(e => /already exists/i.test(e.message || ''));
    if (!nameTaken) throw new Error(`GitHub could not create the repo for ${login}: ${data.message || response.status}`);
  }
  throw new Error('Could not find a free repository name on GitHub.');
}
function target(root: string, repo: string, token: string): SyncTarget {
  return { root, gitDir: gitDirFor(root), remote: `https://github.com/${repo}.git`, auth: Buffer.from(`x-access-token:${token}`).toString('base64') };
}

export async function syncProject(root: string, send: (progress: SyncProgress) => void): Promise<SyncResult> {
  const { token: firebaseToken, uid } = await idToken();
  const github = await githubSession();
  send({ phase: 'preparing' });
  const registry = await readRegistry();
  const id = registry[root] ?? randomBytes(10).toString('hex');
  const name = path.basename(root) || 'project';
  const existing = await getRecord(uid, firebaseToken, id);
  const { repo, url } = existing?.repo ? { repo: existing.repo, url: existing.repoUrl } : await createRepo(name, github.login);
  registry[root] = id;
  await writeRegistry(registry);

  send({ phase: 'pushing' });
  const result = await snapshotAndPush(target(root, repo, github.token),
    { name: github.login, email: `${github.id}+${github.login}@users.noreply.github.com` },
    `Kelus sync ${new Date().toISOString()}`);

  send({ phase: 'writing-record' });
  const project: CloudProject = { id, name, sizeBytes: result.bytes, updatedAt: new Date().toISOString(), repo, repoUrl: url };
  const fields = {
    name: { stringValue: project.name }, sizeBytes: { integerValue: String(project.sizeBytes) },
    updatedAt: { timestampValue: project.updatedAt }, repo: { stringValue: repo }, repoUrl: { stringValue: url }
  };
  await firestoreFetch(`${firestoreBase()}/users/${uid}/projects/${id}`, firebaseToken, { method: 'PATCH', body: JSON.stringify({ fields }) });
  send({ phase: 'done' });
  return { ...project, skipped: result.skipped, changed: result.changed };
}

export async function listProjects(): Promise<CloudProject[]> {
  const { token, uid } = await idToken();
  const data = await firestoreFetch(`${firestoreBase()}/users/${uid}/projects`, token).catch(error => {
    if (String(error.message).includes('NOT_FOUND')) return { documents: [] };
    throw error;
  });
  const documents = (data.documents as Record<string, unknown>[]) || [];
  return documents.map(fromFirestoreDocument).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Removes the project from the Kelus list. The GitHub repo is kept; delete it on GitHub if wanted. */
export async function deleteProject(id: string): Promise<void> {
  const { token, uid } = await idToken();
  await firestoreFetch(`${firestoreBase()}/users/${uid}/projects/${id}`, token, { method: 'DELETE' });
  const registry = await readRegistry();
  for (const [root, projectId] of Object.entries(registry)) {
    if (projectId !== id) continue;
    delete registry[root];
    await fs.rm(gitDirFor(root), { recursive: true, force: true });
  }
  await writeRegistry(registry);
}

/** Downloads the latest synced snapshot into a new folder. Returns that folder, or null if cancelled. */
export async function downloadProject(id: string): Promise<string | null> {
  const { token, uid } = await idToken();
  const github = await githubSession();
  const record = await getRecord(uid, token, id);
  if (!record?.repo) throw new Error('This project was synced before GitHub sync existed. Sync it again from the computer that has it.');
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose where to download the project' });
  if (result.canceled || !result.filePaths[0]) return null;
  const destination = path.join(await fs.realpath(result.filePaths[0]), record.name);
  await restore(target(destination, record.repo, github.token));
  const registry = await readRegistry();
  registry[await fs.realpath(destination)] = id;
  await writeRegistry(registry);
  return destination;
}
