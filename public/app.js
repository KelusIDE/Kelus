import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut as firebaseSignOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, deleteDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  getStorage, ref, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';

// Same project as apps/desktop/electron/firebaseConfig.ts — this API key is a public
// client identifier (https://firebase.google.com/docs/projects/api-keys), not a secret.
const firebaseConfig = {
  apiKey: 'AIzaSyBakQH8Zk7_Wkh-r7fqEW6FEjqLb-hQfdI',
  authDomain: 'kelus-ide.firebaseapp.com',
  projectId: 'kelus-ide',
  storageBucket: 'kelus-ide.firebasestorage.app'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
        <div class="actions"><button data-action="download">Download</button><button data-action="delete" class="danger">Delete</button></div>`;
      row.querySelector('.name').textContent = data.name || docSnapshot.id;
      row.querySelector('.meta').textContent =
        `${formatSize(data.sizeBytes)} · updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'unknown'}`;
      row.querySelector('[data-action="download"]').addEventListener('click', () => downloadProject(data.storagePath));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteProject(docSnapshot.id, data.storagePath, data.name || docSnapshot.id));
      list.appendChild(row);
    });
  } catch (cause) {
    empty.hidden = false;
    empty.textContent = `Could not load projects: ${cause.message || cause}`;
  }
}
async function downloadProject(storagePath) {
  if (!storagePath) return;
  try {
    const url = await getDownloadURL(ref(storage, storagePath));
    window.open(url, '_blank');
  } catch (cause) { alert(`Could not get a download link: ${cause.message || cause}`); }
}
async function deleteProject(id, storagePath, name) {
  if (!confirm(`Delete the cloud copy of ${name}? This cannot be undone.`)) return;
  try {
    if (storagePath) await deleteObject(ref(storage, storagePath)).catch(() => {});
    await deleteDoc(doc(db, 'users', currentUser.uid, 'projects', id));
    await setDoc(doc(db, 'users', currentUser.uid), { lastProjectDeletedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    loadDashboard();
  } catch (cause) { alert(`Could not delete: ${cause.message || cause}`); }
}

route();
