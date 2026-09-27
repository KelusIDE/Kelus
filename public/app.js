import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut as firebaseSignOut, updateProfile, signInWithPopup, GoogleAuthProvider, GithubAuthProvider
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, deleteDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Same project as apps/desktop/electron/firebaseConfig.ts — this API key is a public
// client identifier (https://firebase.google.com/docs/projects/api-keys), not a secret.
const firebaseConfig = {
  apiKey: 'AIzaSyBakQH8Zk7_Wkh-r7fqEW6FEjqLb-hQfdI',
  authDomain: 'kelus-ide.firebaseapp.com',
  projectId: 'kelus-ide'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const views = {
  home: document.getElementById('view-home'),
  login: document.getElementById('view-login'),
  signup: document.getElementById('view-signup'),
  desktop: document.getElementById('view-desktop'),
  dashboard: document.getElementById('view-dashboard')
};
const navSignedOut = document.getElementById('nav-signed-out');
const navSignedIn = document.getElementById('nav-signed-in');
let currentUser = null;

function route() {
  const hash = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  const name = views[hash] ? hash : 'home';
  if ((name === 'login' || name === 'signup') && currentUser) { location.hash = '#/dashboard'; return; }
  if (name === 'dashboard' && !currentUser) { location.hash = '#/login'; return; }
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  if (name === 'dashboard') loadDashboard();
  if (name === 'desktop') showDesktop();
}
window.addEventListener('hashchange', route);

onAuthStateChanged(auth, user => {
  currentUser = user;
  navSignedOut.hidden = Boolean(user);
  navSignedIn.hidden = !user;
  route();
});

function showError(el, error) {
  el.textContent = String(error?.message || error).replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[a-z-]+\)\.?$/, '');
  el.hidden = false;
}

// --- Sign up ---
const signupForm = document.getElementById('signup-form');
signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('signup-error');
  error.hidden = true;
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const button = signupForm.querySelector('button');
  button.disabled = true;
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(credential.user, { displayName: name });
    location.hash = '#/dashboard';
  } catch (cause) { showError(error, cause); }
  finally { button.disabled = false; }
});

// --- Sign in ---
const loginForm = document.getElementById('login-form');
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('login-error');
  error.hidden = true;
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    location.hash = '#/dashboard';
  } catch (cause) { showError(error, cause); }
  finally { button.disabled = false; }
});

// --- Google / GitHub ---
async function providerSignIn(name) {
  const provider = name === 'github' ? new GithubAuthProvider() : new GoogleAuthProvider();
  if (name === 'google') provider.setCustomParameters({ prompt: 'select_account' });
  try { return (await signInWithPopup(auth, provider)).user; }
  catch (cause) {
    if (cause?.code === 'auth/popup-closed-by-user' || cause?.code === 'auth/cancelled-popup-request') return null;
    if (cause?.code === 'auth/account-exists-with-different-credential') {
      throw new Error('This email already uses another sign-in method. Sign in with that method instead.');
    }
    throw cause;
  }
}
document.querySelectorAll('[data-provider]').forEach(button => button.addEventListener('click', async () => {
  const context = button.dataset.context;
  const error = document.getElementById(context === 'desktop' ? 'desktop-error' : (views.signup.hidden ? 'login-error' : 'signup-error'));
  error.hidden = true;
  button.disabled = true;
  try {
    const user = await providerSignIn(button.dataset.provider);
    if (!user) return;
    if (context === 'desktop') handOff(user); else location.hash = '#/dashboard';
  } catch (cause) { showError(error, cause); }
  finally { button.disabled = false; }
}));

// --- Desktop app sign-in: Kelus opens #/desktop?port=…&state=… and listens on 127.0.0.1 ---
function desktopParams() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const port = Number(params.get('port'));
  const state = params.get('state') || '';
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && /^[a-f0-9]{48}$/.test(state) ? { port, state } : null;
}
let handingOff = false;
function showDesktop() {
  if (handingOff) return;
  const valid = Boolean(desktopParams());
  document.getElementById('desktop-status').textContent = valid
    ? 'Sign in here and Kelus on your computer connects automatically.'
    : 'Open this page from the Kelus desktop app (Account → Continue with Google or GitHub).';
  document.getElementById('desktop-signed-in').hidden = !valid || !currentUser;
  document.getElementById('desktop-options').hidden = !valid || Boolean(currentUser);
  if (currentUser) document.getElementById('desktop-email').textContent = currentUser.email || currentUser.displayName || 'your account';
}
function handOff(user) {
  const target = desktopParams();
  if (!target) return;
  handingOff = true;
  document.getElementById('desktop-status').textContent = 'Connecting to Kelus…';
  document.getElementById('desktop-options').hidden = true;
  document.getElementById('desktop-signed-in').hidden = true;
  const form = document.getElementById('desktop-handoff');
  form.action = `http://127.0.0.1:${target.port}/callback`;
  form.elements.state.value = target.state;
  form.elements.refresh_token.value = user.refreshToken;
  form.submit();
}
document.getElementById('desktop-continue').addEventListener('click', () => { if (currentUser) handOff(currentUser); });
document.getElementById('desktop-switch').addEventListener('click', () => firebaseSignOut(auth));
document.getElementById('desktop-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('desktop-error');
  error.hidden = true;
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const credential = await signInWithEmailAndPassword(auth, document.getElementById('desktop-email-input').value.trim(), document.getElementById('desktop-password').value);
    handOff(credential.user);
  } catch (cause) { showError(error, cause); }
  finally { button.disabled = false; }
});

document.getElementById('sign-out').addEventListener('click', () => firebaseSignOut(auth));
document.getElementById('sign-out-dash').addEventListener('click', () => firebaseSignOut(auth));

// --- Dashboard ---
function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(1)} ${units[index]}`;
}

async function loadDashboard() {
  document.getElementById('profile-name').textContent = currentUser.displayName || currentUser.email;
  document.getElementById('profile-email').textContent = currentUser.email;
  const list = document.getElementById('project-list');
  const empty = document.getElementById('project-empty');
  list.innerHTML = '';
  empty.hidden = true;
  try {
    const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'projects'));
    if (snapshot.empty) { empty.hidden = false; return; }
    snapshot.forEach(docSnapshot => {
      const data = docSnapshot.data();
      const row = document.createElement('div');
      row.className = 'project-row';
      row.innerHTML = `
        <div><div class="name"></div><div class="meta"></div></div>
        <div class="actions"><a class="button" data-action="open" target="_blank" rel="noopener" hidden>Open on GitHub</a><button data-action="delete" class="danger">Remove from list</button></div>`;
      row.querySelector('.name').textContent = data.name || docSnapshot.id;
      row.querySelector('.meta').textContent =
        `${data.repo ? data.repo + ' · ' : ''}${formatSize(data.sizeBytes)} · updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'unknown'}`;
      const open = row.querySelector('[data-action="open"]');
      if (typeof data.repoUrl === 'string' && data.repoUrl.startsWith('https://github.com/')) { open.href = data.repoUrl; open.hidden = false; }
      row.querySelector('[data-action="delete"]').addEventListener('click', () => removeFromList(docSnapshot.id, data.name || docSnapshot.id));
      list.appendChild(row);
    });
  } catch (cause) {
    empty.hidden = false;
    empty.textContent = `Could not load projects: ${cause.message || cause}`;
  }
}
// Project files live in a private repo on the user's own GitHub; this only removes the Kelus listing.
async function removeFromList(id, name) {
  if (!confirm(`Remove ${name} from your Kelus list? The GitHub repo stays; delete it on GitHub if you want it gone.`)) return;
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'projects', id));
    await setDoc(doc(db, 'users', currentUser.uid), { lastProjectDeletedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    loadDashboard();
  } catch (cause) { alert(`Could not remove: ${cause.message || cause}`); }
}

// --- Home hero: copy-to-clipboard install command ---
const copyInstall = document.getElementById('copy-install');
copyInstall?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('npm install && npm start');
    copyInstall.textContent = 'Copied!';
    setTimeout(() => { copyInstall.textContent = 'Copy'; }, 1600);
  } catch { /* Clipboard API unavailable; the command is still visible to copy by hand. */ }
});

// --- Home hero: animated Agent Room demo ---
const demoScript = [
  { kind: 't-task', prefix: '$ ', text: 'Fix the null pointer bug in auth.py' },
  { kind: 't-claim', prefix: 'Coder      claim       ', text: 'Proposing a patch to auth.py' },
  { kind: 't-evidence', prefix: 'Tester     evidence    ', text: 'pytest -q  →  12 passed' },
  { kind: 't-evidence', prefix: 'Reviewer   evidence    ', text: 'Change matches requirements' },
  { kind: 't-decision', prefix: 'Judge      decision    ', text: '✓ Verified — merged' }
];
function runTerminalDemo() {
  const el = document.getElementById('terminal-demo');
  if (!el) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    el.textContent = demoScript.map(step => step.prefix + step.text).join('\n');
    return;
  }
  let stepIndex = 0;
  function typeStep() {
    const step = demoScript[stepIndex];
    const line = document.createElement('div');
    const prefixSpan = document.createElement('span');
    prefixSpan.className = step.kind === 't-task' ? 't-task' : 't-agent';
    prefixSpan.textContent = step.prefix;
    const textSpan = document.createElement('span');
    textSpan.className = step.kind;
    const cursor = document.createElement('span');
    cursor.className = 't-cursor';
    line.append(prefixSpan, textSpan, cursor);
    el.appendChild(line);
    let charIndex = 0;
    (function typeChar() {
      if (charIndex <= step.text.length) {
        textSpan.textContent = step.text.slice(0, charIndex);
        charIndex++;
        setTimeout(typeChar, 18);
      } else {
        cursor.remove();
        stepIndex++;
        if (stepIndex < demoScript.length) setTimeout(typeStep, 280);
        else setTimeout(() => { el.textContent = ''; stepIndex = 0; setTimeout(typeStep, 500); }, 2600);
      }
    })();
  }
  typeStep();
}
runTerminalDemo();

route();
