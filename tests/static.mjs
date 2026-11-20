// Static guards for the public repo: size, CSP, no unsafe DOM writes, no external loads, no secrets or data.
// Runs in CI (no private files needed): node tests/static.mjs   Refusal tests: node tests/guards.mjs
//
// scan(files) -> [{code, path, line, msg}], files = [{path, bytes}] (bytes a Buffer). Every message starts with a stable
// code and gives path:line, never the matched text (CI logs are public). Codes:
//   ALLOWLIST  a file not on the public list            SIZE        index.html over 128 KB
//   EXT-LOAD   a script, stylesheet or resource load    LINK-TAGS   the three exact <link> tags, once each
//   HOSTS      a host other than (api.)github.com       CSP         the one exact policy, before the first script
//   MANIFEST   manifest.webmanifest keys and values     ICON        icon.png: 512 x 512, under 20,000 bytes, = tests/icon.mjs
//   PNG-CHUNKS a PNG with other chunks or extra bytes   WIREFRAME   docs/wireframe.png changed (pinned by sha256)
//   RESULTS-SHAPED results CSV text                     TOKEN       a GitHub token shape
//   ROWS       a line that starts like a stock row      DEMO-ROWS   tests/demo.mjs: CSV-looking lines or symbols
//   DEMO-WRITE tests/demo.mjs writes a file             DEMO-READ   tests/demo.mjs reads other than its three files
//   DEMO-LISTEN tests/demo.mjs listens beyond 127.0.0.1 PAGE-DEMO   index.html: "demo", serviceWorker, caches.
//   KEY-BLOCK  the key's end date outside its block, a request inside it, the key in the address, Forget key
//   UNSAFE-DOM innerHTML, eval, script URLs and the like
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {iconBytes} from "./icon.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CSP = "default-src 'self'; connect-src https://api.github.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'";
export const LINKS = ['<link rel="manifest" href="manifest.webmanifest">', '<link rel="apple-touch-icon" href="icon.png">', '<link rel="icon" href="icon.png">'];
const ALLOW = /^(index\.html|README\.md|CLAUDE\.md|\.gitignore|manifest\.webmanifest|icon\.png|docs\/wireframe\.png|tests\/[a-z]+\.mjs|\.github\/workflows\/[a-z-]+\.yml)$/;
const WIREFRAME_SHA256 = "f48b46465d5982f255f067c8297fba7ae11ba22efb522f36f40a00a4e428dead"; // origin/main 0339337
const MANIFEST = {name: "PSE Screener", short_name: "PSE Screener", start_url: "./", scope: "./", display: "standalone",
  background_color: "#16191f", theme_color: "#16191f", icons: [{src: "icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable"}]};
const PNG_SIG = "89504e470d0a1a0a", PNG_OK = new Set(["IHDR", "PLTE", "IDAT", "IEND", "sRGB", "gAMA", "pHYs"]);
const RESULTS = /^symbol,name,data_date,|pass_strict,pass_loose/m, TOKEN = /github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}/;
const ROW_START = /^\s*["']?[A-Z][A-Z0-9]{1,4}["']?,/;
const DEMO_OK = new Set(["GET", "POST", "PUT", "OK", "UTC", "PSE", "CSV", "PNG"]);
const UNSAFE = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|srcdoc|setAttribute\(\s*["'`]on|javascript:|set(Timeout|Interval)\(\s*["'`]|\.src\s*=/;
// tests/demo.mjs may read only these three files, through this one line and this one call
const DEMO_FS = 'import {readFileSync} from "node:fs";';
const DEMO_MAP = 'const READ = Object.freeze({"/": "index.html", "/manifest.webmanifest": "manifest.webmanifest", "/icon.png": "icon.png"});';
const DEMO_CALL = "readFileSync(join(ROOT, READ[p]))", DEMO_MODULES = ["node:fs", "node:http", "node:path", "node:url"];

export function scan(files) {
  const out = [];
  const fail = (code, path, line, msg) => out.push({code, path, line, msg});
  const lineOf = (text, i) => i < 0 ? 1 : text.slice(0, i).split("\n").length;
  const each = (text, re, f) => text.split("\n").forEach((l, i) => { if (re.test(l)) f(i + 1); });
  const byPath = new Map(files.map(f => [f.path, f.bytes]));
  for (const {path, bytes} of files) {
    if (!ALLOW.test(path)) fail("ALLOWLIST", path, 1, "file not on the public allowlist");
    if (/\.png$/i.test(path)) { png(path, bytes, fail); continue; }
    if (/\.(jpe?g|gif|webp)$/i.test(path)) continue; // refused by the allowlist above
    const t = bytes.toString("utf8");
    if (path !== "tests/static.mjs") each(t, RESULTS, n => fail("RESULTS-SHAPED", path, n, "results-shaped data"));
    each(t, TOKEN, n => fail("TOKEN", path, n, "token-like string"));
    if (path === "tests/demo.mjs") demo(t, fail, each);
    else each(t, ROW_START, n => fail("ROWS", path, n, "line starts like a stock row (symbol, then a comma)"));
  }
  const html = byPath.get("index.html");
  if (!html) fail("ALLOWLIST", "index.html", 1, "index.html missing");
  else page(html.toString("utf8"), fail, lineOf);
  const mf = byPath.get("manifest.webmanifest");
  if (!mf) fail("MANIFEST", "manifest.webmanifest", 1, "manifest.webmanifest missing");
  else manifest(mf.toString("utf8"), fail);
  const icon = byPath.get("icon.png");
  if (!icon) fail("ICON", "icon.png", 1, "icon.png missing");
  else {
    if (icon.length >= 20000) fail("ICON", "icon.png", 1, "icon.png is " + icon.length + " bytes (limit 19,999)");
    if (icon.toString("hex", 0, 8) !== PNG_SIG || icon.length < 24 || icon.toString("latin1", 12, 16) !== "IHDR" ||
      icon.readUInt32BE(16) !== 512 || icon.readUInt32BE(20) !== 512) fail("ICON", "icon.png", 1, "icon.png must be a 512 x 512 PNG");
    if (!icon.equals(iconBytes())) fail("ICON", "icon.png", 1, "icon.png differs from what node tests/icon.mjs writes");
  }
  const wf = byPath.get("docs/wireframe.png");
  if (wf && createHash("sha256").update(wf).digest("hex") !== WIREFRAME_SHA256) fail("WIREFRAME", "docs/wireframe.png", 1, "docs/wireframe.png changed (pinned sha256)");
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

function page(html, fail, lineOf) {
  const P = "index.html", size = Buffer.byteLength(html);
  if (size >= 128 * 1024) fail("SIZE", P, 1, "index.html is " + size + " bytes (limit 128 KB; plan budget for T-21: 88,000)");
  const csps = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)];
  if (csps.length !== 1 || csps[0][1] !== CSP) fail("CSP", P, csps.length ? lineOf(html, csps[0].index) : 1, "CSP meta tag missing, duplicated or changed");
  else if (csps[0].index > html.indexOf("<script")) fail("CSP", P, lineOf(html, csps[0].index), "CSP meta tag must come before the first script");
  const u = UNSAFE.exec(html); if (u) fail("UNSAFE-DOM", P, lineOf(html, u.index), "unsafe DOM write, eval or script URL found");
  let rest = html;
  for (const tag of LINKS) {
    const n = html.split(tag).length - 1;
    if (n !== 1) fail("LINK-TAGS", P, 1, "each of the three allowed <link> tags must appear exactly once (found " + n + ")");
    rest = rest.split(tag).join("");
  }
  const x = /<script[^>]+src=|<link[^>]+href=|@import|\burl\(/.exec(rest);
  if (x) fail("EXT-LOAD", P, lineOf(rest, x.index), "external script, stylesheet or resource found");
  for (const m of html.matchAll(/https?:\/\/([^/"'\s);]+)/g))
    if (!["api.github.com", "github.com"].includes(m[1])) fail("HOSTS", P, lineOf(html, m.index), "unexpected host");
  const pr = /["'`(=]\s*\/\/[a-z0-9]|wss?:\/\//i.exec(html);
  if (pr) fail("HOSTS", P, lineOf(html, pr.index), "protocol-relative or websocket URL found");
  for (const re of [/demo/i, /serviceWorker/, /caches\./]) { const m = re.exec(html); if (m) fail("PAGE-DEMO", P, lineOf(html, m.index), "the page must not hold demo code, a service worker or a cache store"); }
  // The key's end date: read and written only inside KEY-START ... KEY-END, which sends nothing.
  const a = html.indexOf("/* KEY-START"), b = html.indexOf("/* KEY-END */");
  if (a < 0 || b < a || html.indexOf("/* KEY-START", a + 1) >= 0) { fail("KEY-BLOCK", P, 1, "KEY-START / KEY-END markers missing or repeated"); return; }
  const block = html.slice(a, b), outside = html.slice(0, a) + html.slice(b);
  const r = /\bfetch\(|\bgh\(/.exec(block); if (r) fail("KEY-BLOCK", P, lineOf(html, a + r.index), "the KEY block must not make a request");
  const k = /keyExp/.exec(outside); if (k) fail("KEY-BLOCK", P, lineOf(outside, k.index), "keyExp used outside the KEY block");
  const pu = /function pageURL\(\)[\s\S]*?\n\}/.exec(html);
  if (!pu || /key/i.test(pu[0])) fail("KEY-BLOCK", P, pu ? lineOf(html, pu.index) : 1, "pageURL must exist and hold nothing about the key");
  const fk = /function forgetKey\(\)[\s\S]*?\n\}/.exec(block);
  if (!fk || !["key", "keyExp", "keyNag", "cache"].every(n => fk[0].includes('store.del("' + n + '")')))
    fail("KEY-BLOCK", P, fk ? lineOf(html, a + fk.index) : 1, "forgetKey must delete key, keyExp, keyNag and cache");
}

function manifest(text, fail) {
  const P = "manifest.webmanifest";
  let j; try { j = JSON.parse(text); } catch { fail("MANIFEST", P, 1, "not JSON"); return; }
  if (JSON.stringify(j) !== JSON.stringify(MANIFEST)) fail("MANIFEST", P, 1, "keys or values differ from the plan's manifest");
  if (/http/i.test(text)) fail("MANIFEST", P, 1, "no address may appear in the manifest");
}

function demo(t, fail, each) {
  const P = "tests/demo.mjs";
  const lines = t.split("\n"), unq = l => l.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  const hint = ': build symbols as "DEMO" + letter, keep numbers inline, 7 commas or fewer per line';
  lines.forEach((l, i) => {
    if ((unq(l).match(/,/g) || []).length >= 8) fail("DEMO-ROWS", P, i + 1, "looks like a CSV row" + hint);
    if (ROW_START.test(l)) fail("DEMO-ROWS", P, i + 1, "line starts like a stock row" + hint);
    for (const m of l.matchAll(/["'`]([A-Z][A-Z0-9]{1,4})["'`]/g))
      if (!m[1].startsWith("DEMO") && !DEMO_OK.has(m[1])) fail("DEMO-ROWS", P, i + 1, "a symbol-like string that is not DEMO..." + hint);
  });
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
      fail("DEMO-READ", P, i + 1, "tests/demo.mjs may read only index.html, manifest.webmanifest and icon.png");
    for (const m of l.matchAll(/readFileSync\(/g)) if (l.slice(m.index, m.index + DEMO_CALL.length) !== DEMO_CALL && l !== DEMO_FS)
      fail("DEMO-READ", P, i + 1, "file reads must go through " + DEMO_CALL);
  });
}

export const realFiles = () => execFileSync("git", ["ls-files", "--cached"], {cwd: ROOT}).toString().split("\n").filter(Boolean)
  .map(path => ({path, bytes: readFileSync(join(ROOT, path))}));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errs = scan(realFiles());
  if (errs.length) { console.error(errs.map(e => e.code + " " + e.path + ":" + e.line + " " + e.msg).join("\n")); process.exit(1); }
  console.log("static OK");
}
