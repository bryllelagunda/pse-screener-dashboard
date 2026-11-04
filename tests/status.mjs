// Run-schedule lines in the status bar: the missed-run warning and "PSE closed today."
// Runs in CI (no private files needed): node tests/status.mjs
// Value: protects=when each line shows, against the 6:30pm run plus 7:50am Tue–Sat backup (screener RD-2);
//   fails_when=the warning shows before 8:50am, on Sun/Mon, after a holiday, when the final file is there or a run
//   happened since 7:50am, or misses a real gap; "closed today" shows for a past session or misses today's;
//   no_claim=the bar's markup and links (checked by hand in a browser).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const i = html.indexOf("/* STATUS-START"), j = html.indexOf("/* STATUS-END */");
if (i < 0 || j < 0) throw new Error("STATUS markers not found");
const {closedToday, missedRun} = new Function(html.slice(i, j) + "; return {closedToday, missedRun};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (got !== want) { bad++; console.log(`FAIL ${what}: got ${got}, want ${want}`); } };
const at = s => new Date(s + "+08:00"); // Manila wall time
const iso = s => at(s).toISOString();
const final = (...dates) => dates.map(date => ({date, final: true}));
const none = new Set();

// missedRun: Thu 2026-11-05; Wed 2026-11-04 has no final file; last run Wed 6:31pm
const wedEve = {state: "no_new_session", attempted_at: iso("2026-11-04T18:31")};
const noWed = final("2026-11-03");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T09:10")), true, "Thu 9:10am, Wed missing, nothing since 7:50am: warns");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T08:49")), false, "8:49am: too early");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T08:50")), true, "8:50am exactly: warns");
eq(missedRun(wedEve, final("2026-11-04", "2026-11-03"), none, at("2026-11-05T09:10")), false, "Wed's final file is there: no warning");
eq(missedRun(wedEve, [{date: "2026-11-04", final: false}], none, at("2026-11-05T09:10")), true, "a provisional Wed file still warns");
eq(missedRun({state: "no_new_session", attempted_at: iso("2026-11-05T07:52")}, noWed, none, at("2026-11-05T09:10")), false,
  "the backup ran at 7:52am (no new session): no warning, its own line covers it");
eq(missedRun({state: "failed", attempted_at: iso("2026-11-05T07:50")}, noWed, none, at("2026-11-05T09:10")), false, "a run at 7:50am exactly counts");
eq(missedRun({state: "ok", attempted_at: iso("2026-11-05T07:49")}, noWed, none, at("2026-11-05T09:10")), true, "a run at 7:49am does not count");
eq(missedRun({state: "ok"}, noWed, none, at("2026-11-05T09:10")), true, "no attempted_at: warns");
eq(missedRun({state: "ok", attempted_at: iso("2026-11-04T07:53")}, final("2026-11-03"), none, at("2026-11-04T21:45")), false,
  "Wed 9:45pm, evening run never came: no evening warning");
// Days of the week
const friEve = {state: "ok", attempted_at: iso("2026-11-06T18:31")};
eq(missedRun(friEve, final("2026-11-05"), none, at("2026-11-07T09:10")), true, "Sat 9:10am, Fri missing: warns");
eq(missedRun(friEve, final("2026-11-05"), none, at("2026-11-08T09:10")), false, "Sunday: never");
eq(missedRun(friEve, final("2026-11-05"), none, at("2026-11-09T09:10")), false, "Monday: never (no Sunday session)");
// Holidays: Mon 2026-11-30 closed
const hol = new Set(["2026-11-30"]);
const monHol = {state: "holiday", expected_date: "2026-11-30", attempted_at: iso("2026-12-01T07:51")};
eq(missedRun(monHol, final("2026-11-27"), hol, at("2026-12-01T09:10")), false, "Tuesday after a Monday holiday: no warning");
eq(missedRun({state: "ok", attempted_at: iso("2026-11-27T18:31")}, final("2026-11-27"), hol, at("2026-12-01T09:10")), false,
  "Tuesday after a Monday holiday, backup never ran: still no warning (no Monday session)");
eq(missedRun({state: "ok", attempted_at: iso("2026-11-30T18:31")}, final("2026-11-27"), none, at("2026-12-01T09:10")), true,
  "same Tuesday without the holiday listed: warns");
// Malformed index entries are skipped, not thrown on
eq(missedRun(wedEve, [null, {date: "2026-11-04"}], none, at("2026-11-05T09:10")), true, "null or non-final entries don't count");

// closedToday
eq(closedToday({state: "holiday", expected_date: "2026-11-30", attempted_at: iso("2026-11-30T18:31")}, at("2026-11-30T19:00")), true,
  "holiday evening run for today: shows");
eq(closedToday(monHol, at("2026-12-01T09:10")), false, "Tuesday backup for Monday's holiday: not shown on an open day");
eq(closedToday({state: "holiday", expected_date: "2026-11-30", attempted_at: iso("2026-12-01T00:30")}, at("2026-12-01T09:10")), false,
  "a late holiday run after midnight: keyed on expected_date, not the clock");
eq(closedToday({state: "holiday", attempted_at: iso("2026-11-30T18:31")}, at("2026-11-30T19:00")), true, "old status without expected_date, ran today: shows");
eq(closedToday({state: "holiday", attempted_at: iso("2026-11-27T18:31")}, at("2026-11-30T19:00")), false, "old status without expected_date, ran another day: hidden");
eq(closedToday({state: "holiday"}, at("2026-11-30T19:00")), false, "no dates at all: hidden");
eq(closedToday({state: "ok", expected_date: "2026-11-30"}, at("2026-11-30T19:00")), false, "only for holiday runs");

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`status OK (${n} checks)`);
