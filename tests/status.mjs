// Run-schedule lines in the status bar: the missed-run warning and "PSE closed today."
// Runs in CI (no private files needed): node tests/status.mjs
// Value: protects=when each line shows, against the 6:30pm run plus 7:50am Tue–Sat backup (screener RD-2; build
//   decision: cutoff 4:50pm, the backup's start plus 9 hours);
//   fails_when=the warning shows before 4:50pm, on Sun/Mon, after a holiday, when the final file is there, when the
//   backup for that session ran, or for an old/malformed status.json; or misses a real gap, or a Run now hides it; "closed today" shows for a past session or misses today's;
//   no_claim=the bar's markup and links (checked by hand in a browser).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const i = html.indexOf("/* STATUS-START"), j = html.indexOf("/* STATUS-END */");
if (i < 0 || j < 0) throw new Error("STATUS markers not found");
const {closedToday, missedRun, cleanIndex} = new Function(html.slice(i, j) + "; return {closedToday, missedRun, cleanIndex};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (got !== want) { bad++; console.log(`FAIL ${what}: got ${got}, want ${want}`); } };
const at = s => new Date(s + "+08:00"); // Manila wall time
const iso = s => at(s).toISOString();
const final = (...dates) => dates.map(date => ({date, final: true}));
const none = new Set();

// missedRun: Thu 2026-11-05; Wed 2026-11-04 has no final file; the last attempt was Wed's 6:30pm run
const wedEve = {state: "no_new_session", attempted_at: iso("2026-11-05T01:42"), trigger: "schedule", slot: "evening", expected_date: "2026-11-04"};
const noWed = final("2026-11-03");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T17:10")), true, "Thu 5:10pm, Wed missing, no backup run for Wed: warns");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T16:49")), false, "4:49pm: too early");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T16:50")), true, "4:50pm exactly: warns");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T09:10")), false, "9:10am (the old 8:50am cutoff): no warning yet");
eq(missedRun(wedEve, final("2026-11-04", "2026-11-03"), none, at("2026-11-05T17:10")), false, "Wed's final file is there: no warning");
eq(missedRun(wedEve, [{date: "2026-11-04", final: false}], none, at("2026-11-05T17:10")), true, "a provisional Wed file still warns");
// Which attempt hides it: only the 7:50am backup for that session
const backup = (state, expected_date) => ({state, attempted_at: iso("2026-11-05T15:21"), trigger: "schedule", slot: "morning", expected_date});
eq(missedRun(backup("no_new_session", "2026-11-04"), noWed, none, at("2026-11-05T17:10")), false,
  "the backup for Wed ran (no new session): no warning, its own line covers it");
eq(missedRun(backup("failed", "2026-11-04"), noWed, none, at("2026-11-05T17:10")), false, "the backup for Wed failed: its own line covers it");
eq(missedRun(backup("no_new_session", "2026-11-03"), noWed, none, at("2026-11-05T17:10")), true,
  "a backup for an older session (Tue) doesn't count for Wed");
const runNow = {state: "no_new_session", attempted_at: iso("2026-11-05T16:00"), trigger: "workflow_dispatch", slot: null, expected_date: "2026-11-04"};
eq(missedRun(runNow, noWed, none, at("2026-11-05T17:10")), true, "a Run now (no new session) doesn't hide a missing backup");
eq(missedRun({...runNow, state: "ok"}, final("2026-11-04", "2026-11-03"), none, at("2026-11-05T17:10")), false,
  "a Run now that saved Wed's final file: no warning (the file decides)");
eq(missedRun({...wedEve, state: "ok", expected_date: "2026-11-05", attempted_at: iso("2026-11-05T18:33")}, noWed, none, at("2026-11-05T19:00")), true,
  "Thu's evening run doesn't hide a missing Wed backup");
// Days of the week
const friEve = {state: "ok", attempted_at: iso("2026-11-06T18:31"), trigger: "schedule", slot: "evening", expected_date: "2026-11-06"};
eq(missedRun(friEve, final("2026-11-05"), none, at("2026-11-07T17:10")), true, "Sat 5:10pm, Fri missing: warns");
eq(missedRun(friEve, final("2026-11-05"), none, at("2026-11-07T16:49")), false, "Sat 4:49pm: too early");
eq(missedRun({...wedEve, expected_date: "2026-11-02"}, final("2026-10-30"), none, at("2026-11-03T16:50")), true, "Tue 4:50pm, Mon missing: warns");
eq(missedRun(friEve, final("2026-11-05"), none, at("2026-11-08T17:10")), false, "Sunday: never");
eq(missedRun(friEve, final("2026-11-05"), none, at("2026-11-09T17:10")), false, "Monday: never (no Sunday session)");
// Holidays: Mon 2026-11-30 closed
const hol = new Set(["2026-11-30"]);
const monHol = {state: "holiday", expected_date: "2026-11-30", attempted_at: iso("2026-12-01T15:21"), trigger: "schedule", slot: "morning"};
eq(missedRun(monHol, final("2026-11-27"), hol, at("2026-12-01T17:10")), false, "Tuesday after a Monday holiday: no warning");
const monEve = {state: "holiday", attempted_at: iso("2026-12-01T01:40"), trigger: "schedule", slot: "evening", expected_date: "2026-11-30"};
eq(missedRun(monEve, final("2026-11-27"), hol, at("2026-12-01T17:10")), false,
  "Tuesday after a Monday holiday, backup never ran: still no warning (no Monday session)");
eq(missedRun(monEve, final("2026-11-27"), none, at("2026-12-01T17:10")), true, "same Tuesday without the holiday listed: warns");
// Missing or malformed data
eq(missedRun(wedEve, [null, {date: "2026-11-04"}], none, at("2026-11-05T17:10")), true, "null or non-final entries don't count");
eq(missedRun(wedEve, [{date: "2026-11-04", final: "false"}], none, at("2026-11-05T17:10")), true, "final must be true, not a truthy string");
eq(missedRun(null, noWed, none, at("2026-11-05T17:10")), true, "no status.json at all: warns");
eq(missedRun({state: "no_new_session", attempted_at: iso("2026-11-04T18:31"), trigger: "schedule"}, noWed, none, at("2026-11-05T17:10")), false,
  "an older status.json without slot: no warning (can't tell which run it was)");
eq(missedRun({...wedEve, slot: "Morning"}, noWed, none, at("2026-11-05T17:10")), false, "an unknown slot value: no warning");
eq(missedRun({...wedEve, slot: 7}, noWed, none, at("2026-11-05T17:10")), false, "a non-text slot: no warning");
eq(missedRun({...backup("ok"), expected_date: undefined}, noWed, none, at("2026-11-05T17:10")), false, "a backup without expected_date: no warning");
eq(missedRun(backup("ok", "Nov 4"), noWed, none, at("2026-11-05T17:10")), false, "a backup with a malformed expected_date: no warning");
eq(JSON.stringify(cleanIndex([null, 5, "x", {date: "2026-11-04", final: true}])), JSON.stringify([{date: "2026-11-04", final: true}]), "cleanIndex keeps objects only");
eq(JSON.stringify([cleanIndex({}), cleanIndex(null)]), "[[],[]]", "cleanIndex turns a non-array into no entries");
// The warning is about this morning's backup, so it stays into the evening; there is no rule about the 6:30pm run
eq(missedRun(wedEve, noWed, none, at("2026-11-05T21:45")), true, "Thu 9:45pm, backup never ran and Wed still missing: still warns");
eq(missedRun(wedEve, noWed, none, at("2026-11-05T23:59")), true, "Thu 11:59pm: still warns");
eq(missedRun(wedEve, final("2026-11-03"), none, at("2026-11-06T00:01")), false, "Fri 12:01am: Thu is now the previous weekday, before 4:50pm");

// closedToday
eq(closedToday({state: "holiday", expected_date: "2026-11-30", attempted_at: iso("2026-11-30T18:31")}, at("2026-11-30T19:00")), true,
  "holiday evening run for today: shows");
eq(closedToday(monHol, at("2026-12-01T09:10")), false, "Tuesday backup for Monday's holiday: not shown on an open day");
eq(closedToday({state: "holiday", expected_date: "2026-11-30", attempted_at: iso("2026-12-01T00:30")}, at("2026-12-01T09:10")), false,
  "a late holiday run after midnight: keyed on expected_date, not the clock");
eq(closedToday({state: "holiday", attempted_at: iso("2026-11-30T18:31")}, at("2026-11-30T19:00")), true, "old status without expected_date, ran today: shows");
eq(closedToday({state: "holiday", attempted_at: iso("2026-11-27T18:31")}, at("2026-11-30T19:00")), false, "old status without expected_date, ran another day: hidden");
eq(closedToday({state: "holiday"}, at("2026-11-30T19:00")), false, "no dates at all: hidden");
eq(closedToday({state: "holiday", expected_date: "2026-11-30", attempted_at: "garbage"}, at("2026-11-30T19:00")), true, "a bad attempted_at doesn't hide a valid expected_date");
eq(closedToday({state: "holiday", attempted_at: "garbage"}, at("2026-11-30T19:00")), false, "old status with a bad attempted_at: hidden, no crash");
eq(closedToday({state: "ok", expected_date: "2026-11-30"}, at("2026-11-30T19:00")), false, "only for holiday runs");

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`status OK (${n} checks)`);
