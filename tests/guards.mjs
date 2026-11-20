// Refusal tests for tests/static.mjs (plan § 9, the door list): the real tree must pass, then each crafted input
// must fail with its code. Every refused string (a results header, a token, a CSV row, a file write) is built here at
// run time, so this file passes scan() on the real tree with no exemption.
// Runs in CI (no private files needed): node tests/guards.mjs
// Value: protects=every guard that keeps price data and the key out of the public repo and the page loading only itself;
//   fails_when=a guard is moved but no longer called, loosened past the plan, or echoes what it matched;
//   no_claim=what the page does on screen (/qa), and the PR body or screenshots (/cso).
import {spawn} from "node:child_process";
import {scan, realFiles} from "./static.mjs";
import {inject} from "./demo.mjs";

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
const page = (a, b) => ({"index.html": edit("index.html", a, b)});

// Crafted strings, assembled so this file never holds them
const HEADER = ["symbol", "name", "data_date", "close"].join(",");
const PASSES = ["pass", "strict,pass", "loose"].join("_");
const TOKEN = "github" + "_pat_" + "Q7".repeat(15);
const ROW = ["ZQ", "X"].join("") + "," + ["Some Holdings Inc", "2026-11-20", "12.5", "3.1", "88000000", "true", "false"].join(",");

// 0. The real tree passes (a check that is moved but no longer called would still pass here, so every case below matters)
{ n++; const r = scan(real); if (r.length) { bad++; console.log("FAIL the real tree: " + r.map(e => e.code + " " + e.path + ":" + e.line).join("; ")); } }

// 1. A new tracked file
for (const p of ["data.json", "manifest.json", "icon2.png", "tests/Demo.mjs", "results/latest.csv", "docs/shot.png"]) refuse("new file " + p, "ALLOWLIST", {[p]: B("x")});
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
refuse("a script src", "EXT-LOAD", page("<script>", '<script src="app.js"></script>\n<script>'));
refuse("an image before the CSP", "EXT-LOAD", page("<head>", '<head>\n<img src="https://github.com/favicon.ico">'));
for (const tag of ['<link rel="stylesheet" href = "https://github.com/x.css">', '<script/src="app.js"></script>', '<img/src="https://github.com/favicon.ico">', '<base href="https://github.com/">'])
  refuse("before the CSP: " + tag, "EXT-LOAD", page("<head>", "<head>\n" + tag));
for (const tag of ['<iframe src="x.html"></iframe>', '<img srcset="a.png 2x">', '<video poster="p.png"></video>', '<object data="x.pdf"></object>'])
  refuse("a resource tag: " + tag, "EXT-LOAD", page("</body>", tag + "\n</body>"));
refuse("a host in the page", "HOSTS", page('const OWNER = "', 'const EDGE = "https://edge.pse.com.ph";\nconst OWNER = "'));
refuse("a protocol-relative address", "HOSTS", page('const OWNER = "', 'const X = "//cdn.example/x.js";\nconst OWNER = "'));
refuse("an added img-src * in the CSP", "CSP", page("form-action 'none'\">", "form-action 'none'; img-src *\">"));
refuse("innerHTML", "UNSAFE-DOM", page("function el(tag, props, ...kids) {", "function el(tag, props, ...kids) {\n  document.body.innerHTML = tag;"));
refuse("over 128 KB", "SIZE", page("</body>", "<!-- " + "x".repeat(128 * 1024) + " -->\n</body>"));

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
refuse("demo: a fourth file in the map", "DEMO-READ", {"tests/demo.mjs": edit("tests/demo.mjs", '"/icon.png": "icon.png"});', '"/icon.png": "icon.png", "/r": "results/latest.csv"});')});

// 7. The test setup becoming a page feature, or a second stored copy of price data
for (const [what, s] of [["the word demo", "const DEMO_MODE = 1;"], ["a service worker", "navigator.serviceWorker.register;"], ["a cache store", "caches.open;"]])
  refuse("page: " + what, "PAGE-DEMO", page('const OWNER = "', s + '\nconst OWNER = "'));

// 8. The key: its date only inside the KEY block, no request there, never in the address, all of it gone on Forget key
refuse("a request inside the KEY block", "KEY-BLOCK", page("/* KEY-END */", "fetch(API);\n/* KEY-END */"));
refuse("gh() inside the KEY block", "KEY-BLOCK", page("/* KEY-END */", 'gh("/x");\n/* KEY-END */'));
refuse("keyExp read outside the KEY block", "KEY-BLOCK", page("function renderBars() {", 'function renderBars() {\n  const e = store.get("keyExp");'));
refuse("the key in the address", "KEY-BLOCK", page('  p.set("p", S.preset);', '  p.set("p", S.preset); p.set("k", S.key);'));
refuse("Forget key leaving keyNag", "KEY-BLOCK", page('store.del("keyExp"); store.del("keyNag"); store.del("cache");', 'store.del("keyExp"); store.del("cache");'));
refuse("KEY markers removed", "KEY-BLOCK", page("/* KEY-START", "/* KEYS-START"));

// 9. The test server refuses to start without exactly one CSP meta tag, and answers 404 beyond its three files
const html = txt("index.html"), csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/)[0];
for (const [what, h] of [["no CSP", html.replace(csp, "")], ["two CSP tags", html.replace(csp, csp + "\n" + csp)]]) {
  n++; let threw = false; try { inject(h); } catch (e) { threw = /exactly one CSP/.test(e.message); }
  if (!threw) { bad++; console.log(`FAIL demo serve with ${what}: did not refuse`); }
}
{ n++; if (!/^<!doctype html>[\s\S]*Content-Security-Policy[^>]*>\n<script>\(function browserFakes/.test(inject(html))) { bad++; console.log("FAIL inject does not put the fakes right after the CSP tag"); } }

const server = spawn(process.execPath, [new URL("./demo.mjs", import.meta.url).pathname, "serve", "--port", "0"], {stdio: ["ignore", "pipe", "inherit"]});
const url = await new Promise((ok, no) => {
  let out = ""; const t = setTimeout(() => no(new Error("demo server did not print demo ready")), 15000);
  server.stdout.on("data", d => { out += d; const m = /demo ready (http:\/\/127\.0\.0\.1:\d+\/)/.exec(out); if (m) { clearTimeout(t); ok(m[1]); } });
});
try {
  for (const [p, want] of [["", 200], ["manifest.webmanifest", 200], ["icon.png", 200], ["results/latest.csv", 404], ["data/holidays.csv", 404],
    ["index.html", 404], ["tests/demo.mjs", 404], ["..%2Fpse-screener%2Fresults%2Flatest.csv", 404]]) {
    n++; const r = await fetch(url + p);
    if (r.status !== want) { bad++; console.log(`FAIL demo server GET /${p}: ${r.status}, want ${want}`); }
  }
} finally { server.kill(); }

if (bad) { console.log(`${bad} of ${n} checks failed`); process.exit(1); }
console.log(`guards OK (${n} checks)`);
