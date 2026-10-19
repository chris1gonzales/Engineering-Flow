// Every Firebase call the app makes lives here. app.js only talks to this module.
import {
  initializeApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updateProfile, getFirestore, collection, doc, onSnapshot,
  query, where, orderBy, limit, writeBatch, setDoc, serverTimestamp, increment, Timestamp,
} from "./vendor/firebase.js";
import { firebaseConfig } from "./config.js";

export const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
let app, auth, db;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const ms = (t) => (t instanceof Timestamp ? t.toMillis() : typeof t === "number" ? t : Date.now());

/* ---------- auth ---------- */
export function onUser(cb) {
  return onAuthStateChanged(auth, (u) => cb(u ? { id: u.uid, email: (u.email || "").toLowerCase(), name: u.displayName || "" } : null));
}
export const signIn = (email, pw) => signInWithEmailAndPassword(auth, email.trim(), pw);
export const signOutNow = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());
/** Save the signed-in person's display name to their account and the team directory. */
export async function saveMyName(name) {
  const u = auth.currentUser;
  await updateProfile(u, { displayName: name });
  await setDoc(doc(db, "users", u.uid), { name, email: (u.email || "").toLowerCase(), updatedAt: serverTimestamp() }, { merge: true });
}

/* ---------- live reads ---------- */
// Each returns an unsubscribe function. onError gets Firestore errors
// (e.g. code "permission-denied" when the email isn't on the team list).
export function watchUsers(cb, onError) {
  return onSnapshot(collection(db, "users"), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}
export function watchProjects(cb, onError) {
  return onSnapshot(query(collection(db, "projects"), where("archived", "==", false)), (s) =>
    cb(s.docs.map((d) => shapeProject(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)), onError);
}
export function watchLog(pid, cb, onError) {
  return onSnapshot(query(collection(db, "projects", pid, "log"), orderBy("at", "desc"), limit(80)), (s) =>
    cb(s.docs.map((d) => { const x = d.data(); return { id: d.id, sid: x.sid || null, act: x.act, note: x.note || "", by: x.by, byName: x.byName || "", at: ms(x.at) }; })), onError);
}
function shapeProject(id, x) {
  return {
    id, name: x.name, number: x.number || "", customer: x.customer || "",
    scope: x.scope || {}, team: x.team || {}, rev: x.rev || 0, archived: !!x.archived,
    steps: x.steps || {}, createdBy: x.createdBy || null, createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt),
  };
}

/* ---------- writes ---------- */
function logEntry(me, sid, act, note, extra) {
  return { ...(extra || {}), sid: sid || null, act, note: String(note || "").slice(0, 2000), by: me.id, byName: me.name, at: serverTimestamp() };
}

// Actions that can mean someone else now has work: ask the server to email them.
const ALERT_ACTS = new Set(["done", "approved", "returned", "resubmit", "assigned", "blocked"]);
async function requestAlerts(pid, logId) {
  try {
    const token = await auth.currentUser.getIdToken();
    await fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ project: pid, log: logId }) });
  } catch (e) { console.warn("Email alert request failed", e); }
}
/** Turn this person's email alerts on or off. */
export async function setEmailAlerts(on) {
  const u = auth.currentUser;
  await setDoc(doc(db, "users", u.uid), { name: u.displayName || "", email: (u.email || "").toLowerCase(), emailAlerts: !!on }, { merge: true });
}
/** Create a project and its first activity entry together. Returns the new id. */
export async function createProject(me, { name, number, customer, scope }) {
  const ref = doc(collection(db, "projects"));
  const b = writeBatch(db);
  b.set(ref, {
    name, number, customer, scope, team: { pm: { id: me.id } }, rev: 0, archived: false, steps: {},
    createdBy: me.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  b.set(doc(collection(db, "projects", ref.id, "log")), logEntry(me, null, "created", ""));
  await b.commit();
  return ref.id;
}
/**
 * Apply field changes to a project and (optionally) record activity, all at once.
 * `fields` uses dotted paths, e.g. {"steps.s01.status": "done", "team.gfx": {id}}.
 * Pass {bumpRev: true} to add one to the schematic revision.
 */
export async function updateProject(me, pid, fields, activity, { bumpRev = false } = {}) {
  const ref = doc(db, "projects", pid);
  const b = writeBatch(db);
  const patch = { ...fields, updatedAt: serverTimestamp() };
  if (bumpRev) patch.rev = increment(1);
  b.update(ref, patch);
  const logRef = activity ? doc(collection(db, "projects", pid, "log")) : null;
  if (logRef) b.set(logRef, logEntry(me, activity.sid, activity.act, activity.note, activity.extra));
  await b.commit();
  if (logRef && ALERT_ACTS.has(activity.act)) requestAlerts(pid, logRef.id); // fire and forget
}
export async function addNote(me, pid, sid, note) {
  await updateProject(me, pid, {}, { sid, act: "note", note });
}
