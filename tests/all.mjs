// Every check CI runs, in order, with a pass/fail table. Run it on the final tree before every push:
//   node tests/all.mjs
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const RUNS = [["static.mjs"], ["guards.mjs"], ["screens.mjs"], ["status.mjs"], ["history.mjs"], ["summary.mjs"], ["key.mjs"], ["demo.mjs", "check"]];
let failed = 0;
const rows = RUNS.map(([f, ...a]) => {
  const r = spawnSync(process.execPath, [here + f, ...a], {encoding: "utf8"});
  if (r.status !== 0) { failed++; process.stdout.write(`\n--- ${f} ${a.join(" ")}\n${r.stdout}${r.stderr}`); }
  return [(f + " " + a.join(" ")).trim(), r.status === 0 ? "pass" : "FAIL", (r.stdout.trim().split("\n").pop() || "").slice(0, 60)];
});
console.log("\n" + rows.map(([c, s, l]) => c.padEnd(16) + s.padEnd(6) + l).join("\n"));
console.log(failed ? `\n${failed} of ${RUNS.length} checks failed: do not push` : `\nall ${RUNS.length} checks pass`);
process.exit(failed ? 1 : 0);
