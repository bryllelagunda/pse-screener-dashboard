// Static guards for the public page: size, CSP, no unsafe DOM writes, no external loads, no secrets or data.
// Runs in CI (no private files needed): node tests/static.mjs
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };

check(Buffer.byteLength(html) < 60 * 1024, `index.html is ${Buffer.byteLength(html)} bytes (limit 60 KB)`);
const CSP = "default-src 'self'; connect-src https://api.github.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const csps = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)];
check(csps.length === 1 && csps[0][1] === CSP, "CSP meta tag missing, duplicated or changed");
check(csps.length === 1 && csps[0].index < html.indexOf("<script"), "CSP meta tag must come before the first script");
check(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|srcdoc|setAttribute\(\s*["'`]on|javascript:|set(Timeout|Interval)\(\s*["'`]|\.src\s*=/.test(html),
  "unsafe DOM write, eval or script URL found");
check(!/<script[^>]+src=|<link[^>]+href=|@import|\burl\(/.test(html), "external script, stylesheet or resource found");
const hosts = new Set([...html.matchAll(/https?:\/\/([^/"'\s);]+)/g)].map(m => m[1]));
for (const h of hosts) check(["api.github.com", "github.com"].includes(h), `unexpected host ${h}`);
check(!/["'`(=]\s*\/\/[a-z0-9]|wss?:\/\//i.test(html), "protocol-relative or websocket URL found");

// Nothing tracked or staged may hold a token or price data.
const files = execFileSync("git", ["ls-files", "--cached"], {cwd: root}).toString().split("\n").filter(Boolean).map(f => join(root, f));
for (const f of files) {
  // Allowlist, so price data can't slip in under another extension.
  const rel = f.slice(root.length + 1);
  check(/^(index\.html|README\.md|CLAUDE\.md|\.gitignore|docs\/wireframe\.png|tests\/[a-z]+\.mjs|\.github\/workflows\/[a-z-]+\.yml)$/.test(rel),
    `file not on the public allowlist: ${rel}`);
  if (/\.(png|jpe?g|gif|webp)$/i.test(f)) continue;
  const t = readFileSync(f, "utf8");
  check(!/^symbol,name,data_date,|pass_strict,pass_loose/m.test(t) || rel === "tests/static.mjs", `results-shaped data in ${rel}`);
  check(!/github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}/.test(t), `token-like string in ${f}`);
}

if (errs.length) { console.log(errs.map(e => "FAIL " + e).join("\n")); process.exit(1); }
console.log("static OK");
