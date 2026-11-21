// The key's end date and its reminder bars (the KEY block), with the refusal rule gh() uses.
// Runs in CI (no private files needed): node tests/key.mjs
// Value: protects=which date the page accepts, which key bar shows on which day (Manila), what Later hides, the
//   bar words, the date field on open, and that only a 401 or a non-rate-limit 403 counts as a refused key;
//   fails_when=a past or far date is saved, a band changes a day early or late around Manila midnight, Later hides
//   the wrong bar or a bad stored value hides one, a singular reads "1 days", or a rate limit reads as a refused key;
//   no_claim=the panel, focus and bars on screen, and what saveKey/forgetKey store (checked by /qa with tests/demo.mjs).
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

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`key OK (${n} checks)`);
