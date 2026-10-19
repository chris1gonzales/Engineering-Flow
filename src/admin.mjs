// Server-side Firebase access for the Netlify functions.
// Needs these Netlify environment variables (from a Firebase service account key):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { initializeFirestore } from "firebase-admin/firestore";

let cached;
export function admin() {
  if (cached) return cached;
  const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
  const projectId = env("FIREBASE_PROJECT_ID"), clientEmail = env("FIREBASE_CLIENT_EMAIL");
  const privateKey = (env("FIREBASE_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase service account environment variables are missing.");
  const app = getApps()[0] || initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  cached = { auth: getAuth(app), db: initializeFirestore(app, { preferRest: true }), env };
  return cached;
}

/** Emails allowed on the board (config/access → emails), lowercase. */
export async function teamEmails(db) {
  const snap = await db.doc("config/access").get();
  return new Set(((snap.exists && snap.data().emails) || []).map((e) => String(e).toLowerCase()));
}

/** uid -> {email, name, emailAlerts} for everyone in the team directory who is still on the team list. */
export async function directory(db) {
  const [snap, allowed] = await Promise.all([db.collection("users").get(), teamEmails(db)]);
  const out = new Map();
  for (const d of snap.docs) {
    const u = d.data();
    if (u.email && allowed.has(String(u.email).toLowerCase())) out.set(d.id, { email: u.email, name: u.name || "", emailAlerts: u.emailAlerts !== false });
  }
  return out;
}
