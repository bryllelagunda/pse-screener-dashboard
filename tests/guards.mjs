// Refusal tests for tests/static.mjs (plan § 9, the door list): the real tree must pass, then each crafted input
// must fail with its code. Every refused string (a results header, a token, a CSV row, a file write) is built here at
// run time, so this file passes scan() on the real tree with no exemption.
// Runs in CI (no private files needed): node tests/guards.mjs
// Value: protects=every guard that keeps price data and the key out of the public repo and the page loading only itself;
//   fails_when=a guard is moved but no longer called, loosened past the plan, or echoes what it matched;
//   no_claim=what the page does on screen (/qa), and the PR body or screenshots (/cso).
// Section 10 (the before-push check, plan § 3): protects=every pushed commit, message and tag is leak-checked and each
//   tip fully scanned, through the real hooks, without touching the real clone's hooks; fails_when=a leak in history,
//   a merge, a first commit, a message or a tag passes, bad input passes, or ensureHook overwrites another tool's hook;
//   no_claim=a push with --no-verify, or from a clone where node tests/all.mjs never ran.
import {spawn, spawnSync, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {scan, realFiles, scriptTag, ensureHook, HOOK_LOCAL, ROOT} from "./static.mjs";
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
const TAG0 = () => scriptTag(get("app.js"));
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
{ const csp = txt("index.html").match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/)[0];
  refuse("the CSP inside a comment", "CSP", page(csp, "<!-- " + csp + " -->"));
  refuse("a second policy behind an abrupt <!--> comment", "CSP", page(csp, csp + "\n<!--><meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'\"><!-- -->"));
  refuse("the CSP moved into the body", "CSP", {"index.html": B(txt("index.html").replace(csp + "\n", "").replace("<body>", "<body>\n" + csp))});
  refuse("the script tag inside a comment", "SCRIPT-TAG", page(TAG0(), "<!-- " + TAG0() + " -->"));
  refuse("the boot line inside a comment", "SCRIPT-TAG", page(/<p id="boot"[^\n]*<\/p>/.exec(txt("index.html"))[0], "<!-- " + /<p id="boot"[^\n]*<\/p>/.exec(txt("index.html"))[0] + " -->"));
}
refuse("the old policy with 'unsafe-inline' scripts", "CSP", page("script-src 'self';", "script-src 'self' 'unsafe-inline';"));
{ const html = txt("index.html"), csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\n/)[0];
  refuse("the CSP after the script tag", "CSP", {"index.html": B(html.replace(csp, "").replace("</body>", csp + "</body>"))}); }
refuse("innerHTML in the page", "UNSAFE-DOM", page("</main>", '<p title="innerHTML">x</p>\n</main>'));
refuse("innerHTML in the code", "UNSAFE-DOM", app("function el(tag, props, ...kids) {", "function el(tag, props, ...kids) {\n  document.body.innerHTML = tag;"));
for (const s of ['createElement("script")', "createElement('script')", "createElement(`script`)", 'createElement( "script" )', 'createElementNS(ns, "script")',
  'import("./x.js")', 'new Worker("w.js")', 'importScripts("w.js")', 'el("script", {src: "x.js"})', "const t = 'SCRIPT'"])
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
// 5b. A price row anywhere in a line (plan § 4.1): quoted, as JSON, after code, or split by tabs, ; or |; and space-separated
{ const Q3 = String.fromCharCode(81, 81, 88), Q1 = "Q", D = DATE, ZZ = ["Z", "Z", "A"].join("");
  const shapes = s => [["plain", [s, D, "41.2", "3.1", "88000"].join(",")], ["after code", "const x = 1; " + [s, D, "41.2", "3.1", "88000"].join(",")],
    ["double-quoted", [s, D, "41.2", "3.1", "88000"].map(c => '"' + c + '"').join(",")], ["single-quoted", [s, D, "41.2", "3.1", "88000"].map(c => "'" + c + "'").join(",")],
    ["JSON object", JSON.stringify({symbol: s, data_date: D, close: 41.2, chg_pct: 3.1, value_today: 88000})], ["JSON array", JSON.stringify([s, D, 41.2, 3.1, 88000])],
    ["JS object", "{symbol: '" + s + "', data_date: '" + D + "', close: 41.2, chg_pct: 3.1, value: 88000}"], ["tab-separated", [s, D, "41.2", "3.1", "88000"].join("\t")],
    ["semicolon-separated", [s, D, "41.2", "3.1", "88000"].join(";")], ["pipe-separated", [s, D, "41.2", "3.1", "88000"].join("|")],
    ["Markdown table row", "| " + [s, D, "41.2", "3.1", "88000"].join(" | ") + " |"],
    ["space-separated", [s, D, "41.2", "3.1", "88000"].join(" ")], ["space-separated with a two-word name", [s, "Made Up", D, "41.2", "3.1", "88000"].join(" ")]];
  for (const [what, row] of shapes(Q3)) {
    refuse("a row (" + what + ") in README.md", "ROWS", {"README.md": add("README.md", row)}, row);
    refuse("a row (" + what + ") in app.js", "ROWS", app('const OWNER = "', "// " + row + '\nconst OWNER = "'), row);
    refuse("a row (" + what + ") in tests/x.mjs", "ROWS", {"tests/x.mjs": B("const a = 1;\n" + row + "\n")}, row);
  }
  for (const [what, row] of shapes(Q1).filter(([w]) => ["plain", "JSON object", "JSON array", "space-separated"].includes(w)))
    refuse("a one-letter symbol's row (" + what + ") in README.md", "ROWS", {"README.md": add("README.md", row)}, row);
  // the made-up set is the new rules' exemption, not a hole; the old line-start rule keeps refusing any symbol, made-up or not
  for (const [what, row] of shapes(ZZ)) pass("a made-up ZZ symbol's row (" + what + ")", {"README.md": add("README.md", "Made-up: " + row)}, "ROWS");
  refuse("a made-up symbol's row at the start of a line (the old rule)", "ROWS", {"README.md": add("README.md", shapes(ZZ)[0][1])});
  pass("a dated note that is not a row", {"README.md": add("README.md", "T-23 " + D + " shipped 3 of 4 items")}, "ROWS");
  pass("ordinary code starting with a one-letter name", {"tests/x.mjs": B("S, a, b;\nconst q = [Q, 1, 2, 3];\n")}, "ROWS");
}

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
refuse("demo: real-looking numbers beside a DEMO symbol (array)", "DEMO-ROWS", demo('const r = ["DEMOA", 41.2, 3.1, 88000000];'));
refuse("demo: real-looking numbers beside a DEMO symbol (object)", "DEMO-ROWS", demo('const r = {symbol: "DEMOB", close: 41.2, chg_pct: 3.1};'));
pass("demo: DEMO symbols with no numbers", demo('const r = ["DEMOA", "DEMOB"];'), "DEMO-ROWS");
pass("demo: a DEMO symbol with one number", demo('const r = pick("DEMOC", 1);'), "DEMO-ROWS");
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
// 8b. The key is used only as a yes/no check, saved and forgotten in one place each, and sent only in gh()'s header (KEY-USE)
const IN = "function el(tag, props, ...kids) {", inEl = s => app(IN, IN + "\n  " + s + ";");
for (const s of ['location.assign("https://github.com/?k=" + S.key)', "window.open(u)", 'el("a", {href: "https://github.com/?k=" + S.key})', 'fetch(API + "?k=" + S.key)',
  'const k = store.get("key", "")', 'localStorage.getItem("key")', "location.replace(u)", 'location.href = "https://github.com/"', "document.location = u", "send(S.key)",
  'store.set("key", "x")', "S.key = u", "const {key} = S", 'const k = S["key"]', 'fetch("https://api.github.com/x?k=" + (S.key || ""))', "send(S.rows && S.key)", "const k = S.key || x",
  "let k; if (k = S.key) send(k)", "h.if(a && S.key)", "if (send(S.key)) x()"])
  refuse("code: " + s, "KEY-USE", inEl(s));
for (const s of ["window.open(u)", "localStorage.getItem(k)", "S.key"]) refuse("markup: " + s, "KEY-USE", page("</main>", "<!-- " + s + " -->\n</main>"));
for (const s of ["if (!S.key) return", "const t = S.key ? 1 : 2", "const ok = S.key && S.rows", "const k = !!S.key || 0", "if (S.rows && S.key) f()", "while (x || S.key) f()"]) pass("code: " + s, inEl(s), "KEY-USE");
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

// 10. The before-push check, path level (plan § 3, all thirteen cases), in a throwaway repository under the system temp
// folder: its own user, every inherited GIT_* setting cleared and the user's global and system git config cut off, so
// nothing reaches the real repository; the real clone's hooks folder must be byte for byte unchanged afterwards.
{
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  Object.assign(env, {GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0"});
  const run = (cwd, cmd, args, input = "") => spawnSync(cmd, args, {cwd, env, input, encoding: "utf8"});
  const git = (cwd, ...a) => { const r = run(cwd, "git", ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "advice.nestedTag=false", ...a]);
    if (r.status !== 0) throw new Error("guards.mjs: git " + a.join(" ") + ": " + r.stderr); return r.stdout.trim(); };
  const realHooks = join(resolve(ROOT, execFileSync("git", ["rev-parse", "--git-common-dir"], {cwd: ROOT}).toString().trim()), "hooks");
  const snap = () => { try { return readdirSync(realHooks).sort().map(f => f + ":" + statSync(join(realHooks, f)).mode + ":" + readFileSync(join(realHooks, f)).toString("base64")).join("|"); } catch { return "none"; } };
  const before = snap(), base = mkdtempSync(join(tmpdir(), "pse-dash-hook-")), work = join(base, "work"), bare = join(base, "origin.git"), stg = join(base, "staging.git");
  const ok = (cond, what) => { n++; if (!cond) { bad++; console.log("FAIL pre-push " + what); } };
  const Z = "0".repeat(40);
  try {
    git(base, "init", "-q", "--bare", bare); git(base, "init", "-q", "--bare", stg); git(base, "init", "-q", "-b", "main", work);
    git(work, "config", "user.name", "Made Up"); git(work, "config", "user.email", "made-up@example.invalid");
    for (const f of real) { mkdirSync(dirname(join(work, f.path)), {recursive: true}); writeFileSync(join(work, f.path), f.bytes); }
    git(work, "add", "-A"); git(work, "commit", "-q", "-m", "seed"); git(work, "remote", "add", "origin", bare); git(work, "push", "-q", "origin", "main");
    const hooks = join(work, ".git", "hooks"), H = f => join(hooks, f);
    const eh = () => ensureHook({cwd: work, env});
    ok(eh().ok && readFileSync(H("pre-push.local"), "utf8") === HOOK_LOCAL, "ensureHook switches the check on in a fresh clone");
    const pp = (input, remote = "origin") => run(work, process.execPath, [join(work, "tests", "prepush.mjs"), remote, remote === "origin" ? bare : remote], input);
    const line = (ref, sha) => ref + " " + sha + " " + ref + " " + Z + "\n";
    const commit = (msg, edits) => { // edits: {path: text|Buffer|null}
      for (const [p, v] of Object.entries(edits)) { if (v === null) git(work, "rm", "-q", p); else { mkdirSync(dirname(join(work, p)), {recursive: true}); writeFileSync(join(work, p), v); git(work, "add", "-f", p); } }
      git(work, "commit", "-q", "--allow-empty", "-m", msg); return git(work, "rev-parse", "HEAD");
    };
    const branch = b => git(work, "checkout", "-q", "-B", b, "main");
    const CSV = HEADER + "\n";
    // 1. a clean commit
    branch("c1"); const c1 = commit("a clean change", {"README.md": txt("README.md") + "\nclean\n"});
    { const r = pp(line("refs/heads/c1", c1)); ok(r.status === 0 && /^pre-push: [1-9]\d* commits checked, static OK$/m.test(r.stdout), "1: a clean commit passes with the pre-push line"); }
    // 2. a results file added, then deleted: still refused (history is public too)
    branch("c2"); const a2 = commit("add", {"results/latest.csv": CSV}), b2 = commit("remove", {"results/latest.csv": null});
    { const r = pp(line("refs/heads/c2", b2)); ok(r.status === 1 && r.stderr.includes("ALLOWLIST commit " + a2.slice(0, 7) + " results/latest.csv") && r.stderr.includes("nothing was pushed") &&
      r.stderr.includes("git reset --soft $(git merge-base HEAD origin/main) && git commit") && !r.stderr.includes(HEADER) && /push refused$/.test(r.stderr.trim()), "2: a results file added then deleted is refused, with the history fix"); }
    // 3. a token in a commit message
    branch("c3"); const c3 = commit("note " + TOKEN, {"README.md": txt("README.md") + "\nx\n"});
    { const r = pp(line("refs/heads/c3", c3)); ok(r.status === 1 && r.stderr.includes("TOKEN commit " + c3.slice(0, 7) + " message") && !r.stderr.includes(TOKEN) && r.stderr.includes("git commit --amend"), "3: a token in a message is refused, not echoed, with the message fix"); }
    // 4. a branch deletion
    { const r = run(work, process.execPath, [join(work, "tests", "prepush.mjs"), "origin", bare], "refs/heads/gone " + Z + " refs/heads/gone " + c1 + "\n"); ok(r.status === 0, "4: a branch deletion passes"); }
    // 5. a half-finished middle commit (an old-size page, no app.js), complete tip
    branch("c5"); commit("half", {"index.html": txt("index.html") + "<!-- " + "x".repeat(41 * 1024) + " -->\n", "app.js": null});
    const c5 = commit("whole", {"index.html": txt("index.html"), "app.js": get("app.js")});
    { const r = pp(line("refs/heads/c5", c5)); ok(r.status === 0, "5: a half-finished middle commit passes when the tip is complete"); }
    // 6. a tip that fails scan(): app.js changed without restamping
    branch("c6"); const c6 = commit("unstamped", {"app.js": Buffer.concat([get("app.js"), B("// x\n")])});
    { const r = pp(line("refs/heads/c6", c6)); ok(r.status === 1 && r.stderr.includes("SCRIPT-TAG index.html:"), "6: a tip with an unstamped script tag is refused"); }
    // 7. ensureHook's refusals (nothing written, the fix printed), a newer add-on left alone, and the add-on's own branch rules
    const keep = f => readFileSync(H(f), "utf8");
    writeFileSync(H("pre-push.local"), "#!/bin/sh\necho another tool\n", {mode: 0o755});
    { const r = eh(); ok(!r.ok && r.msg.includes("holds another tool's add-on") && r.msg.includes("mv ") && keep("pre-push.local").includes("another tool"), "7: a foreign pre-push.local is refused and kept"); }
    writeFileSync(H("pre-push.local"), HOOK_LOCAL.replace(" check v1 ", " check v9 "), {mode: 0o755});
    { const r = eh(); ok(r.ok && r.msg.includes("newer add-on") && keep("pre-push.local").includes(" v9 "), "7: a higher-version add-on is left alone"); }
    writeFileSync(H("pre-push.local"), HOOK_LOCAL, {mode: 0o755});
    const mainHook = keep("pre-push"); writeFileSync(H("pre-push"), "#!/bin/sh\nexit 0\n", {mode: 0o755});
    { const r = eh(); ok(!r.ok && r.msg.includes("does not call pre-push.local") && keep("pre-push") === "#!/bin/sh\nexit 0\n", "7: a pre-push without the .local call is refused and kept"); }
    writeFileSync(H("pre-push"), "#!/bin/sh\n# runs pre-push.local\nexit 0\n", {mode: 0o755});
    { const r = eh(); ok(!r.ok && r.msg.includes("does not call pre-push.local"), "7: a pre-push naming pre-push.local only in a comment is refused"); }
    writeFileSync(H("pre-push"), "#!/bin/sh\nexit 0 # pre-push.local\n", {mode: 0o755});
    { const r = eh(); ok(!r.ok && r.msg.includes("does not call pre-push.local"), "7: a pre-push naming pre-push.local only in a trailing comment is refused"); }
    writeFileSync(H("pre-push"), mainHook, {mode: 0o755});
    writeFileSync(H("pre-push.local"), "#!/bin/sh\n# pse-screener-dashboard before-push check v9 (x)\nexit 0\n", {mode: 0o755});
    { const r = eh(); ok(!r.ok && keep("pre-push.local").includes("exit 0"), "7: a higher-version marker that never runs the checker is refused, not trusted"); }
    writeFileSync(H("pre-push.local"), HOOK_LOCAL, {mode: 0o755});
    git(work, "config", "core.hooksPath", "elsewhere");
    { const r = eh(); ok(!r.ok && r.msg.includes("(local config)") && r.msg.includes("git config --unset core.hooksPath"), "7: core.hooksPath in local config is refused with its unset"); }
    git(work, "config", "--unset", "core.hooksPath"); git(work, "config", "extensions.worktreeConfig", "true"); git(work, "config", "--worktree", "core.hooksPath", "elsewhere");
    { const r = eh(); ok(!r.ok && r.msg.includes("(worktree config)") && r.msg.includes("git config --worktree --unset core.hooksPath"), "7: core.hooksPath in worktree config is refused with its unset"); }
    git(work, "config", "--worktree", "--unset", "core.hooksPath");
    ok(eh().ok, "7: the slot is on again");
    branch("c7"); const c7 = commit("old branch", {"tests/prepush.mjs": null}); git(work, "fetch", "-q", "origin");
    { const r = run(work, "sh", [H("pre-push.local"), "origin", bare], line("refs/heads/c7", c7)); ok(r.status === 1 && r.stderr.includes("git fetch origin && git rebase origin/main"), "7: a branch without the check is refused once main has it"); }
    const om = git(work, "rev-parse", "refs/remotes/origin/main"); git(work, "update-ref", "refs/remotes/origin/main", c7);
    { const r = run(work, "sh", [H("pre-push.local"), "origin", bare], line("refs/heads/c7", c7)); ok(r.status === 0 && r.stderr.includes("warning"), "7: before the release (or after a revert) it only warns"); }
    git(work, "update-ref", "refs/remotes/origin/main", om);
    branch("c7e"); const c7e = commit("empty checker", {"tests/prepush.mjs": ""});
    { const r = run(work, "sh", [H("pre-push.local"), "origin", bare], line("refs/heads/c7e", c7e)); ok(r.status === 1 && r.stderr.includes("did not report a check"), "7: an empty tests/prepush.mjs is refused, never a silent pass"); }
    // 8. a real git push through the hooks: the leaking branch never arrives, the clean one does
    git(work, "checkout", "-q", "c2");
    { const r = run(work, "git", ["push", "-q", "origin", "c2"]); ok(r.status !== 0 && run(base, "git", ["--git-dir", bare, "cat-file", "-e", a2]).status !== 0, "8: git push refuses the leaking branch and the remote lacks its commits"); }
    git(work, "checkout", "-q", "c1");
    { const r = run(work, "git", ["push", "-q", "origin", "c1"]); ok(r.status === 0 && run(base, "git", ["--git-dir", bare, "cat-file", "-e", c1]).status === 0, "8: git push sends the clean branch"); }
    // 9. garbage input and no input
    { const r = pp("garbage\n"); ok(r.status === 1 && r.stderr.includes("pre-push: internal error") && r.stderr.includes("push refused"), "9: a garbage input line is an internal error, push refused"); }
    { const r = pp(""); ok(r.status === 1 && r.stderr.includes("no refs received"), "9: empty input is refused"); }
    { const r = pp(line("refs/heads/x-" + TOKEN, c1)); ok(r.status === 1 && r.stderr.includes("TOKEN a pushed ref name") && !r.stderr.includes(TOKEN), "9: a token in a pushed ref name is refused, not echoed"); }
    { const ln = join(base, "link"); symlinkSync(work, ln); // a workspace reached through a symlink must still run the check, not exit 0 silently
      const r = run(ln, process.execPath, [join(ln, "tests", "prepush.mjs"), "origin", bare], line("refs/heads/c2", b2)); ok(r.status === 1 && r.stderr.includes("ALLOWLIST"), "9: run through a symlinked folder, it still refuses"); }
    // 10. a merge whose resolution adds a results file, then a deletion; an orphan branch whose first commit adds one
    branch("side"); commit("side", {"README.md": txt("README.md") + "\nside\n"}); branch("m"); commit("main side", {"CLAUDE.md": txt("CLAUDE.md") + "\nm\n"});
    git(work, "merge", "-q", "--no-commit", "--no-ff", "side");
    mkdirSync(join(work, "results"), {recursive: true}); writeFileSync(join(work, "results", "latest.csv"), CSV); git(work, "add", "-f", "results/latest.csv"); git(work, "commit", "-q", "-m", "merge");
    const mg = git(work, "rev-parse", "HEAD"), m2 = commit("remove", {"results/latest.csv": null});
    { const r = pp(line("refs/heads/m", m2)); ok(r.status === 1 && r.stderr.includes("ALLOWLIST commit " + mg.slice(0, 7) + " results/latest.csv"), "10: a merge resolution adding a results file is refused"); }
    git(work, "checkout", "-q", "--orphan", "o", "main"); const o1 = commit("root", {"results/latest.csv": CSV});
    { const r = pp(line("refs/heads/o", o1)); ok(r.status === 1 && r.stderr.includes("ALLOWLIST commit " + o1.slice(0, 7)), "10: an orphan branch's first commit is checked"); }
    // 11. annotated tags: a token in its message, a clean tag wrapping a dirty one, a tag straight at a blob
    git(work, "tag", "-a", "t1", "-m", "t " + TOKEN, c1); git(work, "tag", "-a", "t2", "-m", "clean", "t1");
    const blob = run(work, "git", ["hash-object", "-w", "--stdin"], "x").stdout.trim(); git(work, "tag", "t3", blob);
    for (const [t, what, want] of [["t1", "a token in a tag message", "TOKEN tag"], ["t2", "a clean tag wrapping a dirty one", "TOKEN tag"], ["t3", "a tag at a blob", "TAG-TARGET refs/tags/t3"]]) {
      const r = pp(line("refs/tags/" + t, git(work, "rev-parse", t))); ok(r.status === 1 && r.stderr.includes(want) && !r.stderr.includes(TOKEN), "11: " + what + " is refused");
    }
    // 12. a staging remote holding A (adds a results file) and B (deletes it); C on top, pushed by the destination's URL
    branch("c12"); const A = commit("A", {"results/latest.csv": CSV}), Bc = commit("B", {"results/latest.csv": null});
    git(stg, "fetch", "-q", work, "c12:refs/heads/main"); git(work, "remote", "add", "staging", stg); git(work, "fetch", "-q", "staging");
    const C = commit("C", {"README.md": txt("README.md") + "\nC\n"});
    { const r = run(work, "git", ["push", "-q", bare, "c12:refs/heads/c12"]);
      ok(r.status !== 0 && [A, Bc, C].every(x => run(base, "git", ["--git-dir", bare, "cat-file", "-e", x]).status !== 0), "12: a push by URL checks the whole history: refused, the destination lacks A, B and C"); }
    // 13. a picture replaced by another valid PNG, then restored
    const png = Buffer.concat([SIG, chunk("IHDR", ihdr(512)), chunk("IDAT", Buffer.alloc(16)), chunk("IEND", Buffer.alloc(0))]);
    for (const [p, code] of [["docs/wireframe.png", "WIREFRAME"], ["icon.png", "ICON"]]) {
      branch("c13"); commit("swap", {[p]: png}); const t13 = commit("restore", {[p]: get(p)});
      const r = pp(line("refs/heads/c13", t13)); ok(r.status === 1 && r.stderr.includes(code + " commit "), "13: " + p + " swapped then restored is refused (" + code + ")");
    }
  } catch (e) { n++; bad++; console.log("FAIL pre-push path test: " + e.message); }
  finally { rmSync(base, {recursive: true, force: true}); }
  ok(snap() === before, "the real clone's hooks folder is unchanged");
}

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`guards OK (${n} checks)`);
