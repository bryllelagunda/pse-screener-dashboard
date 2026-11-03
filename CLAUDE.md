# pse-screener-dashboard

Public GitHub Pages dashboard for the private `pse-screener` repo. Never commit price data
(`.csv`, data `.json`) or tokens here. Spec: `../pse-screener/docs/design.md`.

## Testing

- `node tests/static.mjs`: size, CSP, no unsafe DOM writes, no data or tokens. CI runs it.
- `node tests/parity.mjs ../pse-screener [results.csv ...]`: browser filter logic vs
  `pse_screener.evaluate` (needs the private repo cloned beside this one; local only).
