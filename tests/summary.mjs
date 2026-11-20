// When the page reloads on its own: coming back to it, or opening the home-screen app (the SUMMARY block).
// Runs in CI (no private files needed): node tests/summary.mjs
// Value: protects=the 10-minute rule, one load at a time, and no retry storm after a failed try;
//   fails_when=it reloads while a load runs, without a key, while hidden, before 10 minutes, or never after one;
//   no_claim=the visibilitychange wiring and "updating…" on screen (checked by /qa with tests/demo.mjs).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const i = html.indexOf("/* SUMMARY-START"), j = html.indexOf("/* SUMMARY-END */");
if (i < 0 || j < 0) throw new Error("SUMMARY markers not found");
const {shouldRefresh} = new Function(html.slice(i, j) + "; return {shouldRefresh};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (got !== want) { bad++; console.log(`FAIL ${what}: got ${got}, want ${want}`); } };
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

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`summary OK (${n} checks)`);
