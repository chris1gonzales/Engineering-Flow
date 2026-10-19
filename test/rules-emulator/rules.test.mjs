// Real security-rules test against the Firebase emulator.
// From this folder: npm install && npm test   (needs Java 11+)
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-bas-flow",
  firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
});
const people = ["creator", "pm1", "eng1", "viz1", "dana", "outsider"];
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@appliedbas.test` }).firestore();

async function reset(steps = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/access"), { emails: people.filter((p) => p !== "outsider").map((p) => `${p}@appliedbas.test`) });
    await setDoc(doc(db, "projects/p1"), {
      name: "Central Plant", createdBy: "creator", archived: false, rev: 0,
      team: { pm: [{ id: "pm1" }], eng: [{ id: "eng1" }], cad: [{ id: "viz1" }, { label: "Contractor Joe" }], gfx: [{ id: "dana" }] },
      steps,
    });
  });
}
const tick = (uid, sid, checks = [true, false, false, false]) => updateDoc(doc(as(uid), "projects/p1"), { [`steps.${sid}.checks`]: checks });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("ok -", name); };

await reset();
await t("assignee can check", () => assertSucceeds(tick("viz1", "s03")));
await t("non-assignee is rejected", () => assertFails(tick("eng1", "s03")));
await t("PM override", () => assertSucceeds(tick("pm1", "s03", [true, true, false, false])));
await t("creator override", () => assertSucceeds(tick("creator", "s03", [true, true, true, false])));
await t("non-assignee can't uncheck", () => assertFails(tick("eng1", "s03", [false, false, false, false])));
await t("non-assignee can still change status", () => assertSucceeds(updateDoc(doc(as("eng1"), "projects/p1"), { "steps.s03.status": "done" })));
await t("non-assignee can still reassign", () => assertSucceeds(updateDoc(doc(as("eng1"), "projects/p1"), { "team.gfx": [{ id: "eng1" }] })));
await t("outsider rejected entirely", () => assertFails(tick("outsider", "s01")));

await reset({ s03: { assignees: [{ id: "eng1" }] } });
await t("custom step list grants access", () => assertSucceeds(tick("eng1", "s03")));
await t("custom step list replaces the role", () => assertFails(tick("viz1", "s03")));
await t("can't self-assign and tick in one write", () =>
  assertFails(updateDoc(doc(as("dana"), "projects/p1"), { "steps.s03.assignees": [{ id: "dana" }], "steps.s03.checks": [true] })));

await reset({ s09: { assignees: [{ label: "Contractor Joe" }] } });
await t("typed-name-only step: role member rejected", () => assertFails(tick("dana", "s09")));
await t("typed-name-only step: PM still allowed", () => assertSucceeds(tick("pm1", "s09")));

await env.cleanup();
console.log(`${n} rules tests passed`);
