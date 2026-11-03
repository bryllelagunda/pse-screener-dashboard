// Parity check: the browser's filter logic must match pse_screener.evaluate exactly.
// The fixture and results live in the PRIVATE pse-screener repository, so this runs locally:
//   node tests/parity.mjs [path/to/pse-screener] [results.csv ...]
// It checks every case in tests/fixtures/filter_cases.json, then (for each CSV given) that the
// recomputed Strict/Loose pass flags and reason text equal the screener's own columns.
import {readFileSync, existsSync} from "node:fs";
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

// 4. Slider settings vs Python evaluate, called directly.
// Value: protects=Custom slider/checkbox results (incl. "off" = 0 thresholds, band edges, missing data) match pse_screener.evaluate;
//   fails_when=an off-switch (`> 0`), comparison, band bound, missing-data rule or fetch/stale precedence drifts from Python;
//   why_new=the fixture has one custom case and sections 1/3 only exercise the two presets; no case has a fetch error or null sessions;
//   seam=none; no_claim=UI slider wiring, parseMoney, URL round-trip, new/dropped/missed lists.
{
  const py = [join(repo, ".venv", "bin", "python"), "python3"].find(p => p === "python3" || existsSync(p));
  const base = {symbol: "SYN", data_date: "2026-01-02", stale: false, fetch_error: null, sessions: 260, close: 50, sma50: 48,
    sma200: 45, roc9: 6, avg_value_30d: 8e6, mcap: 3e9, value_today: 2e7, pct_high_above_close: 10, atr_pct14: 2.5};
  const synth = [base, {...base, fetch_error: "HTTP 500"}, {...base, fetch_error: "timeout", stale: true}, {...base, stale: true},
    {...base, sessions: null, sma200: null}, (({sessions, ...r}) => ({...r, sma50: null}))(base), {...base, close: NaN},
    {...base, mcap: null}, {...base, value_today: null}, {...base, sma50: null, sma200: null, avg_value_30d: null, atr_pct14: null},
    {...base, close: 1, roc9: -20, pct_high_above_close: 0, atr_pct14: 15}, {...base, close: 0.5, avg_value_30d: 0, value_today: 0}];
  const rows = [...synth, ...csvs.flatMap(p => parseCSV(readFileSync(p, "utf8")))];
  const vary = {above_sma200: [false, true], above_sma50: [false, true], sma50_above_sma200: [false, true], roc9_min: [-20, 0, 30],
    price_min: [0, 0.5, 1], avg_value_min: [0, 1e6, 1e8], mcap_min: [0, 1e8, 1e11], value_today_min: [0, 1e6, 1e8],
    high_band: [[0, 100], [5, 5], [0, 0]], atr_band: [[0, 15], [2.5, 2.5], [0, 0.5]]};
  const sets = [];
  for (const b of [PRESETS.strict, PRESETS.loose, spec.custom]) for (const k in vary) for (const v of vary[k]) sets.push({...b, [k]: v});
  const NAN = "__NaN__", dd = r => r.data_date || "2026-01-02";
  const input = JSON.stringify({rows, sets, dates: rows.map(dd)}, (k, v) => Number.isNaN(v) ? NAN : v).replaceAll(`"${NAN}"`, "NaN");
  const out = execFileSync(py, ["-c", [
    "import json,sys", "sys.path.insert(0, sys.argv[1])", "from pse_screener import evaluate", "d = json.load(sys.stdin)",
    "print(json.dumps([['; '.join(evaluate(r, s, dt)) for r, dt in zip(d['rows'], d['dates'])] for s in d['sets']]))"].join("\n"), repo],
    {input, maxBuffer: 1 << 28}).toString();
  const want = JSON.parse(out);
  let n = 0;
  sets.forEach((s, i) => rows.forEach((r, j) => {
    const got = evaluate(r, s, dd(r)).join("; ");
    if (got !== want[i][j]) fail(`settings ${JSON.stringify(s)} ${r.symbol}#${j}: "${got}" vs Python "${want[i][j]}"`);
    n++;
  }));
  console.log(`settings: ${sets.length} slider settings x ${rows.length} rows (${n} checks)`);
}

// 5. parseCSV edge cases the screener's own files don't contain.
// Value: protects=Load CSV reads Excel-resaved or hand-edited results files correctly;
//   fails_when=the invisible BOM literal is stripped by an editor, "" escapes or quoted newlines break, short rows or blank lines mis-parse, or empty cells become 0/"" instead of null;
//   why_new=the real results CSV has no BOM, no "" escapes and no short rows; seam=none; no_claim=file picker, looksLikeResults gate, rendering.
{
  const text = '﻿symbol,name,sessions,stale,pass_strict\r\nAAA,"Foo, ""Inc""\nline2",12,true,false\r\nBBB,,,,\r\n\r\nCCC,Bar';
  const want = [{symbol: "AAA", name: 'Foo, "Inc"\nline2', sessions: 12, stale: true, pass_strict: false},
    {symbol: "BBB", name: null, sessions: null, stale: null, pass_strict: null},
    {symbol: "CCC", name: "Bar", sessions: null, stale: null, pass_strict: null}];
  for (const [label, t] of [["CRLF", text], ["LF", text.replaceAll("\r\n", "\n")], ["CR", text.replaceAll("\r\n", "\r")]]) {
    const got = JSON.stringify(parseCSV(t));
    if (got !== JSON.stringify(want)) fail(`parseCSV ${label}: ${got}`);
  }
  console.log("parseCSV: 3 line-ending variants");
}

console.log(bad ? `${bad} mismatch(es)` : "parity OK");
process.exit(bad ? 1 : 0);
