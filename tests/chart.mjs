// The price chart's logic (the CHART block in app.js, T-23 plan § 3, tests b1-b6 and b11), with made-up symbols and prices.
// Runs in CI (no private files needed): node tests/chart.mjs
// Value: protects=which closes files the page accepts, that a refusal never quotes a value, the 50/200-day averages, the
//   3M/1Y window ending on the day on screen, where the owner's levels go, every chart state's words, the readout and its keys;
//   fails_when=a bad file parses, a reason echoes a cell, an average differs from a hand-computed mean or starts early, the
//   window holds a session outside its months or ends on another day, a far level squashes the scale or a near one is
//   left out, a state shows other words, or an arrow key moves the readout the wrong way;
//   no_claim=the loader, Forget key and the results binding (tests/key.mjs), the drawing on screen and the slider's
//   aria-valuetext in a browser (/qa with tests/demo.mjs), and parity with the real screener (tests/parity.mjs).
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const js = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.js"), "utf8");
const block = (a, b) => { const i = js.indexOf(a), j = js.indexOf(b); if (i < 0 || j < 0) throw new Error(a + " markers not found"); return js.slice(i, j); };
const fnText = name => { const i = js.indexOf("function " + name + "("), j = js.indexOf("\n}\n", i); if (i < 0) throw new Error(name + " not found"); return js.slice(i, j + 2); };
const lineText = name => { const l = js.split("\n").find(x => x.startsWith("const " + name + " = ")); if (!l) throw new Error(name + " not found"); return l; };
const C = new Function(lineText("price") + "\n" + fnText("dateLabel") + "\n" + block("/* CHART-START", "/* CHART-END */") +
  "; return {parseCloses, stampOf, avgLine, monthsBack, viewOf, chartState, chartModel, niceTicks, readout, stepKey, price, dateLabel};")();

let bad = 0, n = 0;
const eq = (got, want, what) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
const ok = (c, what) => eq(!!c, true, what);

// Made-up weekdays and a made-up file: DEMOA climbs, DEMOB has blanks
const days = (from, count) => { const out = []; for (let t = Date.parse(from); out.length < count; t += 864e5) { const w = new Date(t).getUTCDay(); if (w && w < 6) out.push(new Date(t).toISOString().slice(0, 10)); } return out; };
const D = days("2025-10-01", 290);
const walk = (start, step, gaps = []) => D.map((_, i) => gaps.includes(i) ? "" : (start + i * step).toFixed(2));
const file = rows => ["symbol"].concat(D).join(",") + "\n" + rows.map(([s, v]) => [s].concat(v).join(",")).join("\n") + "\n";
const GOOD = file([["DEMOA", walk(10, 0.05)], ["DEMOB", walk(5, 0.01, [3, 4, 280])]]);

// b1: parsing
{ const p = C.parseCloses(GOOD);
  eq([p.dates.length, p.by.size, p.by.get("DEMOA")[0], p.by.get("DEMOB")[3]], [290, 2, 10, null], "a good made-up file parses (blank = null)");
  const refuse = (what, text) => { n++; try { C.parseCloses(text); bad++; console.log("FAIL " + what + ": parsed"); } catch { /* refused */ } };
  refuse("a bad first line", GOOD.replace(/^symbol/, "sym"));
  refuse("a short row", GOOD.replace(/,[^,\n]*\n/, "\n"));
  refuse("a non-number", GOOD.replace(/,10\.00,/, ",x1,"));
  refuse("a zero close", GOOD.replace(/,10\.00,/, ",0,"));
  refuse("a negative close", GOOD.replace(/,10\.00,/, ",-1,"));
  refuse("dates out of order", GOOD.replace(D[1] + "," + D[2], D[2] + "," + D[1]));
  refuse("a date that is not a day", GOOD.replace(D[5], "2025-02-30"));
  refuse("a symbol with no letter", GOOD.replace("DEMOB", "1234"));
  refuse("a number in E notation as a symbol", GOOD.replace("DEMOB", "1E3"));
  refuse("a symbol twice", GOOD + "DEMOA," + walk(1, 0).join(",") + "\n");
  refuse("an empty line inside", GOOD.replace("\nDEMOB", "\n\nDEMOB"));
  refuse("an empty file", "");
}
// b2: a reason never quotes a cell value
{ for (const [what, text, secret] of [["a non-number", GOOD.replace(/,10\.05,/, ",98765.4x,"), "98765"], ["a zero", GOOD.replace(/,10\.05,/, ",0.000,"), "0.000"],
  ["a bad date", GOOD.replace(D[7], "2025-13-45"), "2025-13-45"], ["a bad symbol", GOOD.replace("DEMOB", "de mo"), "de mo"]]) {
    let msg = ""; try { C.parseCloses(text); } catch (e) { msg = e.message; }
    ok(msg && !msg.includes(secret), "the reason for " + what + " names a place, not the value (" + msg + ")");
  }
}
// b3: the averages: a hand-computed mean of the last n closes, blanks skipped; null until n closes exist
{ const v = D.map((_, i) => i % 7 === 3 ? null : 20 + Math.sin(i / 5) * 3 + i * 0.01);
  for (const N of [50, 200]) {
    const got = C.avgLine(v, N); let first = -1, wrong = 0;
    for (let i = 0; i < v.length; i++) {
      const seen = v.slice(0, i + 1).filter(x => x !== null);
      const want = seen.length < N ? null : seen.slice(-N).reduce((a, b) => a + b, 0) / N;
      if (want === null ? got[i] !== null : Math.abs(got[i] - want) > 1e-9) wrong++;
      if (first < 0 && got[i] !== null) first = seen.length;
    }
    eq([wrong, first], [0, N], N + "-day average: every point is the mean of the last " + N + " closes and starts at the " + N + "th");
  }
}
// b4: the range: sessions after the end minus 3 (12) calendar months, up to the end (the day on screen)
{ eq(C.monthsBack("2026-05-31", 3), "2026-02-28", "3 months before May 31 is Feb 28");
  eq(C.monthsBack("2026-03-15", 12), "2025-03-15", "12 months back crosses the year");
  const dates = C.parseCloses(GOOD).dates;
  for (const [end, m] of [[D.at(-1), 3], [D.at(-1), 12], [D[200], 3], ["2026-10-04", 3]]) { // the last a Sunday: the Friday before ends the view
    const [a, b] = C.viewOf(dates, end, m), cut = C.monthsBack(end, m);
    ok(dates[b] <= end && (b === dates.length - 1 || dates[b + 1] > end), `${m} months to ${end}: ends on the last session on or before the day`);
    ok(dates[a] > cut && (a === 0 || dates[a - 1] <= cut), `${m} months to ${end}: starts on the first session after ${cut}`);
  }
  eq(C.viewOf(dates, "2025-09-30", 3), null, "a day before the file's first date has no view");
}
// b5: the owner's levels: in range drawn on the scale, within 25 % widens it, further pinned to an edge
{ const p = C.parseCloses(GOOD), d = {dates: p.dates, v: p.by.get("DEMOA"), w: C.viewOf(p.dates, D.at(-1), 3)}, W = 388, H = 190;
  const m0 = C.chartModel(d, {}, 3, W, H, C.price), top = m0.ticks.at(0), bot = m0.ticks.at(-1);
  const lo = Math.min(...d.v.slice(d.w[0], d.w[1] + 1)), hi = Math.max(...d.v.slice(d.w[0], d.w[1] + 1));
  const m = C.chartModel(d, {buy: (lo + hi) / 2, cut: lo - (hi - lo) * 0.1, target: hi * 3}, 3, W, H, C.price);
  const L = k => m.lv.find(l => l.k === k);
  ok(L("buy") && !L("buy").far && L("buy").y > m.T && L("buy").y < H - m.B, "an in-range buy price is drawn inside the plot");
  ok(L("cut") && !L("cut").far && m.ticks.some(t => +t.t.replace(/,/g, "") <= L("cut").x), "a cut-loss just below the prices widens the scale to hold it");
  ok(L("target") && L("target").far === "up" && L("target").y === m.T && / ↑$/.test(L("target").label), "a far target is pinned to the top with an arrow");
  ok(Math.max(...m.ticks.map(t => +t.t.replace(/,/g, ""))) < hi * 1.5, "the far target does not stretch the scale");
  ok(/Target ₱[\d.,]+ is above the chart\.$/.test(m.sum), "the summary says the target is above the chart");
  eq(C.chartModel(d, {buy: null, cut: 0, target: -2}, 3, W, H, C.price).lv, [], "missing, zero or negative levels draw nothing");
  ok(top.y > bot.y && m0.ticks.length >= 3 && m0.ticks.length <= 5, "3 to 5 ticks, highest at the top");
  ok(/^3 months: up \d+\.\d% \(₱[\d.]+ to ₱[\d.]+\)\.$/.test(m0.sum), "the summary line: " + m0.sum);
  const g = {dates: p.dates, v: p.by.get("DEMOB"), w: C.viewOf(p.dates, D.at(-1), 3)};
  ok(/ No trades on 1 of the \d+ days shown\./.test(C.chartModel(g, {}, 3, W, H, C.price).sum), "the summary counts the days without a trade");
  eq(C.chartModel({...d, w: C.viewOf(p.dates, D.at(-1), 12)}, {}, 12, W, H, C.price).mon.some(x => x.t === "Jan ’26"), true, "the year's first month is labelled with the year");
  for (const t of [[1, 1.04], [0.0041, 0.0049], [980, 1210], [12, 12]]) { const k = C.niceTicks(...t); ok(k.length >= 3 && k.length <= 5 && k[0] <= t[0] && k.at(-1) >= t[1], "round ticks for " + t); }
  const twoHundred = C.chartModel({dates: p.dates, v: p.by.get("DEMOA").map((x, i) => i < 150 ? null : x), w: d.w}, {}, 3, W, H, C.price);
  eq([twoHundred.miss50, twoHundred.miss200], [null, "(needs 200 trading days)"], "a stock with under 200 closes greys the 200-day entry");
  const early = C.chartModel({dates: p.dates, v: p.by.get("DEMOA"), w: C.viewOf(p.dates, D[120], 3), sessions: 900}, {}, 3, W, H, C.price);
  eq(early.miss200, "(not enough saved days)", "an early end for a stock with years of sessions: not enough saved days");
  const young = C.chartModel({dates: p.dates, v: p.by.get("DEMOA"), w: C.viewOf(p.dates, D[120], 3), sessions: 290}, {}, 3, W, H, C.price);
  eq(young.miss200, "(needs 200 trading days)", "an early end for a stock with 121 sessions by then: needs 200 trading days");
}
// b6: every state's words (T-23 plan § 3.4)
{ const p = C.parseCloses(GOOD), okc = {state: "ok", stamp: "ab12", ...p}, meta = {date: D.at(-1), closes_sha256: "ab12"};
  const rows = [{symbol: "DEMOA"}, {symbol: "DEMOC", fetch_error: "made-up timeout"}, {symbol: "DEMOD"}];
  const say = (cl, sym = "DEMOA", o = {}) => C.chartState({cl, sym, rows, meta, end: D.at(-1), months: 3, ...o}).say;
  eq(say({state: "loading"}), "Loading prices…", "loading");
  eq(say({state: "idle"}), "Loading prices…", "not asked yet");
  eq(say({state: "missing"}), "The chart appears after the next daily run.", "no file yet (404)");
  eq(say(okc, "DEMOC"), "No prices for DEMOC in the last run (it didn't load). The chart comes back after the next run.", "a fetch error");
  eq(say(okc, "DEMOD"), "No usable prices for DEMOD in the last run.", "in the run, no closes row");
  eq(say(okc, "DEMOE"), "No saved prices for DEMOE: it isn't in the latest run.", "not in the file or the run");
  const one = C.parseCloses(file([["DEMOA", D.map((_, i) => i === 289 ? "4.5" : "")]]));
  eq(say({state: "ok", stamp: "ab12", ...one}), "Not enough trading days to draw a chart yet (1 so far).", "fewer than 2 closes");
  eq(C.chartState({cl: {state: "fail", err: "made-up: no answer in 90 seconds"}, sym: "DEMOA", rows, meta, end: D.at(-1), months: 3}),
    {say: "Couldn't load prices (made-up: no answer in 90 seconds).", retry: true}, "a failed load, with Try again");
  eq(say({state: "auth"}), "Prices can't load until the key is fixed (see above).", "a refused key");
  eq(say({state: "bad", err: "line 3 has 2 cells, want 4"}), "Price file can't be read (line 3 has 2 cells, want 4). Today's results still work.", "an unreadable file");
  for (const [what, m] of [["a different stamp", {...meta, closes_sha256: "ff00"}], ["no stamp", {date: D.at(-1)}], ["no entry", null]])
    eq(say(okc, "DEMOA", {meta: m}), "Prices are being updated: the chart comes back after the next run.", "the file is from another run: " + what);
  eq(say(okc, "DEMOA", {end: "2025-09-30"}), "No saved prices up to that day.", "a picked day before the file's first date");
  // Review 2026-11-24: a picked file without a date ("unknown") threw in monthsBack; no key said "Loading prices…" forever
  eq(say(okc, "DEMOA", {end: "unknown"}), "No saved prices up to that day.", "a day on screen that is not a date");
  eq(say({state: "idle"}, "DEMOA", {nokey: true}), "Prices can't load until the key is fixed (see above).", "no key saved");
  ok(C.chartState({cl: okc, sym: "DEMOA", rows, meta, end: D.at(-1), months: 3}).draw, "a matching file and a stock with prices draws");
}
// b11: the readout and its keys
{ eq([["ArrowLeft", 5], ["ArrowDown", 5], ["ArrowRight", 5], ["ArrowUp", 5], ["Home", 5], ["End", 5], ["ArrowLeft", 0], ["ArrowRight", 9], ["a", 5]].map(([k, i]) => C.stepKey(k, i, 10)),
    [4, 4, 6, 6, 0, 9, 0, 9, undefined], "arrow keys move one day, Home and End jump, the ends hold, other keys do nothing");
  const p = C.parseCloses(GOOD), d = {dates: p.dates, v: p.by.get("DEMOB"), w: C.viewOf(p.dates, D.at(-1), 12)}, m = C.chartModel(d, {}, 12, 388, 190, C.price);
  eq(C.readout(d, m, 280, C.price, C.dateLabel), C.dateLabel(D[280]) + " · no trade · ₱" + C.price(m.a50[280]) + " 50-day · ₱" + C.price(m.a200[280]) + " 200-day", "the readout on a day without a trade");
  eq(C.readout(d, m, 100, C.price, C.dateLabel), C.dateLabel(D[100]) + " · ₱" + C.price(d.v[100]) + " close · ₱" + C.price(m.a50[100]) + " 50-day", "the readout before the 200-day line starts");
}
// The stamp: the first 16 hex characters of the text's SHA-256
eq(await C.stampOf("made-up\n"), (await import("node:crypto")).createHash("sha256").update("made-up\n").digest("hex").slice(0, 16), "the stamp matches the screener's closes_sha256 rule");

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`chart OK (${n} checks)`);
