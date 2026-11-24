// A local test server for /qa and /design-review: the real index.html and app.js with made-up data and a fake GitHub.
// Nothing leaves this computer: it listens on 127.0.0.1 only, reads only index.html, app.js, manifest.webmanifest and
// icon.png, and the page's fetch is replaced by one that never calls the real one (fakes.js, made in memory). No rows live in this file:
// a column list and a fixed-seed generator make every number, and the page's own evaluate() sets the pass columns.
//   node tests/demo.mjs --help
//   node tests/demo.mjs serve [--day <name>] [--key-days <n> | --key-no-date | --no-key] [--github <mode>] [--skew] ...
//   node tests/demo.mjs check [--today YYYY-MM-DD]      (CI: every --day on three pinned dates)
// tests/static.mjs holds this file to its rules (DEMO-ROWS, DEMO-WRITE, DEMO-READ, DEMO-LISTEN).
import {readFileSync} from "node:fs";
import {createServer} from "node:http";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const READ = Object.freeze({"/": "index.html", "/app.js": "app.js", "/manifest.webmanifest": "manifest.webmanifest", "/icon.png": "icon.png"});
const read = p => { if (!Object.hasOwn(READ, p)) throw new Error("demo.mjs: not a served file"); return readFileSync(join(ROOT, READ[p])); };

const DAYS = ["normal", "empty", "holiday", "stale", "failed", "no-compare",
  "no-history", "provisional", "no-closes"];
const GITHUB = ["ok", "401", "403", "403-rate", "500", "offline"];
const FAIL_AS = ["404", "timeout", "401"]; // --fail-as: how the one --fail-day file fails
const CLOSES_FAIL = ["404", "timeout", "401", "500", "stamp", "bad"]; // --closes-fail: how results/closes.csv fails (stamp: from another run)
const PINNED = ["2026-11-24", "2026-11-21", "2026-11-30"]; // a Tuesday, a Saturday, a Monday after a made-up holiday (Fri Nov 27)
const COLUMNS = [
  "symbol",
  "name",
  "data_date",
  "stale",
  "fetch_error",
  "sessions",
  "close",
  "chg_pct",
  "value_today",
  "cci20",
  "atr_pct14",
  "roc9",
  "pct_vs_sma50",
  "pct_vs_sma200",
  "sma50",
  "sma200",
  "high_52w",
  "pct_high_above_close",
  "avg_value_30d",
  "mcap",
  "pass_strict",
  "pass_loose",
];

// The page's own code, sliced by its markers (the pattern tests/screens.mjs uses)
export function pageCode(js = read("/app.js").toString()) {
  const block = (a, b) => { const i = js.indexOf(a), j = js.indexOf(b); if (i < 0 || j < 0) throw new Error("demo.mjs: " + a + " markers not found"); return js.slice(i, j); };
  const names = ["filter", "history", "status", "summary", "key", "chart"].map(n => n.toUpperCase());
  const src = names.map(n => block("/* " + n + "-START", "/* " + n + "-END */")).join("\n");
  const names2 = "evaluate, parseCSV, dayRows, parseHistory, HHEAD, PRESETS, missedRun, manilaISO, addDays, isDay, keyBand, shouldRefresh, mood, parseCloses, stampOf";
  return new Function(src + "; return {" + names2 + "};")();
}

// ---------------------------------------------------------------- made-up data
function rng(seed) { // mulberry32
  let a = 0;
  for (const c of seed) a = Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SYMBOLS = Array.from({length: 60}, (_, i) => "DEMO" + String.fromCharCode(65 + i % 26) + (i < 26 ? "" : String(Math.floor(i / 26))));
// What each symbol is today: both (passes Strict and Loose), loose (misses Strict on the 9-day change only),
// near (misses each set by one rule), small (above its 200-day average, fails two rules), down, short (under 200 sessions), error
function kinds(day, which) {
  const plan = day === "empty" ? {near: 2, small: 20, down: 32, short: 3, error: 3}
    : which === "compare" ? {both: 4, loose: 3, small: 15, down: 32, short: 3, error: 3}
    : {both: 3, loose: 4, small: 18, down: 29, short: 3, error: 3};
  const out = [];
  for (const k in plan) for (let i = 0; i < plan[k]; i++) out.push(k);
  if (which === "compare" && day !== "empty") { out[2] = "loose"; out[3] = "both"; out[4] = "both"; } // 1 new and 2 dropped since the compare date
  return out;
}
function makeRow(sym, kind, date, rnd) {
  const r = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  const o = {symbol: sym, name: "Demo Company " + sym.slice(4), data_date: date, stale: false, fetch_error: null};
  if (kind === "error") return {...o, fetch_error: "made-up timeout", sessions: null};
  const close = r(2, 300), up = kind !== "down";
  const sma200 = Math.round(close / (up ? r(1.05, 1.3) : r(0.75, 0.95)) * 100) / 100;
  const sma50 = Math.round(close / (up ? r(1.01, 1.04) : r(0.85, 0.98)) * 100) / 100;
  const roc9 = kind === "both" ? r(6, 12) : kind === "loose" || kind === "near" ? r(1, 4) : kind === "small" ? r(-4, -1) : r(-9, -1);
  const high = up ? r(2, 15) : r(25, 45);
  Object.assign(o, {sessions: kind === "short" ? 120 : 260, close, chg_pct: r(-3, 3), roc9});
  Object.assign(o, {cci20: r(-150, 200), atr_pct14: r(1.5, 3.5)});
  Object.assign(o, {value_today: kind === "near" ? r(2e6, 8e6) : r(2e7, 9e7), avg_value_30d: r(8e6, 6e7), pct_high_above_close: high});
  Object.assign(o, {mcap: kind === "small" ? r(1e8, 4e8) : r(2e9, 4e10), sma50, sma200, high_52w: Math.round(close * (1 + high / 100) * 100) / 100});
  o.pct_vs_sma50 = Math.round((close / sma50 - 1) * 1e4) / 100;
  o.pct_vs_sma200 = Math.round((close / sma200 - 1) * 1e4) / 100;
  if (kind === "short") Object.assign(o, {sma200: null, pct_vs_sma200: null});
  return o;
}
const cell = v => v === null || v === undefined ? "" : typeof v === "string" && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : String(v);
function results(P, day, which, date) {
  const rnd = rng(day + which + date), ks = kinds(day, which);
  const rows = SYMBOLS.map((s, i) => makeRow(s, ks[i], date, rnd));
  for (const r of rows) for (const p in P.PRESETS) r["pass_" + p] = r.fetch_error ? false : !P.evaluate(r, P.PRESETS[p], date).length;
  return {rows, csv: [COLUMNS.join(",")].concat(rows.map(r => COLUMNS.map(c => cell(r[c])).join(","))).join("\n") + "\n"};
}
const weekday = d => { const w = new Date(d).getUTCDay(); return w > 0 && w < 6; };
function before(P, d, n, holidays) { // the n weekdays (not holidays) before d, newest first
  const out = [];
  for (let x = P.addDays(d, -1); out.length < n; x = P.addDays(x, -1)) if (weekday(x) && !holidays.has(x)) out.push(x);
  return out;
}
// Every file the fake GitHub serves for one --day; dates follow the given time by the page's own date rules
export function dataset(P, day, now) {
  const today = P.manilaISO(now), prev = before(P, today, 1, new Set())[0];
  const hol = day === "holiday" ? new Set([prev]) : new Set();
  const late = ["holiday", "stale", "failed"].includes(day);
  const date = day === "provisional" ? today : late ? before(P, prev, 1, hol)[0] : prev;
  const older = before(P, date, 30, hol), shown = results(P, day, "today", date);
  const index = [{date, final: day !== "provisional", scanned: 60, fetch_failed: 3, finished_at: now.toISOString()}];
  if (day === "provisional") index.push({date: prev, final: true, scanned: 60, fetch_failed: 3, finished_at: now.toISOString()});
  if (day !== "no-compare") for (const d of older.slice(0, 5)) if (!index.some(e => e.date === d)) index.push({date: d, final: true, scanned: 60, fetch_failed: 3});
  const files = {"results/latest.csv": shown.csv};
  for (const e of index.slice(1)) files["results/" + e.date + ".csv"] = results(P, day, e === index[1] ? "compare" : "today", e.date).csv;
  if (day === "normal") index.push({date: older[5], final: true, scanned: 60, fetch_failed: 3}); // listed with no file: Pick a day's "Couldn't load"
  files["results/index.json"] = JSON.stringify(index);
  const st = {state: "ok", attempted_at: now.toISOString(), trigger: "schedule", slot: "morning", expected_date: day === "provisional" ? prev : late ? prev : date};
  if (day === "holiday") st.state = "holiday";
  if (day === "stale") Object.assign(st, {state: "no_new_session", data_date: date});
  if (day === "failed") Object.assign(st, {state: "failed", error: "PSE EDGE did not answer (made-up)"});
  st.run_url = "https://github.com/bryllelagunda/pse-screener/actions";
  files["results/status.json"] = JSON.stringify(st);
  files["data/holidays.csv"] = "date,name\n" + [...hol].map(d => d + ",Made-up holiday").join("\n") + "\n";
  if (day !== "no-history") {
    const lines = [P.HHEAD];
    for (const d of older.slice().reverse().concat(date === today && day === "provisional" ? [] : [date])) {
      const rows = d === date ? shown.rows : results(P, day, d === older[0] ? "compare" : "today", d).rows;
      lines.push(d + ",,live,,,,,");
      for (const [sym, o] of P.dayRows(rows, d))
        lines.push([d, sym, "live", o.strict, o.loose, o.miss_strict, o.miss_loose, rows.find(r => r.symbol === sym).close].join(","));
    }
    files["results/history.csv"] = lines.join("\n") + "\n";
  }
  return {date, today, holidays: hol, index, status: st, files, rows: shown.rows};
}
// results/closes.csv, made up at run time: every weekday (not a made-up holiday) in the 400 days up to the shown day, a
// seeded random walk per stock ending on its latest.csv close. No row for a fetch error; of the three short stocks one has
// no row (left out), one a single close, one only its last 120; one stock skips 4 days (no trade). The latest index entry
// gets the file's stamp. mode: --closes-fail; stamp: a stamp from another run, bad: a row one cell short.
export async function withCloses(P, d, mode) {
  const dates = [];
  for (let x = d.date; x > P.addDays(d.date, -400); x = P.addDays(x, -1)) if (x === d.date || weekday(x) && !d.holidays.has(x)) dates.unshift(x);
  const lines = [["symbol"].concat(dates).join(",")], shorts = d.rows.filter(r => r.sessions === 120).map(r => r.symbol);
  for (const r of d.rows) {
    if (r.fetch_error || r.symbol === shorts[0]) continue;
    const rnd = rng("closes" + r.symbol), up = r.pct_vs_sma200 === null || r.pct_vs_sma200 > 0, v = [r.close], dp = r.close < 1 ? 4 : 2;
    for (let i = 1; i < dates.length; i++) v.unshift(+Math.max(0.01, v[0] / (1 + (up ? 0.0012 : -0.0012) + (rnd() - 0.5) * 0.04)).toFixed(dp));
    const from = r.symbol === shorts[1] ? dates.length - 1 : r.symbol === shorts[2] ? dates.length - 120 : 0;
    const cells = v.map((x, i) => i < from || r.symbol === d.rows[5].symbol && i > dates.length - 30 && i < dates.length - 25 ? "" : String(x));
    lines.push([r.symbol].concat(cells).join(","));
  }
  let text = lines.join("\n") + "\n";
  const index = JSON.parse(d.files["results/index.json"]);
  index[0].closes_sha256 = mode === "stamp" ? "0".repeat(16) : await P.stampOf(text);
  if (mode === "bad") text = text.replace(/,[^,\n]*\n/, "\n");
  d.files["results/closes.csv"] = text; d.files["results/index.json"] = JSON.stringify(index);
  return d;
}
// The two days --fail-day is for: the latest's compare day, and the compare day of the earlier day after it in the list
export function failDays(d) {
  const finals = d.index.filter(e => e.final && d.files["results/" + e.date + ".csv"]).map(e => e.date).sort().reverse();
  const o = finals[0] === d.date ? 1 : 0;
  return {latestCmp: finals[o], earlier: finals[o + 1], earlierCmp: finals[o + 2], all: finals.filter(x => x !== d.date)};
}

// ---------------------------------------------------------------- the page's fakes (runs in the browser)
function browserFakes(C, D) {
  try {
    if (localStorage.getItem("demo.run") !== String(C.run)) { // once per server start: wipe the page's storage
      for (const k of Object.keys(localStorage)) if (k.startsWith("pse.")) localStorage.removeItem(k);
      localStorage.setItem("demo.run", String(C.run));
      if (C.key) localStorage.setItem("pse.key", JSON.stringify("demo-key"));
      if (C.key && C.exp) localStorage.setItem("pse.keyExp", JSON.stringify(C.exp));
    }
  } catch (e) { console.error("demo.mjs: storage", e); }
  if (C.standalone) {
    const mm = window.matchMedia.bind(window);
    const yes = q => ({matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}});
    window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? yes(q) : mm(q);
    Object.defineProperty(navigator, "standalone", {get: () => true, configurable: true});
  }
  if (C.ua) Object.defineProperty(navigator, "userAgent", {get: () => C.ua, configurable: true});
  const base = "https://api.github.com/repos/bryllelagunda/" + "pse-screener";
  const runs = [], wait = ms => new Promise(f => setTimeout(f, ms));
  const json = (status, body, headers) => new Response(body === null ? null : JSON.stringify(body), {status, headers});
  window.fetch = async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase(), u = String(url);
    const path = u.startsWith(base + "/") ? u.slice(base.length) : u;
    await wait(400); // long enough to see "updating…"
    if (C.github === "offline") throw new TypeError("Failed to fetch");
    if (C.failDay && path === "/contents/results/" + C.failDay + ".csv") { // --fail-day: only this file fails
      if (C.failAs === "401") return json(401, {message: "Bad credentials"});
      if (C.failAs === "404") return json(404, {message: "Not Found"});
      return new Promise((ok, no) => { if (opts.signal) opts.signal.addEventListener("abort", () => no(opts.signal.reason)); }); // timeout: the page's own 30 s abort
    }
    if (C.closesFail && path === "/contents/results/closes.csv" && !["stamp", "bad"].includes(C.closesFail)) { // --closes-fail
      if (C.closesFail === "401") return json(401, {message: "Bad credentials"});
      if (C.closesFail === "404") return json(404, {message: "Not Found"});
      if (C.closesFail === "500") return json(500, {message: "made-up server error"});
      return new Promise((ok, no) => { if (opts.signal) opts.signal.addEventListener("abort", () => no(opts.signal.reason)); }); // timeout: the page gives up at 90 s
    }
    if (C.github === "401") return json(401, {message: "Bad credentials"});
    if (C.github === "403-rate") return json(403, {message: "rate limit"}, {"x-ratelimit-remaining": "0"});
    if (C.github === "500") return json(500, {message: "made-up server error"});
    const file = path.startsWith("/contents/") ? path.slice("/contents/".length) : null;
    if (file !== null && method === "GET") {
      if (C.github === "403" || !Object.hasOwn(D, file)) return json(404, {message: "Not Found"});
      return new Response(D[file], {status: 200});
    }
    if (path.startsWith("/actions/") && C.github === "403") return json(403, {message: "Resource not accessible"});
    if (method === "GET" && path.startsWith("/actions/workflows/screen.yml/runs")) return json(200, {workflow_runs: runs.map(r => ({id: r.id}))});
    if (method === "POST" && path === "/actions/workflows/screen.yml/dispatches") { runs.unshift({id: 1001 + runs.length, t: Date.now()}); return json(204, null); }
    const m = /^\/actions\/runs\/(\d+)$/.exec(path), run = m && runs.find(r => r.id === +m[1]);
    if (method === "GET" && run) {
      const done = Date.now() - run.t > 5000;
      return json(200, {id: run.id, status: done ? "completed" : "in_progress", conclusion: done ? (C.runResult === "fail" ? "failure" : "success") : null,
        html_url: "https://github.com/bryllelagunda/pse-screener/actions/runs/" + run.id});
    }
    const msg = "demo.mjs: no fake for " + method + " " + path;
    console.error(msg);
    throw new Error(msg);
  };
}

// The served page: index.html with one tag loading the fakes right after its one CSP meta tag (the page refuses inline
// scripts); otherwise byte for byte the real file, so the browser checks the real fingerprint of app.js
export function inject(html) {
  const tags = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/gi)];
  if (tags.length !== 1) throw new Error("demo.mjs: index.html must hold exactly one CSP meta tag (found " + tags.length + "); not serving");
  const at = tags[0].index + tags[0][0].length;
  return html.slice(0, at) + '\n<script src="fakes.js"></script>' + html.slice(at);
}
// /fakes.js, answered from memory: the fakes and their made-up files
export const fakesJS = (C = {}, D = {}) => "(" + browserFakes + ")(" + JSON.stringify(C) + ", " + JSON.stringify(D) + ");\n";

// ---------------------------------------------------------------- command line
const HELP = `node tests/demo.mjs serve [flags]   the page with made-up data at http://127.0.0.1:8787/
node tests/demo.mjs check [--today YYYY-MM-DD]   build and check every --day (CI)
  --day <name>          ${DAYS.join(", ")} (default normal)
  --key-days <n>        the saved key runs out in n days (any whole number; default 60)
  --key-no-date         a key saved before end dates existed
  --no-key              no key saved: the first screen
  --github <mode>       ${GITHUB.join(", ")} (default ok); --refuse is --github 401
  --run ok|fail         how a Run now ends (default ok)
  --fail-day <date> --fail-as 404|timeout|401   only results/<date>.csv fails (timeout: no answer until the page gives up at 30 s)
  --closes-fail ${CLOSES_FAIL.join("|")}   the price chart's file fails (timeout: 90 s; stamp: from another run; bad: unreadable); --day no-closes: no file yet
  --skew                serve app.js one byte off its fingerprint: the page refuses it and shows only the boot line
  --standalone          act as the home-screen app
  --ua iphone|android|other   the phone the Add to home screen steps are for
  --port <n>            default 8787; 0 picks a free port
Examples:
  node tests/demo.mjs serve --day normal
  node tests/demo.mjs serve --day empty --key-days 3
  node tests/demo.mjs serve --no-key --standalone --ua iphone
  node tests/demo.mjs serve --skew`;
// --help's last lines: today's made-up days for --fail-day (they follow the date, so they are worked out at run time)
const failHelp = () => { const f = failDays(dataset(pageCode(), "normal", new Date()));
  return `--fail-day for --day normal today: the latest's compare day ${f.latestCmp}; an earlier day's compare day ${f.earlierCmp} (pick ${f.earlier} in the day menu)
  node tests/demo.mjs serve --day normal --fail-day ${f.latestCmp} --fail-as 401
  node tests/demo.mjs serve --day normal --fail-day ${f.earlierCmp} --fail-as 404`; };
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  other: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
function usage(msg, fix) { process.stderr.write("demo.mjs: " + msg + "\ntry: " + fix + "\n"); process.exit(2); }
export function parseArgs(argv) {
  const [cmd, ...rest] = argv, o = {cmd, day: "normal", keyDays: 60, key: "days", github: "ok", run: "ok"};
  Object.assign(o, {standalone: false, ua: null, port: 8787, today: null, failDay: null, failAs: null, skew: false});
  const keyFlags = [], val = (f, i) => { if (rest[i + 1] === undefined || rest[i + 1].startsWith("--")) usage(f + " needs a value", "node tests/demo.mjs --help"); return rest[i + 1]; };
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i];
    if (f === "--day") { o.day = val(f, i++); if (!DAYS.includes(o.day)) usage(`unknown --day "${o.day}" (one of: ${DAYS.join(", ")})`, "node tests/demo.mjs " + cmd + " --day normal"); }
    else if (f === "--key-days") { const v = val(f, i++); if (!/^-?\d+$/.test(v)) usage(`--key-days needs a whole number, not "${v}"`, "node tests/demo.mjs serve --key-days 9"); o.keyDays = +v; keyFlags.push(f); }
    else if (f === "--key-no-date") { o.key = "nodate"; keyFlags.push(f); }
    else if (f === "--no-key") { o.key = "none"; keyFlags.push(f); }
    else if (f === "--github" || f === "--refuse") { const v = f === "--refuse" ? "401" : val(f, i++); if (!GITHUB.includes(v)) usage(`unknown --github "${v}" (one of: ${GITHUB.join(", ")})`, "node tests/demo.mjs serve --github 401"); o.github = v; }
    else if (f === "--run") { o.run = val(f, i++); if (!["ok", "fail"].includes(o.run)) usage(`unknown --run "${o.run}" (one of: ok, fail)`, "node tests/demo.mjs serve --run fail"); }
    else if (f === "--fail-day") { o.failDay = val(f, i++); if (!/^\d{4}-\d{2}-\d{2}$/.test(o.failDay)) usage(`--fail-day needs YYYY-MM-DD, not "${o.failDay}"`, "node tests/demo.mjs --help (it lists the made-up days)"); }
    else if (f === "--fail-as") { o.failAs = val(f, i++); if (!FAIL_AS.includes(o.failAs)) usage(`unknown --fail-as "${o.failAs}" (one of: ${FAIL_AS.join(", ")})`, "node tests/demo.mjs --help"); }
    else if (f === "--closes-fail") { o.closesFail = val(f, i++); if (!CLOSES_FAIL.includes(o.closesFail)) usage(`unknown --closes-fail "${o.closesFail}" (one of: ${CLOSES_FAIL.join(", ")})`, "node tests/demo.mjs serve --closes-fail 404"); }
    else if (f === "--skew") o.skew = true;
    else if (f === "--standalone") o.standalone = true;
    else if (f === "--ua") { o.ua = val(f, i++); if (!Object.hasOwn(UA, o.ua)) usage(`unknown --ua "${o.ua}" (one of: iphone, android, other)`, "node tests/demo.mjs serve --ua iphone"); }
    else if (f === "--port") { const v = val(f, i++); if (!/^\d+$/.test(v) || +v > 65535) usage(`--port needs a number from 0 to 65535, not "${v}"`, "node tests/demo.mjs serve --port 0"); o.port = +v; }
    else if (f === "--today" && cmd === "check") { o.today = val(f, i++); if (!/^\d{4}-\d{2}-\d{2}$/.test(o.today) || isNaN(Date.parse(o.today))) usage(`--today needs YYYY-MM-DD, not "${o.today}"`, "node tests/demo.mjs check --today 2026-11-24"); }
    else usage(`unknown flag ${f}`, "node tests/demo.mjs --help");
  }
  if (!!o.failDay !== !!o.failAs) usage("--fail-day and --fail-as go together", "node tests/demo.mjs --help (it lists the made-up days)");
  if (keyFlags.length > 1) usage("pick one of " + keyFlags.join(" and ") + " (they set the same key)", "node tests/demo.mjs serve " + keyFlags[0] + (keyFlags[0] === "--key-days" ? " " + o.keyDays : ""));
  return o;
}

async function check(o) {
  const P = pageCode(), dates = o.today ? [o.today] : PINNED, fails = [];
  let ok = 0;
  const fail = m => { fails.push(m); process.stderr.write("demo check FAIL " + m + "\n"); };
  for (const day of DAYS) {
    let good = true;
    const bad = m => { good = false; fail("day=" + day + " " + m); };
    for (const t of dates) {
      const now = new Date(t + "T09:00:00+08:00"), d = dataset(P, day, now);
      if (day !== "no-closes") { // the made-up closes file parses, has a row for each stock with prices, and carries its stamp
        await withCloses(P, d, null);
        const text = d.files["results/closes.csv"], ix = JSON.parse(d.files["results/index.json"]);
        try { const c = P.parseCloses(text), want = d.rows.filter(r => !r.fetch_error).length - 1;
          if (c.by.size !== want || c.dates.at(-1) !== d.date) bad(`date=${t} closes.csv: ${c.by.size} rows ending ${c.dates.at(-1)}, want ${want} ending ${d.date}`);
          if (![...c.by.keys()].every(s => /^DEMO[A-Z]\d?$/.test(s))) bad(`date=${t} closes.csv: a symbol that is not a made-up DEMO symbol`);
        } catch (e) { bad(`date=${t} closes.csv: ${e.message}`); }
        if (ix[0].closes_sha256 !== await P.stampOf(text)) bad(`date=${t} closes.csv: the latest index entry's stamp does not match`);
      }
      const rows = P.parseCSV(d.files["results/latest.csv"]);
      if (rows.length !== 60) bad(`date=${t} latest.csv parsed to ${rows.length} rows, want 60`);
      for (const r of rows) {
        if (!/^DEMO[A-Z]\d?$/.test(r.symbol)) bad(`date=${t} row=${r.symbol} is not a made-up DEMO symbol`);
        for (const p in P.PRESETS) {
          const ev = r.fetch_error ? false : !P.evaluate(r, P.PRESETS[p], r.data_date).length;
          if (ev !== r["pass_" + p]) bad(`row=${r.symbol} pass_${p}: generator=${+r["pass_" + p]} evaluate=${+ev}`);
        }
      }
      const count = p => rows.filter(r => r["pass_" + p]).length, want = day === "empty" ? [0, 0] : [3, 7];
      if (count("strict") !== want[0] || count("loose") !== want[1]) bad(`date=${t} passes Strict ${count("strict")}, Loose ${count("loose")}; want ${want.join(", ")}`);
      if (day === "empty") {
        const missed = rows.filter(r => !r.fetch_error && P.evaluate(r, P.PRESETS.strict, r.data_date).length === 1).length;
        if (missed !== 2) bad(`date=${t} ${missed} missed Strict by one, want 2`);
      }
      if (d.files["results/history.csv"]) try { P.parseHistory(d.files["results/history.csv"]); } catch (e) { bad(`date=${t} history.csv: ${e.message}`); }
      const index = JSON.parse(d.files["results/index.json"]), st = JSON.parse(d.files["results/status.json"]);
      for (const h of [4, 6, 9, 18]) {
        const at = new Date(t + "T" + String(h).padStart(2, "0") + ":00:00+08:00");
        if (day === "normal" && P.missedRun(st, index, d.holidays, at)) bad(`date=${t} ${h}:00 shows a missed-run bar`);
      }
      if (day === "normal" && P.keyBand(P.addDays(d.today, 60), null, false, now).band !== null) bad("the default key (60 days) shows a key bar");
      const m = P.mood(rows, null);
      if (!m || !["weak", "mixed", "strong"].includes(m.word)) bad(`date=${t} market mood: not enough numbers in the made-up rows`);
      if (day === "normal") { // --fail-day: both made-up days have a file to fail, and every --fail-as mode builds
        const f = failDays(d);
        for (const x of [f.latestCmp, f.earlierCmp]) if (!x || !d.files["results/" + x + ".csv"]) bad(`date=${t} --fail-day ${x}: no such made-up file`);
        if (f.latestCmp !== JSON.parse(d.files["results/index.json"])[1].date) bad(`date=${t} --fail-day: the latest's compare day is not the one the page compares with`);
        for (const as of FAIL_AS) if (!fakesJS({failDay: f.earlierCmp, failAs: as}, d.files).includes(f.earlierCmp)) bad(`--fail-as ${as} does not build`);
      }
    }
    if (good) ok++;
  }
  console.log(`${ok} of ${DAYS.length} days OK` + (o.today ? ` (${o.today})` : ` (${dates.join(", ")})`));
  if (fails.length) process.exit(1);
}

async function serve(o) {
  const P = pageCode(), now = new Date(), d = dataset(P, o.day, now), run = Math.floor(Math.random() * 1e9);
  if (o.day !== "no-closes") await withCloses(P, d, o.closesFail);
  if (o.failDay) { const f = failDays(d); if (!f.all.includes(o.failDay))
    usage(`--fail-day needs one of ${f.all.join(", ")} (latest's compare day: ${f.latestCmp}; an earlier day's compare day: ${f.earlierCmp})`, `node tests/demo.mjs serve --day ${o.day} --fail-day ${f.latestCmp} --fail-as 401`); }
  const C = {run, key: o.key !== "none", exp: o.key === "days" ? P.addDays(d.today, o.keyDays) : null, github: o.github,
    runResult: o.run, standalone: o.standalone, ua: o.ua ? UA[o.ua] : null, failDay: o.failDay, failAs: o.failAs, closesFail: o.closesFail};
  inject(read("/").toString()); // refuses to start without exactly one CSP meta tag
  const fakes = fakesJS(C, d.files), JS = "text/javascript; charset=utf-8";
  const TYPES = {"/": "text/html; charset=utf-8", "/app.js": JS, "/fakes.js": JS, "/manifest.webmanifest": "application/manifest+json", "/icon.png": "image/png"};
  const server = createServer((req, res) => {
    const p = new URL(req.url, "http://127.0.0.1").pathname; // the address without its query, as GitHub Pages serves app.js?v=…
    if (req.method !== "GET" || !Object.hasOwn(READ, p) && p !== "/fakes.js") { res.writeHead(404, {"content-type": "text/plain"}); res.end("404: the test server serves only the page, its code, its manifest and its icon\n"); return; }
    try {
      const body = p === "/" ? inject(read("/").toString()) : p === "/fakes.js" ? fakes : p === "/app.js" && o.skew ? Buffer.concat([read(p), Buffer.from("\n")]) : read(p);
      res.writeHead(200, {"content-type": TYPES[p], "cache-control": "no-store"}); res.end(body);
    } catch (e) { res.writeHead(500, {"content-type": "text/plain"}); res.end(e.message + "\n"); }
  });
  server.on("error", e => {
    if (e.code === "EADDRINUSE") process.stderr.write(`demo.mjs: port ${o.port} is in use: add --port <n> (or --port 0)\n`);
    else process.stderr.write("demo.mjs: " + e.message + "\n");
    process.exit(1);
  });
  server.listen(o.port, "127.0.0.1", () => {
    const key = o.key === "none" ? "none" : o.key === "nodate" ? "nodate" : o.keyDays + "d";
    console.log(`demo ready http://127.0.0.1:${server.address().port}/ day=${o.day} key=${key} github=${o.github} run=${run}` +
      (o.failDay ? ` fail=${o.failDay}:${o.failAs}` : "") + (o.closesFail ? ` closes=${o.closesFail}` : "") + (o.skew ? " skew=on" : ""));
    console.log("switching --day needs a restart (storage is wiped once per start)");
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") { console.log(HELP + "\n" + failHelp()); process.exit(0); }
  if (!["serve", "check"].includes(argv[0])) usage(`unknown command "${argv[0]}" (serve or check)`, "node tests/demo.mjs serve --day normal");
  const o = parseArgs(argv);
  if (o.cmd === "check") await check(o); else await serve(o);
}
