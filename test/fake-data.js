// In-memory stand-in for public/data.js, used to click through the UI locally
// without a Firebase project. Mirrors the same exports and write semantics
// (dotted-path updates, increment on rev, append-only log).
export const configured = true;
const me = { id: "u-chris", email: "chris@appliedbas.test", name: "Chris" };
const db = { users: { "u-chris": { name: "Chris", email: me.email }, "u-dana": { name: "Dana Ortiz", email: "dana@appliedbas.test" } }, projects: {}, logs: {} };
const subs = new Set();
const emit = () => setTimeout(() => subs.forEach((f) => f()), 0);
let userCb;

export function onUser(cb) { userCb = cb; setTimeout(() => cb(window.__signedOut ? null : me), 0); return () => {}; }
export async function signIn() { const e = new Error("bad"); e.code = "auth/invalid-credential"; throw e; }
export async function signOutNow() { userCb && userCb(null); }
export async function resetPassword() {}
export async function saveMyName(name) { db.users[me.id] = { name, email: me.email }; me.name = name; emit(); }

function sub(fn) { const f = () => fn(); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); }
export const watchUsers = (cb) => sub(() => cb(Object.entries(db.users).map(([id, u]) => ({ id, ...u }))));
export const watchProjects = (cb) => sub(() => cb(Object.values(db.projects).filter((p) => !p.archived).map((p) => structuredClone(p)).sort((a, b) => b.createdAt - a.createdAt)));
export const watchLog = (pid, cb) => sub(() => cb([...(db.logs[pid] || [])].reverse()));

function setPath(obj, path, val) {
  const keys = path.split("."); let o = obj;
  for (const k of keys.slice(0, -1)) { if (typeof o[k] !== "object" || o[k] === null) o[k] = {}; o = o[k]; }
  o[keys.at(-1)] = val;
}
let n = 0;
export async function createProject(m, { name, number, customer, scope }) {
  const id = "p" + ++n;
  db.projects[id] = { id, name, number, customer, scope, team: { pm: { id: m.id } }, rev: 0, archived: false, steps: {}, createdAt: Date.now(), updatedAt: Date.now() };
  db.logs[id] = [{ id: "l" + Date.now(), act: "created", note: "", by: m.id, byName: m.name, at: Date.now(), sid: null }];
  emit(); return id;
}
export async function updateProject(m, pid, fields, activity, { bumpRev = false } = {}) {
  const p = db.projects[pid];
  for (const [k, v] of Object.entries(fields)) setPath(p, k, v);
  if (bumpRev) p.rev += 1;
  p.updatedAt = Date.now();
  if (activity) db.logs[pid].push({ id: "l" + Math.random(), sid: activity.sid || null, act: activity.act, note: activity.note || "", by: m.id, byName: m.name, at: Date.now() });
  emit();
}
export const addNote = (m, pid, sid, note) => updateProject(m, pid, {}, { sid, act: "note", note });
