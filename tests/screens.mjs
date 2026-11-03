// Saved filter sets: storage cleaning, name rules and the collapsed-panel summary.
// Runs in CI (no private files needed): node tests/screens.mjs
// Value: protects=what the page keeps from localStorage, which names it accepts, and the one-line summary text;
//   fails_when=a corrupt or tampered entry loads, a good entry is dropped, a duplicate or 21st name is accepted,
//   a rename to itself is refused, or the summary misstates a filter;
//   no_claim=buttons, the name box, URL restore, the panel toggle and real localStorage (checked by hand in a browser).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
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
eq(summary(STRICT), "Price > SMA200 · Price > SMA50 · SMA50 > SMA200 · ROC ≥ 5% · Mkt cap ≥ ₱1B · Price > ₱1 · 30D value > ₱5M · 52W high 0–20% below · ATR 1–4%", "Strict summary");
eq(summary(LOOSE), "Price > SMA200 · SMA50 > SMA200 · ROC ≥ 0% · Mkt cap ≥ ₱500M · Price > ₱1 · 30D value > ₱5M · Today's value > ₱10M · 52W high 0–30% below · ATR 1–6%", "Loose summary");
eq(summary({above_sma200: false, above_sma50: false, sma50_above_sma200: false, roc9_min: -20, price_min: 0, avg_value_min: 0, mcap_min: 0,
  value_today_min: 0, high_band: [0, 100], atr_band: [0, 15]}), "ROC ≥ -20% · 52W high 0–100% below · ATR 0–15%", "all-off summary leaves out off filters");

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`screens OK (${n} checks)`);
