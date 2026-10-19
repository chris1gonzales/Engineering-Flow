// Who gets an email, and what it says. Pure functions: no Firebase or network
// here, so the logic can be tested on its own.
import { STEPS, SIDX, ROLE, inScope, retTarget, statusOf, assigneesOf, roleMembersOf, stepState, waitsOn } from "../public/flow.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stepLabel = (s) => `${s.id.slice(1)} ${s.title}`;
const projLabel = (p) => (p.number ? `${p.number} · ${p.name}` : p.name);

/**
 * Turn one activity entry into alert messages.
 * @param project  project document data (with id)
 * @param entry    activity log entry {sid, act, note, by, byName, added?, target?}
 * @returns [{uid, subject, lines:[...], note?}]  one per recipient (before email lookup)
 */
export function alertsFor(project, entry) {
  const out = new Map(); // uid -> message (first reason wins)
  const add = (members, msg) => {
    for (const m of members) if (m.id && m.id !== entry.by && !out.has(m.id)) out.set(m.id, { uid: m.id, ...msg });
  };
  const who = entry.byName || "A teammate";
  const s = entry.sid ? STEPS[SIDX[entry.sid]] : null;

  if ((entry.act === "done" || entry.act === "approved") && s) {
    for (const next of STEPS) {
      if (!inScope(project, next) || !waitsOn(project, next, s.id)) continue;
      if (statusOf(project, next) !== "todo") continue;
      add(assigneesOf(project, next), {
        subject: `Ready for you: ${stepLabel(next)}`,
        lines: [`${who} ${entry.act === "approved" ? "approved" : "finished"} ${stepLabel(s)}, so ${stepLabel(next)} is ready to start.`],
      });
    }
  }
  if ((entry.act === "returned" || entry.act === "resubmit") && s) {
    const target = retTarget(project, s);
    if (target) {
      const t = STEPS[SIDX[target]];
      add(assigneesOf(project, t), {
        subject: `Returned to you: ${stepLabel(t)}`,
        lines: [entry.act === "resubmit"
          ? `${who} marked the submittal Revise & resubmit. ${stepLabel(t)} is back in progress.`
          : `${who} returned ${stepLabel(t)} from ${stepLabel(s)} with redlines.`],
        note: entry.note,
      });
    }
  }
  if (entry.act === "assigned" && Array.isArray(entry.added) && entry.added.length) {
    const members = entry.added.map((id) => ({ id }));
    if (entry.target && entry.target.step && STEPS[SIDX[entry.target.step]]) {
      const t = STEPS[SIDX[entry.target.step]];
      add(members, { subject: `You're on ${stepLabel(t)}`, lines: [`${who} added you to ${stepLabel(t)}. It's currently ${statusWord(statusOf(project, t))}.`] });
    } else if (entry.target && entry.target.role && ROLE[entry.target.role]) {
      const r = ROLE[entry.target.role];
      add(members, { subject: `You're ${r.name} on ${projLabel(project)}`, lines: [`${who} added you as ${r.name}. Steps for that role will come to you.`] });
    }
  }
  if (entry.act === "blocked" && s) {
    add(roleMembersOf(project, "pm"), {
      subject: `Blocked: ${stepLabel(s)}`,
      lines: [`${who} flagged ${stepLabel(s)} as blocked.`],
      note: entry.note,
    });
  }
  return [...out.values()].map((m) => ({ ...m, subject: `${m.subject} — ${projLabel(project)}`, project: projLabel(project) }));
}

function statusWord(st) {
  return { waiting: "waiting on earlier steps", todo: "ready to start", progress: "in progress", blocked: "blocked", done: "done", skipped: "not in scope" }[st] || st;
}

/**
 * Morning digest: each person's open steps across all active projects.
 * @returns Map uid -> [{project, step, status, due, overdue}]
 */
export function digestFor(projects, today) {
  const per = new Map();
  for (const p of projects) {
    if (p.archived) continue;
    for (const s of STEPS) {
      const st = statusOf(p, s);
      if (!["todo", "progress", "blocked"].includes(st)) continue;
      const due = stepState(p, s.id).due || null;
      for (const m of assigneesOf(p, s)) {
        if (!m.id) continue;
        if (!per.has(m.id)) per.set(m.id, []);
        per.get(m.id).push({ project: projLabel(p), step: stepLabel(s), status: statusWord(st), due, overdue: !!(due && due < today) });
      }
    }
  }
  for (const list of per.values()) list.sort((a, b) => (b.overdue - a.overdue) || String(a.due || "9999").localeCompare(String(b.due || "9999")));
  return per;
}

/* ---------- email rendering ---------- */
const shell = (title, body, url) => `<!doctype html><html><body style="margin:0;background:#eaeef0;font-family:Segoe UI,Arial,sans-serif;color:#15202a">
<div style="max-width:560px;margin:0 auto;padding:20px 16px">
<div style="background:#fbfcfc;border:1.5px solid #15202a;padding:18px 20px">
<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5a6773;font-weight:600">Schematics &amp; Graphics Flow</div>
<h1 style="font-size:19px;margin:6px 0 12px">${esc(title)}</h1>${body}
<p style="margin:18px 0 0"><a href="${esc(url)}" style="background:#1d5d8a;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;display:inline-block">Open the board</a></p>
</div><p style="font-size:12px;color:#5a6773;margin:12px 2px">You get these because you're on this board. Turn them off from the board with <b>Email alerts</b> next to your name.</p></div></body></html>`;

export function renderAlert(msg, url) {
  const body = msg.lines.map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5">${esc(l)}</p>`).join("")
    + (msg.note ? `<div style="border:1px solid #c3362c;background:#f8e1de;padding:8px 10px;font-size:13px;margin-top:8px"><b style="color:#c3362c">Comments:</b> ${esc(msg.note)}</div>` : "");
  const text = [...msg.lines, msg.note ? `Comments: ${msg.note}` : "", "", `Open the board: ${url}`].filter((x, i, a) => x || i === a.length - 2).join("\n");
  return { subject: msg.subject, html: shell(msg.project, body, url), text };
}

export function renderDigest(items, url) {
  const overdue = items.filter((i) => i.overdue).length;
  const rows = items.map((i) => `<tr><td style="padding:6px 8px;border-top:1px solid #cdd6db;font-size:13px">${esc(i.step)}<br><span style="color:#5a6773">${esc(i.project)}</span></td>
<td style="padding:6px 8px;border-top:1px solid #cdd6db;font-size:13px;white-space:nowrap">${esc(i.status)}</td>
<td style="padding:6px 8px;border-top:1px solid #cdd6db;font-size:13px;white-space:nowrap;${i.overdue ? "color:#c3362c;font-weight:600" : ""}">${i.due ? esc(i.due) + (i.overdue ? " · overdue" : "") : "—"}</td></tr>`).join("");
  const title = `You have ${items.length} open step${items.length === 1 ? "" : "s"}${overdue ? `, ${overdue} overdue` : ""}`;
  const html = shell(title, `<table style="width:100%;border-collapse:collapse"><tr><th align="left" style="font-size:11px;color:#5a6773;padding:4px 8px">Step</th><th align="left" style="font-size:11px;color:#5a6773;padding:4px 8px">Status</th><th align="left" style="font-size:11px;color:#5a6773;padding:4px 8px">Due</th></tr>${rows}</table>`, url);
  const text = [title, "", ...items.map((i) => `- ${i.step} (${i.project}) — ${i.status}${i.due ? `, due ${i.due}${i.overdue ? " OVERDUE" : ""}` : ""}`), "", `Open the board: ${url}`].join("\n");
  return { subject: `Morning summary: ${title.replace("You have ", "")}`, html, text };
}

/* ---------- sending ---------- */
/**
 * Send emails [{to, subject, html, text}] with whichever service is configured:
 *  - Microsoft 365 (Graph API) when MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MAIL_SENDER are set
 *  - otherwise Resend, with RESEND_API_KEY and MAIL_FROM
 * `env` is a function returning an environment variable.
 */
export function sendEmails(emails, env, fetchImpl = fetch) {
  if (env("MS_TENANT_ID") && env("MS_CLIENT_ID") && env("MS_CLIENT_SECRET") && env("MAIL_SENDER")) {
    return sendViaMicrosoft(emails, {
      tenant: env("MS_TENANT_ID"), clientId: env("MS_CLIENT_ID"), secret: env("MS_CLIENT_SECRET"),
      sender: env("MAIL_SENDER"), fromName: env("MAIL_FROM_NAME") || "BAS Flow", fetchImpl,
    });
  }
  if (env("RESEND_API_KEY") && env("MAIL_FROM")) return sendViaResend(emails, { apiKey: env("RESEND_API_KEY"), from: env("MAIL_FROM"), fetchImpl });
  return Promise.reject(new Error("No email service is configured (set the Microsoft 365 or Resend variables)."));
}

/** Microsoft Graph: app-only token, then POST /users/{sender}/sendMail for each email. */
export async function sendViaMicrosoft(emails, { tenant, clientId, secret, sender, fromName, fetchImpl = fetch }) {
  const tok = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!tok.ok) throw new Error(`Microsoft sign-in failed (${tok.status}): ${(await tok.text()).slice(0, 300)}`);
  const { access_token } = await tok.json();
  const sent = [];
  for (const e of emails) {
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: e.subject,
          body: { contentType: "HTML", content: e.html },
          from: { emailAddress: { address: sender, name: fromName } },
          toRecipients: [{ emailAddress: { address: e.to } }],
        },
        saveToSentItems: false,
      }),
    });
    if (!res.ok) throw new Error(`Microsoft 365 refused the email to ${e.to} (${res.status}): ${(await res.text()).slice(0, 300)}`);
    sent.push(e.to);
  }
  return sent;
}

/** Resend's batch API. */
export async function sendViaResend(emails, { apiKey, from, fetchImpl = fetch }) {
  const sent = [];
  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100).map((e) => ({ from, to: [e.to], subject: e.subject, html: e.html, text: e.text }));
    const res = await fetchImpl("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Email service returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    sent.push(...batch.map((b) => b.to[0]));
  }
  return sent;
}
