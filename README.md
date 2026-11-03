# pse-screener-dashboard (public)

The dashboard for the private `pse-screener` repository: one `index.html` with no libraries,
served by GitHub Pages at https://bryllelagunda.github.io/pse-screener-dashboard/.

**This repository holds no price data and no key.** PSE EDGE allows personal, non-commercial
viewing only, so results stay in the private repository. The page reads them with a
fine-grained GitHub token kept in your browser's `localStorage`, or from a CSV you open with
**Load CSV**. Never commit a `.csv`, `.json` data file or token here; `tests/static.mjs` fails CI if
you do.

## First open on a device

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new):
   repository access **pse-screener** only, permissions **Contents: read** and
   **Actions: read and write**, expiry up to 1 year.
2. Open the page, paste the token, press **Save key**. **Key → Forget key** removes it.

Offline: press **Load CSV** and pick `pse-screener/results/latest.csv`. No key needed.

## Checks

```bash
node tests/static.mjs                                  # size, CSP, no innerHTML, no data or tokens (CI runs this)
node tests/parity.mjs ../pse-screener ../pse-screener/results/latest.csv
```

`parity.mjs` reads the private repository's `tests/fixtures/filter_cases.json` and any results
CSVs you pass, and fails if the browser's filter logic (between `FILTER-START` and `FILTER-END`
in `index.html`) disagrees with `pse_screener.evaluate` on a pass/fail verdict or reason text.
Change the two together. The page runs the same check on every load against the CSV's own
`pass_strict` and `pass_loose` columns, and shows a red warning if they disagree.

Design: `pse-screener/docs/design.md`, sections "How the dashboard reads private data" and
"Dashboard". Wireframe: `docs/wireframe.png`.
