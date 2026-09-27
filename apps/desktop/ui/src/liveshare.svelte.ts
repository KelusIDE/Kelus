/**
 * Live Share: the host is the hub of a star of WebRTC data channels. Each shared file is a Yjs
 * document bound to a Monaco model on both sides, so concurrent edits merge without conflicts.
 * Firestore (through the main process) is only used to exchange the connection offer/answer.
 */
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { MonacoBinding } from 'y-monaco';
import { monaco } from './monaco';
import { language } from './language';
import type { Entry, JoinRequest } from './types';

export type Participant = { id: string; name: string; color: string; host: boolean };
export type LiveHooks = {
  ensureModel(path: string): Promise<monaco.editor.ITextModel>;
  saveFile(path: string): Promise<void>;
  openRemote(path: string, model: monaco.editor.ITextModel): void;
  remoteSaved(path: string): void;
  closeRemoteTabs(): void;
  editors(): monaco.editor.ICodeEditor[];
};

const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const COLORS = ['#e06c75', '#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#f78c6c', '#ff79c6'];
const CHUNK = 48_000;
export const REMOTE_PREFIX = 'live:';

export const live = $state({
  role: 'none' as 'none' | 'host' | 'joining' | 'guest',
  code: '', status: '', error: '', hostName: '', project: '',
  participants: [] as Participant[], requests: [] as JoinRequest[]
});

let hooks: LiveHooks | null = null;
export function setLiveHooks(value: LiveHooks) { hooks = value; }

// ---------- wire format ----------
type Message = Record<string, unknown> & { t: string };
const toB64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
function send(channel: RTCDataChannel | undefined, message: Message) {
  if (!channel || channel.readyState !== 'open') return;
  const text = JSON.stringify(message);
  if (text.length <= CHUNK) { channel.send(text); return; }
  const id = Math.random().toString(36).slice(2);
  const n = Math.ceil(text.length / CHUNK);
  for (let i = 0; i < n; i++) channel.send(JSON.stringify({ t: 'chunk', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
}
function receiver(handle: (message: Message) => void) {
  const parts = new Map<string, string[]>();
  return (event: MessageEvent) => {
    let message: Message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.t !== 'chunk') { handle(message); return; }
    const list = parts.get(String(message.id)) ?? Array(Number(message.n)).fill('');
    list[Number(message.i)] = String(message.d);
    parts.set(String(message.id), list);
    if (list.every(Boolean)) { parts.delete(String(message.id)); try { handle(JSON.parse(list.join(''))); } catch { /* corrupt message */ } }
  };
}
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', done); resolve(); } };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 4000);
  });
}
const cleanError = (error: unknown) => String(error).replace(/^Error:\s*(Error invoking remote method '[^']+': )?(Error: )?/, '');

// ---------- remote cursor colours (y-monaco renders .yRemoteSelection-<clientID>) ----------
const styled = new Set<number>();
let styleSheet: HTMLStyleElement | null = null;
function styleCursors(awareness: Awareness) {
  styleSheet ??= document.head.appendChild(document.createElement('style'));
  awareness.getStates().forEach((state, clientID) => {
    const user = (state as { user?: { color?: string; name?: string } }).user;
    if (!user?.color || styled.has(clientID) || clientID === awareness.clientID) return;
    styled.add(clientID);
    const name = JSON.stringify(user.name || 'Guest');
    styleSheet!.textContent += `.yRemoteSelection-${clientID}{background:${user.color}33}` +
      `.yRemoteSelectionHead-${clientID}{position:absolute;border-left:2px solid ${user.color};height:100%;box-sizing:border-box}` +
      `.yRemoteSelectionHead-${clientID}::after{content:${name};position:absolute;top:-1.2em;left:-2px;padding:0 4px;font-size:10px;line-height:1.2em;white-space:nowrap;color:#fff;background:${user.color};border-radius:3px 3px 3px 0;pointer-events:none}`;
  });
}

type SharedDoc = { doc: Y.Doc; awareness: Awareness; binding: MonacoBinding; model: monaco.editor.ITextModel };
function bind(doc: Y.Doc, model: monaco.editor.ITextModel, self: { name: string; color: string }): SharedDoc {
  const awareness = new Awareness(doc);
  awareness.setLocalStateField('user', self);
  awareness.on('change', () => styleCursors(awareness));
  const binding = new MonacoBinding(doc.getText('content'), model, new Set(hooks?.editors() ?? []), awareness);
  return { doc, awareness, binding, model };
}
function destroyDoc(shared: SharedDoc) { shared.awareness.setLocalState(null); shared.binding.destroy(); shared.awareness.destroy(); shared.doc.destroy(); }

let self = { id: '', name: '', color: COLORS[0] };

/**
 * y-monaco only redraws remote cursors when someone's cursor changes; call this when the visible
 * editor or its file changes so cursors show immediately.
 */
export function refreshCursors() {
  const editors = hooks?.editors() ?? [];
  for (const shared of [...hostDocs.values(), ...guestDocs.values()]) {
    const binding = shared.binding as unknown as { editors: Set<monaco.editor.ICodeEditor>; _rerenderDecorations?: () => void };
    binding.editors.clear();
    editors.forEach(editor => binding.editors.add(editor));
    binding._rerenderDecorations?.();
  }
}

// =================================== HOST ===================================
type Peer = { uid: string; name: string; color: string; pc: RTCPeerConnection; channel?: RTCDataChannel; paths: Set<string>; clients: Map<string, Set<number>> };
const peers = new Map<string, Peer>();
const hostDocs = new Map<string, SharedDoc>();
const opening = new Map<string, Promise<SharedDoc>>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
const seenRequests = new Set<string>();

function hostPresence() {
  live.participants = [{ id: self.id, name: `${self.name}`, color: self.color, host: true },
    ...[...peers.values()].filter(p => p.channel?.readyState === 'open').map(p => ({ id: p.uid, name: p.name, color: p.color, host: false }))];
  for (const peer of peers.values()) send(peer.channel, { t: 'presence', participants: $state.snapshot(live.participants) });
}

export async function startHosting(project: string) {
  if (live.role !== 'none') return;
  live.error = '';
  try {
    const session = await window.kelus.liveStart(project);
    self = { id: session.uid, name: session.name, color: COLORS[0] };
    Object.assign(live, { role: 'host', code: session.code, project, hostName: session.name, status: '', requests: [] });
    seenRequests.clear();
    hostPresence();
    pollTimer = setInterval(pollRequests, 3000);
  } catch (error) { live.error = cleanError(error); }
}
async function pollRequests() {
  try {
    const requests = await window.kelus.liveRequests(live.code);
    for (const request of requests) {
      if (request.answered || peers.has(request.uid) || seenRequests.has(request.uid) || !request.offer) continue;
      seenRequests.add(request.uid);
      live.requests.push(request);
    }
  } catch { /* transient network error; keep polling */ }
}
export async function denyRequest(request: JoinRequest) {
  live.requests = live.requests.filter(r => r.uid !== request.uid);
  await window.kelus.liveAnswer(live.code, request.uid, null).catch(() => undefined);
}
export async function approveRequest(request: JoinRequest) {
  live.requests = live.requests.filter(r => r.uid !== request.uid);
  const pc = new RTCPeerConnection(ICE);
  const peer: Peer = { uid: request.uid, name: request.name || request.email || 'Guest', color: COLORS[(peers.size + 1) % COLORS.length], pc, paths: new Set(), clients: new Map() };
  peers.set(request.uid, peer);
  pc.ondatachannel = event => {
    peer.channel = event.channel;
    event.channel.onmessage = receiver(message => hostHandle(peer, message));
    event.channel.onopen = () => { send(peer.channel, { t: 'welcome', hostName: self.name, project: live.project, color: peer.color }); hostPresence(); };
    event.channel.onclose = () => dropPeer(peer);
  };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropPeer(peer); };
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: request.offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await window.kelus.liveAnswer(live.code, request.uid, pc.localDescription!.sdp);
  } catch (error) { live.error = cleanError(error); dropPeer(peer); }
}
function dropPeer(peer: Peer) {
  if (!peers.has(peer.uid)) return;
  peers.delete(peer.uid);
  for (const [path, ids] of peer.clients) { const shared = hostDocs.get(path); if (shared) removeAwarenessStates(shared.awareness, [...ids], 'disconnect'); }
  try { peer.pc.close(); } catch { /* already closed */ }
  hostPresence();
}
async function hostDoc(path: string): Promise<SharedDoc> {
  const existing = hostDocs.get(path);
  if (existing) return existing;
  if (!opening.has(path)) opening.set(path, (async () => {
    const model = await hooks!.ensureModel(path);
    const doc = new Y.Doc();
    doc.getText('content').insert(0, model.getValue());
    const shared = bind(doc, model, { name: self.name, color: self.color });
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      for (const peer of peers.values()) if (peer.paths.has(path) && peer.uid !== origin) send(peer.channel, { t: 'update', path, u: toB64(update) });
    });
    shared.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const update = encodeAwarenessUpdate(shared.awareness, [...added, ...updated, ...removed]);
      for (const peer of peers.values()) if (peer.paths.has(path) && peer.uid !== origin) send(peer.channel, { t: 'awareness', path, u: toB64(update) });
    });
    hostDocs.set(path, shared);
    opening.delete(path);
    return shared;
  })());
  return opening.get(path)!;
}
/** True when guests are editing this host file (so out-of-band model changes must be pushed). */
export const isShared = (path: string) => live.role === 'host' && hostDocs.has(path);

async function hostHandle(peer: Peer, message: Message) {
  const path = typeof message.path === 'string' ? message.path : '';
  if (path && (path.startsWith('/') || path.split(/[\\/]/).includes('..'))) return;
  try {
    if (message.t === 'list') {
      const entries: Entry[] = await window.kelus.listFiles(String(message.dir || ''));
      send(peer.channel, { t: 'list', req: message.req, entries });
    } else if (message.t === 'open') {
      const shared = await hostDoc(path);
      peer.paths.add(path);
      const states = [...shared.awareness.getStates().keys()];
      send(peer.channel, { t: 'state', path, req: message.req, u: toB64(Y.encodeStateAsUpdate(shared.doc)), a: toB64(encodeAwarenessUpdate(shared.awareness, states)) });
    } else if (message.t === 'update' && peer.paths.has(path)) {
      Y.applyUpdate(hostDocs.get(path)!.doc, fromB64(String(message.u)), peer.uid);
    } else if (message.t === 'awareness' && peer.paths.has(path)) {
      const shared = hostDocs.get(path)!;
      const before = new Set(shared.awareness.getStates().keys());
      applyAwarenessUpdate(shared.awareness, fromB64(String(message.u)), peer.uid);
      const ids = peer.clients.get(path) ?? new Set<number>();
      shared.awareness.getStates().forEach((_state, id) => { if (!before.has(id)) ids.add(id); });
      peer.clients.set(path, ids);
    } else if (message.t === 'save' && peer.paths.has(path)) {
      await hooks!.saveFile(path);
      send(peer.channel, { t: 'saved', path });
    } else if (message.t === 'close') {
      peer.paths.delete(path);
      const shared = hostDocs.get(path);
      if (shared) removeAwarenessStates(shared.awareness, [...(peer.clients.get(path) ?? [])], 'close');
      peer.clients.delete(path);
    }
  } catch (error) {
    send(peer.channel, { t: 'error', req: message.req, message: cleanError(error) });
  }
}

export async function stopHosting() {
  if (live.role !== 'host') return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  for (const peer of peers.values()) { send(peer.channel, { t: 'bye' }); try { peer.pc.close(); } catch { /* closed */ } }
  peers.clear();
  for (const shared of hostDocs.values()) destroyDoc(shared);
  hostDocs.clear();
  const code = live.code;
  Object.assign(live, { role: 'none', code: '', participants: [], requests: [], status: '' });
  await window.kelus.liveEnd(code).catch(() => undefined);
}

// =================================== GUEST ===================================
let guestPc: RTCPeerConnection | null = null;
let guestChannel: RTCDataChannel | undefined;
const guestDocs = new Map<string, SharedDoc>();
const pending = new Map<string, { resolve: (message: Message) => void; reject: (error: Error) => void }>();
let joinAbort = false;

function request(message: Message): Promise<Message> {
  const req = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    pending.set(req, { resolve, reject });
    send(guestChannel, { ...message, req });
    setTimeout(() => { if (pending.delete(req)) reject(new Error('The host did not respond.')); }, 20_000);
  });
}

export async function joinSession(code: string) {
  if (live.role !== 'none') return;
  Object.assign(live, { role: 'joining', error: '', status: 'Connecting…', code: code.trim().toUpperCase() });
  joinAbort = false;
  const pc = new RTCPeerConnection(ICE);
  guestPc = pc;
  const channel = pc.createDataChannel('kelus', { ordered: true });
  guestChannel = channel;
  channel.onmessage = receiver(guestHandle);
  channel.onclose = () => { if (live.role === 'guest') endGuest('The host ended the session.'); };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const info = await window.kelus.liveJoin(live.code, pc.localDescription!.sdp);
    self = { id: info.uid, name: info.name, color: COLORS[1] };
    Object.assign(live, { hostName: info.hostName, project: info.project, status: `Waiting for ${info.hostName} to let you in…` });
    const deadline = Date.now() + 5 * 60_000;
    let answer: string | null = null;
    while (!answer && !joinAbort && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      const result = await window.kelus.livePoll(live.code).catch(() => ({ answer: null, denied: false }));
      if (result.denied) throw new Error(`${info.hostName} declined the request.`);
      answer = result.answer;
    }
    if (joinAbort) return;
    if (!answer) throw new Error('The host did not respond in time.');
    live.status = 'Connecting directly…';
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await new Promise<void>((resolve, reject) => {
      if (channel.readyState === 'open') { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('Could not connect directly to the host. One of your networks may block peer-to-peer connections.')), 20_000);
      channel.onopen = () => { clearTimeout(timer); resolve(); };
    });
    live.role = 'guest';
    live.status = '';
  } catch (error) {
    if (!joinAbort) { const message = cleanError(error); await leaveSession(); live.error = message; }
  }
}
function guestHandle(message: Message) {
  const path = typeof message.path === 'string' ? message.path : '';
  if (message.req && pending.has(String(message.req))) {
    const waiter = pending.get(String(message.req))!;
    pending.delete(String(message.req));
    if (message.t === 'error') waiter.reject(new Error(String(message.message))); else waiter.resolve(message);
    return;
  }
  if (message.t === 'welcome') { self.color = String(message.color || self.color); }
  else if (message.t === 'presence') live.participants = message.participants as Participant[];
  else if (message.t === 'update') { const shared = guestDocs.get(path); if (shared) Y.applyUpdate(shared.doc, fromB64(String(message.u)), 'remote'); }
  else if (message.t === 'awareness') { const shared = guestDocs.get(path); if (shared) applyAwarenessUpdate(shared.awareness, fromB64(String(message.u)), 'remote'); }
  else if (message.t === 'saved') hooks?.remoteSaved(path);
  else if (message.t === 'bye') endGuest('The host ended the session.');
}

export async function listRemote(dir: string): Promise<Entry[]> {
  return (await request({ t: 'list', dir })).entries as Entry[];
}
export async function openRemote(path: string) {
  if (guestDocs.has(path)) { hooks?.openRemote(path, guestDocs.get(path)!.model); return; }
  const reply = await request({ t: 'open', path });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromB64(String(reply.u)), 'remote');
  const model = monaco.editor.createModel(doc.getText('content').toString(), language(path), monaco.Uri.parse(`kelus-live:/${encodeURI(path)}`));
  const shared = bind(doc, model, { name: self.name, color: self.color });
  applyAwarenessUpdate(shared.awareness, fromB64(String(reply.a)), 'remote');
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'remote') send(guestChannel, { t: 'update', path, u: toB64(update) }); });
  shared.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== 'remote') send(guestChannel, { t: 'awareness', path, u: toB64(encodeAwarenessUpdate(shared.awareness, [...added, ...updated, ...removed])) });
  });
  guestDocs.set(path, shared);
  hooks?.openRemote(path, model);
}
export function saveRemote(path: string) { send(guestChannel, { t: 'save', path }); }
export function closeRemote(path: string) {
  const shared = guestDocs.get(path);
  if (!shared) return;
  send(guestChannel, { t: 'close', path });
  guestDocs.delete(path);
  destroyDoc(shared);
}
function endGuest(reason: string) {
  for (const [path] of guestDocs) closeRemote(path);
  hooks?.closeRemoteTabs();
  try { guestPc?.close(); } catch { /* closed */ }
  guestPc = null; guestChannel = undefined;
  const code = live.code;
  Object.assign(live, { role: 'none', code: '', participants: [], status: '', error: reason });
  if (code) window.kelus.liveLeave(code).catch(() => undefined);
}
export async function leaveSession() {
  joinAbort = true;
  const code = live.code;
  endGuest('');
  if (code) await window.kelus.liveLeave(code).catch(() => undefined);
}
