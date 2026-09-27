// Kelus Firebase project (Auth + Firestore only — file bytes live in the user's own
// Backblaze B2 bucket, see settings.ts/cloud.ts/b2.ts). The API key below is a public
// client identifier, not a secret (https://firebase.google.com/docs/projects/api-keys) —
// access is enforced by Firestore security rules, not by hiding this key.
// Keep this in sync with the copy in public/app.js (the account website).
export const firebaseConfig = {
  apiKey: 'AIzaSyBakQH8Zk7_Wkh-r7fqEW6FEjqLb-hQfdI',
  authDomain: 'kelus-ide.firebaseapp.com',
  projectId: 'kelus-ide'
};
