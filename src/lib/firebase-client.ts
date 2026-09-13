import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Public Firebase web config (not a secret — these are app identifiers). Reused
// from the Blockwick project so Google sign-in works with zero extra setup; the
// only console step is adding this app's domain to Firebase → Auth → authorized
// domains. Split into a dedicated Alliance Firebase project later if desired.
export const FIREBASE_PUBLIC_CONFIG = {
  apiKey: "AIzaSyA4JrJRCJ2BgvAqZzGb6Lj9fsJIAiEjo5o",
  authDomain: "blockwick-540dd.firebaseapp.com",
  projectId: "blockwick-540dd",
  appId: "1:136932538639:web:249ae0f224b02fcf43a67a",
} as const;

export const firebaseConfigured = Object.values(FIREBASE_PUBLIC_CONFIG).every(Boolean);

export function firebaseAuth() {
  if (!firebaseConfigured) return null;
  const app = getApps().length ? getApp() : initializeApp(FIREBASE_PUBLIC_CONFIG);
  return getAuth(app);
}
