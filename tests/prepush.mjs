// The before-push check (plan § 3): git's pre-push hook runs it through gstack's hook and .git/hooks/pre-push.local
// (both written by node tests/all.mjs). It reads git's input lines (<local ref> <local sha> <remote ref> <remote sha>):
//   every commit the destination doesn't have yet (merges and first commits included): the leak checks of
//     tests/static.mjs on each file it adds, changes or retypes, read from that commit, and on its message;
//   every annotated tag on the way: its message; a ref that ends in a tree or a blob is refused (TAG-TARGET);
//   each pushed tip: the full scan() CI runs.
// Never echoes what it matched. Success prints "pre-push: <n> commits checked, static OK"; a refusal prints the codes,
// where, "nothing was pushed", one fix, then "push refused", and exits 1.
// Value: protects=a key, results file or row never reaches the public repo, even in history or a message;
//   fails_when=a leak in a middle commit, a deleted file, a merge, a first commit, a message or a tag passes, or bad
//   input passes silently; no_claim=a push with --no-verify, from a clone where node tests/all.mjs never ran, or a
//   commit made on github.com (plan § 3 "What it can't stop").
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {leaks, scan, textLeaks, treeFiles, say, isMain} from "./static.mjs";

const ZERO = /^0+$/, SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const HIST_FIX = "git reset --soft $(git merge-base HEAD origin/main) && git commit (rebuilds the branch as one commit without it)";

export function prepush(input, args, o = {}) {
  let last = "";
  const git = a => { last = "git " + a.join(" "); return execFileSync("git", a, {cwd: o.cwd || process.cwd(), env: o.env || process.env, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"]}); };
  const str = a => git(a).toString("utf8");
  try {
    const lines = input.split("\n").filter(l => l.trim());
    if (!lines.length) return {code: 1, err: "pre-push: no refs received; push refused\nfix: update gstack's hook (it must pass git's input to pre-push.local), then node tests/all.mjs (see README.md#pre-push)"};
    const refs = lines.map(l => {
      const f = l.split(" ");
      if (f.length !== 4 || !SHA.test(f[1]) || !SHA.test(f[3])) throw new Error("an input line is not <local ref> <local sha> <remote ref> <remote sha>");
      return {ref: f[0], sha: f[1]};
    });
    const remote = args[0] || "", named = remote && str(["remote"]).split("\n").includes(remote);
    const out = [], seen = new Set();
    for (const {ref, sha} of refs) {
      if (ZERO.test(sha)) continue; // a deletion sends nothing
      let obj = sha, type = str(["cat-file", "-t", obj]).trim();
      while (type === "tag") { // every tag message on the way down to the commit
        const body = str(["cat-file", "-p", obj]);
        for (const e of textLeaks(body.slice(body.indexOf("\n\n") + 2))) out.push(e.code + " tag " + obj.slice(0, 7) + " message; nothing was pushed\nfix: git tag -d <tag>, make it again with a clean message (see README.md#" + e.code.toLowerCase() + ")");
        obj = /^object ([0-9a-f]+)$/m.exec(body)[1]; type = str(["cat-file", "-t", obj]).trim();
      }
      if (type !== "commit") { out.push("TAG-TARGET " + ref + " points at a " + type + ", not a commit; nothing was pushed\nfix: git tag -d <tag> (or point the ref at a commit), then push again (see README.md#tag-target)"); continue; }
      const tip = obj, newer = str(["rev-list", tip, ...(named ? ["--not", "--remotes=" + remote] : [])]).split("\n").filter(Boolean);
      for (const c of newer) {
        if (seen.has(c)) continue;
        seen.add(c);
        const short = c.slice(0, 7), raw = str(["diff-tree", "-r", "--root", "--no-renames", "-m", "--first-parent", "--diff-filter=d", "--no-commit-id", "-z", c]).split("\0");
        const files = [];
        for (let i = 0; i + 1 < raw.length; i += 2) {
          const [, mode, , oid] = raw[i].replace(/^:/, "").split(" "), path = raw[i + 1]; // :<old mode> <new mode> <old oid> <new oid> <status>
          if (!path) continue;
          files.push({path, bytes: /^160000$/.test(mode) ? Buffer.from("") : git(["cat-file", "blob", oid])});
        }
        for (const e of leaks(files)) out.push(e.code + " commit " + short + " " + e.path + ":" + e.line + " " + e.msg + "; nothing was pushed\nfix: " + HIST_FIX + " (see README.md#" + e.code.toLowerCase() + ")");
        const msg = str(["show", "-s", "--format=%B", c]);
        for (const e of textLeaks(msg)) out.push(e.code + " commit " + short + " message; nothing was pushed\nfix: " + (c === tip ? 'on the tip: git commit --amend -m "<new message>"' : HIST_FIX) + " (see README.md#" + e.code.toLowerCase() + ")");
      }
      const t = scan(treeFiles(tip, o));
      if (t.length) out.push(...t.map(e => say(e).replace(/ \(see /, "; nothing was pushed (see ")));
    }
    if (out.length) return {code: 1, err: [...new Set(out)].join("\n") + "\npush refused"};
    return {code: 0, out: "pre-push: " + seen.size + " commits checked, static OK"};
  } catch (e) {
    const stack = String(e.stack || "").split("\n").slice(1, 4).map(l => l.trim()).join(" < ");
    return {code: 1, err: "pre-push: internal error (" + String(e.message || e).split("\n")[0] + "; failed: " + (last || "before any git call") + "), push refused\n  " + stack +
      "\nfix: re-run the push; if it repeats, report this line (see README.md#pre-push)"};
  }
}

if (isMain(import.meta.url)) {
  const r = prepush(readFileSync(0, "utf8"), process.argv.slice(2));
  if (r.out) console.log(r.out);
  if (r.err) console.error(r.err);
  process.exitCode = r.code; // not process.exit(): it can cut off output to a pipe
}
