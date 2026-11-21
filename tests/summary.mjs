// The daily summary, market mood, when the page reloads on its own (the SUMMARY block), and the ? explanations (TIPS).
// Runs in CI (no private files needed): node tests/summary.mjs
// Value: protects=the summary words for every case in plan § 6, one prefix in the right order, the mood cut-offs and
//   its 50-row floor, a ? explanation for every plain label, the 10-minute reload rule and one load at a time;
//   fails_when=a case reads wrong, two prefixes show, an edge moves, a label has no explanation, or it reloads too often;
//   no_claim=the panel, bubbles and visibilitychange wiring on screen (checked by /qa with tests/demo.mjs).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const block = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); if (i < 0 || j < 0) throw new Error(a + " markers not found"); return html.slice(i, j); };
const {shouldRefresh, summaryLine, mood, moodLine, TIPS} = new Function(block("/* STATUS-START", "/* STATUS-END */") +
  block("/* SUMMARY-START", "/* SUMMARY-END */") + block("/* TIPS-START", "/* TIPS-END */") + "; return {shouldRefresh, summaryLine, mood, moodLine, TIPS};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
const T = 1_800_000_000_000, MIN = 60e3;
const s = o => ({key: "k", loading: 0, updated: null, tried: null, ...o});

eq(shouldRefresh(s({}), T, false), true, "nothing loaded or tried yet: refresh");
eq(shouldRefresh(s({updated: T - 10 * MIN}), T, false), false, "exactly 10 minutes since the last good load: not yet");
eq(shouldRefresh(s({updated: T - 10 * MIN - 1}), T, false), true, "just over 10 minutes: refresh");
eq(shouldRefresh(s({updated: T - 30 * MIN, loading: 7}), T, false), false, "a load is running: never a second one");
eq(shouldRefresh(s({updated: T - 30 * MIN, tried: T - 2 * MIN}), T, false), false, "a failed try 2 minutes ago: wait (no retry on every tab switch)");
eq(shouldRefresh(s({updated: null, tried: T - 11 * MIN}), T, false), true, "a failed try 11 minutes ago: try again");
eq(shouldRefresh(s({key: ""}), T, false), false, "no key: nothing to load");
eq(shouldRefresh(s({}), T, true), false, "page hidden: wait until it is visible");


// Line 1, the day (plan § 6), bold shown as **…**; made-up counts
const txt = parts => parts.map(x => typeof x === "string" ? x : "**" + x.b + "**").join("");
const Cx = (pass, isNew, dropped, missed, hasCmp = true) => ({pass: Array(pass), isNew: new Set(Array.from({length: isNew}, (_, i) => i)), dropped: Array(dropped), missed: Array(missed), hasCmp});
const at = s => new Date(s + "+08:00");
const day = o => ({name: "Strict", date: "2026-11-19", provisional: false, status: {state: "ok"}, holidays: new Set(), missed: false, now: at("2026-11-20T09:00"), cmp: "Wed, Nov 18", ...o});
const line = (C, o) => txt(summaryLine(C, day(o)));
eq(line(Cx(3, 1, 2, 4)), "**Strict** today: **3 stocks pass**, 1 new and 2 dropped since Wed, Nov 18. 4 more missed by one filter.", "normal");
eq(line(Cx(1, 1, 0, 0)), "**Strict** today: **1 stock passes**, new since Wed, Nov 18.", "one stock, new");
eq(line(Cx(3, 0, 0, 0)), "**Strict** today: **3 stocks pass**, the same as Wed, Nov 18.", "nothing new or dropped");
eq(line(Cx(0, 0, 0, 2)), "**Strict** today: **no stock passes.** 2 missed by one filter.", "empty day");
eq(line(Cx(0, 0, 1, 2)), "**Strict** today: **no stock passes**, 1 dropped since Wed, Nov 18. 2 missed by one filter.", "empty day says how many dropped (T-28)");
eq(line(Cx(0, 0, 3, 0)), "**Strict** today: **no stock passes**, 3 dropped since Wed, Nov 18. None missed by one filter.", "empty day, dropped, none missed");
eq(line(Cx(0, 0, 2, 0, false)), "**Strict** today: **no stock passes**, and none missed by one filter. Quiet days like this are normal.", "no compare date: no dropped count");
eq(line(Cx(0, 0, 0, 0)), "**Strict** today: **no stock passes**, and none missed by one filter. Quiet days like this are normal.", "empty, none missed");
eq(line(Cx(7, 0, 0, 3, false), {name: "Loose"}), "**Loose** today: **7 stocks pass**. 3 missed by one filter. Pick a date in Compare with… to see what's new.", "no compare date");
// Prefixes: one at most, provisional, then holiday, then not today's
const hol = {date: "2026-11-27", holidays: new Set(["2026-11-30"]), now: at("2026-12-01T09:00")};
eq(line(Cx(3, 0, 0, 0), hol), "PSE was closed Mon, Nov 30 (holiday). Latest session, Fri, Nov 27: **Strict**: **3 stocks pass**, the same as Wed, Nov 18.", "holiday");
eq(line(Cx(3, 0, 0, 0), {...hol, status: {state: "no_new_session"}}), line(Cx(3, 0, 0, 0), hol), "holiday + no new session: the holiday prefix only");
eq(line(Cx(3, 0, 0, 0), {...hol, missed: true}), line(Cx(3, 0, 0, 0), hol), "holiday + missed run: the holiday prefix only");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-26", holidays: new Set(["2026-11-27"]), now: at("2026-11-30T19:00"), status: {state: "failed", expected_date: "2026-11-30"}}).startsWith("From Thu, Nov 26 (not today's): "), true, "a run after the holiday failed: not today's, not the holiday (T-28)");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-26", holidays: new Set(["2026-11-27"]), now: at("2026-11-30T09:00"), status: {state: "failed", expected_date: "2026-11-27"}}).startsWith("PSE was closed Fri, Nov 27"), true, "a failed run for the holiday itself: the holiday prefix");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-17", picked: true, status: {state: "failed"}}), "Tue, Nov 17, an earlier day: **Strict**: **3 stocks pass**, the same as Wed, Nov 18.", "a picked earlier day names itself, no other prefix");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-18", status: {state: "no_new_session"}}), "From Wed, Nov 18 (not today's): **Strict**: **3 stocks pass**, the same as Wed, Nov 18.", "stale: no new session");
eq(line(Cx(3, 0, 0, 0), {status: {state: "failed"}}).startsWith("From Thu, Nov 19 (not today's): "), true, "stale: run failed");
eq(line(Cx(3, 0, 0, 0), {missed: true}).startsWith("From Thu, Nov 19 (not today's): "), true, "stale: missed-run line on");
eq(line(Cx(3, 0, 0, 0), {provisional: true, status: {state: "failed"}, ...hol}).startsWith("Provisional (during trading): **Strict**: "), true, "provisional wins over holiday and stale");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-20", now: at("2026-11-23T09:00")}).startsWith("**Strict** today"), true, "Friday's data on Monday: no prefix (a weekend is not a holiday)");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-18", now: at("2026-11-20T09:00")}).startsWith("**Strict** today"), true, "no prefix without a holiday, a stale status or a missed run");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-27", holidays: new Set(["2026-11-30"]), now: at("2026-11-30T09:00")}).startsWith("PSE was closed Mon, Nov 30 (holiday). Latest session, Fri, Nov 27: "), true, "today itself is the holiday");
eq(line(Cx(3, 0, 0, 0), {date: "2026-11-25", holidays: new Set(["2026-11-26"]), now: at("2026-11-30T09:00")}).startsWith("**Strict** today"), true, "a holiday, then a normal weekday with no data: no holiday prefix");
// Line 2, market mood: share of rows with a number; cut-offs 35 and 65 whole percent; 50-row floor
const rows = (up, n, nulls = 0) => [...Array.from({length: n}, (_, i) => ({pct_vs_sma200: i < up ? 2 : -2})), ...Array.from({length: nulls}, () => ({pct_vs_sma200: null}))];
eq([mood(rows(34, 100)).word, mood(rows(35, 100)).word, mood(rows(65, 100)).word, mood(rows(66, 100)).word], ["weak", "mixed", "mixed", "strong"], "35% and 65% edges");
eq(mood(rows(20, 49, 30)), null, "49 rows with a number: not enough data (rows without one count in neither part)");
eq(mood(rows(23, 50, 30)), {n: 50, pct: 46, word: "mixed", was: null}, "50 rows: enough; the count names only rows with a number");
eq(mood(rows(0, 0, 80)), null, "a file with no numbers: not enough data");
eq(txt(moodLine(mood(rows(46, 100), rows(41, 100)), "Wed, Nov 18")), "Market mood: **mixed**. 46% of 100 stocks are above their 200-day average (up from 41% on Wed, Nov 18).", "up from");
eq(txt(moodLine(mood(rows(29, 100), rows(33, 100)), "Wed, Nov 18")), "Market mood: **weak**. 29% of 100 stocks are above their 200-day average (down from 33% on Wed, Nov 18).", "down from");
eq(txt(moodLine(mood(rows(44, 100), rows(44, 100)), "Tue, Nov 17")), "Market mood: **mixed**. 44% of 100 stocks are above their 200-day average (same as 44% on Tue, Nov 17).", "same as");
eq(txt(moodLine(mood(rows(44, 100), rows(20, 40)), "Tue, Nov 17")), "Market mood: **mixed**. 44% of 100 stocks are above their 200-day average.", "compare file under 50 numbers: no comparison");
eq(txt(moodLine(null, "x")), "Market mood: not enough data today.", "not enough data words");
eq(txt(moodLine(mood(rows(46, 100), rows(41, 100)), null)), "Market mood: **mixed**. 46% of 100 stocks are above their 200-day average.", "no compare date name: no comparison");
// ? explanations: every plain label of plan § 7 has one, and every label the page shows with a ? is in TIPS
const LABELS = ["Stock", "Days on list", "Momentum", "Price ₱", "Traded today", "Today %", "Daily swing", "9-day change", "Below year high", "vs 50-day avg",
  "vs 200-day avg", "Company size", "Usual daily trading", "Price above 200-day average", "Price above 50-day average", "50-day average above 200-day",
  "9-day change at least", "Company size at least", "Below year high, %", "Usual daily trading above", "Traded today above", "Price above", "Daily swing between",
  "Strict", "Loose", "Custom", "missed by one filter", "Knocking on the door", "BOTH", "Provisional", "Market mood"];
eq(LABELS.filter(l => typeof TIPS[l] !== "string" || !TIPS[l]), [], "every plan § 7 label has an explanation");
const shown = [...html.matchAll(/data-tip="([^"]+)"|tipBtn\("([^"]+)"\)/g)].map(m => m[1] || m[2])
  .concat([...block("const COLS = [", "function renderHead").matchAll(/\bt: "([^"]+)"/g)].map(m => m[1]))
  .concat([...block("const SLIDERS = [", "const CHECKS").matchAll(/label: "([^"]+)"/g)].map(m => m[1]));
eq(shown.filter(l => !(l in TIPS)), [], "every ? on the page has an explanation");
eq(TIPS["Market mood"].includes("Not a signal to buy or sell"), true, "Market mood says it describes, not advises");

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`summary OK (${n} checks)`);
