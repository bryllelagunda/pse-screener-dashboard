// Refusal tests for tests/static.mjs (plan § 9, the door list): the real tree must pass, then each crafted input
// must fail with its code. Every refused string (a results header, a token, a CSV row, a file write) is built here at
// run time, so this file passes scan() on the real tree with no exemption.
// Runs in CI (no private files needed): node tests/guards.mjs
// Value: protects=every guard that keeps price data and the key out of the public repo and the page loading only itself;
//   fails_when=a guard is moved but no longer called, loosened past the plan, or echoes what it matched;
//   no_claim=what the page does on screen (/qa), and the PR body or screenshots (/cso).
import {spawn} from "node:child_process";
import {scan, realFiles, scriptTag} from "./static.mjs";
import {inject} from "./demo.mjs";
import {stamp} from "./stamp.mjs";

let bad = 0, n = 0;
const real = realFiles(), get = p => real.find(f => f.path === p).bytes, txt = p => get(p).toString("utf8");
const B = s => Buffer.from(s, "utf8");
const tree = (changes = {}) => {
  const out = real.filter(f => !(f.path in changes) || changes[f.path] !== null).map(f => f.path in changes ? {path: f.path, bytes: changes[f.path]} : f);
  for (const p in changes) if (changes[p] !== null && !real.some(f => f.path === p)) out.push({path: p, bytes: changes[p]});
  return out;
};
const codes = r => [...new Set(r.map(e => e.code))].join(", ") || "nothing";
function refuse(what, code, changes, secret) {
  n++;
  const r = scan(tree(changes));
  if (!r.some(e => e.code === code)) { bad++; console.log(`FAIL ${what}: want ${code}, got ${codes(r)}`); }
  if (r.some(e => typeof e.line !== "number" || !e.path || !e.msg)) { bad++; console.log(`FAIL ${what}: a result without path, line or message`); }
  if (secret && JSON.stringify(r).includes(secret)) { bad++; console.log(`FAIL ${what}: the message echoes the matched text`); }
}
const edit = (p, a, b) => { const t = txt(p); if (!t.includes(a)) throw new Error(`guards.mjs: "${a.slice(0, 40)}" not found in ${p}`); return B(t.replace(a, b)); };
const add = (p, line) => B(txt(p) + "\n" + line + "\n");
const page = (a, b) => ({"index.html": edit("index.html", a, b)}); // F: a change to the markup file
const app = (a, b) => ({"app.js": edit("app.js", a, b)}); // A: a change to the code file (its tag goes stale too; each case names its own code)
function pass(what, changes, code) { // the change must not trip this code (nothing at all when code is omitted)
  n++; const r = scan(tree(changes)).filter(e => !code || e.code === code);
  if (r.length) { bad++; console.log(`FAIL ${what}: should pass, got ${codes(r)}`); }
}

// Crafted strings, assembled so this file never holds them
const HEADER = ["symbol", "name", "data_date", "close"].join(",");
const PASSES = ["pass", "strict,pass", "loose"].join("_");
const TOKEN = "github" + "_pat_" + "Q7".repeat(15);
const SYM = String.fromCharCode(90, 81, 88), DATE = ["2026", "11", "20"].join("-"); // a made-up symbol and day, never side by side here
const ROW = SYM + "," + ["Some Holdings Inc", DATE, "12.5", "3.1", "88000000", "true", "false"].join(",");

// 0. The real tree passes (a check that is moved but no longer called would still pass here, so every case below matters)
{ n++; const r = scan(real); if (r.length) { bad++; console.log("FAIL the real tree: " + r.map(e => e.code + " " + e.path + ":" + e.line).join("; ")); } }

// 1. A new tracked file
for (const p of ["data.json", "manifest.json", "icon2.png", "tests/Demo.mjs", "results/latest.csv", "docs/shot.png", "app2.js", "js/app.js", ".githooks/pre-push"])
  refuse("new file " + p, "ALLOWLIST", {[p]: B("x")});
refuse("app.js removed", "ALLOWLIST", {"app.js": null});
refuse("icon.png removed", "ICON", {"icon.png": null});
refuse("manifest removed", "MANIFEST", {"manifest.webmanifest": null});

// 2. index.html loading a script, style or resource: only the three exact <link> tags pass
const LINK_M = '<link rel="manifest" href="manifest.webmanifest">', LINK_I = '<link rel="icon" href="icon.png">';
refuse("a fourth <link href>", "EXT-LOAD", page(LINK_M, LINK_M + '\n<link rel="stylesheet" href="app.css">'));
refuse("a second manifest tag", "LINK-TAGS", page(LINK_M, LINK_M + "\n" + LINK_M));
for (const href of ["https://x/icon.png", "//x/icon.png", "icon.png?k=1"]) {
  refuse("icon tag pointing at " + href, "LINK-TAGS", page(LINK_I, LINK_I.replace("icon.png", href)));
  refuse("icon tag pointing at " + href + " (load guard)", "EXT-LOAD", page(LINK_I, LINK_I.replace("icon.png", href)));
}
refuse("a second <script src=\"app.js\">", "EXT-LOAD", page("</body>", '<script src="app.js"></script>\n</body>'));
refuse("an image before the CSP", "EXT-LOAD", page("<head>", '<head>\n<img src="https://github.com/favicon.ico">'));
for (const tag of ['<link rel="stylesheet" href = "https://github.com/x.css">', '<script/src="app.js"></script>', '<img/src="https://github.com/favicon.ico">', '<base href="https://github.com/">'])
  refuse("before the CSP: " + tag, "EXT-LOAD", page("<head>", "<head>\n" + tag));
for (const tag of ['<iframe src="x.html"></iframe>', '<img srcset="a.png 2x">', '<video poster="p.png"></video>', '<object data="x.pdf"></object>'])
  refuse("a resource tag: " + tag, "EXT-LOAD", page("</body>", tag + "\n</body>"));
refuse("a host in the page", "HOSTS", page("</main>", "<p>https://edge.pse.com.ph</p>\n</main>"));
refuse("a host in the code", "HOSTS", app('const OWNER = "', 'const EDGE = "https://edge.pse.com.ph";\nconst OWNER = "'));
refuse("a protocol-relative address in the page", "HOSTS", page("</main>", '<p title="//cdn.example/x.js">x</p>\n</main>'));
refuse("a protocol-relative address in the code", "HOSTS", app('const OWNER = "', 'const X = "//cdn.example/x.js";\nconst OWNER = "'));
refuse("a websocket in the code", "HOSTS", app('const OWNER = "', 'const X = "wss://x";\nconst OWNER = "'));
refuse("an added img-src * in the CSP", "CSP", page("form-action 'none'\">", "form-action 'none'; img-src *\">"));
refuse("the old policy with 'unsafe-inline' scripts", "CSP", page("script-src 'self';", "script-src 'self' 'unsafe-inline';"));
{ const html = txt("index.html"), csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\n/)[0];
  refuse("the CSP after the script tag", "CSP", {"index.html": B(html.replace(csp, "").replace("</body>", csp + "</body>"))}); }
refuse("innerHTML in the page", "UNSAFE-DOM", page("</main>", '<p title="innerHTML">x</p>\n</main>'));
refuse("innerHTML in the code", "UNSAFE-DOM", app("function el(tag, props, ...kids) {", "function el(tag, props, ...kids) {\n  document.body.innerHTML = tag;"));
for (const s of ['createElement("script")', "createElement('script')", "createElement(`script`)", 'createElement( "script" )', 'createElementNS(ns, "script")',
  'import("./x.js")', 'new Worker("w.js")', 'importScripts("w.js")'])
  refuse("the code making or loading a script: " + s, "UNSAFE-DOM", app("function el(tag, props, ...kids) {", "function el(tag, props, ...kids) {\n  " + s + ";"));
refuse("index.html over 40 KB", "SIZE", page("</body>", "<!-- " + "x".repeat(40 * 1024) + " -->\n</body>"));
refuse("app.js over 160 KB", "SIZE", app('"use strict";\n', '"use strict";\n/* ' + "x".repeat(160 * 1024) + " */\n"));

// 2b. The one script tag (SCRIPT-TAG): exactly one, equal to the tag built from app.js, with the boot line and its CSS
const TAG = scriptTag(get("app.js")), tagWith = f => page(TAG, f(TAG));
refuse("a second script tag", "SCRIPT-TAG", page("</main>", TAG + "\n</main>"));
refuse("an inline script", "SCRIPT-TAG", page("</main>", "<script>x()</script>\n</main>"));
refuse("an inline script instead of the tag", "SCRIPT-TAG", page(TAG, "<script>x()</script>"));
refuse("a script inside an svg", "SCRIPT-TAG", page("</main>", "<svg><script>x()</script></svg>\n</main>"));
refuse("the tag with a stale v", "SCRIPT-TAG", tagWith(t => t.replace(/v=[0-9a-f]{16}/, "v=0123456789abcdef")));
refuse("the tag with a stale integrity", "SCRIPT-TAG", tagWith(t => t.replace(/sha384-[A-Za-z0-9+/=]{4}/, "sha384-AAAA")));
refuse("the tag without integrity", "SCRIPT-TAG", tagWith(t => t.replace(/ integrity="[^"]*"/, "")));
refuse("the tag loading github.com", "SCRIPT-TAG", tagWith(t => t.replace('src="app.js', 'src="https://github.com/app.js')));
refuse("the tag loading //x", "SCRIPT-TAG", tagWith(t => t.replace('src="app.js', 'src="//x/app.js')));
refuse("the tag as a module", "SCRIPT-TAG", tagWith(t => t.replace("<script ", '<script type="module" ')));
refuse("the boot line removed", "SCRIPT-TAG", page(/<p id="boot"[^\n]*<\/p>\n/.exec(txt("index.html"))[0], ""));
refuse("the boot line's CSS removed", "SCRIPT-TAG", page(".boot{visibility:hidden;animation:boot 0s 4s forwards}", ""));
refuse("the boot line's animation removed", "SCRIPT-TAG", page("@keyframes boot{to{visibility:visible}}", ""));
refuse("app.js changed by one byte without restamping", "SCRIPT-TAG", {"app.js": Buffer.concat([get("app.js"), B("\n")])});
refuse("app.js no longer removing the boot line", "SCRIPT-TAG", app('document.getElementById("boot")?.remove();', ""));
refuse("a merge conflict on the script tag", "SCRIPT-TAG", page(TAG, "<<<<<<< HEAD\n" + TAG + "\n=======\n" + TAG.replace(/v=[0-9a-f]{16}/, "v=0123456789abcdef") + "\n>>>>>>> other"));
{ // stamp.mjs refuses any other shape (nothing written) and writes the same tag SCRIPT-TAG wants
  const html = txt("index.html");
  for (const [what, h] of [["two tags", html.replace(TAG, TAG + "\n" + TAG)], ["no tag", html.replace(TAG, "")], ["an inline script", html.replace(TAG, "<script>x()</script>")]]) {
    n++; const r = stamp(h, get("app.js")); if (!r.err || r.html || !/^STAMP-SHAPE index\.html: found \d+ script tags.*nothing written/.test(r.err)) { bad++; console.log(`FAIL stamp.mjs with ${what}: did not refuse`); }
  }
  n++; const r = stamp(html.replace(TAG, TAG.replace(/v=[0-9a-f]{16}/, "v=0")), get("app.js"));
  if (r.html !== html) { bad++; console.log("FAIL stamp.mjs does not write the one tag SCRIPT-TAG wants, on its own line"); }
}

// 2c. No inline event handlers in the markup (INLINE-CODE); quoted values and plain text can't fake or hide one
for (const t of ['<button onclick="x()">x</button>', "<p onload=x>x</p>", "<img/onerror=x>", '<p title="a>b" onclick=x>x</p>', "<p title=a'b onclick=x>x</p>"])
  refuse("an event handler in the page: " + t, "INLINE-CODE", page("</main>", t + "\n</main>"));
refuse("an event handler on body", "INLINE-CODE", page("<body>", "<body onload=x>"));
pass("a quoted = inside a value", page("</main>", '<p data-tip="run once = daily">x</p>\n</main>'));
pass("the word on in text", page("</main>", "<p>Turn on = off</p>\n</main>"));

// 3. The manifest's addresses
const mf = () => JSON.parse(txt("manifest.webmanifest"));
refuse("manifest: an http icon", "MANIFEST", {"manifest.webmanifest": B(JSON.stringify({...mf(), icons: [{...mf().icons[0], src: "https://x/icon.png"}]}))});
refuse("manifest: a query in start_url", "MANIFEST", {"manifest.webmanifest": B(JSON.stringify({...mf(), start_url: "./?p=x"}))});
refuse("manifest: an extra key", "MANIFEST", {"manifest.webmanifest": B(JSON.stringify({...mf(), id: "x"}))});
refuse("manifest: not JSON", "MANIFEST", {"manifest.webmanifest": B("{")});

// 4. A renamed data file as the icon, or text hidden in a PNG
const chunk = (type, body) => { const l = Buffer.alloc(4); l.writeUInt32BE(body.length); return Buffer.concat([l, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]); };
const ihdr = w => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(w, 4); b[8] = 8; b[9] = 3; return b; };
const SIG = Buffer.from("89504e470d0a1a0a", "hex"), icon = get("icon.png"), iend = icon.length - 12;
refuse("a CSV saved as icon.png", "ICON", {"icon.png": B(HEADER + "\n")}, HEADER);
refuse("a 192 x 192 icon", "ICON", {"icon.png": Buffer.concat([SIG, chunk("IHDR", ihdr(192)), chunk("IEND", Buffer.alloc(0))])});
refuse("a 20,001-byte icon", "ICON", {"icon.png": Buffer.concat([SIG, chunk("IHDR", ihdr(512)), chunk("IDAT", Buffer.alloc(20001 - 8 - 25 - 12 - 12)), chunk("IEND", Buffer.alloc(0))])});
{ const t = Buffer.concat([SIG, chunk("IHDR", ihdr(512)), chunk("IDAT", Buffer.alloc(20001 - 8 - 25 - 12 - 12)), chunk("IEND", Buffer.alloc(0))]);
  n++; if (t.length !== 20001) { bad++; console.log("FAIL the crafted big icon is " + t.length + " bytes"); } }
const flipped = Buffer.from(icon); flipped[100] ^= 1;
refuse("an icon that differs from tests/icon.mjs", "ICON", {"icon.png": flipped});
const withText = Buffer.concat([icon.subarray(0, iend), chunk("tEXt", B("note\0\n" + HEADER)), icon.subarray(iend)]);
refuse("a tEXt chunk in the icon", "PNG-CHUNKS", {"icon.png": withText}, HEADER);
refuse("a results header hidden in a PNG", "RESULTS-SHAPED", {"icon.png": withText}, HEADER);
refuse("a token hidden in a PNG", "TOKEN", {"icon.png": Buffer.concat([icon.subarray(0, iend), chunk("tEXt", B("k\0" + TOKEN)), icon.subarray(iend)])}, TOKEN);
refuse("bytes after IEND", "PNG-CHUNKS", {"icon.png": Buffer.concat([icon, B("x")])});
refuse("bytes after IEND in the wireframe", "PNG-CHUNKS", {"docs/wireframe.png": Buffer.concat([get("docs/wireframe.png"), B(ROW)])}, ROW);
const wf = Buffer.from(get("docs/wireframe.png")); wf[200] ^= 1;
refuse("an edited wireframe", "WIREFRAME", {"docs/wireframe.png": wf});

// 5. Results text or rows in a tracked file
refuse("a results header in tests/x.mjs", "RESULTS-SHAPED", {"tests/x.mjs": B("// " + HEADER + "\n" + HEADER + "\n")}, HEADER);
refuse("pass columns in README.md", "RESULTS-SHAPED", {"README.md": add("README.md", PASSES)}, PASSES);
refuse("a headerless row in README.md", "ROWS", {"README.md": add("README.md", ROW)}, ROW);
refuse("a headerless row in tests/x.mjs", "ROWS", {"tests/x.mjs": B("const a = 1;\n" + ROW + "\n")}, ROW);
refuse("a token in tests/demo.mjs", "TOKEN", {"tests/demo.mjs": add("tests/demo.mjs", "// " + TOKEN)}, TOKEN);
refuse("a token in index.html", "TOKEN", {"index.html": edit("index.html", "</body>", "<!-- " + TOKEN + " -->\n</body>")}, TOKEN);
refuse("a token in app.js", "TOKEN", app('"use strict";\n', '"use strict";\n// ' + TOKEN + "\n"), TOKEN);

// 6. Rows, writes, reads and listening in the test server
const demo = l => ({"tests/demo.mjs": add("tests/demo.mjs", l)});
refuse("demo: a plain CSV row", "DEMO-ROWS", demo(ROW), ROW);
refuse("demo: a quoted CSV row", "DEMO-ROWS", demo('"' + ROW + '"'), ROW);
refuse("demo: an indented CSV row", "DEMO-ROWS", demo("    " + ROW), ROW);
refuse("demo: a quoted row of cells", "DEMO-ROWS", demo(ROW.split(",").map(c => '"' + c + '"').join(",")));
refuse("demo: a row written as an object", "DEMO-ROWS", demo('const r = {s: "ZQX", c: 41.2};'));
refuse("demo: eight commas of numbers", "DEMO-ROWS", demo("const a = [" + Array.from({length: 9}, (_, i) => i + 1.5).join(", ") + "];"));
refuse("demo: writeFile", "DEMO-WRITE", demo('writeFile' + 'Sync("x.csv", "y");'));
refuse("demo: createWriteStream", "DEMO-WRITE", demo('const w = createWrite' + 'Stream("x.csv");'));
refuse("demo: listen(8787)", "DEMO-LISTEN", {"tests/demo.mjs": edit("tests/demo.mjs", 'server.listen(o.port, "127.0.0.1", () => {', "server.listen(8787, () => {")});
refuse("demo: reading the screener's results", "DEMO-READ", demo('const x = readFileSync("../pse-screener/results/latest.csv");'));
refuse("demo: reading a path from argv", "DEMO-READ", demo("const x = readFileSync(process.argv[2]);"));
refuse("demo: another fs import", "DEMO-READ", demo('import {readdirSync} from "node:fs";'));
refuse("demo: a child process", "DEMO-READ", demo('import {execSync} from "node:child_process";'));
refuse("demo: a module that can require", "DEMO-READ", demo('import {createRequire} from "node:module";'));
refuse("demo: a dynamic import", "DEMO-READ", demo('const fs = await import("node:fs");'));
refuse("demo: a fifth file in the map", "DEMO-READ", {"tests/demo.mjs": edit("tests/demo.mjs", '"/icon.png": "icon.png"});', '"/icon.png": "icon.png", "/r": "results/latest.csv"});')});

// 7. The test setup becoming a page feature, or a second stored copy of price data
for (const [what, s] of [["the word demo", "const DEMO_MODE = 1;"], ["a service worker", "navigator.serviceWorker.register;"], ["a cache store", "caches.open;"]]) {
  refuse("code: " + what, "PAGE-DEMO", app('const OWNER = "', s + '\nconst OWNER = "'));
  refuse("markup: " + what, "PAGE-DEMO", page("</main>", "<p>" + s + "</p>\n</main>"));
}
refuse("code: a <link> tag in a string", "LINK-TAGS", app('const OWNER = "', 'const L = \'<link rel="stylesheet" href="x.css">\';\nconst OWNER = "'));
for (const [what, s] of [["an <img src> string", 'const I = \'<img src="x.png">\';'], ["a CSS url(", 'const U = "url(x.png)";'], ["an @import", 'const U = "@import x.css";']])
  refuse("code: " + what, "EXT-LOAD", app('const OWNER = "', s + '\nconst OWNER = "'));

// 8. The key: its date only inside the KEY block, no request there, never in the address, all of it gone on Forget key
refuse("a request inside the KEY block", "KEY-BLOCK", app("/* KEY-END */", "fetch(API);\n/* KEY-END */"));
refuse("gh() inside the KEY block", "KEY-BLOCK", app("/* KEY-END */", 'gh("/x");\n/* KEY-END */'));
refuse("keyExp read outside the KEY block", "KEY-BLOCK", app("function renderBars() {", 'function renderBars() {\n  const e = store.get("keyExp");'));
refuse("the key in the address", "KEY-BLOCK", app('  p.set("p", S.preset);', '  p.set("p", S.preset); p.set("k", S.key);'));
refuse("Forget key leaving keyNag", "KEY-BLOCK", app('store.del("keyExp"); store.del("keyNag"); store.del("cache");', 'store.del("keyExp"); store.del("cache");'));
refuse("KEY markers removed", "KEY-BLOCK", app("/* KEY-START", "/* KEYS-START"));
refuse("keyExp in index.html", "KEY-BLOCK", page("</main>", '<p data-x="keyExp">x</p>\n</main>'));
refuse("KEY markers in index.html", "KEY-BLOCK", page("</style>", "/* KEY-START */ /* KEY-END */\n</style>"));

// 9. The test server refuses to start without exactly one CSP meta tag, loads its fakes by a tag, and answers 404 beyond its files
const html = txt("index.html"), csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/)[0];
for (const [what, h] of [["no CSP", html.replace(csp, "")], ["two CSP tags", html.replace(csp, csp + "\n" + csp)]]) {
  n++; let threw = false; try { inject(h); } catch (e) { threw = /exactly one CSP/.test(e.message); }
  if (!threw) { bad++; console.log(`FAIL demo serve with ${what}: did not refuse`); }
}
{ n++; const out = inject(html), tag = '<script src="fakes.js"></script>';
  if (!/^<!doctype html>[\s\S]*Content-Security-Policy[^>]*>\n<script src="fakes\.js"><\/script>\n/.test(out) || out.replace("\n" + tag, "") !== html) { bad++; console.log("FAIL inject does not put the fakes tag right after the CSP tag, leaving the rest as it is"); } }

const server = spawn(process.execPath, [new URL("./demo.mjs", import.meta.url).pathname, "serve", "--port", "0"], {stdio: ["ignore", "pipe", "inherit"]});
const url = await new Promise((ok, no) => {
  let out = ""; const t = setTimeout(() => no(new Error("demo server did not print demo ready")), 15000);
  server.stdout.on("data", d => { out += d; const m = /demo ready (http:\/\/127\.0\.0\.1:\d+\/)/.exec(out); if (m) { clearTimeout(t); ok(m[1]); } });
});
try {
  for (const [p, want] of [["", 200], ["manifest.webmanifest", 200], ["icon.png", 200], ["results/latest.csv", 404], ["data/holidays.csv", 404],
    ["index.html", 404], ["tests/demo.mjs", 404], ["..%2Fpse-screener%2Fresults%2Flatest.csv", 404], ["app.js", 200], ["app.js?v=x", 200], ["fakes.js", 200], ["app.js.map", 404]]) {
    n++; const r = await fetch(url + p);
    if (r.status !== want) { bad++; console.log(`FAIL demo server GET /${p}: ${r.status}, want ${want}`); }
  }
} finally { server.kill(); }

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`guards OK (${n} checks)`);
