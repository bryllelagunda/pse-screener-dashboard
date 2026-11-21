// Every check CI runs, in order, with a pass/fail table. Run it on the final tree before every push:
//   node tests/all.mjs
// Its first row switches the before-push check on (or checks it): it may write .git/hooks/pre-push.local, and
// .git/hooks/pre-push only when none exists (plan § 3). In CI (GITHUB_ACTIONS set) that row is skipped.
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {ensureHook} from "./static.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const RUNS = [["static.mjs"], ["guards.mjs"], ["screens.mjs"], ["status.mjs"], ["history.mjs"], ["summary.mjs"], ["key.mjs"], ["demo.mjs", "check"]];
let failed = 0, total = RUNS.length;
const rows = [];
if (!process.env.GITHUB_ACTIONS) {
  total++;
  let h; try { h = ensureHook(); } catch (e) { h = {ok: false, msg: "pre-push check: internal error (" + String(e.message).split("\n")[0] + ")"}; }
  if (!h.ok) { failed++; process.stdout.write(`\n--- pre-push check\n${h.msg}\n`); }
  rows.push(["pre-push check", h.ok ? "pass" : "FAIL", h.msg.replace(/^pre-push check: /, "").slice(0, 60)]);
}
for (const [f, ...a] of RUNS) {
  const r = spawnSync(process.execPath, [here + f, ...a], {encoding: "utf8"});
  if (r.status !== 0) { failed++; process.stdout.write(`\n--- ${f} ${a.join(" ")}\n${r.stdout}${r.stderr}`); }
  rows.push([(f + " " + a.join(" ")).trim(), r.status === 0 ? "pass" : "FAIL", (r.stdout.trim().split("\n").pop() || "").slice(0, 60)]);
}
console.log("\n" + rows.map(([c, s, l]) => c.padEnd(16) + s.padEnd(6) + l).join("\n"));
console.log(failed ? `\n${failed} of ${total} checks failed: do not push` : `\nall ${total} checks pass`);
process.exit(failed ? 1 : 0);
