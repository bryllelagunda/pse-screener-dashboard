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
check(html.includes(`content="default-src 'self'; connect-src https://api.github.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`),
  "CSP meta tag missing or changed");
check(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(html), "unsafe DOM write or eval found");
check(!/<script[^>]+src=|<link[^>]+href=|@import|\burl\(/.test(html), "external script, stylesheet or resource found");
const hosts = new Set([...html.matchAll(/https?:\/\/([^/"'\s);]+)/g)].map(m => m[1]));
for (const h of hosts) check(["api.github.com", "github.com"].includes(h), `unexpected host ${h}`);

// Nothing tracked or staged may hold a token or price data.
const files = execFileSync("git", ["ls-files", "--cached"], {cwd: root}).toString().split("\n").filter(Boolean).map(f => join(root, f));
for (const f of files) {
  check(!/\.(csv|json)$/i.test(f), `data file in public repo: ${f}`);
  if (/\.(png|jpe?g|gif|webp)$/i.test(f)) continue;
  const t = readFileSync(f, "utf8");
  check(!/github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}/.test(t), `token-like string in ${f}`);
}

if (errs.length) { console.log(errs.map(e => "FAIL " + e).join("\n")); process.exit(1); }
console.log("static OK");
