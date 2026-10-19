// Checklist permission: who may tick a step's boxes.
// 1) canEditChecklist() in public/flow.js (what the page uses)
// 2) a line-for-line JavaScript mirror of the firestore.rules functions,
//    run against whole before/after project writes
// 3) the rules' generated step list matches public/flow.js
// The real rules are exercised by test/rules-emulator (needs the Firebase emulator).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STEPS, canEditChecklist } from "../public/flow.js";

const project = () => ({
  createdBy: "creator",
  team: { pm: [{ id: "pm1" }], eng: [{ id: "eng1" }], cad: [{ id: "viz1" }, { label: "Contractor Joe" }], prog: [{ id: "prg" }], gfx: { id: "dana" } /* old single-person shape */ },
  steps: {},
});

/* ---- 1. page logic ---- */
let p = project();
assert.equal(canEditChecklist(p, "s03", "viz1"), true, "role member (assignee) can check");
assert.equal(canEditChecklist(p, "s03", "eng1"), false, "non-assignee is refused");
assert.equal(canEditChecklist(p, "s03", "pm1"), true, "PM override");
assert.equal(canEditChecklist(p, "s03", "creator"), true, "creator override");
assert.equal(canEditChecklist(p, "s08", "dana"), true, "legacy single-person role still counts");
p.steps.s03 = { assignees: [{ id: "eng1" }] };
assert.equal(canEditChecklist(p, "s03", "eng1"), true, "custom per-step list grants access");
assert.equal(canEditChecklist(p, "s03", "viz1"), false, "custom per-step list replaces the role");
p = project();
assert.equal(canEditChecklist(p, "s03", "Contractor Joe"), false, "typed-name assignee can't check");
p.steps.s09 = { assignees: [{ label: "Contractor Joe" }] };
assert.equal(canEditChecklist(p, "s09", "dana"), false, "typed-name-only step: role members are no longer assignees");
assert.equal(canEditChecklist(p, "s09", "pm1"), true, "...but the PM still can");
assert.equal(canEditChecklist(p, "s03", null), false, "signed-out can't");

/* ---- 2. mirror of firestore.rules ---- */
// Each function below matches the rules function of the same name.
const get = (m, k, d) => (m && Object.prototype.hasOwnProperty.call(m, k) ? m[k] : d);
const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function rulesAllow(before, after, uid) {
  const roleList = (data, role) => { const v = get(get(data, "team", {}), role, null); return Array.isArray(v) ? v : isMap(v) ? [v] : []; };
  const stepMap = (data, sid) => { const s = get(get(data, "steps", {}), sid, {}); return isMap(s) ? s : {}; };
  const assigneesOf = (data, sid, role) => { const c = get(stepMap(data, sid), "assignees", null); return Array.isArray(c) ? c : roleList(data, role); };
  const meIn = (list) => list.some((m) => eq(m, { id: uid })); // rules: {'id': uid} in list
  const isLead = () => get(before, "createdBy", "") === uid || meIn(roleList(before, "pm"));
  const checksChanged = (sid) => !eq(get(stepMap(after, sid), "checks", []), get(stepMap(before, sid), "checks", []));
  const mayCheck = (sid, role) => !checksChanged(sid) || isLead() || meIn(assigneesOf(before, sid, role));
  return STEPS.every((s) => mayCheck(s.id, s.role));
}
const withSteps = (base, steps) => ({ ...structuredClone(base), steps: { ...structuredClone(base.steps), ...steps } });
const before = project();
const tick = (sid) => withSteps(before, { [sid]: { checks: [true, false, false, false] } });

assert.equal(rulesAllow(before, tick("s03"), "viz1"), true, "rules: assignee can check");
assert.equal(rulesAllow(before, tick("s03"), "eng1"), false, "rules: non-assignee rejected");
assert.equal(rulesAllow(before, tick("s03"), "pm1"), true, "rules: PM override");
assert.equal(rulesAllow(before, tick("s03"), "creator"), true, "rules: creator override");
assert.equal(rulesAllow(before, tick("s08"), "dana"), true, "rules: legacy single-person role");
const custom = withSteps(before, { s03: { assignees: [{ id: "eng1" }] } });
assert.equal(rulesAllow(custom, withSteps(custom, { s03: { assignees: [{ id: "eng1" }], checks: [true] } }), "eng1"), true, "rules: custom list grants");
assert.equal(rulesAllow(custom, withSteps(custom, { s03: { assignees: [{ id: "eng1" }], checks: [true] } }), "viz1"), false, "rules: custom list replaces role");
const labelOnly = withSteps(before, { s09: { assignees: [{ label: "Contractor Joe" }] } });
assert.equal(rulesAllow(labelOnly, withSteps(labelOnly, { s09: { assignees: [{ label: "Contractor Joe" }], checks: [true] } }), "dana"), false, "rules: typed-name step locks role members out");
// Unchecking is a change too.
const ticked = tick("s03");
assert.equal(rulesAllow(ticked, withSteps(ticked, { s03: { checks: [false, false, false, false] } }), "eng1"), false, "rules: non-assignee can't uncheck");
// Other edits stay open to everyone.
assert.equal(rulesAllow(ticked, withSteps(ticked, { s03: { checks: [true, false, false, false], status: "done", by: "eng1" } }), "eng1"), true, "rules: status change by non-assignee allowed");
assert.equal(rulesAllow(before, { ...structuredClone(before), team: { ...before.team, cad: [{ id: "eng1" }] } }, "eng1"), true, "rules: reassignment allowed");
// Assigning yourself and ticking in one write is judged on the old assignment.
assert.equal(rulesAllow(before, withSteps(before, { s03: { assignees: [{ id: "eng1" }], checks: [true] } }), "eng1"), false, "rules: can't self-assign and tick in one write");
// A return (status reset on later steps, checklists untouched) by a reviewer is allowed.
const worked = withSteps(before, { s05: { checks: [true, true, false, false], status: "done" } });
assert.equal(rulesAllow(worked, withSteps(worked, { s03: { status: "progress", returned: true }, s05: { checks: [true, true, false, false], status: "todo" } }), "eng1"), true, "rules: return without touching checklists");
// Two steps in one write: one allowed, one not -> rejected.
assert.equal(rulesAllow(before, withSteps(before, { s03: { checks: [true] }, s07: { checks: [true] } }), "viz1"), false, "rules: every changed checklist must be allowed");

/* ---- 3. generated rules match flow.js ---- */
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const listed = [...rules.matchAll(/mayCheck\('(s\d+)', '(\w+)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
assert.deepEqual(listed, STEPS.map((s) => `${s.id}:${s.role}`), "firestore.rules step list is out of date: run npm run rules");
assert.match(rules, /&& checklistsAllowed\(\);/, "update rule must call checklistsAllowed()");

console.log("Checklist permission tests passed");
