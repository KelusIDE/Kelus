import archiver from 'archiver';
import yauzl from 'yauzl';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { dialog } from 'electron';
import { firebaseConfig } from './firebaseConfig';
import { idToken } from './account';
import { b2Credentials } from './settings';
import * as b2 from './b2';

export type CloudProject = { id: string; name: string; sizeBytes: number; updatedAt: string; storagePath: string };
export type SyncProgress = { phase: 'zipping' | 'uploading' | 'writing-record' | 'done'; percent?: number };

// Reproducible or heavy directories excluded from the uploaded archive; a re-clone or
// `npm install` recreates them, so shipping them to the cloud would only waste the
// (currently free-tier) Storage quota this project uses.
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-ui', '__pycache__', '.venv', 'venv', '.DS_Store']);

function firestoreBase(): string { return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`; }

async function requireB2(): Promise<NonNullable<Awaited<ReturnType<typeof b2Credentials>>>> {
  const creds = await b2Credentials();
  if (!creds) throw new Error('Set up Backblaze B2 in Settings → Cloud storage before syncing.');
  return creds;
}

export function projectIdFor(root: string): string {
  return createHash('sha1').update(root).digest('hex').slice(0, 20);
}

async function firestoreFetch(url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown> & { error?: { message?: string } }) : {};
  if (!response.ok) throw new Error(data.error?.message || `Firestore request failed (${response.status})`);
  return data;
}

async function zipWorkspace(root: string, onProgress: (percent: number) => void): Promise<{ path: string; bytes: number }> {
  const zipPath = path.join(tmpdir(), `kelus-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    output.on('error', reject);
  });
  archive.on('progress', (info) => { if (info.fs.totalBytes) onProgress(Math.round((info.fs.processedBytes / info.fs.totalBytes) * 100)); });
  archive.pipe(output);
  archive.glob('**/*', {
    cwd: root, dot: true, nodir: true,
    ignore: [...EXCLUDED_DIRS].map(name => `**/${name}/**`)
  });
  await archive.finalize();
  await done;
  const stats = await fs.stat(zipPath);
  return { path: zipPath, bytes: stats.size };
}

async function uploadZip(zipPath: string, uid: string, id: string): Promise<void> {
  const data = await fs.readFile(zipPath);
  const creds = await requireB2();
  await b2.putObject(creds, `users/${uid}/projects/${id}.zip`, data);
}

function toFirestoreFields(project: Omit<CloudProject, 'id'>): Record<string, unknown> {
  return {
    name: { stringValue: project.name },
    sizeBytes: { integerValue: String(project.sizeBytes) },
    updatedAt: { timestampValue: project.updatedAt },
    storagePath: { stringValue: project.storagePath }
  };
}
function fromFirestoreDocument(doc: Record<string, unknown>): CloudProject {
  const fields = (doc.fields || {}) as Record<string, Record<string, string>>;
  const name = String(doc.name || '');
  const id = name.split('/').pop() || '';
  return {
    id,
    name: fields.name?.stringValue || id,
    sizeBytes: Number(fields.sizeBytes?.integerValue || 0),
    updatedAt: fields.updatedAt?.timestampValue || '',
    storagePath: fields.storagePath?.stringValue || ''
  };
}

export async function syncProject(root: string, send: (progress: SyncProgress) => void): Promise<CloudProject> {
  const { token, uid } = await idToken();
  const id = projectIdFor(root);
  const name = path.basename(root) || id;
  send({ phase: 'zipping', percent: 0 });
  const { path: zipPath, bytes } = await zipWorkspace(root, percent => send({ phase: 'zipping', percent }));
  try {
    send({ phase: 'uploading', percent: 0 });
    await uploadZip(zipPath, uid, id);
    send({ phase: 'writing-record' });
    const storagePath = `users/${uid}/projects/${id}.zip`;
    const project: CloudProject = { id, name, sizeBytes: bytes, updatedAt: new Date().toISOString(), storagePath };
    const url = `${firestoreBase()}/users/${uid}/projects/${id}?` +
      ['name', 'sizeBytes', 'updatedAt', 'storagePath'].map(field => `updateMask.fieldPaths=${field}`).join('&');
    await firestoreFetch(url, token, { method: 'PATCH', body: JSON.stringify({ fields: toFirestoreFields(project) }) });
    send({ phase: 'done' });
    return project;
  } finally {
    await fs.rm(zipPath, { force: true });
  }
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

export async function deleteProject(id: string): Promise<void> {
  const { token, uid } = await idToken();
  const creds = await requireB2();
  await b2.deleteObject(creds, `users/${uid}/projects/${id}.zip`);
  await firestoreFetch(`${firestoreBase()}/users/${uid}/projects/${id}`, token, { method: 'DELETE' });
}

/** Downloads and extracts a synced project. Returns the chosen destination folder, or null if canceled. */
export async function downloadProject(id: string): Promise<string | null> {
  const { uid } = await idToken();
  const creds = await requireB2();
  const buffer = await b2.getObject(creds, `users/${uid}/projects/${id}.zip`);

  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder to download into' });
  if (result.canceled || !result.filePaths[0]) return null;
  const destinationRoot = await fs.realpath(result.filePaths[0]);
  await extractZipSafely(buffer, destinationRoot);
  return destinationRoot;
}

/** Extracts a zip buffer into `destinationRoot`, rejecting entries that would escape it (zip-slip) or that are symlinks. */
async function extractZipSafely(buffer: Buffer, destinationRoot: string): Promise<void> {
  const zipfile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => (error || !zip ? reject(error) : resolve(zip)));
  });
  await new Promise<void>((resolve, reject) => {
    zipfile.on('error', reject);
    zipfile.on('end', resolve);
    zipfile.readEntry();
    zipfile.on('entry', (entry: yauzl.Entry) => {
      handleEntry(zipfile, entry, destinationRoot).then(() => zipfile.readEntry()).catch(reject);
    });
  });
}
async function handleEntry(zipfile: yauzl.ZipFile, entry: yauzl.Entry, destinationRoot: string): Promise<void> {
  const isSymlink = ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
  if (isSymlink) throw new Error(`Refusing to extract symlink entry: ${entry.fileName}`);
  const target = path.resolve(destinationRoot, entry.fileName);
  if (target !== destinationRoot && !target.startsWith(destinationRoot + path.sep)) {
    throw new Error(`Refusing to extract entry outside the destination folder: ${entry.fileName}`);
  }
  if (entry.fileName.endsWith('/')) {
    await fs.mkdir(target, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const readStream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => (error || !stream ? reject(error) : resolve(stream)));
  });
  await pipeline(readStream, createWriteStream(target));
}
