import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut as firebaseSignOut, updateProfile
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
  dashboard: document.getElementById('view-dashboard')
};
const navSignedOut = document.getElementById('nav-signed-out');
const navSignedIn = document.getElementById('nav-signed-in');
let currentUser = null;

function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const name = views[hash] ? hash : 'home';
  if ((name === 'login' || name === 'signup') && currentUser) { location.hash = '#/dashboard'; return; }
  if (name === 'dashboard' && !currentUser) { location.hash = '#/login'; return; }
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  if (name === 'dashboard') loadDashboard();
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
        <div class="actions"><button data-action="delete" class="danger">Remove from list</button></div>`;
      row.querySelector('.name').textContent = data.name || docSnapshot.id;
      row.querySelector('.meta').textContent =
        `${formatSize(data.sizeBytes)} · updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'unknown'}`;
      row.querySelector('[data-action="delete"]').addEventListener('click', () => removeFromList(docSnapshot.id, data.name || docSnapshot.id));
      list.appendChild(row);
    });
  } catch (cause) {
    empty.hidden = false;
    empty.textContent = `Could not load projects: ${cause.message || cause}`;
  }
}
// Project files live in your own Backblaze B2 bucket (see the desktop app's Settings),
// not in anything this website has credentials for — download and actual deletion of the
// file happen from the desktop app. This only removes the listing entry.
async function removeFromList(id, name) {
  if (!confirm(`Remove ${name} from this list? The file itself stays in your B2 bucket; delete it from the desktop app or your B2 console.`)) return;
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
