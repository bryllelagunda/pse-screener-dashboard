# pse-screener-dashboard (public)

The dashboard for the private `pse-screener` repository: one `index.html` with no libraries,
served by GitHub Pages at https://bryllelagunda.github.io/pse-screener-dashboard/.

**This repository holds no price data and no key.** PSE EDGE allows personal, non-commercial
viewing only, so results stay in the private repository. The page reads them with a
fine-grained GitHub token kept in your browser's `localStorage`, or from a CSV you open with
**Load CSV**. Never commit a `.csv`, `.json` data file or token here; `tests/static.mjs` fails CI if
you do. It also allows only these files to be committed: `index.html`, `README.md`, `CLAUDE.md`,
`.gitignore`, `docs/wireframe.png`, `tests/*.mjs` and `.github/workflows/*.yml`. Any other file,
or results-shaped CSV text inside an allowed one, fails the check.

## First open on a device

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new):
   repository access **pse-screener** only, permissions **Contents: read** and
   **Actions: read and write**, expiry up to 1 year.
2. Open the page, paste the token, press **Save key**. **Key → Forget key** removes it.

Offline: press **Load CSV** and pick `pse-screener/results/latest.csv`. No key needed.

## Saved filter sets

**Save as…** names the current checkboxes and sliders; each saved set gets its own button next to
Strict, Loose and Custom (up to 20). **Save changes**, **Rename** and **Delete** appear while a saved set
is selected. **Filters** hides the panel and shows a one-line summary instead. Sets and the open/hidden
choice live only in this browser's `localStorage` (`pse.screens`, `pse.filtersOpen`); nothing is sent
anywhere, and **Forget key** leaves them in place. Shared links still carry the values, never set names.

## Checks

```bash
node tests/static.mjs                                  # size, exact CSP, no innerHTML, file allowlist, no data or tokens (CI runs this)
node tests/screens.mjs                                 # saved sets: storage cleaning, name rules, panel summary (CI runs this)
node tests/parity.mjs ../pse-screener ../pse-screener/results/latest.csv
```

`parity.mjs` reads the private repository's `tests/fixtures/filter_cases.json` and any results
CSVs you pass, and fails if the browser's filter logic (between `FILTER-START` and `FILTER-END`
in `index.html`) disagrees with `pse_screener.evaluate` on a pass/fail verdict or reason text.
It also runs the private repository's Python `evaluate` directly over 81 slider settings (using
`../pse-screener/.venv/bin/python` when present, otherwise `python3`) and checks how **Load CSV**
parses edge-case files (BOM, quoted commas and newlines, short rows, CRLF/LF/CR line endings).
Change the filter block and `evaluate` together. The page runs the same check on every load
against the CSV's own `pass_strict` and `pass_loose` columns, and shows a red warning if they
disagree.

Design: `pse-screener/docs/design.md`, sections "How the dashboard reads private data" and
"Dashboard". Wireframe: `docs/wireframe.png`.
