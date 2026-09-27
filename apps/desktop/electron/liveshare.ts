/**
 * Live Share rendezvous over Firestore: the host publishes a session under a random invite code,
 * guests post a WebRTC offer, and the host answers after approving them. Only connection setup goes
 * through Firestore; project files and edits then flow directly between the peers.
 */
import { randomInt } from 'node:crypto';
import { currentAccount, idToken } from './account';
import { firestoreBase, firestoreFetch } from './firestore';

export type JoinRequest = { uid: string; name: string; email: string; offer: string; answered: boolean };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_HOURS = 12;

const str = (value: string) => ({ stringValue: value });
const field = (doc: Record<string, unknown>, name: string) =>
  ((doc.fields as Record<string, Record<string, string>> | undefined)?.[name]?.stringValue) ?? '';
const flag = (doc: Record<string, unknown>, name: string) =>
  Boolean((doc.fields as Record<string, Record<string, boolean>> | undefined)?.[name]?.booleanValue);
const sessionUrl = (code: string) => `${firestoreBase()}/sessions/${code}`;

function normalizeCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 8 || [...clean].some(c => !ALPHABET.includes(c))) throw new Error('Invite codes look like ABCD-2345.');
  return clean;
}
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

async function me(): Promise<{ token: string; uid: string; name: string; email: string }> {
  const { token, uid } = await idToken();
  const account = await currentAccount();
  return { token, uid, name: account?.displayName || account?.email || 'Kelus user', email: account?.email || '' };
}

export async function startSession(projectName: string): Promise<{ code: string; uid: string; name: string }> {
  const { token, uid, name } = await me();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const now = Date.now();
    try {
      await firestoreFetch(`${firestoreBase()}/sessions?documentId=${code}`, token, { method: 'POST', body: JSON.stringify({ fields: {
        hostUid: str(uid), hostName: str(name), project: str(projectName),
        createdAt: { timestampValue: new Date(now).toISOString() },
        expiresAt: { timestampValue: new Date(now + SESSION_HOURS * 3600_000).toISOString() }
      } }) });
      return { code: formatCode(code), uid, name };
    } catch (error) { if (!/exists/i.test(String((error as Error).message))) throw error; }
  }
  throw new Error('Could not create a Live Share session. Try again.');
}

export async function endSession(code: string): Promise<void> {
  const { token } = await me();
  const id = normalizeCode(code);
  const peers = await firestoreFetch(`${sessionUrl(id)}/peers`, token).catch(() => ({ documents: [] }));
  for (const doc of (peers.documents as Record<string, unknown>[] | undefined) ?? []) {
    await firestoreFetch(`https://firestore.googleapis.com/v1/${doc.name}`, token, { method: 'DELETE' }).catch(() => undefined);
  }
  await firestoreFetch(sessionUrl(id), token, { method: 'DELETE' }).catch(() => undefined);
}

export async function listRequests(code: string): Promise<JoinRequest[]> {
  const { token } = await me();
  const data = await firestoreFetch(`${sessionUrl(normalizeCode(code))}/peers`, token);
  return ((data.documents as Record<string, unknown>[] | undefined) ?? []).map(doc => ({
    uid: String(doc.name).split('/').pop() || '', name: field(doc, 'name'), email: field(doc, 'email'),
    offer: field(doc, 'offer'), answered: Boolean(field(doc, 'answer')) || flag(doc, 'denied')
  }));
}

export async function answerRequest(code: string, guestUid: string, answer: string | null): Promise<void> {
  const { token } = await me();
  const fields = answer ? { answer: str(answer) } : { denied: { booleanValue: true } };
  const mask = Object.keys(fields).map(key => `updateMask.fieldPaths=${key}`).join('&');
  await firestoreFetch(`${sessionUrl(normalizeCode(code))}/peers/${encodeURIComponent(guestUid)}?${mask}`, token,
    { method: 'PATCH', body: JSON.stringify({ fields }) });
}

/** Guest side: checks the session exists, then posts this user's offer. */
export async function requestJoin(code: string, offer: string): Promise<{ hostName: string; project: string; uid: string; name: string }> {
  const { token, uid, name, email } = await me();
  const id = normalizeCode(code);
  const session = await firestoreFetch(sessionUrl(id), token).catch(error => {
    if (String((error as Error).message) === 'NOT_FOUND') throw new Error('No Live Share session with that code.');
    throw error;
  });
  const expires = ((session.fields as Record<string, Record<string, string>>)?.expiresAt?.timestampValue) || '';
  if (expires && Date.parse(expires) < Date.now()) throw new Error('That Live Share session has ended.');
  if (field(session, 'hostUid') === uid) throw new Error('You are the host of this session.');
  await firestoreFetch(`${sessionUrl(id)}/peers/${encodeURIComponent(uid)}`, token, { method: 'PATCH', body: JSON.stringify({ fields: {
    name: str(name), email: str(email), offer: str(offer), createdAt: { timestampValue: new Date().toISOString() }
  } }) });
  return { hostName: field(session, 'hostName'), project: field(session, 'project'), uid, name };
}

export async function pollAnswer(code: string): Promise<{ answer: string | null; denied: boolean }> {
  const { token, uid } = await me();
  const doc = await firestoreFetch(`${sessionUrl(normalizeCode(code))}/peers/${encodeURIComponent(uid)}`, token);
  return { answer: field(doc, 'answer') || null, denied: flag(doc, 'denied') };
}

export async function leaveSession(code: string): Promise<void> {
  const { token, uid } = await me();
  await firestoreFetch(`${sessionUrl(normalizeCode(code))}/peers/${encodeURIComponent(uid)}`, token, { method: 'DELETE' }).catch(() => undefined);
}
