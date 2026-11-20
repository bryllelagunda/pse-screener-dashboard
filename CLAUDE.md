# pse-screener-dashboard

Public GitHub Pages dashboard for the private `pse-screener` repo. Never commit price data
(`.csv`, data `.json`) or tokens here. Spec: `../pse-screener/docs/design.md`.

## Testing

- **Run `node tests/all.mjs` on the final tree before every push, and never push while it is red.**
  (A rule, not an enforced check: CI runs after the push, when the commit is already public.)
- `node tests/static.mjs`: size, CSP, the three `<link>` tags, file allowlist, manifest, icon, no unsafe
  DOM writes, no data, rows or tokens. `node tests/guards.mjs`: a refusal test for each of its guards. CI runs both.
- `node tests/key.mjs`, `summary.mjs`, `screens.mjs`, `status.mjs`, `history.mjs`: the page's marked blocks. CI.
- `node tests/demo.mjs serve|check`: the page with made-up data on 127.0.0.1 for `/qa` and `/design-review`
  (`--help` lists the flags); `check` runs in CI.
- `node tests/icon.mjs`: rebuilds `icon.png`.
- `node tests/parity.mjs ../pse-screener [results.csv ...]`: browser filter logic vs
  `pse_screener.evaluate` (needs the private repo cloned beside this one; local only).
