// Saved filter sets (storage cleaning, name rules, the collapsed-panel summary), My list stars and notes (the MYLIST
// block) and Pick a day (the DAY block).
// Runs in CI (no private files needed): node tests/screens.mjs
// Value: protects=what the page keeps from localStorage, which names it accepts, the one-line summary text, which
//   prices a note accepts, My list's tags at their edges, that My list writes only pse.mine, and which file is on screen
//   while a day is picked, refreshed, failed or left;
//   fails_when=a corrupt or tampered entry loads, a good entry is dropped, a duplicate or 21st name is accepted,
//   a rename to itself is refused, the summary misstates a filter, a 0 or negative price saves, a tag is off by the
//   edge, storage full changes the list, the new storage touches the key, the cache or saved sets, or a refresh,
//   a failed day file or Forget key leaves the wrong day on screen, or an earlier day's failed compare file says nothing;
//   no_claim=buttons, the name box, URL restore, the panel toggle, the day menu and the panel's note boxes on screen
//   (checked by /qa with tests/demo.mjs).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.js"), "utf8"); // the page's code
const block = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); if (i < 0 || j < 0) throw new Error(a + " markers not found"); return html.slice(i, j); };
const src = block("/* FILTER-START", "/* FILTER-END */") + block("/* SCREENS-START", "/* SCREENS-END */");
const {STRICT, LOOSE, cleanSet, loadScreens, nameError, sameSet, summary} =
  new Function(src + "; return {STRICT, LOOSE, cleanSet, loadScreens, nameError, sameSet, summary};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
const with_ = patch => ({...STRICT, ...patch});

// cleanSet
eq(cleanSet({roc9_min: -3}), with_({roc9_min: -3}), "missing keys take Strict's value; negative ROC kept");
eq(cleanSet(with_({mcap_min: "1e9"})), null, "a number stored as text rejects the set");
eq(cleanSet(with_({price_min: -1})), null, "a negative money minimum rejects the set");
eq(cleanSet(with_({atr_band: [5, 2]})), null, "a band with min above max rejects the set");
eq(cleanSet(with_({high_band: [0]})), null, "a band without two numbers rejects the set");
eq(cleanSet(with_({above_sma50: 1})), null, "a checkbox stored as a number rejects the set");
eq([cleanSet(null), cleanSet([]), cleanSet("x")], [null, null, null], "non-objects are rejected");
{ const s = with_({}), c = cleanSet(s); c.atr_band[0] = 9; eq(s.atr_band[0], STRICT.atr_band[0], "cleanSet copies bands"); }

// loadScreens
eq([loadScreens(null), loadScreens({name: "a", set: STRICT}), loadScreens("x")], [[], [], []], "non-arrays load as no sets");
eq(loadScreens([{name: "  Break   outs ", set: STRICT}]).map(o => o.name), ["Break outs"], "names are trimmed and spaces collapsed");
eq(loadScreens([{name: "", set: STRICT}, {name: "x".repeat(31), set: STRICT}, {name: 5, set: STRICT}, null, {name: "ok", set: STRICT}]).map(o => o.name),
  ["ok"], "empty, over-30-character and non-text names are dropped; good entries kept");
eq(loadScreens([{name: "bad", set: with_({mcap_min: "1e9"})}, {name: "good", set: LOOSE}]).map(o => o.name), ["good"], "an entry with a bad set is dropped");
eq(loadScreens([{name: "Mine", set: STRICT}, {name: "MINE", set: LOOSE}]), [{name: "Mine", set: STRICT}], "case-insensitive duplicates keep the first");
eq(loadScreens(Array.from({length: 25}, (_, i) => ({name: "s" + i, set: STRICT}))).length, 20, "at most 20 sets load");

// nameError
const list = [{name: "Breakouts", set: STRICT}];
eq(nameError("   ", list), "Enter a name.", "blank name");
eq(nameError("x".repeat(31), list), "Use 30 characters or fewer.", "long name");
eq(nameError(" breakouts ", list), "A set called “Breakouts” already exists.", "duplicate in other capitals");
eq(nameError("BREAKOUTS", list, "Breakouts"), "", "rename to itself in new capitals is allowed");
eq(nameError("Breakouts", [...list, {name: "Dips", set: STRICT}], "Dips"), "A set called “Breakouts” already exists.", "rename onto another set");
const full = Array.from({length: 20}, (_, i) => ({name: "s" + i, set: STRICT}));
eq(nameError("new", full), "You can keep 20 sets. Delete one first.", "21st set refused");
eq(nameError("renamed", full, "s3"), "", "renaming with 20 sets is allowed");

// sameSet
eq([sameSet(STRICT, with_({})), sameSet(STRICT, with_({atr_band: [1, 5]})), sameSet(STRICT, LOOSE)], [true, false, false], "sameSet compares every key");

// summary
eq(summary(STRICT), "Price above 200-day average · Price above 50-day average · 50-day average above 200-day · 9-day change at least 5% · Company size at least ₱1B · Price above ₱1 · Usual daily trading above ₱5M · Below year high 0–20% · Daily swing between 1% and 4%", "Strict summary");
eq(summary(LOOSE), "Price above 200-day average · 50-day average above 200-day · 9-day change at least 0% · Company size at least ₱500M · Price above ₱1 · Usual daily trading above ₱5M · Traded today above ₱10M · Below year high 0–30% · Daily swing between 1% and 6%", "Loose summary");
eq(summary({above_sma200: false, above_sma50: false, sma50_above_sma200: false, roc9_min: -20, price_min: 0, avg_value_min: 0, mcap_min: 0,
  value_today_min: 0, high_band: [0, 100], atr_band: [0, 15]}), "9-day change at least -20% · Below year high 0–100% · Daily swing between 0% and 15%", "all-off summary leaves out off filters");

// ---------------------------------------------------------------- My list (MYLIST) and its storage
// A fake localStorage holding a key, a cache, saved sets and settings; full: every write throws (storage full or private mode)
const fakeStorage = () => {
  const m = new Map(), o = {full: false, map: m};
  Object.assign(o, {getItem: k => m.has(k) ? m.get(k) : null, removeItem: k => m.delete(k),
    setItem: (k, v) => { if (o.full) throw new Error("QuotaExceededError"); m.set(k, String(v)); }});
  return o;
};
const LS = fakeStorage();
for (const [k, v] of [["pse.key", "k-made-up"], ["pse.keyExp", "2027-01-01"], ["pse.cache", {csv: "x", at: 1}], ["pse.screens", [{name: "Mine", set: STRICT}]], ["pse.settings", {preset: "strict"}]])
  LS.setItem(k, JSON.stringify(v));
const before = new Map(LS.map);
const store_ = block("const store = {", "const MINUS"), keyBlock = block("/* KEY-START", "/* KEY-END */");
const M = new Function("localStorage", store_ + block("/* MYLIST-START", "/* MYLIST-END */") +
  "; return {priceIn, cleanMine, mineWith, mineErr, readNotes, priceMsg, myView, levelLine, saveMine, reloadMine, mine: () => MINE, mineOf, starred, MAX_MINE, NOSAVE};")(LS);

eq([M.priceIn(""), M.priceIn(" 3.40 "), M.priceIn("₱1,200.5"), M.priceIn(".5")], [null, 3.4, 1200.5, 0.5], "prices: empty is none; ₱, commas and spaces are read");
eq(["0", "0.00", "-1", "abc", "1e3", "3.4.5", "9".repeat(400)].map(t => Number.isNaN(M.priceIn(t))), [true, true, true, true, true, true, true], "0, below 0, not a number and a number too long to hold are refused");
eq(M.readNotes({buy: "0", cut: "2", target: "x", note: "n"}), {bad: ["buy", "target"]}, "readNotes names every refused box");
eq(M.readNotes({buy: "3.40", cut: "", target: "4", note: "  " + "x".repeat(400)}).note.length, 300, "a note is capped at 300 characters");
eq([M.priceMsg(7.85), M.priceMsg(0.0425), M.priceMsg(null)], ["Enter a price above 0, like 7.85.", "Enter a price above 0, like 0.0425.", "Enter a price above 0."], "the refusal names this stock's close");
// cleanMine: tampered storage
eq(M.cleanMine([{sym: "DEMOA", star: true, buy: 3.4, cut: -1, target: "4", note: 5, at: "nope"}]),
  [{sym: "DEMOA", star: true, note: "", at: null, buy: 3.4, cut: null, target: null}], "bad prices, notes and times are dropped field by field");
eq(M.cleanMine([{sym: "demoa", star: true}, {sym: "DEMOB", star: "yes"}, {sym: "DEMOB", star: true}, null, "x", {sym: "A<b>", star: true}]).map(e => e.sym), ["DEMOB"],
  "bad symbols, a non-true star with no notes, and non-objects are dropped; the first good one of a stock is kept");
eq(M.cleanMine([{sym: "DEMOC", star: true}, {sym: "DEMOC", star: false, buy: 2}]).length, 1, "one entry per stock");
eq([M.cleanMine(null), M.cleanMine({sym: "DEMOA"})], [[], []], "a non-list loads as an empty list");
eq(M.cleanMine(Array.from({length: 305}, (_, i) => ({sym: "DEMO" + i, star: true}))).length, 300, "at most 300 stocks load");
// star on and off, notes, Clear notes
let L = M.mineWith([], "DEMOA", {star: true});
eq(L, [{sym: "DEMOA", star: true, buy: null, cut: null, target: null, note: "", at: null}], "star on adds the stock");
eq(M.mineWith(L, "DEMOA", {star: false}), [], "star off with no notes removes it");
L = M.mineWith(L, "DEMOA", {buy: 11, cut: 10.2, target: 12, note: "n", at: "2026-11-20T01:12:00Z"});
eq(M.mineWith(L, "DEMOA", {star: false}).map(e => [e.star, e.buy]), [[false, 11]], "star off keeps the notes (a mis-tap never loses them)");
eq(M.mineWith(L, "DEMOA", {buy: null, cut: null, target: null, note: "", at: null}).map(e => [e.star, e.buy, e.note]), [[true, null, ""]], "Clear notes empties the notes; the star stays");
eq(M.mineWith(M.mineWith(L, "DEMOA", {star: false}), "DEMOA", {buy: null, cut: null, target: null, note: "", at: null}), [], "Clear notes on an unstarred stock removes it");
const full300 = Array.from({length: 300}, (_, i) => ({sym: "DEMO" + i, star: true}));
eq([M.mineErr(full300, "DEMOZ"), M.mineErr(full300, "DEMO5")], ["My list keeps 300 stocks. Remove one first.", ""], "a 301st stock is refused; changing a kept one is not");
// tags and vs my buy at the exact edges
const E = {buy: 4, cut: 3.1, target: 4.4};
const tag = close => M.myView(E, {close}).tag;
eq([tag(3.1), tag(3.11), tag(4.39), tag(4.4), tag(5)], ["cut", "", "", "target", "target"], "close = cut-loss is At cut-loss; close = target is Target reached");
eq([M.myView(E, null).tag, M.myView(E, {ghost: 1}).tag, M.myView(E, {close: null}).tag], ["gone", "gone", "gone"], "missing from the file, or no close: Not in this day's scan");
eq([M.myView(E, {close: 5}).vs, M.myView({}, {close: 5}).vs, M.myView(E, {close: null}).vs], [25, null, null], "vs my buy: from buy to close; a dash with no buy price or no close");
eq([M.levelLine(E, 3.1), M.levelLine(E, 4.4), M.levelLine(E, 4), M.levelLine({}, 4)],
  ["Price is at or below your cut-loss (₱3.10).", "Price is at or above your target (₱4.40).", "", ""], "the panel's one line at the edges");
// storage: only pse.mine is written; full storage leaves the list as it was; key, cache and saved sets untouched
eq(M.saveMine(L), true, "saving My list works");
eq(JSON.parse(LS.getItem("pse.mine")).length, 1, "My list is saved under pse.mine");
LS.full = true;
eq([M.saveMine([]), M.mine().length], [false, 1], "storage full: the save is refused and the list in memory is unchanged");
LS.full = false;
LS.setItem("pse.mine", JSON.stringify([...L, {sym: "DEMOB", star: true}])); M.reloadMine();
eq(M.mine().map(e => e.sym), ["DEMOA", "DEMOB"], "a change starts from storage, so a star saved in another tab is kept");
eq([...LS.map.keys()].filter(k => !before.has(k)), ["pse.mine"], "My list adds one storage name, pse.mine");
eq([...before].filter(([k, v]) => LS.getItem(k) !== v), [], "the key, its date, the cache, saved sets and settings are untouched");
eq(["mine"].filter(n => keyBlock.includes('"' + n + '"')), [], "Forget key (the KEY block) never names My list's storage");

// ---------------------------------------------------------------- Pick a day (DAY)
const D = new Function("isDay", "fileText", "AuthError", "setCurrent", "setCompare", "renderAll", "renderBars", "S", "gen",
  block("/* DAY-START", "/* DAY-END */") + "; return {dayList, onLatest, backToLatest, dropDay, pickDay, latest: () => LATEST, dayWords, dayText};");
{ // b12 (T-23 plan § 3.6, T-28): an earlier day's panel never says "today", and the day list shows the year on every row
  const DW = D(() => true), W = DW.dayWords, lbl = new Function(/function dateLabel[\s\S]*?\n\}/.exec(html)[0] + "; return dateLabel;")();
  const w = W("Thu, Oct 29"), t = W(null);
  eq(w, {notIn: "Not in the Thu, Oct 29 scan", notScanned: "Not scanned on Thu, Oct 29", fails: "Fails on Thu, Oct 29", today: "On Thu, Oct 29", traded: "Traded that day"}, "b12: an earlier day's panel words");
  eq(Object.values(w).filter(x => /today/i.test(x)), [], "b12: no earlier-day word says today");
  eq([t.notIn, t.fails, t.today, t.traded], ["Not in today's scan", "Fails today", "Today", "Traded today"], "b12: the latest day keeps today's words");
  const rp = /function renderPanel\(\)[\s\S]*?\n\}/.exec(html)[0].replace(/\/\/.*$/gm, "");
  eq((rp.match(/"(?:[^"\\]|\\.)*"/g) || []).filter(q => /\btoday\b/i.test(q) && q !== '" Today\'s results still work."'), [], "b12: renderPanel holds no today wording of its own (it reads dayWords)");
  eq([DW.dayText({date: "2026-10-29", prov: true}, lbl), DW.dayText({date: "2025-12-30", latest: true}, lbl)],
    ["Thu, Oct 29, 2026 (provisional)", "Tue, Dec 30, 2025 (latest)"], "b12: every day-list row shows its year");
  eq(/text: dayText\(x, dateLabel\)/.test(html), true, "b12: the day list is built with dayText");
}
class AuthErr extends Error {}
const isDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const mkDay = files => {
  const S = {key: "k", index: [{date: "2026-11-20", final: true}, {date: "2026-11-19", final: true}, {date: "2026-11-17", final: true}, {date: "2026-11-16", final: false}, {date: "2026-11-13", final: true}],
    rows: "rows 20", date: "2026-11-20", meta: {date: "2026-11-20"}, parity: 0, cmpRows: "rows 19", cmpDate: "2026-11-19"}, asked = [];
  const fileText = async p => { asked.push(p); const v = files[p]; if (v instanceof Error) throw v; return v === undefined ? null : v; };
  const setCurrent = csv => { S.rows = csv; S.date = csv.slice(5); S.meta = S.index.find(e => e.date === S.date) || null; };
  const setCompare = (csv, d) => { S.cmpRows = csv || null; S.cmpDate = csv ? d : null; };
  return {S, asked, ...D(isDay, fileText, AuthErr, setCurrent, setCompare, () => {}, () => {}, S, 0)}; // gen: the key's load counter (LOAD block)
};
eq(mkDay({}).dayList([{date: "2026-11-17"}, {date: "2026-11-20"}, {date: "2026-11-17"}, {date: "bad"}, {date: "2026-11-19", final: false}], "2026-11-20"),
  [{date: "2026-11-20", latest: true, prov: false}, {date: "2026-11-19", latest: false, prov: true}, {date: "2026-11-17", latest: false, prov: false}], "every saved day once, newest first, the latest marked");
{
  const F = {"results/2026-11-17.csv": "rows 2026-11-17", "results/2026-11-13.csv": "rows 2026-11-13"}, T = mkDay(F);
  await T.pickDay("2026-11-17");
  eq([T.S.rows, T.S.date, T.S.cmpDate, T.latest().rows, T.latest().cmpDate], ["rows 2026-11-17", "2026-11-17", "2026-11-13", "rows 20", "2026-11-19"],
    "pick a day: that day's file on screen, compared with the last final day before it (not a provisional one); the latest kept aside");
  T.onLatest(() => { T.S.rows = "rows 20 refreshed"; T.S.cmpRows = "fresh"; });
  eq([T.S.rows, T.S.cmpRows, T.latest().rows, T.latest().cmpRows], ["rows 2026-11-17", "rows 2026-11-13", "rows 20 refreshed", "fresh"], "a refresh while a day is picked updates the latest, not the screen");
  T.backToLatest();
  eq([T.S.rows, T.S.date, T.S.cmpDate, T.latest()], ["rows 20 refreshed", "2026-11-20", "2026-11-19", null], "Back to latest: the latest file and its comparison return");
  T.onLatest(() => { T.S.rows = "direct"; });
  eq(T.S.rows, "direct", "with no day picked, a refresh writes the screen as before");
}
{
  const T = mkDay({"results/2026-11-17.csv": "rows 2026-11-17"});
  await T.pickDay("2026-11-17"); const n = T.asked.length;
  await T.pickDay("2026-11-17");
  eq(T.asked.length, n, "picking the day already shown loads nothing");
  await T.pickDay("2026-11-20");
  eq([T.S.date, T.latest()], ["2026-11-20", null], "picking the latest from the list is Back to latest");
}
for (const [what, file, why] of [["missing", undefined, "no file for that day"], ["timed out", new Error("results/2026-11-17.csv: no answer in 30 seconds"), "results/2026-11-17.csv: no answer in 30 seconds"], ["refused", new AuthErr(), "GitHub didn't accept the key"]]) {
  const T = mkDay({"results/2026-11-17.csv": file});
  await T.pickDay("2026-11-17");
  eq([T.S.rows, T.S.date, T.latest(), T.S.dayMsg, !!T.S.authErr], ["rows 20", "2026-11-20", null, {fail: "2026-11-17", why}, what === "refused"], "a " + what + " day file says so and keeps the latest on screen");
}
// An earlier day whose compare file fails (plan § 5.3): that day on screen, no comparison, and a message naming why
for (const [what, file, why] of [["missing", undefined, "no file for that day"], ["timed out", new Error("results/2026-11-13.csv: no answer in 30 seconds"), "results/2026-11-13.csv: no answer in 30 seconds"], ["refused", new AuthErr(), "GitHub didn't accept the key"]]) {
  const T = mkDay({"results/2026-11-17.csv": "rows 2026-11-17", "results/2026-11-13.csv": file});
  await T.pickDay("2026-11-17");
  eq([T.S.date, T.S.cmpRows, T.S.dayMsg, !!T.S.authErr], ["2026-11-17", null, {nocmp: "2026-11-13", why}, what === "refused"], "an earlier day whose compare file is " + what + " says so");
  T.backToLatest();
  eq(T.S.dayMsg, null, "Back to latest clears the compare message (" + what + ")");
}
{
  const T = mkDay({"results/2026-11-13.csv": "rows 2026-11-13"});
  await T.pickDay("2026-11-13");
  eq([T.S.date, T.S.cmpRows, T.S.dayMsg ?? null], ["2026-11-13", null, null], "an earlier day with no final day before it: no comparison and no message");
}
{
  const T = mkDay({"results/2026-11-17.csv": "rows 2026-11-17"});
  await T.pickDay("2026-11-17"); Object.assign(T.S, {key: ""}); T.dropDay();
  eq(T.S.dayMsg, null, "Forget key clears the compare message");
}
{
  const T = mkDay({"results/2026-11-19.csv": "rows 2026-11-19", "results/2026-11-17.csv": "rows 2026-11-17"});
  await T.pickDay("2026-11-19"); await T.pickDay("2026-11-17");
  eq([T.S.date, T.latest().date], ["2026-11-17", "2026-11-20"], "one earlier day after another: the latest stays the one kept aside");
  const slow = T.pickDay("2026-11-19"); T.backToLatest(); await slow;
  eq(T.S.date, "2026-11-20", "Back to latest during a load: the late file never lands");
}
{
  let done; const T = mkDay({"results/2026-11-17.csv": new Promise(r => { done = r; })});
  const p = T.pickDay("2026-11-17");
  Object.assign(T.S, {key: "", rows: null, date: null}); T.dropDay(); done("rows 2026-11-17"); await p;
  eq([T.S.rows, T.S.dayMsg ?? null, T.latest()], [null, null, null], "Forget key during a first pick: the late day file never lands");
}
{
  let done; const T = mkDay({"results/2026-11-17.csv": "rows 2026-11-17", "results/2026-11-19.csv": new Promise(r => { done = r; })});
  await T.pickDay("2026-11-17"); const p = T.pickDay("2026-11-19"); await T.pickDay("2026-11-17"); done("rows 2026-11-19"); await p;
  eq([T.S.date, T.S.dayMsg ?? null], ["2026-11-17", null], "picking the shown day again cancels a pick still loading");
}
{
  const T = mkDay({"results/2026-11-17.csv": "rows 2026-11-17"});
  await T.pickDay("2026-11-17");
  Object.assign(T.S, {key: "", rows: null, date: null}); T.dropDay();
  eq([T.latest(), T.S.rows], [null, null], "after Forget key the kept latest is dropped too");
}

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`screens OK (${n} checks)`);
