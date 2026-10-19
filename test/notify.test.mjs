// Checks who gets emailed for each kind of action, and the morning digest.
// Run: npm test
import assert from "node:assert/strict";
import { alertsFor, digestFor, renderAlert, renderDigest, sendEmails } from "../src/notify-core.mjs";

const base = () => ({
  id: "p1", name: "Central Plant", number: "26-1042",
  scope: { drawings: true, submittals: true },
  team: { pm: [{ id: "chris" }], eng: [{ id: "eng1" }], cad: [{ id: "viz1" }, { id: "viz2" }], prog: [{ id: "prg" }], gfx: [{ id: "dana" }, { label: "Contractor Joe" }] },
  steps: {},
});
const uids = (a) => a.map((m) => m.uid).sort();

// 1. Points list done -> schematics (VSO x2) and graphics templates (GFX) become ready.
let p = base();
p.steps.s01 = { status: "done" }; p.steps.s02 = { status: "done" };
let a = alertsFor(p, { act: "done", sid: "s02", by: "eng1", byName: "Eng One" });
assert.deepEqual(uids(a), ["dana", "viz1", "viz2"]);
assert.match(a.find((m) => m.uid === "viz1").subject, /^Ready for you: 03 Controller schematic drawings \(Visio\) — 26-1042 · Central Plant$/);

// 2. Actor isn't emailed about their own work; per-step override wins over the role.
p.steps.s03 = { assignees: [{ id: "viz2" }, { id: "eng1" }] };
a = alertsFor(p, { act: "done", sid: "s02", by: "eng1" });
assert.deepEqual(uids(a), ["dana", "viz2"]);

// 3. Drawings out of scope: finishing s02 makes the submittal package (PM) ready.
p = base(); p.scope.drawings = false; p.steps.s01 = { status: "done" }; p.steps.s02 = { status: "done" };
a = alertsFor(p, { act: "done", sid: "s02", by: "eng1" });
assert.deepEqual(uids(a), ["chris", "dana"]);

// 4. Return from engineering review -> drafters, with the redline note.
p = base();
a = alertsFor(p, { act: "returned", sid: "s04", by: "eng1", byName: "Eng One", note: "Fix AHU-1 terminals" });
assert.deepEqual(uids(a), ["viz1", "viz2"]);
assert.equal(a[0].note, "Fix AHU-1 terminals");

// 5. Submittal resubmit with drawings off -> back to PM's package step.
p = base(); p.scope.drawings = false;
a = alertsFor(p, { act: "resubmit", sid: "s06", by: "chris" });
assert.deepEqual(uids(a), []); // Chris is PM and the actor
a = alertsFor(p, { act: "resubmit", sid: "s06", by: "someoneElse" });
assert.deepEqual(uids(a), ["chris"]);

// 6. Added to a step / role.
a = alertsFor(base(), { act: "assigned", sid: "s09", by: "chris", added: ["prg", "chris"], target: { step: "s09" } });
assert.deepEqual(uids(a), ["prg"]);
a = alertsFor(base(), { act: "assigned", by: "chris", added: ["dana"], target: { role: "gfx" } });
assert.match(a[0].subject, /^You're Station Designer on/);

// 7. Blocked -> PM.
a = alertsFor(base(), { act: "blocked", sid: "s07", by: "prg", note: "Waiting on IP addresses" });
assert.deepEqual(uids(a), ["chris"]);

// 8. Notes, starts, scope changes send nothing.
for (const act of ["note", "started", "scope", "created"]) assert.equal(alertsFor(base(), { act, sid: "s01", by: "x" }).length, 0);

// Digest: open steps per person, overdue first.
p = base(); p.steps.s01 = { status: "done" }; p.steps.s02 = { status: "progress", due: "2026-10-01" };
const q = base(); q.id = "p2"; q.name = "Library"; q.number = ""; q.steps.s01 = { status: "progress", due: "2026-12-01" };
const d = digestFor([p, q, { ...base(), archived: true }], "2026-10-12");
assert.deepEqual([...d.keys()].sort(), ["chris", "eng1"]);
assert.equal(d.get("eng1")[0].overdue, true);
assert.equal(d.get("chris")[0].project, "Library");

// Rendering + sending.
const r = renderAlert(a[0], "https://flow.example");
assert.match(r.html, /Waiting on IP addresses/); assert.match(r.text, /Open the board: https:\/\/flow.example/);
assert.match(renderDigest(d.get("eng1"), "https://flow.example").subject, /1 open step, 1 overdue/);
assert.doesNotMatch(renderAlert({ ...a[0], note: "<script>x</script>" }, "u").html, /<script>x/);
const envOf = (o) => (k) => o[k];
let posted;
await sendEmails([{ to: "a@b.co", subject: "s", html: "h", text: "t" }], envOf({ RESEND_API_KEY: "k", MAIL_FROM: "Flow <f@x.co>" }),
  async (url, init) => { posted = { url, init }; return new Response("{}", { status: 200 }); });
assert.equal(posted.url, "https://api.resend.com/emails/batch");
assert.equal(JSON.parse(posted.init.body)[0].to[0], "a@b.co");
await assert.rejects(sendEmails([{ to: "a@b.co" }], envOf({ RESEND_API_KEY: "k", MAIL_FROM: "f" }), async () => new Response("nope", { status: 403 })), /403/);

// Microsoft 365 takes priority when its variables are set.
const calls = [];
const msEnv = envOf({ MS_TENANT_ID: "t1", MS_CLIENT_ID: "c1", MS_CLIENT_SECRET: "s1", MAIL_SENDER: "bas-flow@appliedbas.com", RESEND_API_KEY: "k", MAIL_FROM: "x" });
await sendEmails([{ to: "a@b.co", subject: "Hi", html: "<p>h</p>" }, { to: "c@d.co", subject: "Yo", html: "<p>y</p>" }], msEnv, async (url, init) => {
  calls.push({ url, init });
  return url.includes("oauth2") ? Response.json({ access_token: "tok" }) : new Response(null, { status: 202 });
});
assert.equal(calls[0].url, "https://login.microsoftonline.com/t1/oauth2/v2.0/token");
assert.equal(new URLSearchParams(calls[0].init.body).get("scope"), "https://graph.microsoft.com/.default");
assert.equal(calls[1].url, "https://graph.microsoft.com/v1.0/users/bas-flow%40appliedbas.com/sendMail");
assert.equal(calls[1].init.headers.Authorization, "Bearer tok");
const msg = JSON.parse(calls[2].init.body).message;
assert.equal(msg.toRecipients[0].emailAddress.address, "c@d.co"); assert.equal(msg.body.contentType, "HTML");
await assert.rejects(sendEmails([{ to: "a@b.co" }], msEnv, async (u) => (u.includes("oauth2") ? new Response("bad secret", { status: 401 }) : null)), /Microsoft sign-in failed \(401\)/);
await assert.rejects(sendEmails([{ to: "a@b.co" }], envOf({}), fetch), /No email service/);

console.log("Alert tests passed");
