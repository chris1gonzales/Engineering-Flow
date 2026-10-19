// Regenerates the step -> role list inside firestore.rules from public/flow.js,
// so the database rules always match the app. Run: npm run rules
import { readFileSync, writeFileSync } from "node:fs";
import { STEPS } from "../public/flow.js";

const file = new URL("../firestore.rules", import.meta.url);
const src = readFileSync(file, "utf8");
const begin = "    // BEGIN GENERATED STEP LIST (npm run rules)";
const end = "    // END GENERATED STEP LIST";
const a = src.indexOf(begin), b = src.indexOf(end);
if (a < 0 || b < 0) throw new Error("Generated markers not found in firestore.rules");
const body = [
  begin,
  "    function checklistsAllowed() {",
  "      return " + STEPS.map((s) => `mayCheck('${s.id}', '${s.role}')`).join("\n        && ") + ";",
  "    }",
  "",
].join("\n");
writeFileSync(file, src.slice(0, a) + body + src.slice(b));
console.log(`firestore.rules: ${STEPS.length} steps written.`);
