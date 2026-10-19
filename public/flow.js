// Shared process definition, used by the page and by the API function.
// Edit step titles, checklists and dependencies here.

export const ROLES = [
  {k:"pm",  code:"PM",  name:"Project Manager"},
  {k:"eng", code:"ENG", name:"BAS Engineer"},
  {k:"cad", code:"VSO", name:"Visio Drafter"},
  {k:"prog",code:"PRG", name:"Programmer"},
  {k:"gfx", code:"GFX", name:"Station Designer"}
];
export const ROLE = Object.fromEntries(ROLES.map(r=>[r.k,r]));
export const PHASES = ["Setup","Schematics","Submittal","Programming","Graphics","Closeout"];
export const STEPS = [
 {id:"s01",phase:0,role:"pm",kind:"task",deps:[],title:"Kickoff & document intake",
  hint:"Collect everything engineering needs before a single point is listed.",
  checks:["Mechanical plans & equipment schedules received","Sequences of operation received","Controls spec section (23 09 00 / 23 09 23) reviewed","Project folder & drawing numbering set up"]},
 {id:"s02",phase:0,role:"eng",kind:"task",deps:["s01"],title:"Points list & controller selection",
  hint:"Build the points list per equipment and allocate I/O to controllers.",
  checks:["Equipment inventory built","Points list per equipment (AI / AO / BI / BO)","Controllers & expansion modules selected, spare I/O allowed","Network riser defined (BACnet MS/TP / IP trunks, addressing)"]},
 {id:"s03",phase:1,role:"cad",kind:"task",deps:["s02"],title:"Controller schematic drawings (Visio)",
  hint:"Wiring diagrams per controller in Visio, drawn from the approved I/O allocation.",
  checks:["Wiring diagram per controller","Terminal numbers match I/O allocation","Panel layout & 24 VAC power (transformer sizing, Class 2)","Network riser drawing","Title block, sheet numbers & revision set","Visio file saved to project folder & PDF exported"]},
 {id:"s04",phase:1,role:"eng",kind:"review",deps:["s03"],returnsTo:["s03"],title:"Engineering review of schematics",
  hint:"Redline anything wrong and return it to the drafter, or approve for submittal.",
  checks:["I/O matches points list","Device part numbers match spec","Transformer loading & fusing checked","Sequences of operation reflected"]},
 {id:"s05",phase:2,role:"pm",kind:"task",deps:["s04"],title:"Assemble submittal package",
  hint:"Schematics, cut sheets, sequences and bill of materials in one transmittal.",
  checks:["Schematics & riser included","Product data / cut sheets included","Sequences of operation included","Transmitted to GC / engineer of record"]},
 {id:"s06",phase:2,role:"pm",kind:"gate",deps:["s05"],returnsTo:["s03","s05"],title:"Submittal approval",
  hint:"Hard gate. Programming and graphics build do not start until the submittal comes back approved.",
  checks:["Reviewer comments logged","Comments distributed to engineer & drafter"]},
 {id:"s07",phase:3,role:"prog",kind:"task",deps:["s06"],title:"Point naming & station database",
  hint:"Programming and the Niagara database the graphics will bind to.",
  checks:["Naming convention & tagging applied","Controller programs built per sequence","Points discovered / created in station","Point list handed to Station Designer"]},
 {id:"s08",phase:4,role:"gfx",kind:"task",deps:["s02"],title:"Graphics templates & navigation",
  hint:"Can start as soon as the points list exists; runs in parallel with schematics.",
  checks:["Nav tree / site hierarchy","Floor plan backgrounds","Equipment templates (AHU, RTU, VAV, FCU…)","Customer graphic standards applied"]},
 {id:"s09",phase:4,role:"gfx",kind:"task",deps:["s07","s08"],title:"Station graphics build",
  hint:"Build pages from templates once the database is ready.",
  checks:["Equipment pages","Floor plans with zone values","Summary / tabular pages","Alarm & schedule pages"]},
 {id:"s10",phase:4,role:"prog",kind:"review",deps:["s09"],returnsTo:["s09"],title:"Point binding check",
  hint:"Programmer confirms every value on every page is bound to the right point.",
  checks:["Every value bound to the correct ord","Writable points & overrides work","Units & facets correct"]},
 {id:"s11",phase:4,role:"eng",kind:"review",deps:["s10"],returnsTo:["s09"],title:"Graphics QC review",
  hint:"Graphics agree with schematics and sequences before turnover.",
  checks:["Graphics match schematics & sequences","Labels & spelling","Consistent with standards"]},
 {id:"s12",phase:5,role:"cad",kind:"task",deps:["s11"],title:"As-built schematics (Visio)",
  hint:"Fold field redlines into the final Visio drawing set.",
  checks:["Field redlines collected","Redlines incorporated","Final as-built revision issued"]},
 {id:"s13",phase:5,role:"pm",kind:"task",deps:["s12"],title:"Turnover & closeout",
  hint:"Deliver the documents and close the job.",
  checks:["Station backup archived","As-builts & O&M delivered","Customer sign-off received"]}
];
export const SIDX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));
export const DRAW_STEPS = ["s03", "s04", "s12"];
export const SUB_STEPS = ["s05", "s06"];

export function scopeOf(p) {
  const sc = (p && p.scope) || {};
  return { drawings: sc.drawings !== false, submittals: sc.submittals !== false };
}
export function inScope(p, s) {
  if (!p) return true;
  const sc = scopeOf(p);
  if (!sc.drawings && DRAW_STEPS.includes(s.id)) return false;
  if (!sc.submittals && SUB_STEPS.includes(s.id)) return false;
  return true;
}
/** First in-scope step a review or gate sends work back to. */
export function retTarget(p, s) {
  return (s.returnsTo || []).find((id) => inScope(p, STEPS[SIDX[id]])) || null;
}
/** The step and every step that depends on it, directly or not. */
export function downstream(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of STEPS) {
      if (!out.has(s.id) && s.deps.some((d) => out.has(d))) { out.add(s.id); grew = true; }
    }
  }
  return out;
}

/* ---------- shared status + assignment logic (used by email alerts) ---------- */
export const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((m) => m && (m.id || m.label));
export const stepState = (p, id) => (p && p.steps && p.steps[id]) || {};
export function depsMet(p, id) {
  const s = STEPS[SIDX[id]];
  return inScope(p, s) ? stepState(p, id).status === "done" : s.deps.every((x) => depsMet(p, x));
}
/** waiting | todo | progress | blocked | done | skipped */
export function statusOf(p, s) {
  if (!inScope(p, s)) return "skipped";
  const d = stepState(p, s.id);
  if (d.status === "done" || d.status === "progress" || d.status === "blocked") return d.status;
  return s.deps.some((x) => !depsMet(p, x)) ? "waiting" : "todo";
}
export const roleMembersOf = (p, role) => asList(p && p.team && p.team[role]);
export function assigneesOf(p, s) {
  const d = stepState(p, s.id);
  return Array.isArray(d.assignees) ? asList(d.assignees) : roleMembersOf(p, s.role);
}
/** True if step `s` waits on step `id`, directly or through steps that are out of scope. */
export function waitsOn(p, s, id) {
  return s.deps.some((d) => d === id || (!inScope(p, STEPS[SIDX[d]]) && waitsOn(p, STEPS[SIDX[d]], id)));
}

/* ---------- checklist permission (mirrored in firestore.rules) ---------- */
/**
 * Who may tick or untick a step's checklist: the step's assignees (account
 * holders only, not typed names), the project's PMs, and the project creator.
 * firestore.rules enforces the same thing; keep the two in sync
 * (run `npm run rules` after changing step roles).
 */
export function canEditChecklist(p, stepId, uid) {
  if (!p || !uid) return false;
  if (p.createdBy === uid) return true;
  if (roleMembersOf(p, "pm").some((m) => m.id === uid)) return true;
  const s = STEPS[SIDX[stepId]];
  return !!s && assigneesOf(p, s).some((m) => m.id === uid);
}
