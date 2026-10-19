// POST /api/notify  {project, log}
// Called by the board right after someone records an action. Reads that
// activity entry, works out who has new work, and emails them once.
import { FieldValue } from "firebase-admin/firestore";
import { admin, directory, teamEmails } from "../../src/admin.mjs";
import { alertsFor, renderAlert, sendEmails } from "../../src/notify-core.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let A;
  try { A = admin(); } catch (e) { console.error(e); return json({ error: "Alerts aren't configured on the server yet." }, 503); }
  const { auth, db, env } = A;

  // Who is calling: must be signed in and on the team list.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let caller;
  try { caller = await auth.verifyIdToken(token); } catch { return json({ error: "Sign in again." }, 401); }
  const allowed = await teamEmails(db);
  if (!caller.email || !allowed.has(caller.email.toLowerCase())) return json({ error: "Not on the team list." }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const pid = String(body.project || ""), lid = String(body.log || "");
  if (!/^[\w-]{1,60}$/.test(pid) || !/^[\w-]{1,60}$/.test(lid)) return json({ error: "Bad request." }, 400);

  const logRef = db.doc(`projects/${pid}/log/${lid}`);
  const [projSnap, logSnap] = await Promise.all([db.doc(`projects/${pid}`).get(), logRef.get()]);
  if (!projSnap.exists || !logSnap.exists) return json({ error: "Not found." }, 404);
  const entry = logSnap.data();
  // Only the person who took the action can trigger its alerts, and only once.
  if (entry.by !== caller.uid) return json({ error: "Not your action." }, 403);
  if (entry.notifiedAt) return json({ ok: true, sent: 0, already: true });

  const project = { id: pid, ...projSnap.data() };
  const people = await directory(db);
  const url = env("URL") || new URL(req.url).origin;
  const emails = [];
  for (const msg of alertsFor(project, entry)) {
    const u = people.get(msg.uid);
    if (!u || !u.emailAlerts) continue;
    emails.push({ to: u.email, ...renderAlert(msg, url) });
  }

  await logRef.update({ notifiedAt: FieldValue.serverTimestamp(), notifiedCount: emails.length });
  if (!emails.length) return json({ ok: true, sent: 0 });
  try {
    await sendEmails(emails, env);
  } catch (e) {
    console.error(e);
    return json({ error: "The email service rejected the message." }, 502);
  }
  return json({ ok: true, sent: emails.length });
};

export const config = { path: "/api/notify" };
