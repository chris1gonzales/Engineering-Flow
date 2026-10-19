import * as data from "./data.js";
import { ROLES, ROLE, PHASES, STEPS, SIDX, scopeOf, inScope, retTarget, downstream, canEditChecklist } from "./flow.js";

const STAT_LABEL = { waiting: "Waiting", todo: "Ready", progress: "In progress", blocked: "Blocked", done: "Done", skipped: "Not in scope" };

const S = {
  me: null, team: [], projects: [], pid: null, proj: null, log: [],
  expanded: new Set(), mine: false, drafts: {}, picker: null,
  showNew: false, confirmArchive: false, online: navigator.onLine, loaded: false,
};

const $app = document.getElementById("app");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let toastT;
function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3600); }
const revLetter = (n) => String.fromCharCode(65 + Math.max(0, Math.min(25, n || 0)));
function ago(ms) {
  if (!ms) return ""; const d = (Date.now() - ms) / 1000;
  if (d < 60) return "just now"; if (d < 3600) return Math.floor(d / 60) + "m ago"; if (d < 86400) return Math.floor(d / 3600) + "h ago";
  if (d < 604800) return Math.floor(d / 86400) + "d ago"; return new Date(ms).toLocaleDateString();
}
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/* ---------------- live data ---------------- */
let unsub = { users: null, projects: null, log: null };
function stopWatching() { for (const k in unsub) { if (unsub[k]) unsub[k](); unsub[k] = null; } }
function onDataError(e) {
  console.error(e);
  if (e && e.code === "permission-denied") { stopWatching(); showNoAccess(); }
  else toast("Lost the live connection. It will reconnect on its own.");
}
function startWatching() {
  stopWatching();
  unsub.users = data.watchUsers((u) => { S.team = u.filter((x) => x.name); render(); }, onDataError);
  unsub.projects = data.watchProjects((list) => {
    S.projects = list; S.loaded = true;
    if (!list.find((p) => p.id === S.pid)) {
      const saved = store.get("sgf_pid");
      S.pid = (list.find((p) => p.id === saved) || list[0] || {}).id || null;
      S.expanded.clear(); watchLog();
    }
    S.proj = list.find((p) => p.id === S.pid) || null;
    render();
  }, onDataError);
}
function watchLog() {
  if (unsub.log) unsub.log();
  unsub.log = null; S.log = [];
  if (S.pid) unsub.log = data.watchLog(S.pid, (l) => { S.log = l; render(); }, onDataError);
}
/** Run a write; the live listeners update the screen. */
async function save(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) {
    console.error(e);
    toast(e && e.code === "permission-denied" ? "You don't have permission to make that change." : "Could not save. Check your connection and try again.");
  }
}
window.addEventListener("online", () => { S.online = true; render(); });
window.addEventListener("offline", () => { S.online = false; render(); });

/* ---------------- sign-in screens ---------------- */
function authShell(title, sub, form, foot) {
  $app.innerHTML = `<div class="auth"><div class="auth-card">
    <div class="head"><span class="label">Applied BAS · Engineering</span><h1>${esc(title)}</h1>${sub ? `<span class="muted">${esc(sub)}</span>` : ""}</div>
    ${form}${foot ? `<div class="foot">${foot}</div>` : ""}</div></div>`;
}
function showLogin(msg) {
  authShell("Schematics & Graphics Flow", "Sign in with your team account.",
    `<form id="f_login"><label><span class="label">Email</span><input type="email" id="l_email" autocomplete="username" required value="${esc(store.get("sgf_email") || "")}"></label>
     <label><span class="label">Password</span><input type="password" id="l_pw" autocomplete="current-password" required></label>
     <div class="err" id="l_err">${esc(msg || "")}</div><button class="btn primary" type="submit">Sign in</button></form>`,
    `<button class="linkbtn" id="l_forgot" type="button">Forgot or need a password?</button><span class="muted">Team members only.</span>`);
  document.getElementById("f_login").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("l_email").value.trim(), pw = document.getElementById("l_pw").value;
    const err = document.getElementById("l_err"); err.textContent = "Signing in…";
    try { await data.signIn(email, pw); store.set("sgf_email", email); }
    catch (x) {
      const c = x && x.code;
      err.textContent = c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-email"
        ? "Email or password is wrong." : c === "auth/too-many-requests" ? "Too many attempts. Wait a few minutes or reset your password."
        : c === "auth/network-request-failed" ? "Can't reach the sign-in service. Check your connection." : "Could not sign in.";
    }
  };
  document.getElementById("l_forgot").onclick = showForgot;
}
function showForgot() {
  authShell("Set or reset your password", "We'll email you a link to choose a password.",
    `<form id="f_forgot"><label><span class="label">Email</span><input type="email" id="r_email" required value="${esc(store.get("sgf_email") || "")}"></label>
     <div class="err" id="r_err"></div><button class="btn primary" type="submit">Send link</button></form>`,
    `<button class="linkbtn" id="r_back" type="button">Back to sign in</button>`);
  document.getElementById("r_back").onclick = () => showLogin();
  document.getElementById("f_forgot").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("r_email").value.trim(), err = document.getElementById("r_err");
    try { await data.resetPassword(email); store.set("sgf_email", email); }
    catch (x) { if (x && x.code === "auth/invalid-email") { err.textContent = "That email address isn't valid."; return; } }
    // Same message whether or not the account exists.
    err.className = "ok-msg"; err.textContent = "If that address has an account, a link is on its way. Check spam too.";
  };
}
function showName() {
  authShell("What should the team call you?", "Your name shows on steps you own and in the activity feed.",
    `<form id="f_name"><label><span class="label">Your name</span><input type="text" id="n_name" autocomplete="name" required maxlength="60" value="${esc(S.me.name || "")}"></label>
     <div class="err" id="n_err"></div><button class="btn primary" type="submit">Continue</button></form>`,
    `<span class="muted">${esc(S.me.email)}</span><button class="linkbtn" id="n_out" type="button">Sign out</button>`);
  document.getElementById("n_out").onclick = () => data.signOutNow();
  document.getElementById("f_name").onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("n_name").value.trim().slice(0, 60);
    if (!name) return;
    const err = document.getElementById("n_err"); err.textContent = "Saving…";
    try { await data.saveMyName(name); S.me.name = name; enterBoard(); }
    catch (x) { err.textContent = x && x.code === "permission-denied" ? "Your email isn't on the team list yet. Ask the board owner to add it." : "Could not save. Try again."; }
  };
}
function showNoAccess() {
  authShell("Not on the team list yet", "You're signed in, but this email hasn't been added to the board.",
    `<div style="padding:18px;display:grid;gap:10px"><p style="margin:0">Ask the board owner to add <b>${esc(S.me ? S.me.email : "")}</b> to the team list in Firebase, then reload this page.</p>
     <div class="actions"><button class="btn primary" id="na_reload" type="button">Reload</button><button class="btn" id="na_out" type="button">Sign out</button></div></div>`);
  document.getElementById("na_reload").onclick = () => location.reload();
  document.getElementById("na_out").onclick = () => data.signOutNow();
}
function showSetup() {
  authShell("Almost there", "This copy of the board isn't connected to Firebase yet.",
    `<div style="padding:18px"><p style="margin:0">Paste your Firebase web app settings into <code>public/config.js</code>, commit, and let Netlify redeploy. The README walks through it.</p></div>`);
}

/* ---------------- helpers ---------------- */
const project = () => S.proj;
const stepData = (p, id) => (p && p.steps && p.steps[id]) || {};
function depOk(p, id) { const s = STEPS[SIDX[id]]; return inScope(p, s) ? stepData(p, id).status === "done" : s.deps.every((x) => depOk(p, x)); }
function effStatus(p, s) {
  if (!inScope(p, s)) return "skipped";
  const d = stepData(p, s.id);
  // Work recorded on a step always shows, even if earlier steps aren't finished.
  if (d.status === "done" || d.status === "progress" || d.status === "blocked") return d.status;
  return s.deps.some((x) => !depOk(p, x)) ? "waiting" : "todo";
}
/** Started or finished before the steps it normally follows. */
const outOfOrder = (p, s) => !!p && inScope(p, s) && ["progress", "blocked", "done"].includes(stepData(p, s.id).status) && s.deps.some((x) => !depOk(p, x));
// Assignments: each role holds a list of people (the default for its steps);
// a step can override with its own list. Older single-person data still reads.
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((m) => m && (m.id || m.label));
const sameMember = (a, b) => (a.id ? a.id === b.id : !b.id && a.label === b.label);
const roleMembers = (p, role) => asList(p && p.team && p.team[role]);
const stepIsCustom = (p, sid) => Array.isArray(stepData(p, sid).assignees);
const stepAssignees = (p, s) => (stepIsCustom(p, s.id) ? asList(stepData(p, s.id).assignees) : roleMembers(p, s.role));
const userById = (id) => S.team.find((u) => u.id === id);
function personName(m, fallback) {
  if (!m) return "";
  if (m.id) { const u = userById(m.id); return u ? u.name : (S.me && m.id === S.me.id ? S.me.name : fallback || "Team member"); }
  return m.label || "";
}
function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function avatarHTML(m, fallback) {
  const n = personName(m, fallback) || "?";
  const initials = n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const key = (m && (m.id || m.label)) || n;
  return `<span class="av" style="background:hsl(${hue(key)} 45% 42%);color:#fff">${esc(initials)}</span>`;
}
function whoListHTML(list) {
  if (!list.length) return `<span class="muted">Unassigned</span>`;
  const names = list.slice(0, 2).map((m) => personName(m)).join(", ") + (list.length > 2 ? ` +${list.length - 2}` : "");
  return `<span class="who"><span class="avs">${list.slice(0, 3).map((m) => avatarHTML(m)).join("")}</span>${esc(names)}</span>`;
}
const isMine = (p, s) => !!S.me && stepAssignees(p, s).some((m) => m.id === S.me.id);
/* ---------------- main render ---------------- */
function renderTop() {
  const opts = S.projects.map((x) => `<option value="${esc(x.id)}"${x.id === S.pid ? " selected" : ""}>${esc(x.number ? x.number + " · " : "")}${esc(x.name)}</option>`).join("");
  const sync = S.online ? "● Live" : "Offline — changes will sync when you reconnect";
  return `<div class="top">
    <div class="left"><h1>Schematics &amp; Graphics Flow</h1><span class="muted">Controller drawings → submittal → station graphics</span></div>
    <div class="right">
      ${S.projects.length ? `<label class="label" for="pick">Project</label><select id="pick" data-act="pick">${opts}</select>` : ""}
      <div class="seg" role="group" aria-label="Filter steps"><button data-act="mine" data-v="0" aria-pressed="${!S.mine}">All steps</button><button data-act="mine" data-v="1" aria-pressed="${S.mine}">My steps</button></div>
      <button class="btn primary" data-act="newp">New project</button>
      <span class="me">${avatarHTML({ id: S.me.id }, S.me.name)}<span>${esc(S.me.name)}</span>${(() => { const on = (S.team.find((u) => u.id === S.me.id) || {}).emailAlerts !== false; return `<button class="btn sm" data-act="alerts" data-on="${on ? 1 : 0}" aria-pressed="${on}" title="Emails when work is ready for you, plus a weekday morning summary">Email alerts: ${on ? "On" : "Off"}</button>`; })()}<button class="btn sm" data-act="signout">Sign out</button></span>
    </div></div>
    <div class="sync ${S.online ? "" : "off"}">${esc(sync)}</div>`;
}
function renderNewForm() {
  if (!S.showNew) return "";
  return `<form class="panel" id="newform"><div class="panel-h"><h2>New project</h2><button type="button" class="btn sm" data-act="cancelnew">Cancel</button></div>
    <div class="newp">
      <label><span class="label">Job number</span><input type="text" id="np_num" placeholder="e.g. 26-1042" value="${esc(S.drafts.np_num || "")}"></label>
      <label><span class="label">Project name</span><input type="text" id="np_name" required placeholder="e.g. Central Plant Upgrade" value="${esc(S.drafts.np_name || "")}"></label>
      <label><span class="label">Customer / GC</span><input type="text" id="np_cust" value="${esc(S.drafts.np_cust || "")}"></label>
      <button class="btn primary" type="submit">Create</button>
    </div>
    <div class="scope"><span class="label">Scope</span>
      <label class="sw"><input type="checkbox" id="np_draw" ${S.drafts.np_draw === false ? "" : "checked"}><span>Controller drawings (Visio)</span></label>
      <label class="sw"><input type="checkbox" id="np_sub" ${S.drafts.np_sub === false ? "" : "checked"}><span>Submittals required</span></label>
      <span class="hint">Steps you turn off are marked Not in scope and skipped. You can change this later.</span></div></form>`;
}
function renderTitle(p) {
  const live = STEPS.filter((s) => inScope(p, s));
  const done = live.filter((s) => effStatus(p, s) === "done").length, pct = live.length ? Math.round((done / live.length) * 100) : 0;
  const sc = scopeOf(p), gate = stepData(p, "s06");
  const gateTxt = !sc.submittals ? "Not required" : gate.status === "done" ? gate.outcome || "Approved" : effStatus(p, STEPS[SIDX.s06]) === "waiting" ? "Not submitted" : "Under review";
  return `<div class="tblock">
    <div><div class="label">Project</div><div class="v">${esc(p.name)}</div><div class="muted" style="font-size:13px">${esc(p.customer || "")}</div></div>
    <div><div class="label">Job no.</div><div class="v mono">${esc(p.number || "—")}</div></div>
    <div><div class="label">Schematic rev</div><div class="v ${sc.drawings ? "mono" : ""}">${sc.drawings ? "Rev " + revLetter(p.rev) : "No drawings"}</div></div>
    <div><div class="label">Submittal</div><div class="v" style="color:${gate.status === "done" && sc.submittals ? "var(--ok)" : "var(--ink)"}">${esc(gateTxt)}</div></div>
    <div><div class="label">Complete</div><div class="v mono">${done}/${live.length} · ${pct}%</div><div class="bar"><i style="width:${pct}%"></i></div></div>
  </div>
  <div class="scope panel" style="padding:10px 14px"><span class="label">Scope</span>
    <label class="sw"><input type="checkbox" id="sc_draw" data-act="scope" data-k="drawings" ${sc.drawings ? "checked" : ""}><span>Controller drawings (Visio)</span></label>
    <label class="sw"><input type="checkbox" id="sc_sub" data-act="scope" data-k="submittals" ${sc.submittals ? "checked" : ""}><span>Submittals required</span></label>
    <span class="hint">${!sc.drawings && !sc.submittals ? "Drawing and submittal steps are skipped." : !sc.drawings ? "Drawing steps 03, 04 and 12 are skipped." : !sc.submittals ? "Submittal steps 05 and 06 are skipped; programming starts after schematic review." : "Full process: drawings and submittal gate included."}</span></div>`;
}
function renderMap(p) {
  const ph = PHASES.map((name, i) => {
    const nodes = STEPS.filter((s) => s.phase === i).map((s) => {
      const st = p ? effStatus(p, s) : "waiting";
      return `<button class="node ${st}" data-act="jump" data-s="${s.id}" title="${esc(s.title)} — ${STAT_LABEL[st]} (${ROLE[s.role].code})">${s.id.slice(1)}${s.kind === "gate" ? '<span class="k"></span>' : ""}</button>`;
    }).join("");
    return `<div class="mphase"><span class="label">${esc(name)}</span><div class="mnodes">${nodes}</div></div>`;
  }).join("");
  return `<div class="mapwrap"><div class="map">${ph}</div>
    <div class="legend"><span><i></i>Waiting on earlier step</span><span><i style="border-color:var(--accent);background:var(--accent-soft)"></i>Ready to start</span><span><i style="border-color:var(--warn);background:var(--warn-soft)"></i>In progress</span><span><i style="border-color:var(--redline);background:var(--redline-soft)"></i>Blocked</span><span><i style="border-color:var(--ok);background:var(--ok)"></i>Done</span><span><i style="border-style:dashed;opacity:.6"></i>Not in scope</span><span><i style="transform:rotate(45deg) scale(.8);border-color:var(--ink)"></i>Hard gate</span></div></div>`;
}
function renderNext(p) {
  const open = STEPS.filter((s) => ["todo", "progress", "blocked"].includes(effStatus(p, s)));
  if (!open.length) return `<p class="muted">Nothing open. ${STEPS.every((s) => ["done", "skipped"].includes(effStatus(p, s))) ? "This project is closed out." : ""}</p>`;
  return `<div class="next">${open.map((s) => { const st = effStatus(p, s); return `<div class="nrow"><span class="sno">${s.id.slice(1)}</span><span class="t"><b>${esc(s.title)}</b></span><span class="pill ${st}">${STAT_LABEL[st]}</span><span class="tag">${ROLE[s.role].code}</span>${whoListHTML(stepAssignees(p, s))}</div>`; }).join("")}</div>`;
}
function actText(e) {
  const s = e.sid && STEPS[SIDX[e.sid]]; const t = s ? `${s.id.slice(1)} ${s.title}` : "";
  return ({
    created: "created the project", started: "started " + t, done: "completed " + t, approved: "approved " + t,
    returned: "returned work from " + t, resubmit: "marked the submittal Revise & resubmit", blocked: "flagged " + t + " as blocked",
    unblocked: "cleared the block on " + t, reopened: "reopened " + t, note: "noted on " + t, assigned: e.sid ? "changed who's on " + t : "updated the team",
    scope: "changed the project scope", archived: "archived the project",
  })[e.act] || e.act + " " + t;
}
const logLine = (e) => `<div class="e">${avatarHTML({ id: e.by }, e.byName)}<div><b>${esc(personName({ id: e.by }, e.byName))}</b> ${esc(actText(e))} <span class="muted">· ${ago(e.at)}</span>${e.note ? `<div class="note muted" style="overflow-wrap:anywhere">${esc(e.note)}</div>` : ""}</div></div>`;

function renderStep(p, s) {
  const st = p ? effStatus(p, s) : "waiting", d = stepData(p, s.id), open = S.expanded.has(s.id);
  if (st === "skipped") return `<div class="step skipped" id="step-${s.id}"><div class="shead"><span class="sno">${s.id.slice(1)}</span>
      <span style="min-width:0"><span class="stitle">${esc(s.title)}</span><span class="smeta"><span class="tag">${ROLE[s.role].code}</span><span>Turned off in this project's scope</span></span></span>
      <span class="pill skipped">${STAT_LABEL.skipped}</span></div></div>`;
  const checks = Array.isArray(d.checks) ? d.checks : [];
  const nChk = checks.filter(Boolean).length;
  const late = d.due && st !== "done" && d.due < today();
  const kindTag = s.kind === "gate" ? `<span class="tag gate">GATE</span>` : s.kind === "review" ? `<span class="tag">REVIEW</span>` : "";
  const head = `<button class="shead" data-act="toggle" data-s="${s.id}" aria-expanded="${open}">
      <span class="sno">${s.id.slice(1)}</span>
      <span style="min-width:0"><span class="stitle">${esc(s.title)}</span>
        <span class="smeta"><span class="tag">${ROLE[s.role].code}</span>${p ? whoListHTML(stepAssignees(p, s)) : `<span>${esc(ROLE[s.role].name)}</span>`}${kindTag}
        ${d.returned && st !== "done" ? `<span class="tag red">RETURNED</span>` : ""}
        ${outOfOrder(p, s) ? `<span class="tag ooo" title="Started before the steps it normally follows were finished">OUT OF ORDER</span>` : ""}
        ${s.id === "s03" && p && p.rev ? `<span class="tag">Rev ${revLetter(p.rev)}</span>` : ""}
        ${d.due ? `<span class="tag ${late ? "late" : ""}">Due ${esc(d.due)}</span>` : ""}
        <span>${nChk}/${s.checks.length} checks</span>
        ${d.outcome && st === "done" ? `<span>${esc(d.outcome)}</span>` : ""}</span></span>
      <span class="pill ${st}">${STAT_LABEL[st]}</span></button>`;
  if (!open) return `<div class="step ${st}${S.mine && p && !isMine(p, s) ? " dim" : ""}" id="step-${s.id}">${head}</div>`;

  const pend = (id) => { const t = STEPS[SIDX[id]]; return inScope(p, t) ? (stepData(p, id).status === "done" ? [] : [t]) : t.deps.flatMap(pend); };
  const waitingOn = p ? [...new Set(s.deps.flatMap(pend))] : [];
  const tgt = p && retTarget(p, s);
  const mayCheck = !!p && canEditChecklist(p, s.id, S.me && S.me.id);
  let actions = "";
  if (p) {
    if (waitingOn.length && st !== "done") actions = `<p class="hint" style="margin:0;flex-basis:100%">${st === "waiting" ? "Normally follows" : "Ahead of"} ${waitingOn.map((w) => `<b>${w.id.slice(1)} ${esc(w.title)}</b>`).join(", ")}. You can still work this step now.</p>`;
    if (st === "done") actions = `<button class="btn sm" data-act="reopen" data-s="${s.id}">Reopen</button>`;
    else {
      if (st === "todo" || st === "waiting") actions += `<button class="btn primary" data-act="start" data-s="${s.id}">Start</button>`;
      if (st === "blocked") actions += `<button class="btn" data-act="unblock" data-s="${s.id}">Clear block</button>`;
      if (s.kind === "task") actions += `<button class="btn ok" data-act="done" data-s="${s.id}">Mark done</button>`;
      if (s.kind === "review") actions += `<button class="btn ok" data-act="approve" data-s="${s.id}" data-o="Approved">Approve</button>`;
      if (s.kind === "gate") actions += `<button class="btn ok" data-act="approve" data-s="${s.id}" data-o="Approved">Approved</button><button class="btn ok" data-act="approve" data-s="${s.id}" data-o="Approved as noted">Approved as noted</button>`;
      if (st !== "blocked") actions += `<button class="btn red" data-act="block" data-s="${s.id}">Mark blocked</button>`;
    }
  }
  const ret = p && tgt && (s.kind === "review" || s.kind === "gate") && st !== "waiting" && st !== "done" ? `
    <div style="display:grid;gap:6px"><label class="label" for="ret_${s.id}">${s.kind === "gate" ? "Revise & resubmit — reviewer comments" : "Redline comments for return"}</label>
    <textarea id="ret_${s.id}" data-draft="ret_${s.id}" placeholder="What has to change?">${esc(S.drafts["ret_" + s.id] || "")}</textarea>
    <div class="actions"><button class="btn red solid" data-act="return" data-s="${s.id}">${s.kind === "gate" ? "Revise & resubmit" : "Return"} to ${tgt.slice(1)} ${esc(STEPS[SIDX[tgt]].title)}</button></div></div>` : "";
  const hist = S.log.filter((e) => e.sid === s.id).slice(0, 8);
  return `<div class="step ${st}" id="step-${s.id}">${head}
    <div class="sbody">
      <p class="hint" style="margin:0">${esc(s.hint)}</p>
      ${d.returned && st !== "done" && d.returnNote ? `<div class="redbox"><b>Returned:</b> ${esc(d.returnNote)}</div>` : ""}
      ${p ? renderStepAssign(p, s) : ""}
      <ul class="checks${p && !mayCheck ? " locked" : ""}">${s.checks.map((c, i) => `<li class="${checks[i] ? "on" : ""}"><label><input type="checkbox" id="chk_${s.id}_${i}" data-act="check" data-s="${s.id}" data-i="${i}" ${checks[i] ? "checked" : ""}${!p || !mayCheck ? " disabled" : ""}><span>${esc(c)}</span></label></li>`).join("")}</ul>
      ${p && !mayCheck ? `<p class="hint lock-note" style="margin:0">Only the people assigned to this step, the Project Manager, or the project's creator can tick these boxes.</p>` : ""}
      <div class="actions">${actions}</div>
      ${ret}
      ${p ? `<div class="row2"><label class="label" for="due_${s.id}">Due</label><input type="date" id="due_${s.id}" data-act="due" data-s="${s.id}" value="${esc(d.due || "")}"></div>
      <div style="display:grid;gap:6px"><label class="label" for="note_${s.id}">Add a note</label>
        <textarea id="note_${s.id}" data-draft="note_${s.id}" placeholder="RFI numbers, file locations, questions for the team…">${esc(S.drafts["note_" + s.id] || "")}</textarea>
        <div class="actions"><button class="btn sm" data-act="note" data-s="${s.id}">Post note</button></div></div>
      ${hist.length ? `<div class="hist">${hist.map(logLine).join("")}</div>` : ""}` : ""}
    </div></div>`;
}
const pickerOpen = (kind, key) => !!S.picker && S.picker.kind === kind && S.picker.key === key;
function memberChips(list) {
  return list.length ? `<span class="chips">${list.map((m) => `<span class="chip">${avatarHTML(m)}${esc(personName(m))}</span>`).join("")}</span>` : `<span class="muted">Unassigned</span>`;
}
function renderTeam(p) {
  const rows = ROLES.map((r) => {
    const list = roleMembers(p, r.k), open = pickerOpen("role", r.k);
    return `<div class="trow"><span class="rcode">${r.code}</span><div style="min-width:0"><div class="label" style="letter-spacing:.04em">${esc(r.name)}</div>${memberChips(list)}</div>
      <button class="btn sm" data-act="assign" data-r="${r.k}">${open ? "Done" : list.length ? "Edit" : "Assign"}</button></div>
      ${open ? renderPicker(list, "role") : ""}`;
  }).join("");
  return `<div class="panel"><div class="panel-h"><h2>Team</h2><span class="muted" style="font-size:12.5px">Default people for each role's steps</span></div><div class="team">${rows}</div></div>`;
}
function renderStepAssign(p, s) {
  const custom = stepIsCustom(p, s.id), list = stepAssignees(p, s), open = pickerOpen("step", s.id);
  return `<div class="assignrow"><span class="label">Assigned</span>${memberChips(list)}
      <span class="hint">${custom ? "Set for this step" : `From the ${esc(ROLE[s.role].name)} role`}</span>
      <button class="btn sm" data-act="assign-step" data-s="${s.id}">${open ? "Done" : "Edit"}</button></div>
    ${open ? renderPicker(list, "step") : ""}`;
}
function renderPicker(list, kind) {
  const q = (S.drafts.assign_q || "").toLowerCase();
  const hits = S.team.filter((u) => !q || u.name.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)).slice(0, 12);
  const labels = list.filter((m) => !m.id);
  return `<div class="picker">
    <span class="hint">Tap people to add or remove them. ${list.length} selected.</span>
    <input type="text" id="assign_q" data-act="search" placeholder="Filter, or type a name to add" value="${esc(S.drafts.assign_q || "")}" autocomplete="off">
    <div class="hits">${hits.map((h) => { const on = list.some((m) => m.id === h.id); return `<button data-act="pick-person" data-id="${esc(h.id)}" aria-pressed="${on}" class="${on ? "on" : ""}"><span class="tick">${on ? "✓" : ""}</span>${avatarHTML({ id: h.id })}<span>${esc(h.name)} <span class="muted">${esc(h.email || "")}</span></span></button>`; }).join("") || `<span class="muted" style="font-size:12.5px;padding:2px 4px">No one matches. Add them in Firebase, or add the typed name.</span>`}
    ${labels.map((m) => `<button data-act="pick-label" data-l="${esc(m.label)}" aria-pressed="true" class="on"><span class="tick">✓</span>${avatarHTML(m)}<span>${esc(m.label)} <span class="muted">typed name</span></span></button>`).join("")}</div>
    <div class="actions"><button class="btn sm" data-act="assign-label">Add typed name</button><button class="btn sm red" data-act="assign-clear">Clear all</button>${kind === "step" ? `<button class="btn sm" data-act="assign-default">Use role default</button>` : ""}<button class="btn sm primary" data-act="assign-close">Done</button></div>
  </div>`;
}
function renderLog() {
  const items = S.log.slice(0, 40);
  return `<div class="panel"><div class="panel-h"><h2>Activity</h2></div>${items.length ? `<div class="log">${items.map(logLine).join("")}</div>` : `<p class="muted" style="margin:0">Starts, hand-offs, returns and notes show up here for everyone.</p>`}
  ${S.confirmArchive ? `<div class="actions"><span class="hint">Archive this project for everyone?</span><button class="btn sm red solid" data-act="archive-yes">Archive</button><button class="btn sm" data-act="archive-no">Keep</button></div>` : `<div><button class="btn sm" data-act="archive">Archive project</button></div>`}</div>`;
}
const renderSteps = (p) => PHASES.map((name, i) => `<section class="phase"><div class="phase-h"><span class="n">${String(i + 1).padStart(2, "0")}</span><h2>${esc(name)}</h2></div>${STEPS.filter((s) => s.phase === i).map((s) => renderStep(p, s)).join("")}</section>`).join("");

function render() {
  if (!S.me) return;
  const fa = document.activeElement, fid = fa && fa.id, ss = fa && fa.selectionStart, se = fa && fa.selectionEnd, sy = window.scrollY;
  const p = project();
  let html = `<div class="wrap">` + renderTop() + renderNewForm();
  if (!S.loaded) {
    html += `<div class="panel"><p class="muted" style="margin:0">Loading the board…</p></div>`;
  } else if (!p) {
    html += `<div class="empty"><h3>No projects on the board yet</h3><p class="hint" style="margin:0">Create a project to start tracking it. Each project runs the 13 steps below: points list, controller schematics in Visio, engineering review, the submittal gate, programming, station graphics, QC and closeout. Turn drawings or submittals off for jobs that don't need them.</p>${S.showNew ? "" : `<div><button class="btn primary" data-act="newp">Create the first project</button></div>`}</div>${renderMap(null)}<div class="panel">${renderSteps(null)}</div>`;
  } else {
    html += renderTitle(p) + renderMap(p) +
      `<div class="grid"><div style="display:grid;gap:16px;min-width:0">
         <div class="panel"><div class="panel-h"><h2>Who has it now</h2></div>${renderNext(p)}</div>
         <div class="panel" style="gap:14px">${renderSteps(p)}</div>
       </div><div style="display:grid;gap:16px;min-width:0">${renderTeam(p)}${renderLog()}</div></div>`;
  }
  $app.innerHTML = html + `</div>`;
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch {} } }
  window.scrollTo(0, sy);
}

/* ---------------- writes ---------------- */
const P = () => S.pid;
function stepFields(sid, fields) {
  const out = {};
  for (const [k, v] of Object.entries({ ...fields, by: S.me.id, at: Date.now() })) out[`steps.${sid}.${k}`] = v;
  return out;
}
function stepAct(sid, fields, act, note) {
  return save(() => data.updateProject(S.me, P(), stepFields(sid, fields), act ? { sid, act, note } : null));
}
function returnWork(sid, note) {
  const s = STEPS[SIDX[sid]], target = retTarget(S.proj, s);
  if (!target) return;
  const fields = {};
  for (const id of downstream(target)) {
    Object.assign(fields, id === target
      ? stepFields(id, { status: "progress", returned: true, returnNote: note })
      : stepFields(id, { status: "todo", outcome: null, returned: false }));
  }
  S.expanded.add(target);
  return save(() => data.updateProject(S.me, P(), fields, { sid, act: s.kind === "gate" ? "resubmit" : "returned", note }, { bumpRev: target === "s03" }), "Returned with comments.");
}

/* ---------------- events ---------------- */
$app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !S.me || b.tagName === "SELECT" || b.type === "checkbox" || b.type === "date" || b.tagName === "INPUT") return;
  const a = b.dataset.act, sid = b.dataset.s, p = S.proj;
  switch (a) {
    case "toggle": S.expanded.has(sid) ? S.expanded.delete(sid) : S.expanded.add(sid); render(); break;
    case "jump": S.expanded.add(sid); render(); document.getElementById("step-" + sid)?.scrollIntoView({ block: "center", behavior: "smooth" }); break;
    case "mine": S.mine = b.dataset.v === "1"; if (S.mine && p) S.expanded = new Set(STEPS.filter((s) => isMine(p, s) && ["todo", "progress", "blocked"].includes(effStatus(p, s))).map((s) => s.id)); render(); break;
    case "newp": S.showNew = true; render(); document.getElementById("np_name")?.focus(); break;
    case "cancelnew": S.showNew = false; render(); break;
    case "signout": stopWatching(); data.signOutNow(); break;
    case "alerts": { const on = b.dataset.on !== "1"; save(() => data.setEmailAlerts(on), on ? "Email alerts on." : "Email alerts off."); break; }
    case "start": stepAct(sid, { status: "progress" }, "started"); break;
    case "done": { const s = STEPS[SIDX[sid]], c = (stepData(p, sid).checks || []).filter(Boolean).length;
      stepAct(sid, { status: "done", returned: false }, "done", c < s.checks.length ? `${s.checks.length - c} checklist item(s) left open` : ""); break; }
    case "approve": stepAct(sid, { status: "done", outcome: b.dataset.o, returned: false }, "approved", b.dataset.o !== "Approved" ? b.dataset.o : ""); break;
    case "block": { const n = (S.drafts["note_" + sid] || "").trim(); S.drafts["note_" + sid] = ""; stepAct(sid, { status: "blocked" }, "blocked", n); break; }
    case "unblock": stepAct(sid, { status: "progress" }, "unblocked"); break;
    case "reopen": stepAct(sid, { status: "progress" }, "reopened"); break;
    case "return": {
      const note = (S.drafts["ret_" + sid] || "").trim();
      if (!note) { toast("Add the redline comments before returning."); document.getElementById("ret_" + sid)?.focus(); return; }
      S.drafts["ret_" + sid] = ""; returnWork(sid, note); break;
    }
    case "note": { const n = (S.drafts["note_" + sid] || "").trim(); if (!n) { toast("Type a note first."); return; } S.drafts["note_" + sid] = ""; render(); save(() => data.addNote(S.me, P(), sid, n)); break; }
    case "assign": openPicker("role", b.dataset.r); break;
    case "assign-step": openPicker("step", sid); break;
    case "assign-close": S.picker = null; render(); break;
    case "pick-person": toggleMember({ id: b.dataset.id }); break;
    case "pick-label": toggleMember({ label: b.dataset.l }); break;
    case "assign-label": { const t = (S.drafts.assign_q || "").trim().slice(0, 60); if (!t) { toast("Type the person's name first."); return; } S.drafts.assign_q = ""; if (!pickerList().some((m) => !m.id && m.label === t)) toggleMember({ label: t }); break; }
    case "assign-clear": setMembers([], "Cleared"); break;
    case "assign-default": setMembers(null, "Back to role default"); break;
    case "archive": S.confirmArchive = true; render(); break;
    case "archive-no": S.confirmArchive = false; render(); break;
    case "archive-yes": S.confirmArchive = false; save(() => data.updateProject(S.me, P(), { archived: true }, { act: "archived" }), "Project archived."); break;
  }
});
function openPicker(kind, key) {
  S.picker = pickerOpen(kind, key) ? null : { kind, key };
  S.drafts.assign_q = ""; render();
  if (S.picker) document.getElementById("assign_q")?.focus();
}
function pickerList() {
  const pk = S.picker, p = S.proj; if (!pk || !p) return [];
  return pk.kind === "role" ? roleMembers(p, pk.key) : stepAssignees(p, STEPS[SIDX[pk.key]]);
}
function toggleMember(m) {
  const list = pickerList(), has = list.some((x) => sameMember(x, m));
  const next = has ? list.filter((x) => !sameMember(x, m)) : [...list, m];
  setMembers(next, `${has ? "Removed" : "Added"} ${personName(m)}`);
}
/** list = array of members, or null to put a step back on its role's default. */
function setMembers(list, verb) {
  const pk = S.picker; if (!pk) return;
  const before = pickerList();
  const clean = list && list.map((m) => (m.id ? { id: m.id } : { label: m.label }));
  const after = clean || (pk.kind === "step" ? roleMembers(S.proj, STEPS[SIDX[pk.key]].role) : []);
  // People newly on this role/step get an email (see netlify/functions/notify.mjs).
  const added = after.filter((m) => m.id && !before.some((b) => b.id === m.id)).map((m) => m.id);
  if (pk.kind === "role") {
    save(() => data.updateProject(S.me, P(), { ["team." + pk.key]: clean || [] }, { act: "assigned", note: `${verb} · ${ROLE[pk.key].name}`, extra: { added, target: { role: pk.key } } }));
  } else {
    save(() => data.updateProject(S.me, P(), { [`steps.${pk.key}.assignees`]: clean }, { sid: pk.key, act: "assigned", note: verb, extra: { added, target: { step: pk.key } } }));
  }
}
$app.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.draft) { S.drafts[t.dataset.draft] = t.value; return; }
  if (t.id && t.id.startsWith("np_") && t.type !== "checkbox") { S.drafts[t.id] = t.value; return; }
  if (t.dataset.act === "search") { S.drafts.assign_q = t.value; render(); }
});
$app.addEventListener("change", (e) => {
  const t = e.target, p = S.proj;
  if (!S.me) return;
  if (t.id === "np_draw" || t.id === "np_sub") { S.drafts[t.id] = t.checked; return; }
  if (t.dataset.act === "scope") {
    const k = t.dataset.k;
    save(() => data.updateProject(S.me, P(), { ["scope." + k]: t.checked }, { act: "scope", note: `${k === "drawings" ? "Controller drawings" : "Submittals"} turned ${t.checked ? "on" : "off"}` }));
    return;
  }
  if (t.dataset.act === "pick") { S.pid = t.value; store.set("sgf_pid", S.pid); S.proj = S.projects.find((x) => x.id === S.pid) || null; S.expanded.clear(); watchLog(); render(); return; }
  if (t.dataset.act === "check") {
    const sid = t.dataset.s, i = +t.dataset.i, s = STEPS[SIDX[sid]];
    if (!canEditChecklist(p, sid, S.me.id)) { t.checked = !t.checked; toast("Only this step's assignees, the PM or the project creator can tick these."); return; }
    const arr = s.checks.map((_, k) => !!((stepData(p, sid).checks || [])[k])); arr[i] = t.checked;
    const f = { checks: arr }; if (["todo", "waiting"].includes(effStatus(p, s)) && t.checked) f.status = "progress";
    stepAct(sid, f); return;
  }
  if (t.dataset.act === "due") stepAct(t.dataset.s, { due: t.value || null });
});
$app.addEventListener("submit", async (e) => {
  if (e.target.id !== "newform") return;
  e.preventDefault();
  const name = (S.drafts.np_name || "").trim().slice(0, 120); if (!name) { toast("Give the project a name."); return; }
  try {
    const id = await data.createProject(S.me, {
      name, number: (S.drafts.np_num || "").trim().slice(0, 40), customer: (S.drafts.np_cust || "").trim().slice(0, 120),
      scope: { drawings: S.drafts.np_draw !== false, submittals: S.drafts.np_sub !== false },
    });
    S.pid = id; store.set("sgf_pid", id); S.showNew = false; S.expanded.clear();
    for (const k of ["np_name", "np_num", "np_cust", "np_draw", "np_sub"]) delete S.drafts[k];
    S.proj = S.projects.find((x) => x.id === id) || S.proj; watchLog(); render();
    toast("Project created. You're set as Project Manager — assign the other roles.");
  } catch (x) { console.error(x); toast(x && x.code === "permission-denied" ? "You don't have access to add projects." : "Could not create the project. Try again."); }
});

/* ---------------- boot ---------------- */
function enterBoard() {
  render();
  startWatching();
}
function boot() {
  if (!data.configured) return showSetup();
  data.onUser((u) => {
    stopWatching();
    if (!u) { S.me = null; S.projects = []; S.proj = null; S.pid = null; S.loaded = false; return showLogin(); }
    S.me = u;
    if (!u.name) return showName();
    // Keep the team directory entry current (also confirms the email is on the team list).
    data.saveMyName(u.name).then(enterBoard, (x) => (x && x.code === "permission-denied" ? showNoAccess() : enterBoard()));
  });
}
boot();
