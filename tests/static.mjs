// Static guards for the public repo: size, CSP, no unsafe DOM writes, no external loads, no secrets or data.
// Runs in CI (no private files needed): node tests/static.mjs   Refusal tests: node tests/guards.mjs
// Run locally (GITHUB_ACTIONS unset), it also switches the before-push check on: it may write one file,
// .git/hooks/pre-push.local (and .git/hooks/pre-push only when none exists), and says so. Importing it writes nothing.
//
// scan(files) -> [{code, path, line, msg}], files = [{path, bytes}] (bytes a Buffer). Every message starts with a stable
// code and gives path:line, never the matched text (CI logs are public). Codes:
//   ALLOWLIST  a file not on the public list            SIZE        index.html over 40 KB, app.js over 160 KB
//   EXT-LOAD   a script, stylesheet or resource load    LINK-TAGS   the three exact <link> tags, once each
//   HOSTS      a host other than (api.)github.com       CSP         the one exact policy, before the one script tag
//   SCRIPT-TAG index.html's one script tag = the one built from app.js (node tests/stamp.mjs); the boot line and its CSS
//   INLINE-CODE an event-handler attribute (on...=) in index.html
//   MANIFEST   manifest.webmanifest keys and values     ICON        icon.png: 512 x 512, under 20,000 bytes, = tests/icon.mjs
//   PNG-CHUNKS a PNG with other chunks or extra bytes   WIREFRAME   docs/wireframe.png changed (pinned by sha256)
//   RESULTS-SHAPED results CSV text                     TOKEN       a GitHub token shape
//   ROWS       a stock row anywhere in a line           DEMO-ROWS   tests/demo.mjs: CSV-looking lines, symbols, numbers by DEMO
//   KEY-USE    the key used as a value, stored or sent outside its places, or a navigation call (app.js)
//   DEMO-WRITE tests/demo.mjs writes a file             DEMO-READ   tests/demo.mjs reads other than its four files
//   DEMO-LISTEN tests/demo.mjs listens beyond 127.0.0.1 PAGE-DEMO   index.html or app.js: "demo", serviceWorker, caches.
//   KEY-BLOCK  the key's end date outside its block, a request inside it, the key in the address, Forget key
//   UNSAFE-DOM innerHTML, eval, script URLs, a script element made in code, import(), workers
// The page is two files: index.html (markup and styles) and app.js (all code); every page rule reads both.
// The command line prints each finding as "CODE path:line what: fix (see README.md#code)".
import {readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdirSync, accessSync, constants, realpathSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {join, dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {iconBytes} from "./icon.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// True when the module at url is the script node was started with, through any symlink (a folder reached through a
// link must not make a check skip itself and exit 0)
export const isMain = url => { try { return realpathSync(fileURLToPath(url)) === realpathSync(process.argv[1]); } catch { return false; } };
export const CSP = "default-src 'self'; connect-src https://api.github.com; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'";
export const LINKS = ['<link rel="manifest" href="manifest.webmanifest">', '<link rel="apple-touch-icon" href="icon.png">', '<link rel="icon" href="icon.png">'];
const ALLOW = /^(index\.html|app\.js|README\.md|CLAUDE\.md|\.gitignore|manifest\.webmanifest|icon\.png|docs\/wireframe\.png|tests\/[a-z]+\.mjs|\.github\/workflows\/[a-z-]+\.yml)$/;
const WIREFRAME_SHA256 = "f48b46465d5982f255f067c8297fba7ae11ba22efb522f36f40a00a4e428dead"; // origin/main 0339337
const MANIFEST = {name: "PSE Screener", short_name: "PSE Screener", start_url: "./", scope: "./", display: "standalone",
  background_color: "#16191f", theme_color: "#16191f", icons: [{src: "icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable"}]};
const PNG_SIG = "89504e470d0a1a0a", PNG_OK = new Set(["IHDR", "PLTE", "IDAT", "IEND", "sRGB", "gAMA", "pHYs"]);
const RESULTS = /^symbol,name,data_date,|pass_strict,pass_loose/m, TOKEN = /github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}/;
const ROW_START = /^\s*["']?[A-Z][A-Z0-9]{1,4}["']?,/;
// A row anywhere in a line (plan § 4.1): cells split on , tab ; |, each cut to its last piece, so "close":12.5 gives 12.5
const SYM = /^[A-Z][A-Z0-9]{0,4}$/, ISO = /^\d{4}-\d{2}-\d{2}$/, NUM = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;
export const MADE_UP = /^(DEMO[A-Z][0-9]?|ZZ[A-Z]|SYN)$/; // symbols tests may use: no PSE symbol has these shapes
const cellsOf = l => l.split(/[,\t;|]/).map(c => c.split(/[\s"'`=:;()[\]{}]+/).filter(Boolean).pop() || "");
const nearRow = (cells, i, dateIn, numsIn) => cells.slice(i + 1, i + 1 + dateIn).some(c => ISO.test(c)) && cells.slice(i + 1, i + 1 + numsIn).filter(c => NUM.test(c)).length >= 3;
export function rowAt(l) {
  const cells = cellsOf(l);
  if (cells.some((c, i) => SYM.test(c) && !MADE_UP.test(c) && nearRow(cells, i, 12, 12))) return true;
  const toks = l.split(/[\s,;|]+/).map(t => t.split(/["'`=:()[\]{}]+/).filter(Boolean).pop() || "").filter(Boolean); // space-separated rows (3b)
  return toks.some((t, i) => (/^[A-Z][A-Z0-9]{1,4}$/.test(t) || i === 0 && SYM.test(t)) && !MADE_UP.test(t) && nearRow(toks, i, 6, 12));
}
const ROW_FIX = "if this is not price data, drop the date or move the numbers off the line; made-up symbols: DEMO…, ZZ…, SYN";
const DEMO_OK = new Set(["GET", "POST", "PUT", "OK", "UTC", "PSE", "CSV", "PNG"]);
const UNSAFE = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|srcdoc|setAttribute\(\s*["'`]on|javascript:|set(Timeout|Interval)\(\s*["'`]|\.src\s*=|createElement(NS)?\s*\([^)]*["'`]script["'`]|["'`]\s*script\s*["'`]|\bimport\s*\(|new\s+(Shared)?Worker\b|importScripts/i;
// The one way code reaches the page: this tag, built from the tracked app.js bytes (node tests/stamp.mjs writes it)
export function scriptTag(js) {
  const h = createHash("sha384").update(js);
  const d = h.digest();
  return '<script src="app.js?v=' + d.toString("hex").slice(0, 16) + '" integrity="sha384-' + d.toString("base64") + '"></script>';
}
export const TAG_SHAPE = /^<script src="app\.js\?v=[0-9a-f]*" integrity="sha384-[A-Za-z0-9+/=]*"><\/script>$/;
// What a phone shows when page and code don't match (D-DSR-6); app.js removes it as its first statement
export const BOOT = '<p id="boot" class="boot" role="status">Couldn\'t start the page. You may be offline, or a new version just came out: <a href="./?r=1">Reload</a>. If this stays, try again in 10 minutes.</p>';
export const BOOT_CSS = [".boot{visibility:hidden;animation:boot 0s 4s forwards}", "@keyframes boot{to{visibility:visible}}"];
export const BOOT_JS = '"use strict";\ndocument.getElementById("boot")?.remove();';
// tests/demo.mjs may read only these four files, through this one line and this one call
const DEMO_FS = 'import {readFileSync} from "node:fs";';
const DEMO_MAP = 'const READ = Object.freeze({"/": "index.html", "/app.js": "app.js", "/manifest.webmanifest": "manifest.webmanifest", "/icon.png": "icon.png"});';
const DEMO_CALL = "readFileSync(join(ROOT, READ[p]))", DEMO_MODULES = ["node:fs", "node:http", "node:path", "node:url"];

const finder = () => {
  const out = [];
  const fail = (code, path, line, msg, fix) => out.push(fix ? {code, path, line, msg, fix} : {code, path, line, msg});
  return {out, fail};
};
const lineOf = (text, i) => i < 0 ? 1 : text.slice(0, i).split("\n").length;
const each = (text, re, f) => text.split("\n").forEach((l, i) => { if (re.test(l)) f(i + 1); });

// The leak checks, run on any set of files (the whole tree here and in CI; each pushed commit's changed files in
// tests/prepush.mjs): file names, tokens, results text, rows, pictures. Nothing here needs the rest of the tree.
export function leaks(files) {
  const {out, fail} = finder();
  for (const {path, bytes} of files) {
    if (!ALLOW.test(path)) fail("ALLOWLIST", path, 1, "file not on the public allowlist");
    if (/\.png$/i.test(path)) { png(path, bytes, fail); continue; }
    if (/\.(jpe?g|gif|webp)$/i.test(path)) continue; // refused by the allowlist above
    const t = bytes.toString("utf8");
    if (path !== "tests/static.mjs") each(t, RESULTS, n => fail("RESULTS-SHAPED", path, n, "results-shaped data"));
    each(t, TOKEN, n => fail("TOKEN", path, n, "token-like string"));
    if (path === "tests/demo.mjs") demoRows(t, fail);
    else t.split("\n").forEach((l, i) => {
      if (ROW_START.test(l)) fail("ROWS", path, i + 1, "line starts like a stock row (symbol, then a comma)", ROW_FIX);
      else if (rowAt(l)) fail("ROWS", path, i + 1, "looks like a price row (symbol, date, numbers)", ROW_FIX);
    });
  }
  const icon = files.find(f => f.path === "icon.png");
  if (icon) {
    const b = icon.bytes;
    if (b.length >= 20000) fail("ICON", "icon.png", 1, "icon.png is " + b.length + " bytes (limit 19,999)");
    if (b.toString("hex", 0, 8) !== PNG_SIG || b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR" ||
      b.readUInt32BE(16) !== 512 || b.readUInt32BE(20) !== 512) fail("ICON", "icon.png", 1, "icon.png must be a 512 x 512 PNG");
    if (!b.equals(iconBytes())) fail("ICON", "icon.png", 1, "icon.png differs from what node tests/icon.mjs writes", "run node tests/icon.mjs");
  }
  const wf = files.find(f => f.path === "docs/wireframe.png");
  if (wf && createHash("sha256").update(wf.bytes).digest("hex") !== WIREFRAME_SHA256) fail("WIREFRAME", "docs/wireframe.png", 1, "docs/wireframe.png changed (pinned sha256)", "git checkout origin/main -- docs/wireframe.png");
  return out;
}
// A commit or tag message: tokens, results text and rows (path "message", line within it)
export function textLeaks(text) {
  const {out, fail} = finder();
  each(text, RESULTS, n => fail("RESULTS-SHAPED", "message", n, "results-shaped data"));
  each(text, TOKEN, n => fail("TOKEN", "message", n, "token-like string"));
  text.split("\n").forEach((l, i) => { if (ROW_START.test(l) || rowAt(l)) fail("ROWS", "message", i + 1, "looks like a price row"); });
  return out;
}

// Every check on a whole tree: the leak checks, then the page, the test server, the manifest and the icon
export function scan(files) {
  const out = leaks(files), fail = (code, path, line, msg, fix) => out.push(fix ? {code, path, line, msg, fix} : {code, path, line, msg});
  const byPath = new Map(files.map(f => [f.path, f.bytes]));
  const dm = byPath.get("tests/demo.mjs"); if (dm) demo(dm.toString("utf8"), fail);
  const html = byPath.get("index.html"), js = byPath.get("app.js");
  if (!html) fail("ALLOWLIST", "index.html", 1, "index.html missing", "restore it: git checkout origin/main -- index.html");
  if (!js) fail("ALLOWLIST", "app.js", 1, "app.js missing", "restore it: git checkout origin/main -- app.js");
  if (html || js) page(html ? html.toString("utf8") : "", js || null, fail, lineOf);
  const mf = byPath.get("manifest.webmanifest");
  if (!mf) fail("MANIFEST", "manifest.webmanifest", 1, "manifest.webmanifest missing");
  else manifest(mf.toString("utf8"), fail);
  if (!byPath.has("icon.png")) fail("ICON", "icon.png", 1, "icon.png missing", "run node tests/icon.mjs");
  return out;
}

function png(path, b, fail) {
  if (b.toString("hex", 0, 8) !== PNG_SIG) { fail("PNG-CHUNKS", path, 1, "not a PNG"); return; }
  let o = 8, end = false;
  while (o + 8 <= b.length) {
    const len = b.readUInt32BE(o), type = b.toString("latin1", o + 4, o + 8);
    if (!PNG_OK.has(type)) fail("PNG-CHUNKS", path, 1, "PNG chunk type not allowed (allowed: " + [...PNG_OK].join(", ") + ")");
    o += 12 + len;
    if (type === "IEND") { end = true; break; }
  }
  if (!end || o !== b.length) fail("PNG-CHUNKS", path, 1, "PNG must end at IEND with nothing after it");
  const raw = b.toString("latin1");
  if (RESULTS.test(raw)) fail("RESULTS-SHAPED", path, 1, "results-shaped data inside a picture");
  if (TOKEN.test(raw)) fail("TOKEN", path, 1, "token-like string inside a picture");
}

function page(raw, jsBytes, fail, lineOf) {
  const H = "index.html", A = "app.js", js = jsBytes ? jsBytes.toString("utf8") : "";
  // The markup as the browser reads it: <!-- comments --> blanked (same length, so lines stay), so a policy, the tag or
  // the boot line inside a comment counts as missing
  const html = raw.replace(/<!--(?:-?>|[\s\S]*?--!?>|[\s\S]*$)/g, m => m.replace(/[^\n]/g, " ")); // as browsers end them: <!-->, <!--->, -->, --!>
  const files = [[H, raw]].concat(jsBytes ? [[A, js]] : []);
  for (const [P, t, max] of [[H, raw, 40], [A, js, 160]]) {
    const size = Buffer.byteLength(t);
    if (size >= max * 1024) fail("SIZE", P, 1, P + " is " + size + " bytes (limit " + max + " KB)", "move code to app.js or styles out of the markup; a raise is a plan decision");
  }
  // CSP: one exact policy, before the one script tag
  const csps = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)], first = html.search(/<script/i);
  const head = [html.indexOf("<head>"), html.indexOf("</head>")];
  const anyCsp = raw.match(/Content-Security-Policy/gi) || []; // a second policy, even one that looks commented out, is refused
  if (csps.length !== 1 || csps[0][1] !== CSP || anyCsp.length !== 1) fail("CSP", H, csps.length ? lineOf(html, csps[0].index) : 1, "CSP meta tag missing, duplicated, changed or inside a comment", "restore it from git show origin/main:index.html");
  else if (head[0] < 0 || csps[0].index < head[0] || csps[0].index > head[1]) fail("CSP", H, lineOf(html, csps[0].index), "CSP meta tag must be inside <head>", "move it back into the head");
  else if (first >= 0 && csps[0].index > first) fail("CSP", H, lineOf(html, csps[0].index), "CSP meta tag must come before the script tag", "move the CSP meta tag back into the head, above the script tag");
  // SCRIPT-TAG: exactly one <script, equal to the tag built from app.js, last before </body>; the boot line and its CSS once each
  const tags = [...html.matchAll(/<script/gi)], want = jsBytes ? scriptTag(jsBytes) : null;
  const conflict = /^(<{7}|={7}|>{7})( |$)/m.exec(html);
  if (conflict && tags.some(m => Math.abs(lineOf(html, m.index) - lineOf(html, conflict.index)) < 8))
    fail("SCRIPT-TAG", H, lineOf(html, conflict.index), "merge conflict on the script tag", "keep either side, run node tests/stamp.mjs, commit");
  else if (tags.length !== 1) {
    const at = tags.length ? lineOf(html, tags[tags.length > 1 ? 1 : 0].index) : 1;
    fail("SCRIPT-TAG", H, at, "found " + tags.length + " script tags (1 allowed)", tags.length ? "remove the extra tag at line " + at : "restore the tag, then run node tests/stamp.mjs");
  } else {
    const at = tags[0].index, L = lineOf(html, at), line = html.slice(at).split("\n")[0], end = line.indexOf("</script>");
    const tag = end < 0 ? line : line.slice(0, end + 9);
    if (!TAG_SHAPE.test(tag)) {
      const why = /^<script\s*>/i.test(tag) ? "an inline script" : /\stype\s*=/i.test(tag) ? "a type attribute on the script tag"
        : !/\ssrc="app\.js\?v=/.test(tag) ? "a script tag that loads something other than app.js" : !/\sintegrity="sha384-/.test(tag) ? "a script tag without its integrity fingerprint" : "a script tag of another shape";
      fail("SCRIPT-TAG", H, L, "found " + why + " (1 allowed: <script src=\"app.js?v=…\" integrity=\"sha384-…\"></script>)", "restore the tag's shape, then run node tests/stamp.mjs");
    } else if (want && tag !== want) fail("SCRIPT-TAG", H, L, "the script tag does not match app.js", "run node tests/stamp.mjs, then commit index.html");
    else if (html.indexOf(tag + "\n</body>") !== at) fail("SCRIPT-TAG", H, L, "the script tag must be the last thing before </body>", "move it to the line above </body>");
  }
  for (const s of [BOOT, ...BOOT_CSS]) if (html.split(s).length !== 2)
    fail("SCRIPT-TAG", H, 1, "boot line (or its CSS) missing or repeated", "restore it from git show origin/main:index.html");
  if (jsBytes && !js.startsWith(BOOT_JS)) fail("SCRIPT-TAG", A, 1, "app.js must start by removing the boot line", "restore its first two lines from git show origin/main:app.js");
  // INLINE-CODE: no event-handler attribute in any tag (quoted values blanked, so a ">" or "on... =" inside one can't hide or fake one)
  for (const m of html.matchAll(/<[a-z]/gi)) {
    let s = "", q = null, eq = false;
    for (let i = m.index + 1; i < html.length; i++) {
      const c = html[i];
      if (q) { if (c === q) q = null; s += " "; continue; }
      if ((c === '"' || c === "'") && eq) { q = c; s += " "; continue; }
      if (c === ">") break;
      if (!/\s/.test(c)) eq = c === "=";
      s += c;
    }
    if (/[\s/]on[a-z]+\s*=/i.test(s)) fail("INLINE-CODE", H, lineOf(html, m.index), "an event-handler attribute (on...=) in a tag", "attach the handler in app.js with addEventListener");
  }
  for (const [P, t] of files) { const u = UNSAFE.exec(t); if (u) fail("UNSAFE-DOM", P, lineOf(t, u.index), "unsafe DOM write, eval, script URL, script element or code load found", "build elements with el() and textContent"); }
  // LINK-TAGS and EXT-LOAD: index.html minus the three links and the one script tag, and all of app.js
  let rest = raw;
  for (const tag of LINKS) {
    const n = html.split(tag).length - 1;
    if (n !== 1) fail("LINK-TAGS", H, 1, "each of the three allowed <link> tags must appear exactly once (found " + n + ")");
    rest = rest.split(tag).join("");
  }
  const one = /^<script src="app\.js\?v=[0-9a-f]*" integrity="sha384-[A-Za-z0-9+/=]*"><\/script>$/m.exec(rest); // SCRIPT-TAG judges its fingerprint
  if (one) rest = rest.slice(0, one.index) + rest.slice(one.index + one[0].length);
  const lk = /<link/i.exec(js); if (lk) fail("LINK-TAGS", A, lineOf(js, lk.index), "app.js must hold no <link tag");
  const LOAD = /<[a-z][^>]*[\s/](src|srcset|poster|data)\s*=|<(link|base)[^>]*[\s/]href\s*=|@import|\burl\(/i; // any tag that loads a resource
  for (const [P, t] of [[H, rest], ...files.slice(1)]) { const x = LOAD.exec(t); if (x) fail("EXT-LOAD", P, lineOf(t, x.index), "external script, stylesheet or resource found"); }
  for (const [P, t] of files) {
    for (const m of t.matchAll(/https?:\/\/([^/"'\s);]+)/g))
      if (!["api.github.com", "github.com"].includes(m[1])) fail("HOSTS", P, lineOf(t, m.index), "unexpected host");
    const pr = /["'`(=]\s*\/\/[a-z0-9]|wss?:\/\//i.exec(t);
    if (pr) fail("HOSTS", P, lineOf(t, pr.index), "protocol-relative or websocket URL found");
    for (const re of [/demo/i, /serviceWorker/, /caches\./]) { const m = re.exec(t); if (m) fail("PAGE-DEMO", P, lineOf(t, m.index), "the page must not hold demo code, a service worker or a cache store"); }
  }
  // KEY-BLOCK: the key's end date is read and written only inside KEY-START ... KEY-END (in app.js), which sends nothing
  const km = /\/\* KEY-(START|END)/.exec(raw); if (km) fail("KEY-BLOCK", H, lineOf(raw, km.index), "KEY markers belong in app.js only", "move the KEY block back to app.js");
  const ke = /keyExp/.exec(raw); if (ke) fail("KEY-BLOCK", H, lineOf(raw, ke.index), "keyExp used outside the KEY block", "read the end date only inside app.js's KEY block");
  keyUse(raw, jsBytes ? js : null, fail, lineOf);
  if (!jsBytes) return;
  const a = js.indexOf("/* KEY-START"), b = js.indexOf("/* KEY-END */");
  if (a < 0 || b < a || js.indexOf("/* KEY-START", a + 1) >= 0 || js.indexOf("/* KEY-END */", b + 1) >= 0) { fail("KEY-BLOCK", A, 1, "KEY-START / KEY-END markers missing or repeated"); return; }
  const block = js.slice(a, b), outside = js.slice(0, a) + js.slice(b);
  const r = /\bfetch\(|\bgh\(/.exec(block); if (r) fail("KEY-BLOCK", A, lineOf(js, a + r.index), "the KEY block must not make a request");
  const k = /keyExp/.exec(outside); if (k) fail("KEY-BLOCK", A, lineOf(outside, k.index), "keyExp used outside the KEY block", "read the end date only inside the KEY block");
  const pu = /function pageURL\(\)[\s\S]*?\n\}/.exec(js);
  if (!pu || /key/i.test(pu[0])) fail("KEY-BLOCK", A, pu ? lineOf(js, pu.index) : 1, "pageURL must exist and hold nothing about the key");
  const fk = /function forgetKey\(\)[\s\S]*?\n\}/.exec(block);
  if (!fk || !["key", "keyExp", "keyNag", "cache"].every(n => fk[0].includes('store.del("' + n + '")')))
    fail("KEY-BLOCK", A, fk ? lineOf(js, a + fk.index) : 1, "forgetKey must delete key, keyExp, keyNag and cache");
}

// KEY-USE: in app.js the key is read only as a yes/no check, set only by Save key and Forget key, sent only as gh()'s Bearer
// header, read from and written to storage once each; localStorage only inside store; no navigation call at all (connect-src
// stops requests, not a navigation, a link or a new window). index.html holds none of it.
const SINKS = /\blocation\s*\.\s*(assign|replace)\s*\(|\blocation\s*\.\s*href\s*=(?!=)|\blocation\s*=(?!=)|\bdocument\s*\.\s*location\b|\bwindow\s*\.\s*open\s*\(|\bopen\s*\(\s*["'`]?https?:/;
// S.key closes a real if / while condition (not obj.if(…)) that assigns nothing: "if (a && S.key)", never "if (k = S.key)"
function condOk(js, i) {
  for (let d = 0, j = i - 1; j >= 0; j--) {
    if (js[j] === ")") d++;
    else if (js[j] === "(" && d-- === 0) {
      const inner = js.slice(j + 1, i);
      return /(^|[\s;{}])(if|while)\s*$/.test(js.slice(Math.max(0, j - 9), j)) && !/(^|[^=!<>])=(?!=)/.test(inner) && /(^|&&|\|\||\()\s*$/.test(inner);
    }
  }
  return false;
}
function keyUse(html, js, fail, lineOf) {
  const H = "index.html", A = "app.js", FIX = "use the key only as a yes/no check; requests go through gh()";
  const m = /\bS\.key\b|localStorage|\bstore\.(get|set|del)\(\s*["'`]key["'`]/.exec(html) || SINKS.exec(html);
  if (m) fail("KEY-USE", H, lineOf(html, m.index), "the key, storage or a navigation call in index.html", "keep all code in app.js");
  if (js === null) return;
  const bad = (i, what) => fail("KEY-USE", A, lineOf(js, i), what || "the key is used as a value (or a navigation call) outside its three allowed places", FIX);
  const g = /async function gh\(path, opts = \{\}\) \{[\s\S]*?\n\}/.exec(js), st = /const store = \{[\s\S]*?\n\};/.exec(js);
  const inside = (r, i) => r && i >= r.index && i < r.index + r[0].length;
  let bearer = 0, setK = 0, forgetK = 0;
  for (const u of js.matchAll(/\bS\.key\b/g)) {
    const i = u.index, pre = js.slice(Math.max(0, i - 12), i).trimEnd(), post = js.slice(i + 5, i + 20).trimStart();
    if (pre.endsWith('"Bearer " +') && inside(g, i)) { bearer++; continue; }
    if (/^= k;/.test(post)) { setK++; continue; }
    if (/^= "";/.test(post)) { forgetK++; continue; }
    if (/\+$/.test(pre) || /^\+/.test(post) || /^=(?!=)/.test(post)) { bad(i); continue; }
    // allowed: !S.key, S.key ? …, S.key && … (their value is never the key), and S.key closing an if / while condition
    if (pre.endsWith("!") || /^(\?(?![.?])|&&)/.test(post) || /^\)/.test(post) && condOk(js, i)) continue;
    bad(i);
  }
  if (bearer !== 1 || setK !== 1 || forgetK !== 1) bad(1, "the key must be sent once (gh's Bearer header), set once (Save key) and cleared once (Forget key)");
  for (const re of [/\bS\s*\[\s*["'`]key["'`]/, /\{[^{}]*\bkey\b[^{}]*\}\s*=\s*S\b/]) { const x = re.exec(js); if (x) bad(x.index); }
  for (const [re, what] of [[/\bstore\.get\(\s*["'`]key["'`]/g, "read"], [/\bstore\.set\(\s*["'`]key["'`]/g, "saved"]]) {
    const all = [...js.matchAll(re)]; if (all.length !== 1) bad(all.length ? all[1].index : 1, "the key must be " + what + " in storage exactly once");
  }
  for (const x of js.matchAll(/localStorage|sessionStorage/g)) if (!inside(st, x.index)) bad(x.index, "storage used outside the store object");
  const sk = SINKS.exec(js); if (sk) bad(sk.index, "a navigation call (location.assign/replace/href, document.location, window.open)");
}

function manifest(text, fail) {
  const P = "manifest.webmanifest";
  let j; try { j = JSON.parse(text); } catch { fail("MANIFEST", P, 1, "not JSON"); return; }
  if (JSON.stringify(j) !== JSON.stringify(MANIFEST)) fail("MANIFEST", P, 1, "keys or values differ from the plan's manifest");
  if (/http/i.test(text)) fail("MANIFEST", P, 1, "no address may appear in the manifest");
}

const DEMO_HINT = ': build symbols as "DEMO" + letter, keep numbers inline, 7 commas or fewer per line';
function demoRows(t, fail) { // the test server's own row rules (a leak check)
  const P = "tests/demo.mjs", hint = DEMO_HINT, unq = l => l.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  t.split("\n").forEach((l, i) => {
    if ((unq(l).match(/,/g) || []).length >= 8) fail("DEMO-ROWS", P, i + 1, "looks like a CSV row" + hint);
    if (ROW_START.test(l)) fail("DEMO-ROWS", P, i + 1, "line starts like a stock row" + hint);
    const cells = cellsOf(l); // real-looking numbers beside a DEMO symbol (plan § 4.2)
    if (cells.some((c, j) => /^DEMO[A-Z0-9]*$/.test(c) && cells.slice(j + 1, j + 13).filter(x => NUM.test(x)).length >= 2)) fail("DEMO-ROWS", P, i + 1, "numbers beside a DEMO symbol" + hint);
    for (const m of l.matchAll(/["'`]([A-Z][A-Z0-9]{1,4})["'`]/g))
      if (!m[1].startsWith("DEMO") && !DEMO_OK.has(m[1])) fail("DEMO-ROWS", P, i + 1, "a symbol-like string that is not DEMO..." + hint);
  });
}
function demo(t, fail) { // what the test server may write, read and listen on
  const P = "tests/demo.mjs", lines = t.split("\n");
  each(t, /writeFile|appendFile|createWriteStream/, n => fail("DEMO-WRITE", P, n, "the test server must not write files"));
  const listens = lines.map((l, i) => [l, i + 1]).filter(([l]) => /\blisten\(/.test(l));
  if (!listens.length) fail("DEMO-LISTEN", P, 1, "no listen( call found");
  for (const [l, n] of listens) if (!l.includes('"127.0.0.1"')) fail("DEMO-LISTEN", P, n, 'listen( must name "127.0.0.1"');
  // Reads: one fs import, one fixed map of three files, one read call; nothing else that opens a file.
  if (t.split(DEMO_FS).length !== 2) fail("DEMO-READ", P, 1, "tests/demo.mjs must import exactly readFileSync from node:fs, once");
  if (t.split(DEMO_MAP).length !== 2) fail("DEMO-READ", P, 1, "tests/demo.mjs must hold the fixed READ map, once");
  lines.forEach((l, i) => {
    const mod = /\bfrom\s+["']([^"']+)["']/.exec(l);
    if (mod && !DEMO_MODULES.includes(mod[1]) || /\bfrom\s+["'](node:)?fs/.test(l) && l !== DEMO_FS)
      fail("DEMO-READ", P, i + 1, "tests/demo.mjs may import only " + DEMO_MODULES.join(", ") + ", and from node:fs only readFileSync");
    if (/\brequire\(|\bimport\(|createReadStream|\bopen(Sync)?\(|readdir|\.\.\/|process\.binding/.test(l))
      fail("DEMO-READ", P, i + 1, "tests/demo.mjs may read only index.html, app.js, manifest.webmanifest and icon.png");
    for (const m of l.matchAll(/readFileSync\(/g)) if (l.slice(m.index, m.index + DEMO_CALL.length) !== DEMO_CALL && l !== DEMO_FS)
      fail("DEMO-READ", P, i + 1, "file reads must go through " + DEMO_CALL);
  });
}

// ---------------------------------------------------------------- the before-push check (plan § 3)
// A commit's whole tree as files, read from git (never the working folder). opts: {cwd, env} for every git call.
const gitOut = (args, o = {}) => execFileSync("git", args, {cwd: o.cwd || ROOT, env: o.env || process.env, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"]});
export function treeFiles(sha, o = {}) {
  const out = [];
  for (const e of gitOut(["ls-tree", "-r", "-z", sha], o).toString("utf8").split("\0").filter(Boolean)) {
    const [meta, path] = [e.slice(0, e.indexOf("\t")), e.slice(e.indexOf("\t") + 1)], [, type, oid] = meta.split(" ");
    out.push({path, bytes: type === "blob" ? gitOut(["cat-file", "blob", oid], o) : Buffer.from("")});
  }
  return out;
}
// The add-on gstack's pre-push hook runs first (.git/hooks/pre-push.local). Frozen per version: a change bumps v1.
export const HOOK_LOCAL = `#!/bin/sh
# pse-screener-dashboard before-push check v1 (written by node tests/all.mjs; do not edit)
command -v node >/dev/null || { echo "pre-push: node not found on this PATH (a GUI app's git may not see nvm): install Node 22 or later; push refused" >&2; exit 1; }
if [ ! -f tests/prepush.mjs ]; then
  if git cat-file -e origin/main:tests/prepush.mjs 2>/dev/null; then
    echo "pre-push: this branch is older than the before-push check: run git fetch origin && git rebase origin/main; push refused" >&2
    exit 1
  fi
  echo "pre-push: warning: neither this branch nor origin/main has the before-push check yet (not released, or reverted); push allowed" >&2
  exit 0
fi
out=$(node tests/prepush.mjs "$@") || exit 1
case "$out" in
  *"commits checked, static OK"*) echo "$out"; exit 0 ;;
esac
echo "pre-push: tests/prepush.mjs did not report a check (empty or broken?): run node tests/all.mjs; push refused" >&2
exit 1
`;
// Written only when a clone has no pre-push hook at all (no gstack): runs the add-on the same way, and fails closed
export const HOOK_MIN = `#!/bin/sh
# pse-screener-dashboard minimal pre-push v1 (written by node tests/all.mjs because none existed): runs pre-push.local
local_hook="$(git rev-parse --git-path hooks/pre-push.local)"
if [ -x "$local_hook" ]; then exec "$local_hook" "$@"; fi
echo "pre-push: $local_hook is missing or not executable: run node tests/all.mjs; push refused" >&2
exit 1
`;
const MARK = /^# pse-screener-dashboard before-push check v(\d+) /m, HOOK_V = +MARK.exec(HOOK_LOCAL)[1];
const codeLines = t => t.split("\n").map(l => l.replace(/(^|\s)#.*$/, "")).join("\n"); // a hook's text without its comments
// Fills and checks the slot; never sets core.hooksPath, never overwrites gstack's pre-push or another tool's add-on.
// -> {ok, msg}; every write is named in msg. Runs from node tests/all.mjs and a local node tests/static.mjs, never in CI.
export function ensureHook(o = {}) {
  const git = args => { try { return gitOut(args, o).toString("utf8").trim(); } catch (e) { if (e.status === 1) return null; throw e; } };
  const hp = git(["config", "--show-scope", "--get", "core.hooksPath"]);
  if (hp !== null) {
    const scope = hp.split("\t")[0], flag = {local: "", worktree: " --worktree", global: " --global", system: " --system"}[scope];
    return {ok: false, msg: "pre-push check: core.hooksPath is set (" + scope + " config): git skips .git/hooks: " +
      (flag === undefined ? "remove it from where it is set (" + scope + ")" : "git config" + flag + " --unset core.hooksPath") + ", then node tests/all.mjs (see README.md#pre-push)"};
  }
  const dir = join(resolve(o.cwd || ROOT, git(["rev-parse", "--git-common-dir"])), "hooks"), main = join(dir, "pre-push"), add = join(dir, "pre-push.local");
  const wrote = [];
  const put = (f, text) => { mkdirSync(dir, {recursive: true}); const tmp = f + ".tmp-" + process.pid; writeFileSync(tmp, text, {mode: 0o755}); chmodSync(tmp, 0o755); renameSync(tmp, f); wrote.push(f); };
  const exec = f => { try { accessSync(f, constants.X_OK); return true; } catch { return false; } };
  if (!existsSync(main)) put(main, HOOK_MIN);
  else if (!exec(main)) return {ok: false, msg: "pre-push check: " + main + " is not executable: chmod +x " + main + " (see README.md#pre-push)"};
  else if (!codeLines(readFileSync(main, "utf8")).includes("pre-push.local")) return {ok: false, msg: "pre-push check: " + main + " does not call pre-push.local: mv " + main + " " + main + ".bak, then node tests/all.mjs (see README.md#pre-push)"};
  const cur = existsSync(add) ? readFileSync(add, "utf8") : null, m = cur === null ? null : MARK.exec(cur);
  if (cur === HOOK_LOCAL && exec(add) && !wrote.length) return {ok: true, msg: "pre-push check: on"};
  if (m && +m[1] > HOOK_V && codeLines(cur).includes("tests/prepush.mjs")) return {ok: true, msg: "pre-push check: on (newer add-on from another branch)"};
  if (cur !== null && cur !== HOOK_LOCAL && !(m && +m[1] < HOOK_V))
    return {ok: false, msg: "pre-push check: " + add + " holds another tool's add-on (or an edited copy): mv " + add + " " + add + ".bak, then node tests/all.mjs (see README.md#pre-push)"};
  if (cur !== HOOK_LOCAL || !exec(add)) put(add, HOOK_LOCAL);
  return {ok: true, msg: "pre-push check: switched on (wrote " + wrote.join(", ") + ")"};
}

// One finding as the command line prints it: the code, path:line, what failed, the fix and where the README explains it
export const say = e => e.code + " " + e.path + ":" + e.line + " " + e.msg + (e.fix ? ": " + e.fix : "") + " (see README.md#" + e.code.toLowerCase() + ")";

export const realFiles = () => execFileSync("git", ["ls-files", "--cached"], {cwd: ROOT}).toString().split("\n").filter(Boolean)
  .map(path => ({path, bytes: readFileSync(join(ROOT, path))}));

if (isMain(import.meta.url)) {
  // A local run (not CI) also fills and checks the before-push slot: the one file it may write is .git/hooks/pre-push.local
  const h = process.env.GITHUB_ACTIONS ? null : ensureHook();
  if (h) (h.ok ? console.log : console.error)(h.msg);
  const errs = scan(realFiles());
  if (errs.length) { console.error(errs.map(say).join("\n")); process.exit(1); }
  if (h && !h.ok) process.exit(1);
  console.log("static OK");
}
