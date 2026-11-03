# pse-screener-dashboard

Public GitHub Pages dashboard for the private `pse-screener` repo. Never commit price data
(`.csv`, data `.json`) or tokens here. Spec: `../pse-screener/docs/design.md`.

## Testing

- `node tests/static.mjs`: size, exact CSP, no unsafe DOM writes, no data or tokens. CI runs it.
  It allowlists committed files (`index.html`, `README.md`, `CLAUDE.md`, `.gitignore`,
  `docs/wireframe.png`, `tests/*.mjs`, `.github/workflows/*.yml`); adding any other file means
  updating that allowlist.
- `node tests/parity.mjs ../pse-screener [results.csv ...]`: browser filter logic vs
  `pse_screener.evaluate`, including 81 slider settings run through Python directly
  (`../pse-screener/.venv/bin/python` if present, else `python3`) and parseCSV edge cases
  (needs the private repo cloned beside this one; local only).
