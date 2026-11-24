"use strict";
document.getElementById("boot")?.remove(); // the page started: the "couldn't start" line is never seen
const OWNER = "bryllelagunda", REPO = "pse-screener", API = "https://api.github.com/repos/" + OWNER + "/" + REPO;

/* FILTER-START: must match pse_screener.evaluate exactly (tests/parity.mjs checks it) */
const STRICT = {above_sma200: true, above_sma50: true, sma50_above_sma200: true, roc9_min: 5, price_min: 1,
  avg_value_min: 5e6, mcap_min: 1e9, value_today_min: 0, high_band: [0, 20], atr_band: [1, 4]};
const LOOSE = {above_sma200: true, above_sma50: false, sma50_above_sma200: true, roc9_min: 0, price_min: 1,
  avg_value_min: 5e6, mcap_min: 5e8, value_today_min: 1e7, high_band: [0, 30], atr_band: [1, 6]};
const PRESETS = {strict: STRICT, loose: LOOSE};

// Python f"{x:,.2f}".rstrip("0").rstrip("."), including round-half-even on exact ties.
function fmt(x) {
  const neg = x < 0 || Object.is(x, -0), a = Math.abs(x);
  let s = a.toFixed(2);
  if (a < 1e21) {
    const frac = a.toFixed(100).split(".")[1];
    if (frac[2] === "5" && /^0*$/.test(frac.slice(3)) && +frac[1] % 2 === 0) s = a.toFixed(100).split(".")[0] + "." + frac.slice(0, 2);
  }
  let [i, f] = s.split(".");
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + (i + "." + f).replace(/0+$/, "").replace(/\.$/, "");
}
function missing(row, col) { const v = row[col]; return v === null || v === undefined || Number.isNaN(v); }

// Every failed rule, before de-duplication: [{rule, text}]. text is the screener's reason.
function failures(row, s, dataDate) {
  if (row.fetch_error) return [{rule: "fetch", text: "not scanned: " + row.fetch_error}];
  if (row.stale) return [{rule: "stale", text: "no trade on " + dataDate}];
  const out = [], ses = row.sessions === undefined ? 0 : row.sessions;
  const short = "insufficient history (" + (ses === null ? "None" : ses) + " sessions)";
  const need = (rule, ...cols) => {
    if (cols.some(c => missing(row, c))) { out.push({rule, text: short, short: true}); return false; }
    return true;
  };
  const r = row;
  if (s.above_sma200 && need("sma200", "close", "sma200") && !(r.close > r.sma200)) out.push({rule: "sma200", text: "close below sma200"});
  if (s.above_sma50 && need("sma50", "close", "sma50") && !(r.close > r.sma50)) out.push({rule: "sma50", text: "close below sma50"});
  if (s.sma50_above_sma200 && need("cross", "sma50", "sma200") && !(r.sma50 > r.sma200)) out.push({rule: "cross", text: "sma50 below sma200"});
  if (need("roc9", "roc9") && !(r.roc9 >= s.roc9_min)) out.push({rule: "roc9", text: "roc9 " + fmt(r.roc9) + " < " + fmt(s.roc9_min)});
  if (s.price_min > 0 && need("price", "close") && !(r.close > s.price_min)) out.push({rule: "price", text: "close " + fmt(r.close) + " <= " + fmt(s.price_min)});
  if (s.avg_value_min > 0 && need("avg", "avg_value_30d") && !(r.avg_value_30d > s.avg_value_min))
    out.push({rule: "avg", text: "avg_value_30d " + fmt(r.avg_value_30d) + " <= " + fmt(s.avg_value_min)});
  if (s.mcap_min > 0) {
    if (missing(r, "mcap")) out.push({rule: "mcap", text: "market cap unavailable"});
    else if (!(r.mcap >= s.mcap_min)) out.push({rule: "mcap", text: "mcap " + fmt(r.mcap) + " < " + fmt(s.mcap_min)});
  }
  if (s.value_today_min > 0 && need("vt", "value_today") && !(r.value_today > s.value_today_min))
    out.push({rule: "vt", text: "value_today " + fmt(r.value_today) + " <= " + fmt(s.value_today_min)});
  let [lo, hi] = s.high_band;
  if (need("high", "pct_high_above_close") && !(lo <= r.pct_high_above_close && r.pct_high_above_close <= hi))
    out.push({rule: "high", text: "pct_high_above_close " + fmt(r.pct_high_above_close) + " outside " + fmt(lo) + "-" + fmt(hi)});
  [lo, hi] = s.atr_band;
  if (need("atr", "atr_pct14") && !(lo <= r.atr_pct14 && r.atr_pct14 <= hi))
    out.push({rule: "atr", text: "atr_pct14 " + fmt(r.atr_pct14) + " outside " + fmt(lo) + "-" + fmt(hi)});
  return out;
}
function evaluate(row, s, dataDate) { return [...new Set(failures(row, s, dataDate).map(f => f.text))]; }

const NUM = new Set(["sessions", "close", "chg_pct", "value_today", "cci20", "atr_pct14", "roc9", "pct_vs_sma50", "pct_vs_sma200",
  "sma50", "sma200", "high_52w", "pct_high_above_close", "avg_value_30d", "mcap"]);
const BOOL = new Set(["stale", "pass_strict", "pass_loose"]);
function csvRows(text) {
  const rows = []; let row = [], f = "", q = false, i = 0;
  text = text.replace(/^﻿/, "");
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const out = rows.filter(r => r.length > 1 || r[0] !== "");
  out.open = q; // ended inside a quote
  return out;
}
function parseCSV(text) {
  const rows = csvRows(text), head = rows.shift() || [];
  return rows.map(r => {
    const o = {};
    head.forEach((h, j) => {
      const v = r[j] === undefined ? "" : r[j];
      // Empty cells are null, never 0: a null fails any enabled rule that reads it.
      o[h] = v === "" ? null : NUM.has(h) ? Number(v) : BOOL.has(h) ? v === "true" : v;
    });
    return o;
  });
}
/* FILTER-END */

/* SCREENS-START: saved filter sets and the panel summary (tests/screens.mjs checks it) */
const MAX_SETS = 20, MAX_NAME = 30;
function money(x) {
  if (x === null || x === undefined) return "—";
  const a = Math.abs(x);
  for (const [v, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]])
    if (a >= v) return "₱" + +(x / v).toFixed(a / v >= 100 ? 0 : a / v >= 10 ? 1 : 2) + u;
  return "₱" + +x.toFixed(2);
}
// Settings read from storage, or null. A missing key takes Strict's value; a wrong one rejects the set.
function cleanSet(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const out = {}, num = (k, v) => typeof v === "number" && Number.isFinite(v) && (k === "roc9_min" || v >= 0);
  for (const k in STRICT) {
    const d = STRICT[k], v = Object.hasOwn(x, k) ? x[k] : d;
    if (typeof d === "boolean") { if (typeof v !== "boolean") return null; out[k] = v; }
    else if (Array.isArray(d)) { if (!Array.isArray(v) || v.length !== 2 || !v.every(n => num(k, n)) || v[0] > v[1]) return null; out[k] = v.slice(); }
    else { if (!num(k, v)) return null; out[k] = v; }
  }
  return out;
}
const cleanName = n => typeof n === "string" ? n.trim().replace(/\s+/g, " ") : "";
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
function loadScreens(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (out.length >= MAX_SETS) break;
    const name = cleanName(e && e.name), set = e ? cleanSet(e.set) : null;
    if (name && name.length <= MAX_NAME && set && !out.some(o => sameName(o.name, name))) out.push({name, set});
  }
  return out;
}
// "" when the name can be used; except is the set being renamed.
function nameError(name, screens, except) {
  name = cleanName(name);
  if (!name) return "Enter a name.";
  if (name.length > MAX_NAME) return "Use " + MAX_NAME + " characters or fewer.";
  const dup = screens.find(o => sameName(o.name, name) && !(except && sameName(o.name, except)));
  if (dup) return "A set called “" + dup.name + "” already exists.";
  if (!except && screens.length >= MAX_SETS) return "You can keep " + MAX_SETS + " sets. Delete one first.";
  return "";
}
const sameSet = (a, b) => Object.keys(STRICT).every(k => Array.isArray(STRICT[k]) ? a[k][0] === b[k][0] && a[k][1] === b[k][1] : a[k] === b[k]);
function summary(s) {
  const out = [];
  if (s.above_sma200) out.push("Price above 200-day average");
  if (s.above_sma50) out.push("Price above 50-day average");
  if (s.sma50_above_sma200) out.push("50-day average above 200-day");
  out.push("9-day change at least " + s.roc9_min + "%");
  if (s.mcap_min > 0) out.push("Company size at least " + money(s.mcap_min));
  if (s.price_min > 0) out.push("Price above " + money(s.price_min));
  if (s.avg_value_min > 0) out.push("Usual daily trading above " + money(s.avg_value_min));
  if (s.value_today_min > 0) out.push("Traded today above " + money(s.value_today_min));
  out.push("Below year high " + s.high_band[0] + "–" + s.high_band[1] + "%", "Daily swing between " + s.atr_band[0] + "% and " + s.atr_band[1] + "%");
  return out.join(" · ");
}
/* SCREENS-END */

/* HISTORY-START: results/history.csv checks and the values derived from it (tests/history.mjs checks it) */
const HHEAD = "date,symbol,source,strict,loose,miss_strict,miss_loose,close";
const HRULES = ["sma200", "sma50", "cross", "roc9", "price", "avg", "mcap", "vt", "high", "atr"];
const isoDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d);
// A data gap (no trade, not scanned, short history, no market cap) is never a miss by one rule.
const isGap = (f, r) => f.rule === "stale" || f.rule === "fetch" || !!f.short || (f.rule === "mcap" && missing(r, "mcap"));
function missRule(r, s, date) { const f = failures(r, s, date); return f.length === 1 && !isGap(f[0], r) ? f[0].rule : ""; }
// The history rows a results file should give (the screener's rule for kept rows)
function dayRows(rows, date) {
  const m = new Map();
  for (const r of rows) {
    const o = {};
    for (const p in PRESETS) { o[p] = String(!failures(r, PRESETS[p], date).length); o["miss_" + p] = missRule(r, PRESETS[p], date); }
    if (o.strict === "true" || o.loose === "true" || o.miss_strict || o.miss_loose) m.set(r.symbol, o);
  }
  return m;
}
// The whole file or an Error naming the first bad row: never a partial history
function parseHistory(text) {
  const rows = csvRows(text), H = {state: "ok", dates: [], src: {}, by: new Map()};
  if ((rows.shift() || []).join() !== HHEAD) throw new Error("wrong header");
  if (rows.open) throw new Error("unclosed quote");
  rows.forEach((c, i) => {
    const bad = w => { throw new Error("row " + (i + 2) + ": " + w); }, [d, sym, src, s, l, ms, ml, cl] = c;
    if (c.length !== 8) bad("wrong number of cells");
    if (!isoDay(d)) bad("bad date");
    if (!["live", "rebuilt", "missing"].includes(src)) bad("bad source");
    if (![s, l].every(x => ["true", "false", ""].includes(x))) bad("bad pass flag");
    if (![ms, ml].every(x => !x || HRULES.includes(x))) bad("unknown rule");
    if (cl && !/^-?\d+(\.\d+)?$/.test(cl)) bad("bad close");
    if (!sym) { // a session marker: dates rise, one marker each
      if (H.dates.length && d <= H.dates.at(-1)) bad("date out of order");
      H.src[d] = src; H.dates.push(d); return;
    }
    if (d !== H.dates.at(-1) || src !== H.src[d] || src === "missing") bad("stock row without its session row");
    let m = H.by.get(sym); if (!m) H.by.set(sym, m = new Map());
    if (m.has(d)) bad("repeated stock");
    m.set(d, {strict: s, loose: l, miss_strict: ms, miss_loose: ml, close: cl ? +cl : null});
  });
  return H;
}
// One stock's sessions, oldest first: history before the shown date, then the shown file.
// Per preset: p passed, m missed by one rule, n neither, o no record.
function track(H, sym, row, date) {
  const m = H.by.get(sym), out = [];
  const add = (d, src, st, rule, c) => out.push({d, via: src, c, strict: st("strict"), loose: st("loose"), rs: rule("strict"), rl: rule("loose")});
  for (const d of H.dates) if (d < date) {
    const r = m && m.get(d), src = H.src[d];
    add(d, src, p => src === "missing" ? "o" : !r ? "n" : r[p] === "true" ? "p" : r["miss_" + p] ? "m" : "n", p => r ? r["miss_" + p] : "", r ? r.close : null);
  }
  const ok = p => row && !failures(row, PRESETS[p], date).length, mr = p => row ? missRule(row, PRESETS[p], date) : "";
  add(date, "today", p => ok(p) ? "p" : mr(p) ? "m" : "n", mr, row ? row.close : null);
  return out;
}
// Days in, miss streak, last 20, when this run began (or the last pass) and the change since
function strength(t, p) {
  const run = k => { let n = 0; for (let i = t.length - 1; i >= 0 && t[i][p] === k; i--) n++; return n; };
  const days = run("p"), now = t.at(-1), j = days ? t[t.length - days] : t.findLast(x => x[p] === "p");
  return {days, miss: run("m"), last20: t.slice(-20).filter(x => x[p] === "p").length, join: j ? j.d : null,
    chg: days && now.c !== null && j.c > 0 ? now.c / j.c - 1 : null};
}
// Miss-by-one streaks of 3 or more, longest first
function knocking(tracks, rows) {
  const out = {strict: [], loose: []};
  for (const r of rows) for (const p in out) {
    const t = tracks.get(r.symbol), k = t && strength(t, p);
    if (k && k.miss >= 3) out[p].push({r, n: k.miss, rule: t.at(-1)[p === "strict" ? "rs" : "rl"]});
  }
  for (const p in out) out[p].sort((a, b) => b.n - a.n || a.r.symbol.localeCompare(b.r.symbol));
  return out;
}
// Stocks whose rows for the date differ from history's, either way
function disagree(H, rows, date) {
  const mine = dayRows(rows, date), syms = new Set(mine.keys());
  for (const [s, m] of H.by) if (m.has(date)) syms.add(s);
  let n = 0;
  for (const s of syms) {
    const a = mine.get(s), b = H.by.has(s) && H.by.get(s).get(date);
    if (!a || !b || ["strict", "loose", "miss_strict", "miss_loose"].some(k => a[k] !== b[k])) n++;
  }
  return n;
}
// History missing a final session up to the shown date would bridge the gap
const behind = (H, index, date) => { const f = index.filter(e => e.final === true && e.date <= date).map(e => e.date).sort().pop(); return !!f && H.dates.at(-1) < f; };
const daysText = (H, preset, n) => H.state === "loading" ? "…" : H.state !== "ok" || !PRESETS[preset] ? "—" : String(n);
/* HISTORY-END */

// ------------------------------------------------------------------ helpers
const $ = id => document.getElementById(id);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    if (props[k] === null || props[k] === undefined || props[k] === false) continue;
    if (k === "text") e.textContent = props[k];
    else if (k === "cls") e.className = props[k];
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), props[k]);
    else e.setAttribute(k, props[k]);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("pse." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("pse." + k, JSON.stringify(v)); return true; } catch { return false; } }, // false: quota or private mode
  del(k) { try { localStorage.removeItem("pse." + k); } catch { /* ignore */ } },
};
const MINUS = "−";
const sign = (x, d = 1) => (x > 0 ? "+" : x < 0 ? MINUS : "") + Math.abs(x).toFixed(d);
const price = x => x === null ? "—" : x.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: x < 1 ? 4 : 2});
const pct = (x, d = 1) => x === null ? "—" : x.toFixed(d) + "%";
const spct = (x, d = 1) => x === null ? "—" : sign(x, d) + "%";
/* STATUS-START: run-schedule lines in the status bar (tests/status.mjs checks it) */
const manila = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3); // Asia/Manila is UTC+8, no DST
const manilaISO = d => manila(d).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
function dateLabel(iso, withYear) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(iso || "unknown date");
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US",
    {weekday: "short", month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC"});
}
const validTime = t => typeof t === "string" && !isNaN(Date.parse(t));
const cleanIndex = v => Array.isArray(v) ? v.filter(e => e && typeof e === "object") : []; // a bad file or cache can't break the page
// After 4:50pm Tue–Sat (the 7:50am backup's start plus 9 hours: GitHub has started it up to 7h39m late):
// the previous weekday traded, has no final file, and status.json is not a 7:50am-backup attempt for it
// (the 5:17am "early" run and a Run now never count, even for that session).
// A Run now doesn't hide it, unless it saved the final file. st is null when there is no status.json;
// one from before slot existed (no "slot" key), or with a malformed slot or expected_date, never warns.
const isDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d);
function missedRun(st, index, holidays, now = new Date()) {
  const m = manila(now), prev = manilaISO(new Date(now.getTime() - 864e5));
  if (m.getUTCDay() < 2 || m.getUTCHours() * 60 + m.getUTCMinutes() < 16 * 60 + 50 || holidays.has(prev)) return false;
  if (index.some(e => e && e.date === prev && e.final === true)) return false;
  if (!st) return true;
  if (!("slot" in st) || ![null, "evening", "early", "morning"].includes(st.slot) || !isDay(st.expected_date)) return false;
  return st.slot !== "morning" || st.expected_date !== prev;
}
// Only on fresh data: not a stale cache (the refresh decides) or a failed refresh, nor before anything has loaded
const showMissed = (s, now = new Date()) => !s.cached && !s.refreshErr && !s.authErr && !!(s.status || s.index.length) &&
  missedRun(s.status, s.index, s.holidays, now);
/* STATUS-END */
/* SUMMARY-START: the daily summary, market mood and when to refresh (tests/summary.mjs checks it) */
// Text parts: a string, or {b} shown bold ({b, n: 1} for the count)
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
// The latest holiday after date when only weekends and holidays follow it up to yesterday (Manila); today counts if it is one
function closedSince(date, holidays, now) {
  if (!isDay(date)) return null;
  const today = manilaISO(now); let last = null;
  for (let d = addDays(date, 1); d <= today; d = addDays(d, 1)) {
    if ([0, 6].includes(new Date(d).getUTCDay())) continue;
    if (holidays.has(d)) last = d; else if (d < today) return null;
  }
  return last;
}
// One prefix at most, in this order: a picked earlier day, provisional, holiday, then not today's session
// (a failed or empty run for a session after the holiday wins over the holiday)
function dayPrefix(s) {
  if (s.picked) return dateLabel(s.date) + ", an earlier day: ";
  if (s.provisional) return "Provisional (during trading): ";
  const h = closedSince(s.date, s.holidays, s.now), st = s.status && s.status.state, bad = st === "no_new_session" || st === "failed";
  if (h && !(bad && isDay(s.status.expected_date) && s.status.expected_date > h)) return "PSE was closed " + dateLabel(h) + " (holiday). Latest session, " + dateLabel(s.date) + ": ";
  return bad || s.missed ? "From " + dateLabel(s.date) + " (not today's): " : "";
}
// c: counts {pass, isNew, dropped, missed}, cmp: the compare date's label or null
function countsText(name, prefixed, c, cmp) {
  const out = [{b: name}, prefixed ? ": " : " today: "], m = c.missed;
  const d = cmp && c.dropped ? ", " + c.dropped + " dropped since " + cmp + "." : "";
  if (!c.pass && d) return out.concat({b: "no stock passes", n: 1}, d + (m ? " " + m + " missed by one filter." : " None missed by one filter."));
  if (!c.pass) return out.concat(m ? [{b: "no stock passes.", n: 1}, " " + m + " missed by one filter."]
    : [{b: "no stock passes", n: 1}, ", and none missed by one filter. Quiet days like this are normal."]);
  out.push({b: plural(c.pass, "stock passes", "stocks pass"), n: 1});
  if (!cmp) return out.concat(". " + (m ? m + " missed by one filter. " : "") + "Pick a date in Compare with… to see what's new.");
  const ch = [c.isNew && c.isNew + " new", c.dropped && c.dropped + " dropped"].filter(Boolean).join(" and ");
  out.push(c.pass === 1 && c.isNew === 1 && !c.dropped ? ", new since " + cmp + "." : ch ? ", " + ch + " since " + cmp + "." : ", the same as " + cmp + ".");
  return m ? out.concat(" " + m + " more missed by one filter.") : out;
}
function summaryLine(C, s) {
  const p = dayPrefix(s), c = {pass: C.pass.length, isNew: C.isNew.size, dropped: C.dropped.length, missed: C.missed.length};
  return (p ? [p] : []).concat(countsText(s.name, !!p, c, C.hasCmp ? s.cmp : null));
}
// Share of the whole scan above its 200-day average; rows without a number count in neither part
// The 35% and 65% cut-offs are a starting guess, to revisit after the Strict vs Loose track record (TODOS T-11)
function mood(rows, cmpRows) {
  const share = rs => {
    const v = (rs || []).map(r => r.pct_vs_sma200).filter(x => typeof x === "number" && Number.isFinite(x));
    return v.length < 50 ? null : {n: v.length, pct: Math.round(v.filter(x => x > 0).length / v.length * 100)};
  };
  const now = share(rows), was = share(cmpRows);
  return now && {...now, word: now.pct < 35 ? "weak" : now.pct > 65 ? "strong" : "mixed", was: was ? was.pct : null};
}
function moodLine(m, cmp) {
  if (!m) return ["Market mood: not enough data today."];
  const d = m.was === null || !cmp ? "" : " (" + (m.pct > m.was ? "up from " : m.pct < m.was ? "down from " : "same as ") + m.was + "% on " + cmp + ")";
  return ["Market mood: ", {b: m.word}, ". " + m.pct + "% of " + m.n + " stocks are above their 200-day average" + d + "."];
}
// Coming back to the page: reload when nothing has loaded or been tried for 10 minutes, one load at a time
const shouldRefresh = (s, now, hidden) => !hidden && !!s.key && !s.loading && now - Math.max(s.updated || 0, s.tried || 0) > 10 * 60e3;
/* SUMMARY-END */
/* TIPS-START: what each plain-word label means: the ? bubbles and "What the words mean" read this one object (tests/summary.mjs checks it) */
const TIPS = {
  "Stock": "The stock's PSE code. Tap the row for its details.",
  "Days on list": "Trading days in a row this stock has passed the selected set, today included.",
  "Momentum": "How far today's price is from its usual level over 20 days (CCI 20). Over 100 is a strong push up; under −100 a strong push down.",
  "Price ₱": "Last closing price, in pesos.",
  "Traded today": "Pesos traded today: the price times the shares traded.",
  "Today %": "Change from the previous close.",
  "Daily swing": "How much the price usually moves in a day, as a share of the price (14-day ATR). Small is calm, big is jumpy.",
  "9-day change": "Price change over the last 9 trading days (rate of change, ROC 9).",
  "Below year high": "How far the price is under its highest close of the past year. 0% means at the high.",
  "vs 50-day avg": "Price compared with its average close over 50 days (SMA 50). Above 0 means above the average.",
  "vs 200-day avg": "Price compared with its average close over 200 days (SMA 200), the long-term trend.",
  "Company size": "The market value of all the company's shares (market cap).",
  "Usual daily trading": "Average pesos traded per day over 30 days. Higher means easier to buy and sell.",
  "Price above 200-day average": "The price is above its long-term trend.",
  "Price above 50-day average": "The price is above its medium-term trend.",
  "50-day average above 200-day": "The medium-term trend is above the long-term one.",
  "9-day change at least": "Keeps stocks that rose at least this much over 9 trading days.",
  "Company size at least": "Leaves out companies smaller than this.",
  "Below year high, %": "Keeps stocks this close to their year high.",
  "Usual daily trading above": "Leaves out stocks that trade too little to buy and sell easily.",
  "Traded today above": "Leaves out stocks that traded little today.",
  "Price above": "Leaves out very cheap shares.",
  "Daily swing between": "Keeps stocks whose daily moves are in this range.",
  "Strict": "The tighter set: strong trend, steady moves, bigger companies.",
  "Loose": "A wider set that lets more stocks in.",
  "Custom": "Your own slider settings.",
  "missed by one filter": "Failed exactly one rule today: worth watching.",
  "Knocking on the door": "Missed by one rule 3 or more trading days running.",
  "BOTH": "On Strict and Loose today.",
  "Provisional": "Taken during trading hours; the final numbers come after the close.",
  "My buy": "The price you bought at, from your notes.",
  "vs my buy": "Change from your buy price to this day's close.",
  "Cut-loss": "The price at which you plan to sell to limit a loss, from your notes.",
  "Target": "The price at which you plan to take profit, from your notes.",
  "Passes": "Which filter set this stock passes on this day.",
  "Market mood": "How many stocks are above their 200-day average: a rough read of the whole market's long-term trend. Not a signal to buy or sell.",
};
/* TIPS-END */
/* KEY-START: the key's end date and its reminders (tests/key.mjs checks it). Nothing here sends a request; the date stays on this device. */
const NAG_BANDS = ["14", "3", "nodate"]; // the bars Later can hide
const defaultExpiry = (now = new Date()) => addDays(manilaISO(now), 90);
const dateField = (mode, now) => mode === "date" ? "" : defaultExpiry(now); // a new key or a renewal: today + 90; Add date: empty
function validateExpiry(v, now = new Date()) {
  if (!isDay(v)) return "Enter the date your key runs out.";
  const d = dayDiff(manilaISO(now), v);
  return d < 0 ? "That date has passed. Check it on GitHub's token page." : d > 366 ? "That's more than a year away. Check it on GitHub's token page." : "";
}
// At most one key bar: refused or ran out, then today, then 3 days, then 14 days, then no date. Later hides 14, 3 and no date.
function keyBand(exp, nag, refused, now = new Date()) {
  const today = manilaISO(now), days = isDay(exp) ? dayDiff(today, exp) : null;
  const band = days !== null && days < 0 ? "out" : refused ? "refused" : days === null ? "nodate" : days === 0 ? "0" : days <= 3 ? "3" : days <= 14 ? "14" : null;
  const ok = nag && typeof nag === "object" && NAG_BANDS.includes(nag.band) && (nag.until === null || isDay(nag.until));
  return {band: ok && nag.band === band && (band !== "nodate" || !!nag.until && today < nag.until) ? null : band, days};
}
function bandText(band, days, label, standalone) {
  const n = plural(days, "day", "days");
  return {
    "14": "Your key runs out in " + n + " (" + label + "). Renew it.",
    "3": "Your key runs out in " + n + " (" + label + "). Renew it now so your results keep loading.",
    "0": "Your key may stop working today. Renew it now.",
    out: "Your key ran out on " + label + ". Make a new one to see your results.",
    refused: "GitHub didn't accept this key. If you made a new key " + (standalone ? "in Safari or on another device" : "on another device") +
      ", paste it here; if not, make a new one.",
    nodate: "Add your key's end date so this page can remind you before it runs out.",
  }[band] || "";
}
// Only a 401, or a 403 that is not a rate limit, means the key was refused
const authKind = (status, h) => status === 403 && (h.get("x-ratelimit-remaining") === "0" || h.get("retry-after")) ? "rate"
  : status === 401 || status === 403 ? "auth" : "";
const keyBar = () => { const exp = store.get("keyExp", null); return S.key ? {...keyBand(exp, store.get("keyNag", null), S.authErr), exp} : {band: null}; };
function keyLater(band) { store.set("keyNag", {band, until: band === "nodate" ? addDays(manilaISO(), 30) : null}); renderBars(); }
function saveKey() {
  const k = $("keyin").value.trim(), d = $("kdate").value, err = validateExpiry(d);
  if (!k) { $("keyin").focus(); return; }
  if (err) { $("kerr").textContent = err; $("kdate").focus(); return; }
  gen++; dropCloses(); S.key = k; store.set("key", k); store.set("keyExp", d); store.del("keyNag"); S.keyBarShown = false;
  $("keyin").value = ""; S.authErr = S.noAccess = false; H = {state: "loading"}; showKey(false); renderAll(); loadRemote();
}
function saveDate() {
  const d = $("kdate").value, err = validateExpiry(d);
  if (err) { $("kerr").textContent = err; $("kdate").focus(); return; }
  store.set("keyExp", d); store.del("keyNag"); showKey(false); renderBars();
}
function forgetKey() {
  gen++; hgen++; dropCloses(); S.key = ""; store.del("key"); store.del("keyExp"); store.del("keyNag"); store.del("cache"); H = {state: "missing"}; S.htext = null;
  Object.assign(S, {rows: null, date: null, meta: null, index: [], status: null, cmpRows: null, cmpDate: null, msg: null, keyBarShown: false,
    authErr: false, noAccess: false, refreshErr: null, parity: 0, fixtureBad: 0, updated: null, cached: false, loading: 0}); // a load still running can't clear it (T-29)
  showKey("key"); renderAll();
}
/* KEY-END */
/* MYLIST-START: My list stars and notes, kept in this browser only under pse.mine (tests/screens.mjs checks it) */
const MAX_MINE = 300, MAX_NOTE = 300, NOSAVE = "Couldn't save in this browser (storage full or private mode).", PRICES = ["buy", "cut", "target"];
const okPrice = v => typeof v === "number" && Number.isFinite(v) && v > 0;
// A price typed in a notes box: null when empty, NaN when 0, below 0 or not a number
function priceIn(t) {
  t = String(t).trim().replace(/[₱,\s]/g, "");
  return !t ? null : /^(\d+\.?\d*|\.\d+)$/.test(t) && okPrice(+t) ? +t : NaN;
}
const hasNotes = e => PRICES.some(k => e[k] !== null) || !!e.note;
// The list read from storage: bad entries dropped, one per stock, at most MAX_MINE
function cleanMine(raw) {
  const out = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_MINE) break;
    if (!x || typeof x !== "object" || typeof x.sym !== "string" || !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(x.sym) || out.some(o => o.sym === x.sym)) continue;
    const e = {sym: x.sym, star: x.star === true, note: typeof x.note === "string" ? x.note.slice(0, MAX_NOTE) : "",
      at: typeof x.at === "string" && !isNaN(Date.parse(x.at)) ? x.at : null};
    for (const k of PRICES) e[k] = okPrice(x[k]) ? x[k] : null;
    if (e.star || hasNotes(e)) out.push(e);
  }
  return out;
}
// The list with one stock changed (ch: {star} or notes); a stock with no star and no notes leaves it
function mineWith(list, sym, ch) {
  const i = list.findIndex(e => e.sym === sym), e = {sym, star: false, buy: null, cut: null, target: null, note: "", at: null, ...list[i], ...ch};
  if (!e.star && !hasNotes(e)) return list.filter(o => o.sym !== sym);
  return i < 0 ? [...list, e] : list.map((o, j) => j === i ? e : o);
}
const mineErr = (list, sym) => !list.some(e => e.sym === sym) && list.length >= MAX_MINE ? "My list keeps " + MAX_MINE + " stocks. Remove one first." : "";
// The note boxes' text: the three prices and the note, or {bad: [the refused boxes]}
function readNotes(f) {
  const out = {note: String(f.note || "").trim().slice(0, MAX_NOTE)}, bad = PRICES.filter(k => Number.isNaN(out[k] = priceIn(f[k] || "")));
  return bad.length ? {bad} : out;
}
const p2 = x => x.toFixed(x < 1 ? 4 : 2);
const priceMsg = close => "Enter a price above 0" + (okPrice(close) ? ", like " + p2(close) : "") + ".";
// One stock on the shown day: its close (null when not in the file or no close), the change from the buy price in %, and its tag
function myView(e, r) {
  const close = r && !r.ghost && okPrice(r.close) ? r.close : null;
  return {close, vs: close !== null && okPrice(e.buy) ? (close / e.buy - 1) * 100 : null,
    tag: close === null ? "gone" : okPrice(e.cut) && close <= e.cut ? "cut" : okPrice(e.target) && close >= e.target ? "target" : ""};
}
const TAG = {gone: "Not in this day's scan", cut: "At cut-loss", target: "Target reached"};
function levelLine(e, close) {
  const t = myView(e, {close}).tag;
  return t === "cut" ? "Price is at or below your cut-loss (₱" + p2(e.cut) + ")." : t === "target" ? "Price is at or above your target (₱" + p2(e.target) + ")." : "";
}
let MINE = cleanMine(store.get("mine", []));
// Saves the whole list; false (and nothing changed) when storage is full or off
function saveMine(list) { if (!store.set("mine", list)) return false; MINE = list; return true; }
const reloadMine = () => { MINE = cleanMine(store.get("mine", MINE)); }; // before each change: another tab may have saved since
const mineOf = sym => MINE.find(e => e.sym === sym) || null;
const starred = () => MINE.filter(e => e.star);
/* MYLIST-END */
/* DAY-START: Pick a day: an earlier results file on screen, the latest one kept aside (tests/screens.mjs checks it) */
const DAYF = ["rows", "date", "meta", "parity", "cmpRows", "cmpDate"];
const fields = () => Object.fromEntries(DAYF.map(k => [k, S[k]]));
let LATEST = null, dgen = 0; // LATEST: the latest file's fields while an earlier day is shown; each pick or return bumps dgen
const latestDate = () => LATEST ? LATEST.date : S.date;
// Every saved day, newest first, once each
function dayList(index, latest) {
  const m = new Map();
  for (const e of index) if (isDay(e.date) && !m.has(e.date)) m.set(e.date, e);
  if (isDay(latest) && !m.has(latest)) m.set(latest, {date: latest});
  return [...m.values()].sort((a, b) => a.date < b.date ? 1 : -1).map(e => ({date: e.date, latest: e.date === latest, prov: e.final === false}));
}
// f writes the latest file's fields (a refresh); a picked day stays on screen
function onLatest(f) {
  if (!LATEST) return f();
  const pick = fields(); Object.assign(S, LATEST);
  try { return f(); } finally { LATEST = fields(); Object.assign(S, pick); S.meta = S.index.find(e => e.date === S.date) || null; }
}
function backToLatest() { dgen++; S.dayMsg = null; if (LATEST) { Object.assign(S, LATEST); LATEST = null; } }
const dropDay = () => { if (!S.key) { LATEST = S.dayMsg = null; dgen++; } }; // after Forget key: the old latest and any pick still loading are gone too
// Loads results/<d>.csv and its compare day (the last final day before it); a failure keeps the latest on screen
async function pickDay(d) {
  if (d === latestDate()) { backToLatest(); return renderAll(); }
  if (LATEST && d === S.date) { if (S.dayMsg && S.dayMsg.wait) { dgen++; S.dayMsg = null; renderBars(); } return; } // cancels only a day still loading
  const my = ++dgen, kg = gen, get = f => fileText("results/" + f + ".csv"); // kg: a refusal counts only for the key it was sent with
  S.dayMsg = {wait: d}; renderBars();
  try {
    const csv = await get(d);
    if (my !== dgen) return;
    if (!csv) throw new Error("no file for that day");
    const cd = S.index.filter(e => e.final === true && isDay(e.date) && e.date < d).map(e => e.date).sort().pop() || null;
    let why = null, auth = false; // the compare file failed: that day shows without a comparison, and the bar says why
    const ccsv = cd ? await get(cd).then(t => { if (!t) why = "no file for that day"; return t; },
      e => { auth = e instanceof AuthError; why = auth ? "GitHub didn't accept the key" : e.message || "no answer"; return null; }) : null;
    if (my !== dgen) return;
    if (auth && kg === gen) S.authErr = true;
    if (!LATEST) LATEST = fields();
    setCurrent(csv); setCompare(ccsv, cd); S.dayMsg = why ? {nocmp: cd, why} : null;
  } catch (e) {
    if (my !== dgen) return;
    if (e instanceof AuthError && kg === gen) S.authErr = true;
    backToLatest(); S.dayMsg = {fail: d, why: e instanceof AuthError ? "GitHub didn't accept the key" : e.message || "no answer"};
  }
  renderAll();
}
// The panel's words for the day on screen: label is null on the latest day, else the picked day's name ("Thu, Oct 29")
const dayWords = label => label ? {notIn: "Not in the " + label + " scan", notScanned: "Not scanned on " + label, fails: "Fails on " + label, today: "On " + label,
  col: t => t.replace("Traded today", "Traded that day").replace("Today %", "That day %")} // the numbers list's labels
  : {notIn: "Not in today's scan", notScanned: "Not scanned today", fails: "Fails today", today: "Today", col: t => t};
const dayText = (x, label) => label(x.date, true) + (x.latest ? " (latest)" : x.prov ? " (provisional)" : ""); // the day list: the year on every row
/* DAY-END */
/* CHART-START: the price chart in the stock panel: reading results/closes.csv, the averages, the range, the states and the drawing's numbers (tests/chart.mjs checks it) */
const cday = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d);
// closes.csv text -> {dates, by: Map(symbol -> [close or null per date])}; a bad file throws a reason that never quotes a cell
function parseCloses(text) {
  const lines = String(text).split("\n"); if (lines.at(-1) === "") lines.pop();
  const head = (lines[0] || "").split(","), n = head.length, dates = head.slice(1), by = new Map();
  if (head[0] !== "symbol" || n < 2) throw new Error("the first line is not symbol, then dates");
  for (let i = 0; i < dates.length; i++) if (!cday(dates[i]) || i && dates[i] <= dates[i - 1]) throw new Error("date " + (i + 1) + " in the first line is not a date after the one before");
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(",");
    if (c.length !== n) throw new Error("line " + (k + 1) + " has " + c.length + " cells, want " + n);
    // a symbol: the shape tests/static.mjs CLOSES refuses in the public repo
    if (!/^(?=[A-Z0-9.-]*[A-Z])[A-Z0-9][A-Z0-9.-]{0,11}$/.test(c[0]) || /^\d+(\.\d+)?E\d+$/.test(c[0]) || by.has(c[0])) throw new Error("line " + (k + 1) + " has no symbol of its own");
    const v = [];
    for (let j = 1; j < n; j++) {
      if (c[j] === "") { v.push(null); continue; }
      if (!/^\d+(\.\d+)?$/.test(c[j]) || !(+c[j] > 0)) throw new Error("a cell is not a number above 0 on line " + (k + 1));
      v.push(+c[j]);
    }
    by.set(c[0], v);
  }
  return {dates, by};
}
// The first 16 hex characters of the text's SHA-256: index.json's closes_sha256 for the run that wrote the file
async function stampOf(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}
// At each session: the mean of the stock's last n closes up to it, blanks skipped (the screener's sma50/sma200 rule); null before n closes
function avgLine(v, n) {
  const out = [], last = [];
  for (const x of v) {
    if (x !== null) { last.push(x); if (last.length > n) last.shift(); }
    let s = 0; if (last.length === n) for (const y of last) s += y;
    out.push(last.length === n ? s / n : null);
  }
  return out;
}
function monthsBack(iso, m) { // the same day m calendar months earlier (the month's last day when it has fewer days)
  const [y, mo, d] = iso.split("-").map(Number), f = new Date(Date.UTC(y, mo - 1 - m, 1)), days = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), Math.min(d, days))).toISOString().slice(0, 10);
}
// [first, last] column of the view: the sessions after end minus the range's months, up to end; null when none is on or before end
function viewOf(dates, end, months) {
  let b = dates.length - 1; while (b >= 0 && dates[b] > end) b--;
  if (b < 0) return null;
  const cut = monthsBack(end, months); let a = b; while (a > 0 && dates[a - 1] > cut) a--;
  return [a, b];
}
const RANGE = {3: "3 months", 12: "1 year"};
// What the chart area shows. c: {cl (the loaded file), sym, rows and meta (the LATEST run's), end (the day on screen), months}
function chartState(c) {
  const {cl, sym} = c;
  if (cl.state === "idle" || cl.state === "loading") return {say: "Loading prices…"};
  if (cl.state === "auth") return {say: "Prices can't load until the key is fixed (see above)."};
  if (cl.state === "fail") return {say: "Couldn't load prices (" + cl.err + ").", retry: true};
  if (cl.state === "missing") return {say: "The chart appears after the next daily run."};
  if (cl.state !== "ok") return {say: "Price file can't be read (" + cl.err + "). Today's results still work."};
  const st = c.meta && c.meta.closes_sha256; // a file from another run could disagree with the results beside it
  if (typeof st !== "string" || st !== cl.stamp) return {say: "Prices are being updated: the chart comes back after the next run."};
  const row = (c.rows || []).find(r => r.symbol === sym), v = cl.by.get(sym);
  if (row && row.fetch_error) return {say: "No prices for " + sym + " in the last run (it didn't load). The chart comes back after the next run."};
  if (!v) return {say: row ? "No usable prices for " + sym + " in the last run." : "No saved prices for " + sym + ": it isn't in the latest run."};
  const w = viewOf(cl.dates, c.end, c.months);
  if (!w) return {say: "No saved prices up to that day."};
  let n = 0; for (let i = w[0]; i <= w[1]; i++) if (v[i] !== null) n++;
  if (n < 2) return {say: "Not enough trading days to draw a chart yet (" + n + " so far)."};
  return {draw: {dates: cl.dates, v, w, sessions: row && typeof row.sessions === "number" ? row.sessions : null}};
}
// 3 to 5 round ticks; the scale runs from the first to the last
function niceTicks(lo, hi) {
  if (!(hi - lo > Math.abs(hi) * 1e-3)) { const p = Math.max(Math.abs(hi) * 0.01, 1e-4); lo -= p; hi += p; } // a flat line still gets a scale
  for (let e = Math.floor(Math.log10(Math.max(hi - lo, 1e-9))) - 2; ; e++) for (const m of [1, 2, 2.5, 5]) {
    const s = m * 10 ** e, a = Math.floor(lo / s + 1e-9), b = Math.ceil(hi / s - 1e-9);
    if (b - a + 1 <= 5 && b - a >= 2) return Array.from({length: b - a + 1}, (_, i) => +((a + i) * s).toFixed(6));
  }
}
const LEVELS = [["buy", "Buy", "lb"], ["cut", "Cut-loss", "lc"], ["target", "Target", "lt"]];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The drawing in numbers for a W x H area: lines, ticks, months, levels (in range, or pinned to an edge), summary bits
function chartModel(d, mine, months, W, H, fmt) {
  const {dates, v, w} = d, a50 = avgLine(v, 50), a200 = avgLine(v, 200), idx = [];
  for (let i = w[0]; i <= w[1]; i++) idx.push(i);
  const seen = []; for (const i of idx) for (const s of [v, a50, a200]) if (s[i] !== null) seen.push(s[i]);
  const lo0 = Math.min(...seen), hi0 = Math.max(...seen), span = hi0 - lo0 || hi0 * 0.02;
  let lo = lo0, hi = hi0; const lv = [];
  for (const [k, name, cls] of LEVELS) {
    const x = mine && mine[k]; if (typeof x !== "number" || !(x > 0) || !isFinite(x)) continue;
    const far = x > hi0 + span / 4 ? "up" : x < lo0 - span / 4 ? "down" : null;
    if (!far) { lo = Math.min(lo, x); hi = Math.max(hi, x); } // within 25 % of the range beyond it: the scale widens
    lv.push({k, cls, x, far, name, label: name + " " + fmt(x) + (far === "up" ? " ↑" : far === "down" ? " ↓" : "")});
  }
  const ticks = niceTicks(lo, hi), ylo = ticks[0], yhi = ticks.at(-1), R = Math.max(...ticks.map(t => fmt(t).length)) * 7 + 8, T = 8, B = 18;
  const n = idx.length, X = k => +(2 + k * (W - R - 4) / (n - 1)).toFixed(1), Y = y => +(T + (yhi - y) / (yhi - ylo) * (H - T - B)).toFixed(1);
  const path = s => idx.map((i, k) => s[i] === null ? null : X(k) + "," + Y(s[i])).filter(Boolean).map((p, j) => (j ? "L" : "M") + p).join("");
  for (const l of lv) l.y = l.far === "up" ? T : l.far === "down" ? H - B : Y(l.x);
  const mon = [], all = [];
  for (let k = 1; k < n; k++) {
    const a = dates[idx[k - 1]], b = dates[idx[k]], m = +b.slice(5, 7);
    if (a.slice(5, 7) !== b.slice(5, 7) && X(k) < W - R - 14) all.push({x: X(k), t: MON[m - 1] + (m === 1 ? " ’" + b.slice(2, 4) : ""), jan: m === 1});
  }
  for (const c of all.filter(c => c.jan).concat(all.filter(c => !c.jan))) if (mon.every(o => Math.abs(o.x - c.x) >= (o.jan || c.jan ? 44 : 34))) mon.push(c); // a year's label first
  mon.sort((a, b) => a.x - b.x);
  const vals = idx.map(i => v[i]).filter(x => x !== null), first = vals[0], end = vals.at(-1), chg = (end / first - 1) * 100;
  const trades = vals.length, after = v.slice(w[1] + 1).filter(x => x !== null).length; // closes up to the end, in all: the run's sessions less those after it
  const upTo = d.sessions !== null && d.sessions !== undefined ? d.sessions - after : v.slice(0, w[1] + 1).filter(x => x !== null).length;
  const miss = (s, need) => idx.some(i => s[i] !== null) ? null : upTo < need ? "(needs " + need + " trading days)" : "(not enough saved days)";
  const sum = RANGE[months] + ": " + (Math.abs(chg) < 0.05 ? "unchanged" : (chg > 0 ? "up " : "down ") + Math.abs(chg).toFixed(1) + "%") + " (₱" + fmt(first) + " to ₱" + fmt(end) + ")." +
    (n > trades ? " No trades on " + (n - trades) + " of the " + n + " days shown." : "") +
    lv.filter(l => l.far).map(l => " " + l.name + " ₱" + fmt(l.x) + " is " + (l.far === "up" ? "above" : "below") + " the chart.").join("");
  return {idx, n, X, Y, R, T, B, ticks: ticks.map(t => ({y: Y(t), t: fmt(t)})), mon, lv, close: path(v), p50: path(a50), p200: path(a200), a50, a200, miss50: miss(a50, 50), miss200: miss(a200, 200), sum};
}
// One line under the chart for column i: "Fri, Nov 20 · ₱42.15 close · ₱39.02 50-day · ₱34.24 200-day"
const readout = (d, m, i, fmt, label) => [label(d.dates[i]), d.v[i] === null ? "no trade" : "₱" + fmt(d.v[i]) + " close",
  m.a50[i] === null ? null : "₱" + fmt(m.a50[i]) + " 50-day", m.a200[i] === null ? null : "₱" + fmt(m.a200[i]) + " 200-day"].filter(Boolean).join(" · ");
// The readout's next column for a key (arrows move one day, Home and End jump to the ends); undefined for other keys
const stepKey = (key, k, n) => { const j = {ArrowLeft: k - 1, ArrowDown: k - 1, ArrowRight: k + 1, ArrowUp: k + 1, Home: 0, End: n - 1}[key]; return j === undefined ? j : Math.min(n - 1, Math.max(0, j)); };
/* CHART-END */
const timeLabel = iso => new Date(iso).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila"});
const safeUrl = u => typeof u === "string" && /^https:\/\/github\.com\//.test(u) ? u : "https://github.com/" + OWNER + "/" + REPO + "/actions";

// ------------------------------------------------------------------ state
const S = {
  key: store.get("key", ""),
  rows: null, date: null, meta: null, updated: null, tried: null, loading: 0, cached: false,
  index: [], status: null, holidays: new Set(),
  cmpRows: null, cmpDate: null,
  preset: "strict", set: {...STRICT}, view: "pass", sort: {k: "cci20", dir: -1}, q: "", htext: null, herr: null, want: null,
  parity: 0, fixtureBad: 0, authErr: false, noAccess: false, keyBarShown: false, refreshErr: null, msg: null, missed: false,
  screens: loadScreens(store.get("screens", [])), screen: null, dirty: false, fopen: store.get("filtersOpen", true) !== false,
};
let P = null; // open stock panel: {sym, from, pushed}
const NAME = {strict: "Strict", loose: "Loose"};
let H = {state: S.key ? "loading" : "missing"}; // or broken (err), or ok (parseHistory)

// ------------------------------------------------------------------ settings and URL
const MONEY_STEPS = [0, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8];
const SLIDERS = [
  {k: "roc9_min", label: "9-day change at least", min: -20, max: 30, step: 0.5, show: v => v + "%"},
  {k: "mcap_min", label: "Company size at least", steps: [0, 1e8, 2.5e8, 5e8, 1e9, 2e9, 5e9, 1e10, 5e10, 1e11], money: true},
  {k: "high_band", label: "Below year high, %", band: true, min: 0, max: 100, step: 1},
  {k: "avg_value_min", label: "Usual daily trading above", steps: MONEY_STEPS, money: true},
  {k: "value_today_min", label: "Traded today above", steps: MONEY_STEPS, money: true},
  {k: "price_min", label: "Price above", steps: [0, 0.5, 1, 2, 5, 10, 20, 50, 100], money: true},
  {k: "atr_band", label: "Daily swing between", band: true, min: 0, max: 15, step: 0.5},
];
const CHECKS = ["above_sma200", "above_sma50", "sma50_above_sma200"];
const URLK = {above_sma200: "s200", above_sma50: "s50", sma50_above_sma200: "x", roc9_min: "roc", price_min: "price",
  avg_value_min: "avg", mcap_min: "mcap", value_today_min: "vt", high_band: "hi", atr_band: "atr"};

function parseMoney(t) {
  t = String(t).trim().toLowerCase().replace(/[₱,\s]/g, "");
  if (t === "" || t === "off") return 0;
  const m = /^(-?\d*\.?\d+)([kmbt]?)$/.exec(t);
  return m ? +m[1] * ({"": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12})[m[2]] : NaN;
}
function pageURL() {
  const p = new URLSearchParams();
  p.set("p", S.preset);
  if (S.preset === "custom") for (const k in URLK) {
    const v = S.set[k];
    p.set(URLK[k], Array.isArray(v) ? v.join("_") : typeof v === "boolean" ? +v : v);
  }
  const sym = P ? P.sym : S.want;
  if (sym) p.set("s", sym);
  return "?" + p;
}
function settingsToURL() {
  history.replaceState(null, "", pageURL());
  store.set("settings", {preset: S.preset, set: S.set, screen: S.screen, dirty: S.dirty});
}
function settingsFromURL() {
  const p = new URLSearchParams(location.search), pr = p.get("p");
  if (pr === "strict" || pr === "loose") return {preset: pr, set: {...PRESETS[pr]}};
  if (pr === "custom") {
    const set = {...STRICT};
    for (const k in URLK) {
      const v = p.get(URLK[k]);
      if (v === null || v.trim() === "") continue; // a bad or empty value keeps the default, never 0
      const num = x => x.trim() !== "" && Number.isFinite(+x) && (k === "roc9_min" || +x >= 0);
      if (typeof set[k] === "boolean") set[k] = v === "1";
      else if (Array.isArray(set[k])) { const b = v.split("_"); if (b.length === 2 && b.every(num) && +b[0] <= +b[1]) set[k] = b.map(Number); }
      else if (num(v)) set[k] = +v;
    }
    return {preset: "custom", set};
  }
  return store.get("settings", null);
}

function buildControls() {
  const box = $("sliders");
  for (const c of SLIDERS) {
    const parts = c.band ? [0, 1] : [null];
    const lab = el("div", {cls: "lab"}, el("span", null, c.label, tipBtn(c.label)));
    const ins = parts.map(i => el("input", {type: "text", inputmode: "decimal", "aria-label": c.label + (i === null ? "" : i ? " maximum" : " minimum")}));
    const ranges = parts.map(i => el("input", {type: "range", "aria-label": c.label + (i === null ? "" : i ? " maximum" : " minimum"),
      min: c.steps ? 0 : c.min, max: c.steps ? c.steps.length - 1 : c.max, step: c.steps ? 1 : c.step}));
    const valbox = el("span", {cls: "row", style: "gap:4px"});
    ins.forEach((inp, j) => { if (j) valbox.append("–"); valbox.append(inp); });
    lab.append(valbox);
    c.ins = ins; c.ranges = ranges;
    const read = () => c.band ? S.set[c.k].slice() : S.set[c.k];
    const write = v => { S.set[c.k] = v; toCustom(); };
    ranges.forEach((r, j) => r.addEventListener("input", () => {
      const v = c.steps ? c.steps[+r.value] : +r.value;
      if (c.band) { const b = read(); b[j] = v; if (b[0] > b[1]) b[1 - j] = v; write(b); } else write(v);
    }));
    ins.forEach((inp, j) => inp.addEventListener("change", () => {
      const v = c.money ? parseMoney(inp.value) : parseFloat(inp.value);
      if (!Number.isFinite(v)) { syncControls(); return; }
      if (c.band) { const b = read(); b[j] = v; if (b[0] > b[1]) b[1 - j] = v; write(b); } else write(v);
    }));
    box.append(el("div", null, lab, ...ranges));
  }
  for (const k of CHECKS) $(k).addEventListener("change", e => { S.set[k] = e.target.checked; toCustom(); });
  for (const b of document.querySelectorAll("[data-p]")) b.addEventListener("click", () => {
    S.preset = b.dataset.p; S.screen = null; S.dirty = false;
    if (S.preset !== "custom") S.set = {...PRESETS[S.preset], high_band: PRESETS[S.preset].high_band.slice(), atr_band: PRESETS[S.preset].atr_band.slice()};
    update();
  });
  $("ftog").addEventListener("click", () => { S.fopen = !S.fopen; store.set("filtersOpen", S.fopen); syncPanel(); });
  $("saveas").addEventListener("click", () => nameBox("new"));
  $("rename").addEventListener("click", () => nameBox("rename"));
  $("fnameok").addEventListener("click", nameSubmit);
  $("fnameno").addEventListener("click", () => nameBox(null));
  $("fnamein").addEventListener("keydown", e => { if (e.key === "Enter") nameSubmit(); else if (e.key === "Escape") nameBox(null); });
  $("savechg").addEventListener("click", () => {
    if (saveScreens(S.screens.map(o => sameName(o.name, S.screen) ? {name: o.name, set: cleanSet(S.set)} : o))) { S.dirty = false; update(); }
  });
  $("del").addEventListener("click", () => {
    if (!confirm("Delete saved set “" + S.screen + "”?")) return;
    if (saveScreens(S.screens.filter(o => !sameName(o.name, S.screen)))) { S.screen = null; S.dirty = false; S.preset = "custom"; nameBox(null); update(); }
  });
  renderSets();
}
function toCustom() {
  const sc = S.screen && S.screens.find(o => o.name === S.screen);
  if (sc) S.dirty = !sameSet(S.set, sc.set); else S.preset = "custom";
  update();
}

// ------------------------------------------------------------------ saved sets and the panel toggle
function saveScreens(list) {
  if (!store.set("screens", list)) { $("fmsg").textContent = "Couldn't save in this browser (storage full or private mode)."; return false; }
  S.screens = list; $("fmsg").textContent = ""; renderSets();
  return true;
}
function renderSets() {
  for (const b of document.querySelectorAll("[data-s]")) b.remove();
  for (const o of S.screens) $("sets").insertBefore(el("button", {type: "button", "data-s": o.name, text: o.name, onclick: () => {
    S.preset = "custom"; S.screen = o.name; S.dirty = false; S.set = cleanSet(o.set); nameBox(null); update();
  }}), $("ftog")); // saved sets go before the toggle
}
let nameMode = null; // "new", "rename" or null (box closed)
function nameBox(mode) {
  nameMode = mode; $("fname").hidden = !mode; $("fmsg").textContent = "";
  if (!mode) return;
  $("fnamein").value = mode === "rename" ? S.screen : "";
  $("fnamein").focus();
}
function nameSubmit() {
  const name = cleanName($("fnamein").value), err = nameError(name, S.screens, nameMode === "rename" ? S.screen : null);
  if (err) { $("fmsg").textContent = err; return; }
  const list = nameMode === "rename" ? S.screens.map(o => sameName(o.name, S.screen) ? {name, set: o.set} : o)
    : [...S.screens, {name, set: cleanSet(S.set)}];
  if (!saveScreens(list)) return;
  if (nameMode === "new") { S.preset = "custom"; S.dirty = false; }
  S.screen = name; nameBox(null); update();
}
function activeName() {
  return S.screen ? S.screen + (S.dirty ? " (edited)" : "") : S.preset[0].toUpperCase() + S.preset.slice(1);
}
function syncPanel() {
  $("fbody").hidden = !S.fopen; $("fsum").hidden = S.fopen;
  $("ftog").setAttribute("aria-expanded", String(S.fopen)); $("ftog").textContent = S.fopen ? "Hide filters ▴" : "Show filters ▾";
}
function syncControls() {
  for (const c of SLIDERS) {
    const vals = c.band ? S.set[c.k] : [S.set[c.k]];
    vals.forEach((v, j) => {
      const showv = c.money ? (v === 0 ? "off" : money(v).replace("₱", "")) : String(v);
      if (document.activeElement !== c.ins[j]) c.ins[j].value = showv;
      if (c.steps) { let idx = 0; c.steps.forEach((s, i) => { if (s <= v) idx = i; }); c.ranges[j].value = idx; }
      else c.ranges[j].value = v;
    });
  }
  for (const k of CHECKS) $(k).checked = S.set[k];
  for (const b of document.querySelectorAll("[data-p]")) b.setAttribute("aria-pressed", String(!S.screen && b.dataset.p === S.preset));
  for (const b of document.querySelectorAll("[data-s]")) {
    const on = b.dataset.s === S.screen;
    b.setAttribute("aria-pressed", String(on)); b.textContent = b.dataset.s + (on && S.dirty ? " (edited)" : "");
  }
  $("savechg").hidden = !(S.screen && S.dirty); $("rename").hidden = $("del").hidden = !S.screen;
  if (!S.screen && nameMode === "rename") nameBox(null);
  const sum = activeName() + " — " + summary(S.set);
  $("fsum").textContent = sum; $("fsum").title = sum;
}

// ------------------------------------------------------------------ compute
const NICE = {
  sma200: r => "Price below 200-day average" + (r.pct_vs_sma200 !== null ? " by " + Math.abs(r.pct_vs_sma200).toFixed(1) + "%" : ""),
  sma50: r => "Price below 50-day average" + (r.pct_vs_sma50 !== null ? " by " + Math.abs(r.pct_vs_sma50).toFixed(1) + "%" : ""),
  cross: () => "50-day average below 200-day",
  roc9: (r, s) => "9-day change " + spct(r.roc9) + " (needs " + s.roc9_min + "%)",
  price: (r, s) => "Price " + price(r.close) + " (needs above ₱" + s.price_min + ")",
  avg: (r, s) => "Usual daily trading " + money(r.avg_value_30d) + " (needs above " + money(s.avg_value_min) + ")",
  mcap: (r, s) => r.mcap === null ? "Company size unavailable" : "Company size " + money(r.mcap) + " (needs " + money(s.mcap_min) + ")",
  vt: (r, s) => "Traded today " + money(r.value_today) + " (needs above " + money(s.value_today_min) + ")",
  high: (r, s) => pct(r.pct_high_above_close) + " below year high (allowed " + s.high_band[0] + "–" + s.high_band[1] + "%)",
  atr: (r, s) => "Daily swing " + pct(r.atr_pct14, 2) + " (allowed " + s.atr_band[0] + "–" + s.atr_band[1] + "%)",
};
const RULE_NAME = {sma200: "200-day average", sma50: "50-day average", cross: "50-day vs 200-day average", roc9: "9-day change", price: "price",
  avg: "usual daily trading", mcap: "company size", vt: "traded today", high: "year high", atr: "daily swing"};
function nice(f, r, s, date) {
  if (f.rule === "stale") return "No trade on " + dateLabel(date);
  if (f.rule === "fetch") return "Not scanned: " + r.fetch_error;
  if (f.short) return "Not enough history for " + RULE_NAME[f.rule] + " (" + r.sessions + " sessions)";
  return NICE[f.rule](r, s);
}
function evalDay(rows, date) {
  const m = new Map();
  for (const r of rows) m.set(r.symbol, {r, f: failures(r, S.set, date)});
  return m;
}
let C = null; // last computation
function compute() {
  const cur = evalDay(S.rows, S.date);
  const cmp = S.cmpRows ? evalDay(S.cmpRows, S.cmpDate) : null;
  const pass = [], missed = [], dropped = [], notScanned = [], isNew = new Set();
  for (const [sym, e] of cur) {
    if (e.r.fetch_error) { notScanned.push(e.r); continue; }
    if (!e.f.length) pass.push(e.r);
    else if (e.f.length === 1 && e.f[0].rule !== "stale") missed.push(e);
    if (cmp) {
      const p = cmp.get(sym);
      if (p && p.r.fetch_error) continue;
      if (!e.f.length && (!p || p.f.length)) isNew.add(sym);
      if (e.f.length && p && !p.f.length) dropped.push(e);
    }
  }
  if (cmp) for (const [sym, p] of cmp) if (!cur.has(sym) && !p.r.fetch_error && !p.f.length) dropped.push({r: ghost(sym, p.r.name), gone: 1});
  C = {pass, missed, dropped, notScanned, isNew, hasCmp: !!cmp, pset: new Set(pass.map(r => r.symbol))};
}
const ghost = (symbol, name) => ({symbol, name, ghost: 1}); // not in the shown file
// Redone only when the history or the shown file changes
let T = {};
function tracks() {
  if (T.h === H && T.rows === S.rows) return T;
  T = {h: H, rows: S.rows, m: new Map(), dis: 0};
  if (H.state !== "ok" || !S.rows) return T;
  for (const r of S.rows) T.m.set(r.symbol, info(r.symbol, r));
  if (H.src[S.date] === "live" && !(S.meta && S.meta.final === false)) T.dis = disagree(H, S.rows, S.date);
  T.k = knocking(new Map([...T.m].map(([k, v]) => [k, v.t])), S.rows.filter(r => !r.fetch_error));
  return T;
}
function info(sym, row) { const t = track(H, sym, row, S.date); return {t, strict: strength(t, "strict"), loose: strength(t, "loose")}; }
const daysOf = r => { const i = H.state === "ok" && PRESETS[S.preset] && (tracks().m.get(r.symbol) || info(r.symbol, null)); return i ? i[S.preset].days : null; };

// ------------------------------------------------------------------ render
const starTd = (r, x) => el("td", {cls: "stc" + (x ? " x" : "")}, starBtn(r.symbol));
const COLS = [
  {k: "star", t: "", td: r => starTd(r)},
  {k: "symbol", t: "Stock", hl: 1},
  {k: "days", t: "Days on list", hl: 1, v: daysOf, f: r => daysText(H, S.preset, daysOf(r))},
  {k: "cci20", t: "Momentum", hl: 1, f: r => r.cci20 === null ? "—" : r.cci20.toFixed(1)},
  {k: "close", t: "Price ₱", hl: 1, f: r => price(r.close)},
  {k: "value_today", t: "Traded today", hl: 1, x: 1, f: r => money(r.value_today)},
  {k: "chg_pct", t: "Today %", hl: 1, x: 1, f: r => spct(r.chg_pct, 2), c: 1}, // phone: in the stock panel
  {k: "atr_pct14", t: "Daily swing", x: 1, f: r => pct(r.atr_pct14, 2)},
  {k: "roc9", t: "9-day change", x: 1, f: r => spct(r.roc9), c: 1},
  {k: "pct_high_above_close", t: "Below year high", x: 1, f: r => pct(r.pct_high_above_close)},
  {k: "pct_vs_sma50", t: "vs 50-day avg", x: 1, f: r => spct(r.pct_vs_sma50), c: 1},
  {k: "pct_vs_sma200", t: "vs 200-day avg", x: 1, f: r => spct(r.pct_vs_sma200), c: 1},
  {k: "mcap", t: "Company size", x: 1, f: r => money(r.mcap)},
  {k: "avg_value_30d", t: "Usual daily trading", x: 1, f: r => money(r.avg_value_30d)},
];
// My list: phone shows Stock (with the buy price), Price, vs my buy and the tag; the computer adds the rest
const mv = r => myView(mineOf(r.symbol) || {}, r), own = k => r => (mineOf(r.symbol) || {})[k] ?? null;
const passWord = r => { if (r.ghost || r.fetch_error) return "—"; const [a, b] = ["strict", "loose"].map(p => !failures(r, PRESETS[p], S.date).length); return a && b ? "Strict, Loose" : a ? "Strict" : b ? "Loose" : "none"; };
const MYCOLS = [
  {k: "star", t: "", td: r => starTd(r, 1)},
  {k: "symbol", t: "Stock", hl: 1, td: r => { const b = own("buy")(r); return el("td", {cls: "hl"}, r.symbol, el("span", {cls: "nm x", text: r.name || ""}), el("span", {cls: "nm ph", text: b ? "buy " + price(b) : "no buy price"})); }},
  {k: "close", t: "Price ₱", v: r => mv(r).close, f: r => price(mv(r).close)},
  {k: "chg_pct", t: "Today %", x: 1, f: r => spct(r.chg_pct, 2), c: 1},
  {k: "buy", t: "My buy", x: 1, own: 1, v: own("buy"), f: r => price(own("buy")(r))},
  {k: "vs", t: "vs my buy", v: r => mv(r).vs, f: r => spct(mv(r).vs), c: 1},
  {k: "cut", t: "Cut-loss", x: 1, own: 1, v: own("cut"), f: r => price(own("cut")(r))},
  {k: "target", t: "Target", x: 1, own: 1, v: own("target"), f: r => price(own("target")(r))},
  {k: "passes", t: "Passes", x: 1, v: passWord, td: r => { const w = passWord(r); return el("td", {cls: "x" + (w === "none" ? " muted" : "")}, w); }},
  {k: "tag", t: "", td: r => { const t = mv(r).tag; return el("td", null, t ? el("span", {cls: "tag " + t, text: TAG[t]}) : null); }},
];
const mineView = () => S.view === "mine" && !S.q.trim(), cols = () => mineView() ? MYCOLS : COLS;
function renderHead() {
  const tr = $("thr");
  tr.textContent = "";
  for (const c of cols()) {
    if (!c.t) { tr.append(el("th", {cls: c.td && c.k === "star" && cols() === MYCOLS ? "x" : null}, el("span", {cls: "sr", text: c.k === "star" ? "My list" : "Alert"}))); continue; }
    const on = S.sort.k === c.k;
    const th = el("th", {cls: (c.hl ? "hl " : "") + (c.x ? "x" : ""), "aria-sort": on ? (S.sort.dir < 0 ? "descending" : "ascending") : "none"},
      el("div", {cls: "th"}, el("button", {type: "button", text: c.t + (on ? (S.sort.dir < 0 ? " ▼" : " ▲") : ""), onclick: () => {
        S.sort = on ? {k: c.k, dir: -S.sort.dir} : {k: c.k, dir: c.k === "symbol" ? 1 : -1}; render();
      }}), tipBtn(c.t))); // the ? is the sort button's sibling, never inside it
    tr.append(th);
  }
}
function slBadge(r) { // muted without history
  const i = H.state === "ok" && (tracks().m.get(r.symbol) || info(r.symbol, null)), now = i && i.t.at(-1);
  return el("span", {cls: "sl", "aria-label": now ? "Strict " + WORD[now.strict] + ", Loose " + WORD[now.loose] : null},
    el("b", {cls: now ? now.strict : null, text: "S"}), el("b", {cls: now ? now.loose + " l" : "l", text: "L"}));
}
const WORD = {p: "on", m: "missed by one rule", n: "off", o: "no record"};
function cell(c, r) {
  if (c.td) return c.td(r);
  if (c.k === "symbol") {
    return el("td", {cls: "hl"}, r.symbol, C.isNew.has(r.symbol) ? el("span", {cls: "badge", text: "NEW"}) : null,
      S.q.trim() ? slBadge(r) : r.pass_strict && r.pass_loose ? el("span", {cls: "badge both", text: "BOTH"}) : null, el("span", {cls: "nm", text: r.name || ""}));
  }
  const v = c.v && c.c ? c.v(r) : r[c.k];
  return el("td", {cls: (c.hl ? "hl " : "") + (c.x ? "x " : "") + (c.c && v ? (v > 0 ? "up" : "down") : "")}, r.ghost && !c.own && c.k !== "days" ? "—" : c.f(r));
}
function tableRows() {
  let rs = S.view === "mine" ? starred().map(e => S.rows.find(r => r.symbol === e.sym) || ghost(e.sym, null))
    : S.view === "new" ? C.pass.filter(r => C.isNew.has(r.symbol))
    : S.view === "dropped" ? C.dropped.map(e => e.r) : S.view === "missed" ? C.missed.map(e => e.r) : C.pass;
  const q = S.q.trim().toLowerCase();
  if (q) { // every stock in the shown file, plus symbols only in history
    rs = S.rows.filter(r => r.symbol.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q));
    const have = new Set(S.rows.map(r => r.symbol));
    if (H.by) for (const sym of H.by.keys()) if (!have.has(sym) && sym.toLowerCase().includes(q)) rs.push(ghost(sym, null));
  }
  const {k, dir} = S.sort, cs = cols(), col = cs.find(c => c.k === k && c.t), mine = cs === MYCOLS && !col; // My list without a sort column: A to Z
  const g = mine ? r => r.symbol : col ? col.v || (r => r[k]) : r => r.cci20, d = mine ? 1 : col ? dir : -1; // a My list sort elsewhere: Momentum
  return rs.map(r => [r, g(r)]).sort(([, x], [, y]) => {
    x = x === undefined ? null : x; y = y === undefined ? null : y;
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1; // empty last
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * d;
  }).map(([r]) => r);
}
function opener(tr, sym) { // opens the stock panel
  tr.dataset.sym = sym; tr.tabIndex = 0;
  tr.addEventListener("click", () => openPanel(sym, tr));
  tr.addEventListener("keydown", e => { if (e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPanel(sym, tr); } });
  return tr;
}
function render() {
  if (!S.rows) return renderEmpty();
  renderHead();
  const tb = $("tb"), frag = document.createDocumentFragment(), rs = tableRows(), q = S.q.trim();
  for (const r of rs) {
    const tr = opener(el("tr", {cls: "main" + (q && !C.pset.has(r.symbol) ? " dim" : "")}), r.symbol);
    for (const c of cols()) tr.append(cell(c, r));
    frag.append(tr);
  }
  tb.textContent = ""; tb.append(frag);
  const note = [q && rs.length ? rs.length + " match" + (rs.length === 1 ? "" : "es") + " among every scanned stock · clear the search to see the table again" : "",
    S.preset === "custom" ? "Days on list: history covers Strict and Loose only." : ""].filter(Boolean).join(" ");
  $("tnote").hidden = !note; $("tnote").textContent = note;
  const empty = $("tblempty");
  empty.hidden = rs.length > 0;
  $("mynote").hidden = !mineView();
  if (!rs.length) empty.textContent = S.q ? "No stocks match “" + S.q + "”. Clear the search."
    : S.view === "mine" ? "My list is empty. Tap ☆ at the start of a row to add a stock."
    : S.view === "pass" ? "No stocks pass. Loosen a slider or switch to Loose."
    : S.view === "new" ? "No new stocks since the compare date." : S.view === "dropped" ? "Nothing dropped." : "No stocks missed by exactly one filter.";

  const since = C.hasCmp ? " since " + dateLabel(S.cmpDate) : "";
  const chips = $("chips"); chips.textContent = "";
  for (const [v, n, t] of [["pass", C.pass.length, "pass"], ["new", C.hasCmp ? C.isNew.size : "—", "new" + since],
    ["dropped", C.hasCmp ? C.dropped.length : "—", "dropped" + since], ["missed", C.missed.length, "missed by one filter"], ["mine", "★ " + starred().length, "My list"]]) {
    chips.append(el("button", {type: "button", "aria-pressed": String(S.view === v), disabled: n === "—" ? "" : null,
      onclick: () => { S.view = S.view === v && v !== "pass" ? "pass" : v; render(); }}, el("b", {text: n}), t));
    if (v === "missed") chips.append(tipBtn("missed by one filter"));
  }
  renderSummary();

  const lst = (id, items, emptyText, why, keep, cls = "why") => {
    const t = $(id); if (!keep) t.textContent = "";
    if (!items.length) { t.append(el("tr", null, el("td", {cls: "muted", colspan: 4, text: emptyText}))); return; }
    for (const it of items) { const r = it.r || it; t.append(opener(el("tr", null, el("td", {text: r.symbol}),
      el("td", {cls: "muted x", text: r.name || ""}), el("td", {cls: why ? cls : "muted"}, ...[].concat(why ? why(it) : it.fetch_error)), el("td", {cls: "go", text: "›"})), r.symbol)); }
  };
  lst("missed", C.missed.slice().sort((a, b) => (b.r.cci20 ?? -1e9) - (a.r.cci20 ?? -1e9)), "No stocks missed by exactly one filter.",
    e => nice(e.f[0], e.r, S.set, S.date));
  const tk = tracks();
  $("knp").hidden = H.state !== "ok";
  if (H.state === "ok") {
    $("knock").textContent = "";
    if (!tk.k.strict.length && !tk.k.loose.length) lst("knock", [], "No stock has missed by one rule 3 sessions running.");
    else for (const p in tk.k) {
      $("knock").append(el("tr", null, el("td", {cls: "sub", colspan: 4, text: NAME[p]})));
      lst("knock", tk.k[p], "No stock has missed " + NAME[p] + " by one rule 3 sessions running.",
        e => [el("b", {text: e.n + " sessions"}), el("span", {cls: "muted", text: " · " + (RULE_NAME[e.rule] || e.rule) + (e.rule === "vt" ? "" : " today")})], true, "");
    }
  }
  $("droph").textContent = C.hasCmp ? "Dropped since " + dateLabel(S.cmpDate) : "Dropped";
  lst("dropped", C.dropped, C.hasCmp ? "Nothing dropped." : "Pick a date in Compare with… to see what dropped.",
    e => e.gone ? "Not in today's scan" : [...new Set(e.f.map(f => nice(f, e.r, S.set, S.date)))].join("; "));
  $("nsh").textContent = "Not scanned today (" + C.notScanned.length + ")";
  lst("ns", C.notScanned, "Every stock was scanned.");
  renderPanel(); tipGone();
}
function renderEmpty() {
  $("thr").textContent = ""; $("tb").textContent = ""; $("chips").textContent = ""; $("tnote").hidden = $("knp").hidden = $("mynote").hidden = true;
  for (const id of ["missed", "dropped", "ns"]) $(id).textContent = "";
  $("tblempty").hidden = false;
  $("tblempty").textContent = S.msg || (S.key ? "Loading results…" : "Paste your key above to see your results.");
  renderSummary();
}
function renderSummary() {
  const box = $("sum"), part = x => typeof x === "string" ? x : el("b", {text: x.b, cls: x.n ? "n" : null});
  box.classList.toggle("res", !S.rows); box.hidden = !S.rows && !S.loading; // keeps the space while a first load runs
  $("sum1").textContent = $("sum2").textContent = "";
  if (!S.rows || !C) return;
  const cmp = C.hasCmp ? dateLabel(S.cmpDate) : null;
  $("sum1").append(...summaryLine(C, {name: activeName(), date: S.date, provisional: !!(S.meta && S.meta.final === false), status: S.status,
    holidays: S.holidays, missed: S.missed, now: new Date(), cmp, picked: !!LATEST}).map(part));
  $("sum2").append(...moodLine(mood(S.rows, S.cmpRows), cmp).map(part), tipBtn("Market mood"));
  tipGone();
}
// The header date: a button listing every saved day when there is more than one
const DB = el("button", {type: "button", id: "daybtn", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "days"});
const dayLabel = d => dateLabel(d, String(d).slice(0, 4) !== String(latestDate()).slice(0, 4)); // the year only when it differs from the latest's
function renderHeader() {
  const h = $("hdr"), f = document.activeElement === DB;
  h.textContent = "";
  if (!S.rows) { h.textContent = !S.key ? "No data loaded" : S.msg ? "No data yet" : "Loading…"; tipGone(); return; } // S.msg means loading has finished with nothing to show
  const m = S.meta;
  DB.textContent = dayLabel(S.date) + " ▾"; DB.setAttribute("aria-label", dayLabel(S.date) + ", pick a day");
  h.append("Data as of ", dayList(S.index, latestDate()).length > 1 ? DB : el("b", {text: dateLabel(S.date, true)}), " close");
  if (f && DB.isConnected) DB.focus();
  if (m && m.final === false) h.append(el("span", {cls: "badge warn", text: "Provisional"}), tipBtn("Provisional"));
  const bits = [];
  if (m && m.finished_at) bits.push("fetched " + timeLabel(m.finished_at));
  const scanned = m ? m.scanned : S.rows.length, failed = m ? m.fetch_failed : S.rows.filter(r => r.fetch_error).length;
  bits.push(scanned + " stocks scanned", failed + " had no data");
  if (S.loading && !S.cached) bits.push("updating…");
  else if (S.updated) bits.push((S.cached ? "cached, updating… " : "updated ") + new Date(S.updated).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"}));
  h.append(" · " + bits.join(" · "));
  tipGone();
}
function bar(box, cls, kids) { $(box).append(el("div", {cls: "bar fade " + cls}, ...kids)); }
const act = (text, f) => el("a", {href: "#", text, onclick: e => { e.preventDefault(); f(); }});
// Error bars above the summary (#bars), calm bars below it (#calm). Only the refused / ran-out bar is announced, once (#keylive).
function renderBars() {
  $("bars").textContent = ""; $("calm").textContent = "";
  const err = (...k) => bar("bars", "err", k), kb = keyBar(), renew = () => act("How to renew", () => showKey("key")), dm = S.dayMsg;
  if (LATEST) bar("bars", "info", ["Showing ", el("b", {text: dayLabel(S.date)}), ", an earlier day.", act("Back to latest", () => { backToLatest(); renderAll(); DB.focus(); })]);
  if (dm && dm.wait) bar("bars", "mute", ["Loading " + dayLabel(dm.wait) + "…"]);
  if (dm && dm.fail) bar("bars", "", ["Couldn't load " + dayLabel(dm.fail) + " (" + dm.why + "). Showing the latest day."]);
  if (dm && dm.nocmp) bar("bars", "", ["Couldn't load " + dayLabel(dm.nocmp) + " to compare with (" + dm.why + "). Showing " + dayLabel(S.date) + " without a comparison."]);
  const said = kb.band && bandText(kb.band, kb.days, dateLabel(kb.exp), standalone()) + " ";
  if (kb.band === "out" || kb.band === "refused") { bar("bars", "err", [said, renew()]); if (!S.keyBarShown) $("keylive").textContent = said; S.keyBarShown = true; }
  else { $("keylive").textContent = ""; S.keyBarShown = false; } // the next refusal is announced again
  if (S.noAccess) err("This key can't see " + REPO + ". Paste a key with access to it. ", act("Change key", () => showKey("key")));
  const st = S.status, log = () => el("a", {href: safeUrl(st.run_url), target: "_blank", rel: "noopener noreferrer", text: "open log"});
  const when = st && validTime(st.attempted_at) ? " (" + dateLabel(manilaISO(new Date(st.attempted_at))) + " " + timeLabel(st.attempted_at) + ")" : "";
  if (st && st.state === "failed") err("⚠ Last run failed" + when + ": " + (st.error || "unknown error") + ". Showing " + (S.date ? dateLabel(S.date) : "older") + " data. ", log());
  if (S.refreshErr) bar("bars", "", ["Couldn't refresh from GitHub (" + S.refreshErr + "). Showing the results saved " + (S.updated ? new Date(S.updated).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : "earlier") + ". Reload to try again."]);
  if (S.parity) err("Dashboard logic disagrees with screener for " + S.parity + " stock" + (S.parity === 1 ? "" : "s") + ". If this file was made before a filter change, re-run the screener; otherwise trust its own pass lists until this is fixed.");
  const dis = S.rows ? tracks().dis : 0;
  if (dis) err("History disagrees with today's file for " + dis + " stock" + (dis === 1 ? "" : "s") + ". Trust today's file; the next run rebuilds the history.");
  if (S.fixtureBad) err("Dashboard logic disagrees with the screener's test cases (" + S.fixtureBad + " failing). Trust the screener's own pass lists until this is fixed.");
  const later = () => act("Later", () => keyLater(kb.band));
  if (kb.band === "0") bar("calm", "warn", [said, renew()]);
  if (kb.band === "3") bar("calm", "warn", [said, renew(), later()]);
  if (kb.band === "14") bar("calm", "calm", [said, renew(), later()]);
  if (kb.band === "nodate") bar("calm", "calm", [said, act("Add date", () => showKey("date")), later()]);
  if (st && st.state === "no_new_session") bar("calm", "", ["⚠ No new PSE session yet" + when + (st.data_date ? "; PSE EDGE's latest is " + dateLabel(st.data_date) : "") + ". ", log()]);
  if (S.missed = showMissed(S))
    bar("calm", "", ["⚠ Scheduled run did not run this morning. Press Run now, or ", el("a", {href: safeUrl(null), target: "_blank", rel: "noopener noreferrer", text: "open Actions"}), "."]);
}
function renderCompare() {
  const sel = $("cmp"); sel.textContent = "";
  sel.append(el("option", {value: "", text: "Compare with…"}));
  for (const e of S.index) if (cmpOk(e.date)) sel.append(el("option", {value: e.date, text: dateLabel(e.date, true) + (e.final ? "" : " (provisional)")}));
  if (S.cmpRows && ![...sel.options].some(o => o.value === S.cmpDate)) sel.append(el("option", {value: S.cmpDate, text: dateLabel(S.cmpDate, true)})); // the menu names the comparison in use
  sel.value = S.cmpRows ? S.cmpDate : "";
  sel.hidden = !S.rows; // nothing to compare before results load
}
function update() { syncControls(); settingsToURL(); compute(); render(); }
function renderAll() {
  dropDay();
  if (S.herr && H.state === "ok" && S.rows && behind(H, S.index, S.date)) H = {state: "broken", err: S.herr + "; the saved copy is out of date"};
  document.body.classList.toggle("nokey", !S.key && !S.rows); // the first screen: the key panel, one line, the footer
  renderHeader(); renderBars(); renderCompare(); if (S.rows) compute(); render();
  if (S.want && !P && S.rows && (S.rows.some(r => r.symbol === S.want) || H.by && H.by.has(S.want))) { const s = S.want; S.want = null; openPanel(s, null, false); }
}

// ------------------------------------------------------------------ data
/* LOAD-START: loading results from GitHub, and what Forget key does to a load still running (tests/key.mjs checks it) */
class AuthError extends Error {}
let gen = 0; // bumped when the key changes or a load starts, so a slower older load can't overwrite it
async function gh(path, opts = {}) {
  const r = await fetch(API + path, {method: opts.method || "GET", cache: "no-store", body: opts.body, signal: opts.signal,
    headers: {Authorization: "Bearer " + S.key, Accept: opts.json ? "application/vnd.github+json" : "application/vnd.github.raw+json"}});
  const kind = authKind(r.status, r.headers);
  if (kind === "rate") throw new Error("GitHub rate limit reached; try again in a few minutes");
  if (kind === "auth") throw new AuthError();
  return r;
}
// A file read gives up after 30 s, so a hung request can't hold "updating…" (Run now's calls keep no limit)
const fileText = async (path, secs = 30) => {
  const c = new AbortController(), t = setTimeout(() => c.abort(new Error(path + ": no answer in " + secs + " seconds")), secs * 1e3);
  try { const r = await gh("/contents/" + path, {signal: c.signal}); if (r.status === 404) return null; if (!r.ok) throw new Error(path + ": HTTP " + r.status); return await r.text(); }
  catch (e) { throw c.signal.aborted && c.signal.reason instanceof Error ? c.signal.reason : e; }
  finally { clearTimeout(t); }
};
const csvDate = rows => (rows.find(r => r.data_date) || {}).data_date || null;
function setCurrent(csv) {
  S.rows = parseCSV(csv);
  S.date = csvDate(S.rows) || "unknown";
  S.meta = S.index.find(e => e.date === S.date) || null;
  S.parity = 0;
  for (const r of S.rows) for (const p in PRESETS)
    if (r["pass_" + p] !== null && !evaluate(r, PRESETS[p], S.date).length !== r["pass_" + p]) { S.parity++; break; }
}
function setCompare(csv, date) {
  if (!csv) { S.cmpRows = null; S.cmpDate = null; return; }
  S.cmpRows = parseCSV(csv);
  S.cmpDate = date || csvDate(S.cmpRows) || "unknown";
}
const cmpOk = d => isDay(d) && S.date && d < S.date; // compare only with an earlier session (a real date: it goes into a file path)
function defaultCompare() {
  const prev = S.index.find(e => e.final && cmpOk(e.date));
  return prev ? prev.date : null;
}
// x: text, null (no file) or an Error
function setHistory(x) {
  if (x === null) H = {state: "missing"};
  else if (x instanceof Error) H = {state: "broken", err: x.message || "no access"};
  else try { H = parseHistory(x); } catch (e) { H = {state: "broken", err: e.message}; }
  S.htext = typeof x === "string" ? x : null;
}
// Storage full: keep the rest without the history
const saveCache = c => store.set("cache", {...c, history: S.htext}) || store.set("cache", {...c, history: null});
let hgen = 0; // like gen, for history
async function loadHist() {
  const my = ++hgen;
  const x = await fileText("results/history.csv", 90).catch(e => e); // it grows every session: more time on a slow phone
  if (my !== hgen) return;
  if (x instanceof Error && H.state === "ok") { S.herr = x.message || "no access"; renderAll(); return; }
  S.herr = null; setHistory(x);
  const c = store.get("cache", null); if (c) saveCache(c);
  renderAll();
}
async function loadRemote() {
  if (!S.key) return;
  loadHist(); // in parallel: the table doesn't wait for it
  const my = ++gen;
  S.loading = my; if (!S.rows) S.msg = null; renderHeader(); if (!S.rows) renderSummary(); // "updating…"; S.loading is cleared only by the newest load
  const stale = () => my !== gen;
  try {
    const [csv, idx, st, hol] = await Promise.all(["latest.csv", "index.json", "status.json"].map(f => fileText("results/" + f)).concat(fileText("data/holidays.csv")));
    if (stale()) return;
    S.authErr = S.noAccess = false; S.refreshErr = null;
    S.index = cleanIndex(idx ? JSON.parse(idx) : []);
    const sj = st ? JSON.parse(st) : null; S.status = sj && typeof sj === "object" && !Array.isArray(sj) ? sj : null;
    S.holidays = new Set(hol ? parseCSV(hol).map(r => r.date) : []);
    if (!csv && !idx && !hol) { S.noAccess = true; if (!S.rows) S.msg = "This key can't see " + REPO + ". Paste a key with access to it."; return; } // a key without access to the repo gets 404s
    if (!csv) { if (!S.rows) S.msg = "No results yet: press Run now."; return; }
    const cd = onLatest(() => { setCurrent(csv); return cmpOk(S.cmpDate) && S.index.some(e => e.date === S.cmpDate) ? S.cmpDate : defaultCompare(); });
    S.updated = Date.now(); S.cached = false; S.msg = null;
    // A compare file that fails, times out or refuses the key never fails the main load: the fresh results still show and save
    let cfail = false, cauth = false; // a failed compare file keeps the comparison already shown (and saved), never erases it
    const ccsv = cd ? await fileText("results/" + cd + ".csv").catch(e => { cauth = e instanceof AuthError; cfail = true; return null; }) : null;
    if (my !== gen) return; // a load for a key since forgotten or replaced says nothing about the new one
    if (cauth) S.authErr = true;
    const kept = onLatest(() => { const k = cfail && S.cmpRows ? (store.get("cache", null) || {}).cmp || null : null; if (!cfail || !S.cmpRows) setCompare(ccsv, cd); return k; });
    saveCache({csv, index: S.index, status: S.status, holidays: [...S.holidays], cmp: ccsv ? {date: cd, csv: ccsv} : kept, at: S.updated});
    checkFixture(my);
  } catch (e) {
    if (my !== gen) return;
    if (e instanceof AuthError) { S.authErr = true; if (!S.rows) S.msg = "Your results can't load until the key is fixed (see above)."; }
    else if (S.rows) S.refreshErr = e.message;
    else S.msg = "Couldn't reach GitHub (" + e.message + "). Check your connection and reload.";
    S.cached = false;
  } finally {
    if (my === gen) { S.loading = 0; S.tried = Date.now(); S.cached = false; renderAll(); }
  }
}
const refresh = () => { if (!S.loading) loadRemote(); }; // Refresh in the ⋯ menu: a second press while loading does nothing
// The price chart's file (T-23): loaded the first time a panel opens, and once more for each new latest results entry
// (its date, final and finished_at). Parsed into memory and the text dropped: never saved in this browser.
// CL.state: idle, loading, missing (404), fail (err), auth, bad (err), ok ({stamp, dates, by}); CL.for: the entry it was loaded for
let pgen = 0, CL = {state: "idle"}; // pgen: like hgen; Forget key and a new key bump it, so a load still running lands nowhere
const latestEntry = () => (LATEST ? LATEST.meta : S.meta) || null;
const entryKey = e => e ? JSON.stringify([e.date, e.final, e.finished_at]) : "none";
const latestRows = () => LATEST ? LATEST.rows : S.rows;
function dropCloses() { pgen++; CL = {state: "idle"}; }
async function loadCloses(again) { // again: Try again after a failed load
  const k = entryKey(latestEntry());
  if (!S.key || CL.state === "loading" || !again && CL.state !== "idle" && CL.for === k) return;
  const my = ++pgen, kg = gen; CL = {state: "loading", for: k}; // the old prices belong to another run: dropped now
  let next;
  try {
    const t = await fileText("results/closes.csv", 90);
    if (my !== pgen) return;
    if (t === null) next = {state: "missing"};
    else {
      const stamp = await stampOf(t);
      if (my !== pgen) return;
      try { next = {state: "ok", stamp, ...parseCloses(t)}; } catch (e) { next = {state: "bad", err: e.message}; }
    }
  } catch (e) {
    if (my !== pgen) return;
    next = e instanceof AuthError ? {state: "auth"} : {state: "fail", err: e.message || "no answer"};
    if (e instanceof AuthError && kg === gen) { S.authErr = true; renderBars(); } // only for the key it was sent with
  }
  const cur = latestEntry(); // checked against the results on screen now, not when it was asked for
  next.for = next.stamp && cur && cur.closes_sha256 === next.stamp ? entryKey(cur) : k;
  CL = next; chartChanged();
}
/* LOAD-END */
async function checkFixture(my) {
  try {
    const t = await fileText("tests/fixtures/filter_cases.json");
    if (!t || my !== gen) return;
    const spec = JSON.parse(t), sets = {...PRESETS, custom: spec.custom};
    S.fixtureBad = spec.cases.filter(c => {
      const why = evaluate(c.row, sets[c.preset], spec.data_date);
      return !why.length !== c.pass || (c.reason && !why.includes(c.reason));
    }).length;
    if (S.fixtureBad) renderBars();
  } catch { /* the CSV parity check still runs */ }
}
function loadCache() {
  const c = store.get("cache", null);
  if (!c || !S.key || typeof c.csv !== "string") return;
  S.index = cleanIndex(c.index); S.status = c.status && typeof c.status === "object" && !Array.isArray(c.status) ? c.status : null;
  S.holidays = new Set(Array.isArray(c.holidays) ? c.holidays : []);
  setCurrent(c.csv);
  if (c.cmp && cmpOk(c.cmp.date)) setCompare(c.cmp.csv, c.cmp.date);
  if (typeof c.history === "string") setHistory(c.history);
  S.updated = c.at; S.cached = true;
}
// ------------------------------------------------------------------ run now
let running = false;
async function runNow() {
  if (running) return;
  if (!S.key) { showKey("key"); return; }
  running = true; $("run").disabled = true;
  const st = t => { $("runst").textContent = ""; $("runst").append(...[].concat(t)); };
  const link = (u, t) => el("a", {href: safeUrl(u), target: "_blank", rel: "noopener noreferrer", text: t});
  const sleep = ms => new Promise(f => setTimeout(f, ms));
  const RUNS = "/actions/workflows/screen.yml/runs?event=workflow_dispatch&per_page=10";
  const runIds = async () => { const q = await gh(RUNS, {json: true}); if (!q.ok) throw new Error("runs HTTP " + q.status); return ((await q.json()).workflow_runs || []).map(x => x.id); };
  let id = null, accepted = false;
  try {
    st("Starting…");
    // Remember the runs that already exist, so the new one is found by ID, not by the device clock.
    const before = new Set(await runIds());
    const r = await gh("/actions/workflows/screen.yml/dispatches", {method: "POST", json: true, body: JSON.stringify({ref: "main"})});
    if (!r.ok) throw new Error("dispatch HTTP " + r.status);
    if (r.status === 200) { try { const j = await r.json(); id = j.workflow_run_id || null; } catch { /* no body */ } }
    const T = Date.now();
    accepted = true;
    while (!id && Date.now() - T < 120e3) {
      await sleep(5000);
      try { const fresh = (await runIds()).filter(x => !before.has(x)); if (fresh.length) id = Math.min(...fresh); }
      catch (e) { if (e instanceof AuthError) throw e; /* a hiccup while looking: keep looking until the deadline */ }
    }
    if (!id) { st(["Started, but the run didn't show up: ", link(null, "open Actions")]); return; }
    const runUrl = "https://github.com/" + OWNER + "/" + REPO + "/actions/runs/" + id;
    for (const t0 = Date.now(); ;) {
      if (Date.now() - t0 > 25 * 60e3) { st(["Still running after 25 minutes: ", link(runUrl, "open log")]); return; }
      const q = await gh("/actions/runs/" + id, {json: true});
      if (q.ok) {
        const run = await q.json();
        if (run.status === "completed") {
          if (run.conclusion === "success") st("Done");
          else st(["Failed (", link(run.html_url, "open log"), ")"]);
          await loadRemote(); // show the fresh results
          return;
        }
        st("Running…");
      } else st(["Running… (GitHub HTTP " + q.status + ", retrying) ", link(runUrl, "open log")]);
      await sleep(15000);
    }
  } catch (e) {
    // A 401/403 here usually means the key lacks Actions write; it can still read results, so no global key warning.
    if (e instanceof AuthError) st("Key can't run the screener: give it Actions read and write");
    else if (accepted && !id) st(["Started, but lost track of the run (" + e.message + "): ", link(null, "open Actions")]);
    else if (id) st(["Lost track of the run (" + e.message + "): ", link("https://github.com/" + OWNER + "/" + REPO + "/actions/runs/" + id, "open log")]);
    else st("Run failed to start (" + e.message + "). Try again, or run it from GitHub Actions.");
  } finally { running = false; $("run").disabled = false; }
}

// ------------------------------------------------------------------ stock panel
function openPanel(sym, from, push = true) {
  const first = !P;
  if (first || P.sym !== sym) CH.at = null; // a new panel's readout starts on the last day
  P = {sym, from: from || (P && P.from) || document.activeElement, pushed: first ? push : P.pushed};
  if (first && push) history.pushState(null, "", pageURL()); else history.replaceState(null, "", pageURL());
  $("sp").hidden = $("scrim").hidden = false; document.body.classList.add("lock");
  renderPanel(); $("spx").focus();
}
function closePanel(fromBack) {
  if (!P) return;
  const {sym, from, pushed} = P; P = null; tipClose(); notesFor = null;
  $("sp").hidden = $("scrim").hidden = true; document.body.classList.remove("lock");
  if (!fromBack) { if (pushed) history.back(); else history.replaceState(null, "", pageURL()); }
  const back = from && from.isConnected ? from : [...document.querySelectorAll("[data-sym]")].find(e => e.dataset.sym === sym);
  if (back) back.focus();
}
const md = d => dateLabel(d).replace(/^\w+, /, ""); // "Oct 29"
// ------------------------------------------------------------------ star and My notes
function starBtn(sym) { // ☆ adds the stock to My list, ★ takes it off; never opens the row
  const on = !!(mineOf(sym) || {}).star;
  return el("button", {type: "button", cls: "st" + (on ? " on" : ""), "data-star": sym, text: on ? "★" : "☆",
    "aria-label": (on ? "Remove " + sym + " from" : "Add " + sym + " to") + " My list", onclick: e => { e.stopPropagation(); starTap(sym); }});
}
function starTap(sym, inPanel) {
  reloadMine();
  const e = mineOf(sym), on = !(e && e.star), err = on ? mineErr(MINE, sym) : "", msg = $(inPanel ? "nerr" : "mymsg");
  if (err || !saveMine(mineWith(MINE, sym, {star: on}))) { msg.textContent = err || NOSAVE; return; }
  msg.textContent = ""; render();
  if (!inPanel) ([...document.querySelectorAll("[data-star]")].find(b => b.dataset.star === sym) || $("chips").querySelector("[aria-pressed=true]")).focus();
}
const NIN = {buy: "nbuy", cut: "ncut", target: "ntgt"};
let notesFor = null; // the stock the note boxes were last filled for
function syncNotes(row) {
  const sym = P.sym, e = mineOf(sym), on = !!(e && e.star), sb = $("spstar");
  if (notesFor !== sym) {
    notesFor = sym; $("nerr").textContent = ""; $("nnote").value = e ? e.note : "";
    for (const k in NIN) { const i = $(NIN[k]); i.value = e && e[k] !== null ? String(e[k]) : ""; i.classList.remove("bad"); i.removeAttribute("aria-invalid"); }
  }
  sb.textContent = on ? "★ On My list" : "☆ Add to My list"; sb.classList.toggle("primary", on);
  sb.setAttribute("aria-label", (on ? "Remove " + sym + " from" : "Add " + sym + " to") + " My list");
  $("nat").textContent = e && e.at ? "Saved " + new Date(e.at).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : "";
  const lv = e ? levelLine(e, row && !row.fetch_error ? row.close : null) : ""; $("nlvl").hidden = !lv; $("nlvl").textContent = lv;
}
function saveNotes() {
  const sym = P.sym, row = (S.rows || []).find(r => r.symbol === sym), f = readNotes({note: $("nnote").value, buy: $("nbuy").value, cut: $("ncut").value, target: $("ntgt").value});
  for (const k in NIN) { const i = $(NIN[k]), bad = !!f.bad && f.bad.includes(k); i.classList.toggle("bad", bad); if (bad) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); }
  if (f.bad) { $("nerr").textContent = priceMsg(row && row.close); $(NIN[f.bad[0]]).focus(); return; }
  reloadMine();
  const err = mineErr(MINE, sym);
  if (err || !saveMine(mineWith(MINE, sym, {...f, star: true, at: new Date().toISOString()}))) { $("nerr").textContent = err || NOSAVE; return; }
  notesFor = null; render();
}
function clearNotes() {
  reloadMine();
  if (!saveMine(mineWith(MINE, P.sym, {buy: null, cut: null, target: null, note: "", at: null}))) { $("nerr").textContent = NOSAVE; return; }
  notesFor = null; render();
}
// ------------------------------------------------------------------ the price chart (T-23): its numbers come from the CHART block
// SVG elements take their namespace from the markup's empty svg, so no address sits in the code
const sv = (tag, a = {}) => { const e = document.createElementNS($("svgns").namespaceURI, tag); for (const k in a) if (a[k] !== null) e.setAttribute(k, a[k]); return e; };
const CH = {months: 3, at: null, sig: ""}; // the range holds while the page is open; at: the readout's day; sig: what is drawn
const chartChanged = () => { if (P) drawChart(); };
function drawChart() {
  if (!P) return;
  loadCloses();
  const box = $("spc"), sym = P.sym, phone = matchMedia("(max-width:639px)").matches, W = Math.round(box.clientWidth) || (phone ? 358 : 388), H = phone ? 180 : 190;
  const st = chartState({cl: CL, sym, rows: latestRows(), meta: latestEntry(), end: S.date, months: CH.months}), e = mineOf(sym) || {};
  const sig = JSON.stringify([sym, S.date, CH.months, st.say || CL.stamp, e.buy, e.cut, e.target, W, H, !!S.meta && S.meta.final === false]);
  if (sig === CH.sig) return;
  CH.sig = sig;
  const f = box.contains(document.activeElement) ? document.activeElement.dataset.f : null;
  box.textContent = "";
  const rng = el("div", {cls: "chips rng", role: "group", "aria-label": "Chart range"}, ...[[3, "3M"], [12, "1Y"]].map(([m, t]) =>
    el("button", {type: "button", "data-f": t, "aria-pressed": String(CH.months === m), text: t, onclick: () => { CH.months = m; drawChart(); }})));
  box.append(el("div", {cls: "chh"}, el("h3", {text: LATEST ? "Price to " + dateLabel(S.date) : "Price"}), rng));
  if (!st.draw) {
    box.append(el("div", {cls: "chs", role: "status", style: "height:" + H + "px"}, el("span", {text: st.say}),
      st.retry ? el("button", {type: "button", "data-f": "again", text: "Try again", onclick: () => { loadCloses(true); drawChart(); }}) : null));
  } else {
    const d = st.draw, m = chartModel(d, e, CH.months, W, H, price), svg = sv("svg", {viewBox: "0 0 " + W + " " + H, width: "100%", height: H, "aria-hidden": "true"});
    for (const t of m.ticks) svg.append(sv("line", {class: "gr", x1: 0, x2: W - m.R, y1: t.y, y2: t.y}), Object.assign(sv("text", {class: "tk", x: W - m.R + 6, y: t.y + 4}), {textContent: t.t}));
    for (const t of m.mon) svg.append(Object.assign(sv("text", {class: "tk", x: t.x, y: H - 4, "text-anchor": "middle"}), {textContent: t.t}));
    for (const [p, c] of [[m.p200, "a2"], [m.p50, "a5"], [m.close, "cl"]]) if (p) svg.append(sv("path", {class: c, d: p}));
    for (const l of m.lv) {
      svg.append(sv("line", {class: "lv " + l.cls, x1: l.far ? W - m.R - 34 : 0, x2: W - m.R, y1: l.y, y2: l.y}));
      const ty = l.far === "down" ? l.y - 4 : l.far === "up" ? l.y + 12 : l.y > m.T + 14 ? l.y - 4 : l.y + 13;
      svg.append(Object.assign(sv("text", {class: "tk " + l.cls, x: l.far ? W - m.R - 38 : 4, y: ty, "text-anchor": l.far ? "end" : "start"}), {textContent: l.label}));
    }
    const hair = sv("line", {class: "hx", y1: m.T, y2: H - m.B}), dot = sv("circle", {class: "dot", r: 3.5});
    svg.append(hair, dot);
    const out = el("div", {cls: "small cro", "aria-live": "polite"});
    const plot = el("div", {cls: "chp", role: "slider", tabindex: 0, "data-f": "plot", "aria-label": "Price chart, closing prices. Arrow keys move day by day",
      "aria-valuemin": 1, "aria-valuemax": m.n}, svg);
    const was = m.idx.indexOf(d.dates.indexOf(CH.at)); let k = was < 0 ? m.n - 1 : was; // the readout keeps its day when it is in view
    const show = j => {
      k = Math.min(m.n - 1, Math.max(0, j)); const i = m.idx[k], x = m.X(k), y = d.v[i] === null ? null : m.Y(d.v[i]);
      CH.at = d.dates[i]; hair.setAttribute("x1", x); hair.setAttribute("x2", x);
      dot.setAttribute("cx", x); dot.setAttribute("cy", y === null ? -9 : y);
      out.textContent = readout(d, m, i, price, dateLabel);
      plot.setAttribute("aria-valuenow", k + 1); plot.setAttribute("aria-valuetext", out.textContent);
    };
    const at = ev => { const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width; show(Math.round((px - m.X(0)) / ((m.X(m.n - 1) - m.X(0)) / (m.n - 1)))); };
    plot.addEventListener("pointerdown", at); plot.addEventListener("pointermove", at);
    plot.addEventListener("keydown", ev => {
      const j = stepKey(ev.key, k, m.n);
      if (j !== undefined) { ev.preventDefault(); show(j); }
    });
    const key = (c, t, miss) => el("span", {cls: miss ? "off" : null}, el("i", {cls: "k " + c}), t + (miss ? " " + miss : ""));
    box.append(plot, out, el("div", {cls: "legend"}, key("cl", "Close"), key("a5", "50-day", m.miss50), key("a2", "200-day", m.miss200), m.lv.length ? key("lv", "My levels") : null),
      el("div", {cls: "small chsum", text: m.sum + (S.meta && S.meta.final === false ? " The last price is provisional." : "")}),
      el("div", {cls: "note", style: "margin-top:2px", text: "Prices as traded: a stock dividend or split shows as a sudden fall."}));
    show(k);
  }
  const back = f && box.querySelector('[data-f="' + f + '"]'); if (back) back.focus();
}
function renderPanel() {
  if (!P) return;
  const sym = P.sym, row = (S.rows || []).find(r => r.symbol === sym), b = $("spb"), add = (...k) => b.append(...k);
  const ok = row && !row.fetch_error, on = p => ok && !failures(row, PRESETS[p], S.date).length;
  const had = b.contains(document.activeElement); // the star and note boxes are kept: typing survives a redraw
  $("sps").textContent = sym; $("spn").textContent = [row && row.name, row && okPrice(row.close) && "₱" + price(row.close) + " close"].filter(Boolean).join(" · "); b.textContent = "";
  syncNotes(row); drawChart();
  const W = dayWords(LATEST ? dateLabel(S.date) : null), hs = H.state === "ok" && H.by.get(sym), cs = S.cmpRows && S.cmpRows.some(r => r.symbol === sym) ? S.cmpDate : null;
  const seen = [hs ? [...hs.keys()].pop() : null, cs].filter(Boolean).sort().pop();
  add(el("div", {cls: "status"}, !row ? W.notIn + (seen ? ", last seen " + dateLabel(seen) : "")
    : !ok ? W.notScanned + " (" + row.fetch_error + ")"
    : on("strict") ? (on("loose") ? "On Strict and Loose" : "On Strict") : on("loose") ? "On Loose" : "On neither",
  ...(row && row.pass_strict && row.pass_loose ? [el("span", {cls: "badge both", text: "BOTH"}), tipBtn("BOTH")] : []), el("span", {cls: "small muted", text: " · " + dateLabel(S.date)})));
  if (ok && !(on("strict") && on("loose"))) {
    add(el("h3", {text: W.fails}));
    for (const p in PRESETS) if (!on(p)) add(el("b", {cls: "small", text: NAME[p]}),
      el("ul", {cls: "fail why small"}, ...[...new Set(failures(row, PRESETS[p], S.date).map(f => nice(f, row, PRESETS[p], S.date)))].map(t => el("li", {text: t}))));
  }
  add(el("h3", {text: "Strength"}));
  if (H.state !== "ok") add(el("div", {cls: "status" + (H.state === "broken" ? " why" : "")}, H.state === "loading" ? "Loading history…"
    : H.state === "missing" ? "History starts after the next run." : "History file can't be read (" + H.err + ")." + (S.rows ? " Today's results still work." : "")));
  else {
    const i = tracks().m.get(sym) || info(sym, row || null), g = el("div", {cls: "grid"}, el("div"), el("div", {cls: "h", text: "Strict"}), el("div", {cls: "h", text: "Loose"}));
    const line = (t, f) => g.append(el("div", {text: t}), ...["strict", "loose"].map(p => el("div", null, f(i[p]))));
    line("Days on list", k => el("b", {text: k.days}));
    line("Last 20 sessions", k => k.last20 + " of 20");
    line("Joined this time", k => !k.join ? "—" : k.days ? md(k.join) : "Last in " + md(k.join));
    line("Since it joined this time", k => k.chg === null ? "—" : el("span", {cls: k.chg > 0 ? "up" : k.chg < 0 ? "down" : null, text: spct(k.chg * 100)}));
    add(g, el("h3", {text: "Last " + Math.min(60, i.t.length) + " sessions"}), ...strip(i.t),
      el("div", {cls: "legend"}, ...[["p", "S line lit: on Strict"], ["p l", "L line lit: on Loose"], ["m", "Missed by one rule (data gaps not counted)"], ["n", "Neither"], ["o", "No record"]]
        .map(([c, t]) => el("span", null, el("i", {cls: "c " + c, style: c === "p l" ? "background:var(--accent2)" : null}), t))),
      el("div", {cls: "note", text: "Both lines lit: on both that day. Data gaps (no trade, short history, no market cap) never count as a miss."}));
  }
  if (ok) {
    add(el("h3", {text: W.today}));
    const dl = el("dl"); for (const c of COLS) if (c.f && c.k !== "days") dl.append(el("dt", {text: W.col(c.t)}), el("dd", {cls: c.c && row[c.k] ? (row[c.k] > 0 ? "up" : "down") : null, text: c.f(row)}));
    add(dl);
  }
  const nreb = H.state === "ok" ? H.dates.filter(d => d < S.date && H.src[d] === "rebuilt").length : 0;
  if (nreb) add(el("div", {cls: "note", text: "Includes " + nreb + " rebuilt session" + (nreb === 1 ? "" : "s") + " (market caps and the stock list as of the backfill)."}));
  if (had) $("spx").focus();
}
// The last 60 sessions: blocks of 30, an S line over an L line; one slider control
function strip(t) {
  const cols = t.slice(-60), n = cols.length, nb = Math.ceil(n / 30), pad = nb * 30 - n, cells = [];
  const box = el("div", {cls: "strip", role: "slider", tabindex: 0, "aria-label": "Sessions", "aria-valuemin": 1, "aria-valuemax": n});
  const day = el("div", {cls: "small", "aria-live": "polite", style: "margin-top:2px"});
  const kind = i => i < 0 ? "pad" : cols[i].via === "rebuilt" ? "rebuilt" : "live";
  for (let b = 0; b < nb; b++) {
    const lo = b * 30 - pad;
    for (const p of ["strict", "loose"]) {
      box.append(el("div", {cls: "lbl"}, p === "strict" ? md(cols[Math.max(0, lo)].d) + " " : null, el("b", {text: p[0].toUpperCase()})));
      const ln = el("div", {cls: "ln " + p[0]});
      for (let i = lo; i < lo + 30; i++) {
        const x = cols[i], c = el("i", {cls: x ? "c " + x[p] + (x.via === "rebuilt" ? " reb" : "") : "c"});
        ln.append(c); if (x) (cells[i] = cells[i] || []).push(c);
      }
      box.append(ln);
    }
    const sp = el("div", {cls: "span"});
    for (let i = lo, j; i < lo + 30; i = j) {
      for (j = i; j < lo + 30 && kind(j) === kind(i); j++);
      sp.append(el("i", {cls: kind(i), style: "flex:" + (j - i), text: kind(i) === "pad" || j - i < 4 ? "" : kind(i)}));
    }
    box.append(el("div"), sp);
  }
  let sel = n - 1;
  const word = (x, p) => x[p] === "p" ? "on " + NAME[p] : x[p] === "m" ? "missed " + NAME[p] + " by one rule (" + (RULE_NAME[x[p === "strict" ? "rs" : "rl"]] || "") + ")" : "not on " + NAME[p];
  const show = i => {
    for (const c of cells[sel]) c.classList.remove("sel");
    sel = Math.min(n - 1, Math.max(0, i)); for (const c of cells[sel]) c.classList.add("sel");
    const x = cols[sel], what = x.strict === "o" ? "no record" : x.strict === "p" && x.loose === "p" ? "On Strict and Loose"
      : (word(x, "strict") + ", " + word(x, "loose")).replace(/^./, c => c.toUpperCase());
    day.textContent = dateLabel(x.d) + " · " + what + (x.strict === "o" ? "" : " · " + (x.via === "today" ? (S.meta && S.meta.final === false ? "provisional" : "live") : x.via));
    box.setAttribute("aria-valuenow", sel + 1); box.setAttribute("aria-valuetext", day.textContent);
  };
  const pick = e => {
    const lines = [...box.querySelectorAll(".ln")], k = lines.findIndex(l => { const r = l.getBoundingClientRect(); return e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6; });
    if (k < 0) return;
    const r = lines[k].getBoundingClientRect(), c = Math.min(29, Math.max(0, Math.floor((e.clientX - r.left) / r.width * 30)));
    show(Math.max(0, (k >> 1) * 30 - pad + c));
  };
  box.addEventListener("pointerdown", pick);
  box.addEventListener("pointermove", e => { if (e.buttons) pick(e); });
  box.addEventListener("keydown", e => {
    const k = {ArrowLeft: sel - 1, ArrowDown: sel - 1, ArrowRight: sel + 1, ArrowUp: sel + 1, Home: 0, End: n - 1}[e.key];
    if (k !== undefined) { e.preventDefault(); show(k); }
  });
  show(sel);
  return [box, day];
}

// ------------------------------------------------------------------ key panel, phone panels and the ? bubbles
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// mode: false (closed), "key" (a new key or a renewal: the four steps) or "date" (Add date: the date only)
function showKey(mode) {
  const date = mode === "date"; if (!mode) refocus($("keyp")); $("keyp").hidden = !mode; $("keybtn").setAttribute("aria-expanded", String(!!mode)); $("kerr").textContent = "";
  if (!mode) return;
  $("keyh").textContent = date ? "Add your key's end date" : S.key ? "Renew your key" : "Connect your private results";
  $("keylab").textContent = S.key ? "New key" : "Key"; $("keyt").hidden = !!S.key || date; $("keyfind").hidden = !date;
  $("steps").hidden = $("kbox").hidden = $("keysave").hidden = date; $("datesave").hidden = !date;
  $("keyforget").hidden = date || !S.key; $("keyx").hidden = !S.key;
  $("kdate").value = dateField(mode);
  $("keyp").scrollIntoView({block: "nearest"}); (date ? $("kdate") : $("keyin")).focus();
}
// A closing panel hands focus back to Key (desktop) or ⋯ (phone)
const refocus = p => { if (p.contains(document.activeElement)) ($("keybtn").offsetParent ? $("keybtn") : $("more")).focus(); };
function showHome(open) {
  if (!open) refocus($("homep"));
  $("homep").hidden = !open;
  if (!open) return;
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), android = /Android/.test(ua), ol = $("homesteps"), b = t => el("b", {text: t});
  ol.textContent = "";
  if (ios || !android) ol.append(el("li", null, ios ? "" : "iPhone: ", "Tap ", b("Share"), " at the bottom of Safari."), el("li", null, "Tap ", b("Add to Home Screen"), ", then ", b("Add"), "."));
  if (android || !ios) ol.append(el("li", null, ios || android ? "" : "Android: ", "Tap ", b("⋮"), " in Chrome, then ", b("Add to home screen"), " (or ", b("Install app"), ")."));
  $("homep").scrollIntoView({block: "nearest"}); $("homex").focus();
}

function showWords(open) {
  if (!open && $("words").contains(document.activeElement)) $("wordsgo").focus();
  $("words").hidden = !open;
  if (!open) return;
  const dl = $("wordsl"); dl.textContent = "";
  for (const k in TIPS) dl.append(el("dt", {text: k[0].toUpperCase() + k.slice(1)}), el("dd", {text: TIPS[k]}));
  $("words").scrollIntoView({block: "start"}); $("wordsx").focus();
}
let tipOn = null, tipPinned = false, tipAt = 0;
// A ? button for a TIPS label: hover (where hover exists) or focus shows the bubble, a tap or click pins it
function tipBtn(label, b = el("button")) {
  b.type = "button"; b.className = "q"; b.textContent = "?"; b.setAttribute("aria-label", "What is " + label + "?"); b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", e => {
    e.stopPropagation();
    if (tipOn === b && tipPinned) tipClose(); else { tipOpen(b, label, true); $(b.closest("#sp") ? "spsr" : "tipsr").textContent = label + ": " + TIPS[label]; } // a modal panel hides the page's live region
  });
  if (matchMedia("(hover: hover)").matches) { b.addEventListener("mouseenter", () => tipOn === b || tipOpen(b, label)); b.addEventListener("mouseleave", () => tipPinned || tipClose()); }
  b.addEventListener("focus", () => tipPinned || tipOpen(b, label));
  b.addEventListener("blur", () => tipPinned || tipClose());
  return b;
}
function tipOpen(b, label, pin) {
  if (tipOn && tipOn !== b) tipClose();
  const t = $("tip"); t.textContent = ""; t.append(el("b", {text: label[0].toUpperCase() + label.slice(1)}), TIPS[label] || "");
  // tipAt: a scroll that focusing the ? itself caused doesn't close the bubble
  t.hidden = false; tipOn = b; tipPinned = !!pin; tipAt = Date.now(); tipBox = (b.closest("[id]") || {}).id; tipPlace();
}
let tipBox = null; // the id of the box holding the open ?, to find it again after a redraw
function tipPlace() {
  const t = $("tip"), b = tipOn; b.setAttribute("aria-expanded", "true"); b.setAttribute("aria-describedby", "tip");
  const r = b.getBoundingClientRect(), w = t.offsetWidth, vw = document.documentElement.clientWidth; // kept on screen, outside any scroll box
  t.style.top = r.bottom + scrollY + 8 + "px"; t.style.left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2)) + scrollX + "px";
}
// Its ? was redrawn: a pinned bubble moves to the new ? of the same name in the same box, any other closes
const tipGone = () => {
  if (!tipOn || tipOn.isConnected) return;
  const box = tipPinned && tipBox && $(tipBox), nb = box && [...box.querySelectorAll(".q")].find(q => q.getAttribute("aria-label") === tipOn.getAttribute("aria-label"));
  if (nb) { tipOn = nb; tipPlace(); } else tipClose();
};
function tipClose() {
  if (!tipOn) return;
  tipOn.setAttribute("aria-expanded", "false"); tipOn.removeAttribute("aria-describedby"); tipOn = null; tipPinned = false; $("tip").hidden = true;
}

// ------------------------------------------------------------------ wire up
function init() {
  S.want = new URLSearchParams(location.search).get("s");
  const s = settingsFromURL();
  if (s && s.set && (s.preset === "custom" || PRESETS[s.preset])) { S.preset = s.preset; S.set = {...STRICT, ...s.set}; }
  if (S.preset !== "custom") S.set = {...PRESETS[S.preset]};
  // Reselect the last saved set only if the URL still holds the settings it was last seen with (a shared link may not).
  const last = store.get("settings", null), sc = last && typeof last.screen === "string" && S.screens.find(o => o.name === last.screen);
  const lastSet = last && cleanSet(last.set);
  if (sc && S.preset === "custom" && lastSet && sameSet(S.set, lastSet)) { S.screen = sc.name; S.dirty = !sameSet(S.set, sc.set); }
  buildControls(); syncControls(); syncPanel(); settingsToURL();
  $("q").addEventListener("input", e => { S.q = e.target.value; if (S.rows) render(); });
  $("run").addEventListener("click", runNow);
  // A hand-picked comparison on the latest day is also the saved copy's, so a later failed compare file keeps this one (T-28)
  const keepCmp = cmp => { const c = !LATEST && store.get("cache", null); if (c) saveCache({...c, cmp}); };
  let cgen = 0; // each Compare with… choice bumps it, so an older, slower file never lands over a newer choice
  $("cmp").addEventListener("change", async e => {
    const v = e.target.value, my = dgen, mine = ++cgen, kg = gen; // a day picked meanwhile wins
    if (S.dayMsg && S.dayMsg.nocmp) S.dayMsg = null; // a comparison picked by hand replaces "without a comparison"
    if (!v) { setCompare(null); keepCmp(null); renderAll(); return; }
    try { const t = await fileText("results/" + v + ".csv"); if (my !== dgen || mine !== cgen) return; setCompare(t, v); keepCmp(t ? {date: v, csv: t} : null); }
    catch (err) { if (my !== dgen || mine !== cgen) return; if (err instanceof AuthError && kg === gen) S.authErr = true; setCompare(null); }
    renderAll();
  });
  const days = $("days"), setDays = open => {
    days.hidden = !open; DB.setAttribute("aria-expanded", String(open)); days.textContent = "";
    if (!open) return;
    for (const x of dayList(S.index, latestDate())) days.append(el("button", {type: "button", role: "menuitem", "aria-current": x.date === S.date ? "true" : null,
      text: dayText(x, dateLabel), onclick: () => { setDays(false); DB.focus(); pickDay(x.date).then(() => scrollTo(0, 0)); }})); // the bar and summary in view
    (days.querySelector("[aria-current]") || days.firstChild).focus();
  };
  DB.addEventListener("click", () => setDays(days.hidden));
  days.addEventListener("keydown", e => {
    const it = [...days.children], i = it.indexOf(document.activeElement), k = {ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: it.length - 1}[e.key];
    if (k !== undefined) { e.preventDefault(); it[(k + it.length) % it.length].focus(); }
    else if (e.key === "Escape") { e.stopPropagation(); setDays(false); DB.focus(); } else if (e.key === "Tab") setDays(false);
  });
  document.addEventListener("pointerdown", e => {
    if (!days.hidden && !days.contains(e.target) && !DB.contains(e.target)) setDays(false);
    if (tipPinned && !$("tip").contains(e.target) && !e.target.closest(".q")) tipClose(); // iPhone sends no click for plain background
  });
  $("spstar").addEventListener("click", () => starTap(P.sym, true));
  $("nsave").addEventListener("click", saveNotes);
  $("nclear").addEventListener("click", clearNotes);
  for (const id of ["nbuy", "ncut", "ntgt", "nnote"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") saveNotes(); });
  $("keybtn").addEventListener("click", () => showKey($("keyp").hidden && "key"));
  $("keysave").addEventListener("click", saveKey);
  $("datesave").addEventListener("click", saveDate);
  $("keyforget").addEventListener("click", forgetKey);
  $("keyx").addEventListener("click", () => showKey(false));
  $("homex").addEventListener("click", () => showHome(false));
  $("wordsgo").addEventListener("click", e => { e.preventDefault(); showWords(true); });
  $("wordsx").addEventListener("click", () => showWords(false));
  for (const b of document.querySelectorAll("[data-tip]")) tipBtn(b.dataset.tip, b);
  document.addEventListener("click", e => { if (tipOn && !$("tip").contains(e.target)) tipClose(); });
  let sy = scrollY; // a vertical page scroll closes the bubble; scrolling inside a box does not
  addEventListener("scroll", () => { if (tipOn && Math.abs(scrollY - sy) > 2 && Date.now() - tipAt > 300) tipClose(); sy = scrollY; }, {passive: true});
  document.addEventListener("scroll", e => { if (tipOn && e.target !== document && e.target.contains(tipOn)) tipPlace(); }, {capture: true, passive: true}); // its own box scrolled: follow the ?
  $("homeitem").hidden = standalone();
  const GO = {keybtn: () => showKey($("keyp").hidden && "key"), homego: () => showHome(true), refresh};
  const more = $("more"), menu = $("menu"), items = [...menu.children].filter(b => !b.hidden);
  const setMenu = o => { menu.hidden = !o; more.setAttribute("aria-expanded", String(o)); if (o) items[0].focus(); };
  more.addEventListener("click", () => setMenu(menu.hidden));
  for (const b of items) b.addEventListener("click", () => { setMenu(false); GO[b.dataset.go](); });
  menu.addEventListener("keydown", e => {
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
    else if (e.key === "Escape") { setMenu(false); more.focus(); }
  });
  let eat = 0; // an outside tap only closes the menu
  document.addEventListener("pointerdown", e => { if (!menu.hidden && !more.contains(e.target) && !menu.contains(e.target)) { eat = e.timeStamp; setMenu(false); } }, true);
  document.addEventListener("click", e => { if (eat && e.timeStamp - eat < 1000) { e.stopPropagation(); e.preventDefault(); } eat = 0; }, true);
  menu.addEventListener("focusout", e => { if (!menu.contains(e.relatedTarget) && e.relatedTarget !== more && e.relatedTarget) setMenu(false); });
  $("spx").addEventListener("click", () => closePanel());
  $("scrim").addEventListener("click", () => closePanel());
  $("sp").addEventListener("keydown", e => { // Esc closes; Tab stays inside
    if (e.key !== "Tab") return;
    const f = [...$("sp").querySelectorAll("button,input,[tabindex='0'],a[href]")], i = f.indexOf(document.activeElement);
    if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
  });
  window.addEventListener("resize", chartChanged); // a phone turned: the chart takes the new width
  window.addEventListener("popstate", () => { const s = new URLSearchParams(location.search).get("s"); if (!s) closePanel(true); else if (!P) openPanel(s, null, false); });
  document.addEventListener("keydown", e => {
    if (P) { if (e.key === "Escape") { e.preventDefault(); closePanel(); } return; }
    if (e.key === "Escape") { if (tipOn) { const b = tipOn; b.focus(); tipClose(); } else if (!$("words").hidden) showWords(false); else if (!$("homep").hidden) showHome(false); }
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (e.key === "/") { e.preventDefault(); $("q").focus(); }
    else if (e.key === "r" && confirm("Run the screener now?")) runNow();
  });
  const hdr = document.querySelector("header");
  new ResizeObserver(() => document.documentElement.style.setProperty("--hh", hdr.offsetHeight + "px")).observe(hdr);
  // The 4:50pm and midnight edges in a tab left open: before the missed-run line turns on, reload, since the backup may have run since
  const recheck = () => {
    if (document.hidden) return;
    if (shouldRefresh(S, Date.now(), document.hidden) || showMissed(S) && !S.missed && S.key) loadRemote(); else renderBars();
  };
  document.addEventListener("visibilitychange", recheck);
  setInterval(() => { if (!document.hidden && showMissed(S) !== S.missed) recheck(); }, 60e3);
  loadCache();
  if (!S.key && !S.rows) showKey("key");
  renderAll();
  loadRemote();
}
init();
