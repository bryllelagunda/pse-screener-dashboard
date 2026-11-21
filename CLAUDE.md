# pse-screener-dashboard

Public GitHub Pages dashboard for the private `pse-screener` repo. Never commit price data
(`.csv`, data `.json`) or tokens here. Spec: `../pse-screener/docs/design.md`.

## Changing the page

- `index.html` is markup and styles; `app.js` is all the code. After any `app.js` edit run `node tests/stamp.mjs`
  and commit `index.html` with it (a stale script tag fails `static.mjs` and the push).
- A conflict on the script-tag line: keep either side, run `node tests/stamp.mjs`, commit.
- **Never `git push --no-verify`; branch from the current main.** Every push runs the before-push check
  (`tests/prepush.mjs`, through gstack's hook and `.git/hooks/pre-push.local`, which `node tests/all.mjs` writes).
- Reverting the split: delete `.git/hooks/pre-push.local` before pushing the revert branch (README "Changing the code").

## Testing

- **Run `node tests/all.mjs` on the final tree before every push, and never push while it is red.** Its first
  row switches the before-push check on; the check then refuses a leak in any pushed commit, message or tag.
- `node tests/static.mjs`: size, CSP, the one script tag, the three `<link>` tags, file allowlist, manifest, icon,
  no unsafe DOM writes, no data, rows or tokens, the key's uses. `node tests/guards.mjs`: a refusal test for each of
  its guards, and the before-push check in a throwaway repository. CI runs both.
- `node tests/key.mjs`, `summary.mjs`, `screens.mjs`, `status.mjs`, `history.mjs`: `app.js`'s marked blocks. CI.
- `node tests/demo.mjs serve|check`: the page with made-up data on 127.0.0.1 for `/qa` and `/design-review`
  (`--help` lists the flags); `check` runs in CI.
- `node tests/icon.mjs`: rebuilds `icon.png`.
- `node tests/parity.mjs ../pse-screener [results.csv ...]`: browser filter logic vs
  `pse_screener.evaluate` (needs the private repo cloned beside this one; local only).
