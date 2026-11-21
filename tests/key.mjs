// The key's end date and its reminder bars (the KEY block), with the refusal rule gh() uses.
// Runs in CI (no private files needed): node tests/key.mjs
// Value: protects=which date the page accepts, which key bar shows on which day (Manila), what Later hides, the
//   bar words, the date field on open, and that only a 401 or a non-rate-limit 403 counts as a refused key;
//   fails_when=a past or far date is saved, a band changes a day early or late around Manila midnight, Later hides
//   the wrong bar or a bad stored value hides one, a singular reads "1 days", or a rate limit reads as a refused key;
//   no_claim=the panel, focus and bars on screen, and what saveKey/forgetKey store (checked by /qa with tests/demo.mjs).
// The LOAD block with Forget key (plan § 5.1, § 5.2): protects=Forget key during a load, a day pick or a Compare with…
//   load leaves nothing loading and lets the late file land nowhere, and a refused key on the compare file alone keeps
//   and saves the fresh results with the earlier comparison and shows the key warning;
//   fails_when=the loading flag stays set so Refresh does nothing, a late file lands after Forget key, or the fresh
//   results are dropped from the saved copy when only the compare file is refused;
//   no_claim=the bars and the updating… line on screen (checked by /qa with tests/demo.mjs --fail-day).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.js"), "utf8"); // the page's code
const block = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); if (i < 0 || j < 0) throw new Error(a + " markers not found"); return html.slice(i, j); };
const {validateExpiry, defaultExpiry, dateField, keyBand, bandText, authKind} = new Function(
  block("/* STATUS-START", "/* STATUS-END */") + block("/* SUMMARY-START", "/* SUMMARY-END */") + block("/* KEY-START", "/* KEY-END */") +
  "; return {validateExpiry, defaultExpiry, dateField, keyBand, bandText, authKind};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
const at = s => new Date(s + "+08:00"); // Manila wall time
const EXP = "2026-12-01"; // a Tuesday

// Days left and bands, counted on the Manila date: 23:59 and 00:00 fall on different days
const band = (now, exp = EXP, nag = null, refused = false) => keyBand(exp, nag, refused, at(now));
for (const [now, days, b] of [["2026-11-16T12:00", 15, null], ["2026-11-17T00:00", 14, "14"], ["2026-11-16T23:59", 15, null],
  ["2026-11-27T12:00", 4, "14"], ["2026-11-28T00:00", 3, "3"], ["2026-11-27T23:59", 4, "14"], ["2026-11-30T12:00", 1, "3"],
  ["2026-12-01T00:00", 0, "0"], ["2026-11-30T23:59", 1, "3"], ["2026-12-01T23:59", 0, "0"], ["2026-12-02T00:00", -1, "out"]])
  eq(band(now), {band: b, days}, `${now} Manila: ${days} days left`);
eq(keyBand(EXP, null, false, new Date("2026-11-30T16:30:00Z")), {band: "0", days: 0}, "16:30 UTC on Nov 30 is already Dec 1 in Manila");

// Refused by GitHub: ran out when the date has passed, refused otherwise; neither can be hidden
eq(band("2026-11-20T09:00", EXP, null, true), {band: "refused", days: 11}, "refused, date still ahead");
eq(band("2026-12-03T09:00", EXP, null, true), {band: "out", days: -2}, "refused, date passed: ran out");
eq(band("2026-12-03T09:00"), {band: "out", days: -2}, "date passed, not yet refused: ran out");
eq(keyBand(null, null, true, at("2026-11-20T09:00")), {band: "refused", days: null}, "refused, no date known");
eq(band("2026-11-20T09:00", EXP, {band: "14", until: null}, true).band, "refused", "Later never hides refused");

// No date known (a key saved before this version)
eq(keyBand(null, null, false, at("2026-11-20T09:00")), {band: "nodate", days: null}, "no date: the Add date bar");
eq(keyBand("garbage", null, false, at("2026-11-20T09:00")).band, "nodate", "a malformed stored date counts as none");

// Later: hides only its own band; the next band shows again
eq(band("2026-11-20T09:00", EXP, {band: "14", until: null}).band, null, "Later on 14 days hides it");
eq(band("2026-11-28T09:00", EXP, {band: "14", until: null}).band, "3", "Later on 14 days: the 3-day bar still shows");
eq(band("2026-11-29T09:00", EXP, {band: "3", until: null}).band, null, "Later on 3 days hides it");
eq(band("2026-12-01T09:00", EXP, {band: "3", until: null}).band, "0", "Later on 3 days: the day-0 bar still shows");
eq(band("2026-12-02T09:00", EXP, {band: "3", until: null}).band, "out", "Later never hides ran out");
eq(keyBand(null, {band: "nodate", until: "2026-12-20"}, false, at("2026-12-19T23:59")).band, null, "no-date Later: hidden for 30 days");
eq(keyBand(null, {band: "nodate", until: "2026-12-20"}, false, at("2026-12-20T00:00")).band, "nodate", "no-date Later: back on day 30");
eq(keyBand(null, {band: "nodate", until: null}, false, at("2026-12-01T09:00")).band, "nodate", "no-date Later without an end date hides nothing");
for (const nag of ["14", ["14"], {band: "0", until: null}, {band: "14", until: "soon"}, {band: "out"}])
  eq(band("2026-11-20T09:00", EXP, nag).band, "14", "a bad stored Later is ignored: " + JSON.stringify(nag));

// Saving a date: today up to 366 days ahead (Manila); the two refusals, and an empty or bad value
const now = at("2026-11-20T09:00");
eq(validateExpiry("2026-11-20", now), "", "today is accepted");
eq(validateExpiry("2027-11-21", now), "", "366 days ahead is accepted");
eq(validateExpiry("2026-11-19", now), "That date has passed. Check it on GitHub's token page.", "yesterday is refused");
eq(validateExpiry("2027-11-22", now), "That's more than a year away. Check it on GitHub's token page.", "367 days ahead is refused");
eq(validateExpiry("2027-12-25", now), "That's more than a year away. Check it on GitHub's token page.", "400 days ahead is refused");
eq(validateExpiry("", now), "Enter the date your key runs out.", "Save date needs a value");
eq(validateExpiry("2026-02-30", now), "Enter the date your key runs out.", "an impossible date is refused");
eq(validateExpiry("2026-11-20", new Date("2026-11-20T16:30:00Z")), "That date has passed. Check it on GitHub's token page.", "Manila's date, not UTC's");

// The date field on open: today + 90 (Manila) for a new key or a renewal, never the stored date; empty for Add date
eq(defaultExpiry(now), "2027-02-18", "today + 90");
eq(defaultExpiry(new Date("2026-11-20T16:30:00Z")), "2027-02-19", "today + 90 from Manila's date");
eq([dateField("key", now), dateField("date", now)], ["2027-02-18", ""], "renewal resets to today + 90; Add date starts empty");

// Words, singular included, and the refused bar inside and outside the home-screen app
eq(bandText("14", 9, "Tue, Dec 1"), "Your key runs out in 9 days (Tue, Dec 1). Renew it.", "14-day words");
eq(bandText("3", 1, "Tue, Dec 1"), "Your key runs out in 1 day (Tue, Dec 1). Renew it now so your results keep loading.", "1 day, singular");
eq(bandText("3", 3, "Tue, Dec 1"), "Your key runs out in 3 days (Tue, Dec 1). Renew it now so your results keep loading.", "3-day words");
eq(bandText("0", 0, "Tue, Dec 1"), "Your key may stop working today. Renew it now.", "day-0 words");
eq(bandText("out", -2, "Tue, Dec 1"), "Your key ran out on Tue, Dec 1. Make a new one to see your results.", "ran-out words");
eq(bandText("refused", 11, "Tue, Dec 1", true),
  "GitHub didn't accept this key. If you made a new key in Safari or on another device, paste it here; if not, make a new one.", "refused, home-screen app");
eq(bandText("refused", 11, "Tue, Dec 1", false),
  "GitHub didn't accept this key. If you made a new key on another device, paste it here; if not, make a new one.", "refused, browser");
eq(bandText("nodate", null, ""), "Add your key's end date so this page can remind you before it runs out.", "no-date words");

// What Later stores: the band, and 30 Manila days only for the no-date bar (store and renderBars stand in for the page's)
{
  const saved = {}, keyLater = new Function("store", "renderBars", "Date",
    block("/* STATUS-START", "/* STATUS-END */") + block("/* KEY-START", "/* KEY-END */") + "; return keyLater;")(
    {set: (k, v) => { saved[k] = v; }}, () => {}, class extends Date { constructor(...a) { super(...(a.length ? a : ["2026-11-20T16:30:00Z"])); } });
  keyLater("nodate"); eq(saved.keyNag, {band: "nodate", until: "2026-12-21"}, "Later on no date: until 30 days after the Manila date (Nov 21 in Manila)");
  keyLater("14"); eq(saved.keyNag, {band: "14", until: null}, "Later on 14 days: no end date");
  keyLater("3"); eq(saved.keyNag, {band: "3", until: null}, "Later on 3 days: no end date");
}

// Which GitHub answers count as a refused key (gh() throws AuthError on "auth"); a 404 never does
const h = o => ({get: k => o[k] ?? null});
eq([authKind(401, h({})), authKind(403, h({})), authKind(403, h({"x-ratelimit-remaining": "0"})), authKind(403, h({"retry-after": "60"})),
  authKind(404, h({})), authKind(500, h({})), authKind(200, h({}))], ["auth", "auth", "rate", "rate", "", "", ""], "refused key vs rate limit vs other answers");

// ---------------------------------------------------------------- LOAD with Forget key (the real gh() and fileText(), a fake fetch)
// Each made-up file is text "rows <date>"; parseCSV reads its date, so setCurrent and setCompare run as written.
function loadHarness(files, cache = null) {
  const mem = new Map(cache ? [["cache", cache]] : []), asked = [], gates = [];
  const store = {get: (k, d) => mem.has(k) ? mem.get(k) : d, set: (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); return true; }, del: k => mem.delete(k)};
  let hold = false; // true: every request waits until release(); a file name: only that one waits
  const fetch = async (url, o) => {
    const f = String(url).replace(/^.*\/contents\//, ""); asked.push(f);
    if (hold === true || hold === f) await new Promise(r => gates.push(r));
    if (o.signal && o.signal.aborted) throw o.signal.reason;
    const v = files[f];
    return v === 401 ? new Response("{}", {status: 401}) : v === undefined ? new Response("{}", {status: 404}) : new Response(v, {status: 200});
  };
  const parseCSV = t => [{data_date: String(t).split(" ")[1] || null}];
  const S = {key: "k-made-up", rows: null, date: null, meta: null, updated: null, tried: null, loading: 0, cached: false, index: [], status: null,
    holidays: new Set(), cmpRows: null, cmpDate: null, authErr: false, noAccess: false, refreshErr: null, msg: null, parity: 0, fixtureBad: 0};
  const names = "S, store, fetch, parseCSV, isDay, addDays, manilaISO, dayDiff, plural, showKey, renderHeader, renderSummary, renderBars, cleanIndex, PRESETS, evaluate, parseHistory, checkFixture, API";
  const L = new Function(...names.split(", "), "let H = {state: \"loading\"};\nconst renderAll = () => dropDay();\n" +
    block("/* KEY-START", "/* KEY-END */") + block("/* DAY-START", "/* DAY-END */") + block("/* LOAD-START", "/* LOAD-END */") +
    "; return {loadRemote, refresh, forgetKey, pickDay, dropDay, onLatest, fileText, AuthError, setCompare, renderAll, saveCache, dgen: () => dgen, gen: () => gen};")(
    S, store, fetch, parseCSV, d => /^\d{4}-\d{2}-\d{2}$/.test(d), () => "", () => "", () => 0, () => "", () => {}, () => {}, () => {}, () => {},
    x => x, {}, () => [], () => ({state: "ok"}), () => {}, "https://api.github.com/repos/made-up");
  return {S, mem, asked, L, hold: v => { hold = v; }, release: () => { while (gates.length) gates.shift()(); }};
}
const tick = () => new Promise(r => setTimeout(r, 0));
const IDX = JSON.stringify([{date: "2026-11-20", final: true}, {date: "2026-11-19", final: true}, {date: "2026-11-18", final: true}, {date: "2026-11-17", final: true}]);
const FILES = {"results/latest.csv": "rows 2026-11-20", "results/index.json": IDX, "data/holidays.csv": "date", "results/2026-11-19.csv": "rows 2026-11-19",
  "results/2026-11-18.csv": "rows 2026-11-18", "results/2026-11-17.csv": "rows 2026-11-17"};
{ // T-29: Forget key during a load clears the loading flag; Refresh works again once a key is saved
  const T = loadHarness(FILES); T.hold(true);
  const p = T.L.loadRemote(); await tick();
  T.L.forgetKey(); T.release(); await p; T.hold(false);
  eq([!!T.S.loading, T.S.rows], [false, null], "Forget key during a load: nothing is left loading and the late results never land");
  T.S.key = "k-new"; const before = T.asked.length; T.L.refresh(); await tick();
  eq(T.asked.length > before, true, "after Forget key and a new key, Refresh starts a new load");
}
{ // Forget key during a day pick: the late day file never lands
  const T = loadHarness(FILES); await T.L.loadRemote(); T.hold(true);
  const p = T.L.pickDay("2026-11-18"); await tick();
  T.L.forgetKey(); T.release(); await p;
  eq([T.S.rows, T.S.date, T.S.dayMsg ?? null], [null, null, null], "Forget key during a day pick: the late day file never lands");
}
{ // Forget key during a Compare with… load (the change handler in init, sliced by its own lines): the late file never lands
  const js = html, a = js.indexOf("  const keepCmp = "), b = js.indexOf("  const days = $(\"days\")");
  if (a < 0 || b < a) throw new Error("the Compare with… handler was not found in app.js");
  const T = loadHarness(FILES); await T.L.loadRemote(); T.hold(true);
  let onChange = null; const sel = {addEventListener: (t, f) => { onChange = f; }};
  new Function("$", "fileText", "setCompare", "renderAll", "store", "saveCache", "AuthError", "S", "dgenOf", "genOf", "LATEST",
    js.slice(a, b).replace(/\bdgen\b/g, "dgenOf()").replace(/\bgen\b/g, "genOf()"))(() => sel, T.L.fileText, T.L.setCompare, T.L.renderAll, {get: () => null}, T.L.saveCache, T.L.AuthError, T.S, T.L.dgen, T.L.gen, null);
  const p = onChange({target: {value: "2026-11-18"}}); await tick();
  T.L.forgetKey(); T.release(); await p;
  eq([T.S.cmpRows, T.S.cmpDate], [null, null], "Forget key during a Compare with… load: the late file never lands");
  T.hold(false); T.S.key = "k-new"; await T.L.loadRemote();
  T.hold("results/2026-11-18.csv"); const slow = onChange({target: {value: "2026-11-18"}}); await tick();
  T.hold(false); await onChange({target: {value: "2026-11-17"}}); T.release(); await slow;
  eq(T.S.cmpDate, "2026-11-17", "two Compare with… choices: the older, slower file never lands over the newer choice");
}
{ // A refusal that arrives after Forget key (or a new key) says nothing about the key now saved
  const T = loadHarness({...FILES, "results/2026-11-19.csv": 401}); T.hold("results/2026-11-19.csv");
  const p = T.L.loadRemote(); for (let i = 0; i < 5; i++) await tick();
  T.L.forgetKey(); T.release(); await p;
  eq(T.S.authErr, false, "a late refused compare file after Forget key does not mark the key refused");
  const D = loadHarness({...FILES, "results/2026-11-17.csv": 401}); await D.L.loadRemote(); D.hold("results/2026-11-17.csv");
  const q = D.L.pickDay("2026-11-18"); for (let i = 0; i < 5; i++) await tick();
  D.L.forgetKey(); D.S.key = "k-new"; D.release(); await q;
  eq(D.S.authErr, false, "a late refused compare file for a day pick after Forget key does not mark the key refused");
}
{ // A refused key on the compare file alone: fresh results shown and saved, the earlier comparison kept with its date, the key warning on
  const old = {csv: "rows 2026-11-19", index: [], status: null, holidays: [], cmp: {date: "2026-11-18", csv: "rows 2026-11-18"}, at: 1};
  const T = loadHarness({...FILES, "results/2026-11-18.csv": 401}, old);
  Object.assign(T.S, {rows: [{data_date: "2026-11-19"}], date: "2026-11-19", cmpRows: [{data_date: "2026-11-18"}], cmpDate: "2026-11-18", cached: true});
  await T.L.loadRemote();
  const c = T.mem.get("cache") || {};
  eq([T.S.date, T.S.cmpDate, T.S.authErr, c.csv, c.cmp && c.cmp.date], ["2026-11-20", "2026-11-18", true, "rows 2026-11-20", "2026-11-18"],
    "refused key on the compare file alone: fresh results on screen and saved, the earlier comparison kept, the key warning on");
}

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`key OK (${n} checks)`);
