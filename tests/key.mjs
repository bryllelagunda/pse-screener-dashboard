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
  files = {...files}; // each harness its own copy: a test may replace a file mid-run
  const mem = new Map(cache ? [["cache", cache]] : []), asked = [], gates = [];
  const store = {get: (k, d) => mem.has(k) ? mem.get(k) : d, set: (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); return true; }, del: k => mem.delete(k)};
  let hold = false, drawn = 0, onDraw = null; // drawn: chart redraws asked for; hold true: every request waits until release(); a file name: only that one waits
  const fetch = async (url, o) => {
    const f = String(url).replace(/^.*\/contents\//, ""); asked.push(f);
    const v = files[f]; // the file as it was when asked for (a run may replace it while the answer is on its way)
    if (hold === true || hold === f) await new Promise(r => gates.push(r));
    if (o.signal && o.signal.aborted) throw o.signal.reason;
    return v === 401 ? new Response("{}", {status: 401}) : v === undefined ? new Response("{}", {status: 404}) : new Response(v, {status: 200});
  };
  const parseCSV = t => [{data_date: String(t).split(" ")[1] || null}];
  const S = {key: "k-made-up", rows: null, date: null, meta: null, updated: null, tried: null, loading: 0, cached: false, index: [], status: null,
    holidays: new Set(), cmpRows: null, cmpDate: null, authErr: false, noAccess: false, refreshErr: null, msg: null, parity: 0, fixtureBad: 0};
  const names = "S, store, fetch, parseCSV, isDay, addDays, manilaISO, dayDiff, plural, showKey, renderHeader, renderSummary, renderBars, cleanIndex, PRESETS, evaluate, parseHistory, checkFixture, API, chartChanged";
  const L = new Function(...names.split(", "), "let H = {state: \"loading\"};\nconst renderAll = () => dropDay();\n" +
    block("/* KEY-START", "/* KEY-END */") + block("/* DAY-START", "/* DAY-END */") + block("/* CHART-START", "/* CHART-END */") + block("/* LOAD-START", "/* LOAD-END */") +
    "; return {loadRemote, refresh, forgetKey, pickDay, dropDay, onLatest, fileText, AuthError, setCompare, renderAll, saveCache, dgen: () => dgen, gen: () => gen," +
    " loadCloses, dropCloses, saveKey, CL: () => CL, latestRows, latestEntry, chartState, LATEST: () => LATEST};")(
    S, store, fetch, parseCSV, d => /^\d{4}-\d{2}-\d{2}$/.test(d), () => "", () => "", () => 0, () => "", () => {}, () => {}, () => {}, () => {},
    x => x, {}, () => [], () => ({state: "ok"}), () => {}, "https://api.github.com/repos/made-up", () => { drawn++; if (onDraw) onDraw(); });
  return {S, mem, asked, L, files, drawn: () => drawn, setDraw: f => { onDraw = f; }, hold: v => { hold = v; }, release: () => { while (gates.length) gates.shift()(); }};
}
const tick = () => new Promise(r => setTimeout(r, 0));
const ok = (c, what) => eq(!!c, true, what);
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
{ // A date in index.json that is not a date never goes into a request's path
  const bad = JSON.stringify([{date: "2026-11-20", final: true}, {date: "2026-11-19/../../x", final: true}]);
  const T = loadHarness({...FILES, "results/index.json": bad}); await T.L.loadRemote();
  eq(T.asked.filter(f => f.includes("..")), [], "a malformed index date is never requested as the comparison");
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

// ---------------------------------------------------------------- the price chart's file (T-23 plan § 3.2, § 3.3; tests b7-b10, b17-b20)
// A made-up closes file and its stamp; the latest index entry carries the stamp of the run that wrote it
const { createHash } = await import("node:crypto");
const stamp = t => createHash("sha256").update(t).digest("hex").slice(0, 16);
const CDATES = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const closesOf = k => ["symbol"].concat(CDATES).join(",") + "\n" + ["DEMOA", "DEMOB"].map((sym, j) => [sym].concat(CDATES.map((_, i) => String(10 + j + i + k))).join(",")).join("\n") + "\n";
const C1 = closesOf(0), C2 = closesOf(0.5);
const idxWith = (e0, rest = []) => JSON.stringify([e0, ...rest, {date: "2026-11-19", final: true}, {date: "2026-11-18", final: true}]);
const E1 = {date: "2026-11-20", final: true, finished_at: "2026-11-20T10:00:00Z", closes_sha256: stamp(C1)};
const CFILES = {...FILES, "results/closes.csv": C1, "results/index.json": idxWith(E1)};
const closesAsked = T => T.asked.filter(f => f === "results/closes.csv").length;
const view = (T, sym = "DEMOA") => T.L.chartState({cl: T.L.CL(), sym, rows: T.L.latestRows(), meta: T.L.latestEntry(), end: T.S.date, months: 3});
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
{ // b7: one request for every panel; one more for a new latest entry, and only one
  const T = loadHarness(CFILES); await T.L.loadRemote();
  T.hold("results/closes.csv"); const a = T.L.loadCloses(); T.L.loadCloses(); await tick(); T.release(); T.hold(false); await a; await settle();
  T.L.loadCloses(); await settle();
  eq([closesAsked(T), T.L.CL().state, !!view(T).draw], [1, "ok", true], "b7: three panels (two while loading) send one request, and the chart draws");
  const E2 = {...E1, finished_at: "2026-11-20T11:00:00Z", closes_sha256: stamp(C2)};
  T.files["results/index.json"] = idxWith(E2); T.files["results/closes.csv"] = C2; await T.L.loadRemote();
  T.L.loadCloses(); await settle(); T.L.loadCloses(); await settle();
  eq([closesAsked(T), T.L.CL().stamp === stamp(C2), !!view(T).draw], [2, true, true], "b7: a new latest entry reloads once, then draws the new file");
}
{ // b8 and b10: Forget key while the file loads: the late file lands nowhere, and nothing of it is saved in the browser
  const T = loadHarness(CFILES); await T.L.loadRemote(); T.hold("results/closes.csv");
  const a = T.L.loadCloses(); await tick(); T.L.forgetKey(); T.release(); await a; await settle();
  eq([T.L.CL().state, T.L.CL().by === undefined], ["idle", true], "b8: Forget key mid-load: the late file is not kept");
  const U = loadHarness(CFILES); await U.L.loadRemote(); await U.L.loadCloses(); await settle();
  const saved = JSON.stringify([...U.mem.values()]), row = ["DEMOA"].concat(CDATES.map((_, i) => String(10 + i))).join(",");
  eq([U.L.CL().state, saved.includes("symbol," + CDATES[0]), saved.includes(row), U.mem.has("closes")], ["ok", false, false, false],
    "b10: after a chart load no pse.* value holds the closes header or a row");
}
{ // b9: a refused key marks the key refused only when it was sent with the key still saved
  const T = loadHarness({...CFILES, "results/closes.csv": 401}); await T.L.loadRemote(); T.S.authErr = false;
  await T.L.loadCloses(); await settle();
  eq([T.L.CL().state, T.S.authErr, view(T).say], ["auth", true, "Prices can't load until the key is fixed (see above)."], "b9: a refused closes file marks the current key refused");
  // Review 2026-11-24 (specialist): a one-off refusal clears once a refresh shows the key works
  T.files["results/closes.csv"] = C1; await T.L.loadRemote(); T.L.loadCloses(); await settle();
  eq([T.S.authErr, T.L.CL().state], [false, "ok"], "b9: after a good refresh the chart loads again");
  const U = loadHarness({...CFILES, "results/closes.csv": 401}); await U.L.loadRemote(); U.S.authErr = false; U.hold("results/closes.csv");
  const a = U.L.loadCloses(); await tick(); U.L.forgetKey(); U.S.key = "k-new"; U.release(); await a; await settle();
  eq([U.S.authErr, U.L.CL().state], [false, "idle"], "b9: a refusal that returns after Forget key says nothing about the new key");
}
{ // b17: reload once per results change; a file a day behind does not loop; a new key or Forget key drops the old prices
  const P1 = {...E1, final: false, finished_at: "2026-11-20T06:00:00Z", closes_sha256: stamp(C1)};
  const T = loadHarness({...CFILES, "results/index.json": idxWith(P1)}); await T.L.loadRemote(); await T.L.loadCloses(); await settle();
  T.files["results/index.json"] = idxWith({...P1, final: true, finished_at: "2026-11-20T10:00:00Z", closes_sha256: stamp(C2)}); T.files["results/closes.csv"] = C2;
  await T.L.loadRemote(); T.L.loadCloses(); await settle();
  eq([closesAsked(T), T.L.CL().stamp === stamp(C2)], [2, true], "b17: the same day's provisional-to-final change reloads the file");
  T.files["results/index.json"] = idxWith({...E1, finished_at: "2026-11-21T10:00:00Z", closes_sha256: stamp(closesOf(9))}); // the run failed after writing the results
  await T.L.loadRemote(); for (let i = 0; i < 4; i++) { T.L.loadCloses(); await settle(); }
  eq([closesAsked(T), view(T).say], [3, "Prices are being updated: the chart comes back after the next run."], "b17: a file that stays behind reloads once, not in a loop");
  globalThis.$ = id => ({value: id === "keyin" ? "k-other" : id === "kdate" ? "2099-01-01" : "", focus() {}, textContent: ""});
  const keysSent = []; T.setDraw(() => { keysSent.push(T.S.key); });
  T.L.saveKey(); eq([T.L.CL().state, T.L.CL().by === undefined, keysSent], ["idle", true, ["k-other"]], "b17: saving a new key drops the old prices; the redraw sees only the new key");
  T.setDraw(null);
  await T.L.loadCloses(); await settle(); T.L.forgetKey(); eq([T.L.CL().state, T.L.CL().by === undefined], ["idle", true], "b17: Forget key drops the prices");
  delete globalThis.$;
}
{ // b18: on an earlier day the latest run's rows decide the state, not the picked day's
  const T = loadHarness(CFILES); await T.L.loadRemote(); await T.L.loadCloses(); await settle();
  await T.L.pickDay("2026-11-18");
  T.L.LATEST().rows = [{symbol: "DEMOA"}, {symbol: "DEMOB"}, {symbol: "DEMOC"}]; T.S.rows = [{symbol: "DEMOA", fetch_error: "made-up timeout"}];
  eq([!!T.L.LATEST(), T.S.date, !!view(T).draw], [true, "2026-11-18", true], "b18: a fetch error in the picked day's rows does not hide the chart");
  eq(view(T, "DEMOC").say, "No usable prices for DEMOC in the last run.", "b18: in the latest run without a closes row or fetch error: no usable prices");
  ok(view(T).draw.w[1] === CDATES.indexOf("2026-11-18"), "b18: the chart ends on the picked day");
}
{ // b19: refresh and chart answers interleaved across a provisional and a final run of one day: nothing drawn from another run's file
  const P1 = {...E1, final: false, finished_at: "2026-11-20T06:00:00Z", closes_sha256: stamp(C1)}, F2 = {...E1, closes_sha256: stamp(C2)};
  const drawnOk = T => { const v = view(T), e = T.L.latestEntry(); return !v.draw || T.L.CL().stamp === e.closes_sha256 && v.draw.v === T.L.CL().by.get("DEMOA"); };
  // order 1: the chart asks during the provisional run, the final run lands, then the chart answer (the provisional file) arrives
  const A = loadHarness({...CFILES, "results/index.json": idxWith(P1)}); await A.L.loadRemote(); A.hold("results/closes.csv");
  const a = A.L.loadCloses(); await settle(); A.hold(false);
  A.files["results/index.json"] = idxWith(F2); A.files["results/closes.csv"] = C2; await A.L.loadRemote();
  A.release(); await a; await settle();
  eq([A.L.CL().stamp === stamp(C1), view(A).say, drawnOk(A)], [true, "Prices are being updated: the chart comes back after the next run.", true], "b19 order 1: the provisional file is not drawn beside the final results");
  A.L.loadCloses(); await settle(); eq([!!view(A).draw, A.L.CL().stamp === stamp(C2), drawnOk(A)], [true, true, true], "b19 order 1: one reload draws the final file");
  // order 2: the refresh asks first, the final file is written, the chart answer (final) lands before the refresh answer (provisional index)
  const B = loadHarness({...CFILES, "results/index.json": idxWith(P1)}); await B.L.loadRemote(); B.hold("results/index.json");
  const r = B.L.loadRemote(); await settle(); B.hold(false);
  B.files["results/closes.csv"] = C2; B.files["results/index.json"] = idxWith(F2);
  await B.L.loadCloses(); await settle();
  eq([B.L.latestEntry().closes_sha256 === stamp(C1), !!view(B).draw, drawnOk(B)], [true, false, true], "b19 order 2: the final file is not drawn beside the provisional results");
  B.release(); await r; await settle();
  eq([B.L.latestEntry().closes_sha256 === stamp(C1), !!view(B).draw, drawnOk(B)], [true, false, true], "b19 order 2: the older refresh answer still shows no chart");
  await B.L.loadRemote(); B.L.loadCloses(); await settle();
  eq([!!view(B).draw, drawnOk(B)], [true, true], "b19 order 2: once the final results land, the final file draws");
}
{ // b20: build (a) reverted: a latest entry without closes_sha256 never draws
  const T = loadHarness({...CFILES, "results/index.json": idxWith({date: "2026-11-20", final: true, finished_at: "2026-11-20T10:00:00Z"})});
  await T.L.loadRemote(); await T.L.loadCloses(); await settle();
  eq([T.L.CL().state, view(T).say], ["ok", "Prices are being updated: the chart comes back after the next run."], "b20: no stamp in the latest entry: no chart");
}

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`key OK (${n} checks)`);
