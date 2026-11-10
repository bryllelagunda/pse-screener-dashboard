// Stock history: checking results/history.csv and the values derived from it. Made-up symbols and numbers only.
// Runs in CI (no private files needed): node tests/history.mjs
// Value: protects=which history files the page accepts, and Days in, Last 20, Joined this time, the change since,
//   miss streaks, Knocking on the door, the disagreement count and the Days in cell per history state;
//   fails_when=a bad row loads (partial history), a good file is rejected, a no-record day or holiday is bridged
//   wrongly, a data gap counts as a miss, or a one-sided row is not counted as a disagreement;
//   no_claim=the panel, strip, menu and URL wiring (checked in a browser by /qa).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const block = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); if (i < 0 || j < 0) throw new Error(a + " markers not found"); return html.slice(i, j); };
const {PRESETS, parseHistory, missRule, dayRows, track, strength, knocking, disagree, daysText, HHEAD} = new Function(
  block("/* FILTER-START", "/* FILTER-END */") + block("/* HISTORY-START", "/* HISTORY-END */") +
  "; return {PRESETS, parseHistory, missRule, dayRows, track, strength, knocking, disagree, daysText, HHEAD};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
const err = (f) => { try { f(); return null; } catch (e) { return e.message; } };

// A made-up stock that passes both presets; overrides make it fail one rule or hit a data gap.
const BASE = {symbol: "ZZA", data_date: "2026-11-03", stale: false, fetch_error: null, sessions: 260, close: 50, sma50: 48, sma200: 45,
  roc9: 6, avg_value_30d: 8e6, mcap: 3e9, value_today: 2e7, pct_high_above_close: 10, atr_pct14: 2.5};
const row = (symbol, o = {}) => ({...BASE, symbol, ...o});
const hist = (...lines) => [HHEAD, ...lines].join("\n") + "\n";
const marker = (d, src = "live") => `${d},,${src},,,,,`;

// 1. The file check: one bad row rejects the whole file, with a reason naming the row.
const good = hist(marker("2026-10-29", "rebuilt"), "2026-10-29,ZZA,rebuilt,true,true,,,40.5", marker("2026-10-30"), "2026-10-30,ZZA,live,true,false,,vt,41",
  marker("2026-11-03", "missing"));
const H = parseHistory(good);
eq([H.dates, H.src, H.by.get("ZZA").get("2026-10-30")], [["2026-10-29", "2026-10-30", "2026-11-03"],
  {"2026-10-29": "rebuilt", "2026-10-30": "live", "2026-11-03": "missing"}, {strict: "true", loose: "false", miss_strict: "", miss_loose: "vt", close: 41}],
  "a good file loads its sessions, sources and rows");
eq(parseHistory("﻿" + good.replaceAll("\n", "\r\n")).dates.length, 3, "a BOM and CRLF line endings are accepted");
for (const [text, want, what] of [
  ["date,symbol,source\n", "wrong header", "a wrong header"],
  [hist(marker("2026-02-30")), "row 2: bad date", "an impossible date"],
  [hist("2026-10-29,,live,,,,"), "row 2: wrong number of cells", "a short row"],
  [hist(marker("2026-10-29", "guess")), "row 2: bad source", "an unknown source"],
  [hist(marker("2026-10-29"), "2026-10-29,ZZA,live,yes,true,,,1"), "row 3: bad pass flag", "a pass flag that isn't true or false"],
  [hist(marker("2026-10-29"), "2026-10-29,ZZA,live,false,true,rsi,,1"), "row 3: unknown rule", "an unknown rule key"],
  [hist(marker("2026-10-29"), "2026-10-29,ZZA,live,true,true,,,1e3"), "row 3: bad close", "a close that isn't a plain decimal"],
  [hist(marker("2026-10-30"), marker("2026-10-29")), "row 3: date out of order", "sessions out of order"],
  [hist(marker("2026-10-29"), marker("2026-10-29")), "row 3: date out of order", "a repeated session"],
  [hist("2026-10-29,ZZA,live,true,true,,,1"), "row 2: stock row without its session row", "a stock row before any session row"],
  [hist(marker("2026-10-29", "missing"), "2026-10-29,ZZA,missing,true,true,,,1"), "row 3: stock row without its session row", "a stock row on a no-record day"],
  [hist(marker("2026-10-29"), "2026-10-29,ZZA,rebuilt,true,true,,,1"), "row 3: stock row without its session row", "a stock row whose source differs from its session"],
  [hist(marker("2026-10-29"), "2026-10-29,ZZA,live,true,true,,,1", "2026-10-29,ZZA,live,true,true,,,1"), "row 4: repeated stock", "a repeated stock"],
]) eq(err(() => parseHistory(text)), want, what + " rejects the whole file");

// 2. "Missed by one rule": one failure that is not a data gap.
const D = "2026-11-03";
eq(["strict", "loose"].map(p => missRule(row("ZZA", {roc9: 4}), PRESETS[p], D)), ["roc9", ""], "one failed rule is a miss; passing is not");
eq(missRule(row("ZZA", {roc9: 4, atr_pct14: 9}), PRESETS.strict, D), "", "two failed rules are not a miss");
for (const [o, what] of [[{stale: true}, "no trade"], [{fetch_error: "HTTP 500"}, "not scanned"], [{sessions: 120, sma200: null}, "short history"],
  [{mcap: null}, "market cap unavailable"]]) eq(missRule(row("ZZA", o), PRESETS.strict, D), "", "a lone data gap (" + what + ") is never a miss");

// 3. Derived values, on the real calendar: Nov 2 (All Souls' Day) is not a session, so it has no row at all.
{
  const H = parseHistory(hist(marker("2026-10-27"), "2026-10-27,ZZA,live,true,true,,,40", marker("2026-10-28"),
    marker("2026-10-29"), "2026-10-29,ZZA,live,true,true,,,40", marker("2026-10-30"), "2026-10-30,ZZA,live,true,false,,roc9,44"));
  const t = track(H, "ZZA", row("ZZA"), D), s = strength(t, "strict");
  eq([t.length, s.days, s.join, +s.chg.toFixed(4), s.last20], [5, 3, "2026-10-29", 0.25, 4],
    "worked example: first passes Oct 29, shown Nov 3: Days in 3, joined Oct 29, change from that close, 4 of the last sessions");
  const l = strength(t, "loose");
  eq([l.days, l.join, l.chg, l.miss], [1, D, 0, 0], "passing on the shown date only: Days in 1, joined that day, no change");
  const out = strength(track(H, "ZZA", row("ZZA", {roc9: 4}), D), "strict");
  eq([out.days, out.join, out.chg, out.miss], [0, "2026-10-30", null, 1], "out today: Last in the last pass, no change, miss streak 1");
  const gone = strength(track(H, "ZZA", null, D), "strict");
  eq([gone.days, gone.join, gone.chg], [0, "2026-10-30", null], "not in the shown file: Last in its last pass, no change");
  const prov = strength(track(H, "ZZA", row("ZZA"), "2026-10-30"), "strict");
  eq([prov.days, prov.join], [2, "2026-10-29"], "an older shown file counts only the sessions before its date");
}
{
  const H = parseHistory(hist(marker("2026-10-28", "rebuilt"), "2026-10-28,ZZA,rebuilt,true,true,,,40", marker("2026-10-29", "missing"),
    marker("2026-10-30"), "2026-10-30,ZZA,live,true,true,,,40"));
  const t = track(H, "ZZA", row("ZZA"), D);
  eq([t.map(x => x.strict).join(""), strength(t, "strict").days, strength(t, "strict").last20], ["popp", 2, 3],
    "a no-record day breaks the streak; rebuilt sessions count in Last 20");
  const H2 = parseHistory(hist(marker("2026-10-29", "rebuilt"), "2026-10-29,ZZA,rebuilt,true,true,,,40", marker("2026-10-30"), "2026-10-30,ZZA,live,true,true,,,40"));
  eq(strength(track(H2, "ZZA", row("ZZA"), D), "strict").days, 3, "a rebuilt session counts in Days in");
  const many = parseHistory(hist(...Array.from({length: 25}, (_, i) => marker("2026-09-" + String(i + 1).padStart(2, "0"))).flatMap((m, i) =>
    i < 5 ? [m] : [m, m.replace(",,live,,,,,", ",ZZA,live,true,true,,,40")])));
  eq(strength(track(many, "ZZA", row("ZZA", {roc9: 4}), D), "strict").last20, 19, "Last 20 looks at the last 20 sessions only, the shown one included");
}

// 4. Miss streaks and Knocking on the door
{
  const lines = [];
  for (const d of ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]) lines.push(marker(d), `${d},ZZA,live,false,true,roc9,,40`, `${d},ZZB,live,false,true,atr,,40`);
  lines.splice(1, 1); // ZZA misses only the last three sessions
  const H = parseHistory(hist(...lines)), rows = [row("ZZA", {roc9: 4}), row("ZZB", {atr_pct14: 4.5}), row("ZZC", {roc9: 4})];
  const T = new Map(rows.map(r => [r.symbol, track(H, r.symbol, r, D)]));
  const k = knocking(T, rows);
  eq([k.strict.map(e => [e.r.symbol, e.n, e.rule]), k.loose], [[["ZZB", 5, "atr"], ["ZZA", 4, "roc9"]], []],
    "Knocking lists miss streaks of 3 or more with today's rule, longest first; a first-day miss is left out");
}

// 5. The disagreement check, both ways
{
  const rows = [row("ZZA"), row("ZZB", {roc9: 4}), row("ZZC", {stale: true})];
  eq([...dayRows(rows, D)].map(([s, o]) => [s, o.strict, o.loose, o.miss_strict]), [["ZZA", "true", "true", ""], ["ZZB", "false", "true", "roc9"]],
    "derived rows: passing or missed-by-one stocks only, never a lone data gap");
  const day = (...l) => parseHistory(hist(marker(D), ...l));
  const same = ["2026-11-03,ZZA,live,true,true,,,50", "2026-11-03,ZZB,live,false,true,roc9,,50"];
  eq(disagree(day(...same), rows, D), 0, "history equal to the file: no disagreement");
  eq(disagree(day(same[0].replace("true,true", "false,true"), same[1]), rows, D), 1, "a pass flag differs");
  eq(disagree(day(same[0], same[1].replace("roc9", "atr")), rows, D), 1, "a miss rule differs");
  eq(disagree(day(same[0]), rows, D), 1, "a row only in the file");
  eq(disagree(day(...same, "2026-11-03,ZZD,live,true,false,,,9"), rows, D), 1, "a row only in history");
}

// 6. The Days in cell per history state
eq([daysText({state: "loading"}, "strict", 0), daysText({state: "missing"}, "strict", 0), daysText({state: "broken"}, "loose", 0),
  daysText({state: "ok"}, "custom", 4), daysText({state: "ok"}, "strict", 4)], ["…", "—", "—", "—", "4"],
  "Days in: … while loading, — when missing, broken or Custom, else the number");

console.log(bad ? `${bad} of ${n} history checks failed` : `history OK (${n} checks)`);
process.exit(bad ? 1 : 0);
