import { firebaseConfig } from './firebaseConfig';

export function firestoreBase(): string { return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`; }

export async function firestoreFetch(url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown> & { error?: { message?: string; status?: string } }) : {};
  if (!response.ok) throw new Error(data.error?.status === 'NOT_FOUND' ? 'NOT_FOUND' : data.error?.message || `Firestore request failed (${response.status})`);
  return data;
}
