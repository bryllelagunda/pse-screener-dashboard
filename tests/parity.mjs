// Parity check: the browser's filter logic must match pse_screener.evaluate exactly.
// The fixture and results live in the PRIVATE pse-screener repository, so this runs locally:
//   node tests/parity.mjs [path/to/pse-screener] [results.csv ...]
// It checks every case in tests/fixtures/filter_cases.json, then (for each CSV given) that the
// recomputed Strict/Loose pass flags and reason text equal the screener's own columns.
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const src = html.slice(html.indexOf("/* FILTER-START"), html.indexOf("/* FILTER-END */"));
if (!src) throw new Error("filter block markers not found in index.html");
const {PRESETS, evaluate, parseCSV, fmt} = new Function(src + "; return {PRESETS, evaluate, parseCSV, fmt};")();

const [repo = join(here, "..", "..", "pse-screener"), ...csvs] = process.argv.slice(2);
let bad = 0;
const fail = msg => { bad++; console.log("FAIL " + msg); };

// 1. Shared fixture cases (same assertions as tests/test_filters.py)
const spec = JSON.parse(readFileSync(join(repo, "tests", "fixtures", "filter_cases.json"), "utf8"));
const sets = {...PRESETS, custom: spec.custom};
for (const c of spec.cases) {
  const why = evaluate(c.row, sets[c.preset], spec.data_date);
  if (!why.length !== c.pass) fail(`${c.name}: pass=${!why.length}, want ${c.pass} (${why.join("; ")})`);
  if (c.reason && !why.includes(c.reason)) fail(`${c.name}: reason "${c.reason}" not in [${why.join("; ")}]`);
}
console.log(`fixture: ${spec.cases.length} cases`);

// 2. Number formatting against Python's _fmt, including half-even ties and negative zero
const nums = [0, -0, 4.1, 5, -6.7633, 73366.67, 1e9, 999999999, 0.125, 0.375, 2.675, 1.005, -0.001, 102.0725, 1234567.895, 0.5, 20.01];
const py = execFileSync("python3", ["-c",
  "import json,sys\nfor x in json.loads(sys.argv[1]): print(f'{x:,.2f}'.rstrip('0').rstrip('.'))",
  JSON.stringify(nums.map(n => Object.is(n, -0) ? "NEG0" : n)).replace('"NEG0"', "-0.0")]).toString().trim().split("\n");
nums.forEach((n, i) => { if (fmt(n) !== py[i]) fail(`fmt(${Object.is(n, -0) ? "-0" : n}) = ${fmt(n)}, Python ${py[i]}`); });
console.log(`fmt: ${nums.length} values`);

// 3. Real results files: pass flags and the exact reason text
for (const path of csvs) {
  const rows = parseCSV(readFileSync(path, "utf8"));
  let n = 0;
  for (const r of rows) for (const p in PRESETS) {
    const why = evaluate(r, PRESETS[p], r.data_date);
    if (!why.length !== r["pass_" + p]) { fail(`${path} ${r.symbol} ${p}: pass=${!why.length}, screener ${r["pass_" + p]}`); continue; }
    if (why.join("; ") !== (r["fail_" + p] || "")) fail(`${path} ${r.symbol} ${p}: "${why.join("; ")}" vs "${r["fail_" + p]}"`);
    n++;
  }
  console.log(`${path}: ${rows.length} stocks, ${n} preset checks`);
}

console.log(bad ? `${bad} mismatch(es)` : "parity OK");
process.exit(bad ? 1 : 0);
