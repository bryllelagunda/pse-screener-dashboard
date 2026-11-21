// Writes index.html's one script tag from the app.js on disk: its address carries a version (?v=) and its integrity
// fingerprint makes the browser refuse any other app.js. Run it after every app.js edit, then commit index.html:
//   node tests/stamp.mjs
// It changes only the script tag's line, and refuses (exit 1, nothing written) unless index.html holds exactly one
// <script, alone on its line, of the form <script src="app.js?v=…" integrity="sha384-…"></script>.
// tests/static.mjs (SCRIPT-TAG) recomputes the same tag, so a stale one fails there and before every push.
// Value: protects=the one tag that lets code onto the page always names the tracked app.js bytes;
//   fails_when=it writes a second tag, edits another line, or writes a tag of another shape;
//   no_claim=whether app.js itself is safe (tests/static.mjs).
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {ROOT, scriptTag, TAG_SHAPE, isMain} from "./static.mjs";

export function stamp(html, js) {
  const lines = html.split("\n"), at = lines.flatMap((l, i) => (l.match(/<script/gi) || []).map(() => i));
  if (at.length !== 1 || !TAG_SHAPE.test(lines[at[0]]))
    return {err: "STAMP-SHAPE index.html: found " + at.length + " script tags (need exactly 1 of the form <script src=\"app.js?v=…\" integrity=\"sha384-…\">)" +
      (at.length ? ": line " + (at[at.length > 1 ? 1 : 0] + 1) : "") + "; nothing written" + (at.length > 1 ? ": remove the extra tag at line " + (at[1] + 1) : "") +
      " (see README.md#stamp-shape)"};
  const tag = scriptTag(js);
  lines[at[0]] = tag;
  return {html: lines.join("\n"), v: tag.match(/\?v=([0-9a-f]+)/)[1]};
}

if (isMain(import.meta.url)) {
  const page = join(ROOT, "index.html"), r = stamp(readFileSync(page, "utf8"), readFileSync(join(ROOT, "app.js")));
  if (r.err) { console.error(r.err); process.exit(1); }
  writeFileSync(page, r.html);
  console.log("index.html updated (v=" + r.v + "): commit it");
}
