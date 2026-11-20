# pse-screener-dashboard (public)

The dashboard for the private `pse-screener` repository: one `index.html` with no libraries,
served by GitHub Pages at https://bryllelagunda.github.io/pse-screener-dashboard/.

**This repository holds no price data and no key.** PSE EDGE allows personal, non-commercial
viewing only, so results stay in the private repository. The page reads them with a
fine-grained GitHub token kept in your browser's `localStorage`. Never commit a `.csv`, `.json` data
file or token here; `tests/static.mjs` fails CI if you do. It also allows only these files to be
committed: `index.html`, `README.md`, `CLAUDE.md`, `.gitignore`, `manifest.webmanifest`, `icon.png`,
`docs/wireframe.png`, `tests/*.mjs` and `.github/workflows/*.yml`. Any other file, results-shaped CSV
text or a line that starts like a stock row inside an allowed one, or a changed picture, fails the check.

## First open on a device

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new):
   repository access **pse-screener** only, permissions **Contents: read** and
   **Actions: read and write**, expiring in 90 days.
2. Open the page, paste the token, check the date it runs out (filled in as today + 90 days), press
   **Save key**. **Key → Forget key** removes the key, its date and the saved results.

## Key reminders

The page keeps the key's end date (`pse.keyExp`) on this device only; it never goes into a request, the
address or a log. From 14 days before, a bar says how many days are left (warning colour from 3 days, "may
stop working today" on the day), with **How to renew** (the four renewal steps) and **Later** (hides it until
the next stage). When the date has passed, or GitHub refuses the key, a red bar says so. A key saved before
this version asks for its end date (**Add date**; **Later** asks again after 30 days). Each device, and the iPhone home-screen app, keeps its
own key and date.

## Home screen

`manifest.webmanifest` and `icon.png` let a phone add the page to its home screen (no service worker; the
page still reads GitHub each time). On a phone, **Key**, **Add to home screen** (its steps; hidden inside the
home-screen app) and **Refresh** sit in the **⋯** menu. Coming back to the page after 10 minutes reloads it.
`node tests/icon.mjs` rebuilds the icon; `tests/static.mjs` checks the committed one matches.

## Stock history

The page also reads the private `results/history.csv` (written by the screener's runs), after the table
is on screen, and keeps it in the same `localStorage` cache as `latest.csv`. It adds:

- **Days in** (sortable, right after Symbol): sessions in a row on the selected preset, today included.
  `…` while history loads, `—` when there is none yet, it can't be read, or the view is Custom
  (history covers Strict and Loose only). A **BOTH** badge marks stocks on Strict and Loose today.
- **Knocking on the door:** stocks that missed a preset by one rule 3+ sessions running (data gaps
  such as no trade or no market cap never count).
- **Search** replaces the table while the box has text: every stock in the file plus symbols found only
  in history, each with an S/L badge.
- **The stock panel** opens from any table, search or list row (`?s=SYMBOL` in the address; back, ✕ or
  Esc close it): today's status and failures, Strength per preset, the last 60 sessions as S and L
  lines (rebuilt days dimmed, "no record" days dotted), and today's numbers.
- A red bar if history's rows for the shown (final) day disagree with the file.

One bad row rejects the whole history file; the rest of the page keeps working.

## Saved filter sets

**Save as…** names the current checkboxes and sliders; each saved set gets its own button next to
Strict, Loose and Custom (up to 20). **Save changes**, **Rename** and **Delete** appear while a saved set
is selected. **Hide filters** folds away the checkboxes and sliders, leaving the set buttons and a one-line summary. Sets and the open/hidden
choice live only in this browser's `localStorage` (`pse.screens`, `pse.filtersOpen`); nothing is sent
anywhere, and **Forget key** leaves them in place. Shared links still carry the values, never set names.

## Status bar

Shown only when it needs your attention, from the private repository's `results/status.json`:
a failed run or no new PSE session yet. After **4:50pm Tuesday to Saturday** it also says "Scheduled run did not run
this morning" when the previous weekday traded, has no final results file and the 7:50am backup
has not run for it (the 5:17am run never counts as the backup). The cutoff is the backup's start plus 9 hours, because GitHub starts
scheduled runs up to about 7h40m late. A Run now hides the line only if it saves the final file.

## Try the page locally (made-up data)

`tests/demo.mjs` serves the real `index.html` on `127.0.0.1` with made-up `DEMO` stocks and a fake GitHub
inside the page (nothing leaves the computer; it reads no screener file). Node 22 or later, nothing to install.

```bash
node tests/demo.mjs --help                             # every flag
node tests/demo.mjs serve --day normal                 # then open the printed address
node tests/demo.mjs serve --day empty --key-days 3     # days: normal empty holiday stale failed no-compare no-history provisional
node tests/demo.mjs serve --key-days 30 --refuse       # GitHub refuses the key (--github 401|403|403-rate|500|offline)
node tests/demo.mjs serve --no-key --standalone --ua iphone   # the first screen inside the iPhone home-screen app
```

For `/qa` and `/design-review`: one server per `--day` or key state (storage is wiped once per start), at
390 × 844 and 1280 × 800; wait for the `demo ready` line. `--port 0` picks a free port.

## Checks

```bash
node tests/all.mjs                                     # every check below that CI runs, with a table: run it before every push
node tests/static.mjs                                  # size, exact CSP, file allowlist, the 3 <link> tags, manifest, icon, no data, rows or tokens (CI)
node tests/guards.mjs                                  # refusal tests: each guard in static.mjs refuses its crafted input (CI)
node tests/screens.mjs                                 # saved sets: storage cleaning, name rules, panel summary (CI)
node tests/status.mjs                                  # status bar: missed-run rule (CI)
node tests/history.mjs                                 # history file checks, Days in, streaks, Knocking, disagreement (CI)
node tests/key.mjs                                     # key end date, reminder bars, Later, refused vs rate limit (CI)
node tests/summary.mjs                                 # when the page reloads on its own (CI)
node tests/demo.mjs check                              # the made-up data sets parse and agree with the page's filter (CI)
node tests/parity.mjs ../pse-screener ../pse-screener/results/latest.csv
```

`parity.mjs` reads the private repository's `tests/fixtures/filter_cases.json` and any results
CSVs you pass, and fails if the browser's filter logic (between `FILTER-START` and `FILTER-END`
in `index.html`) disagrees with `pse_screener.evaluate` on a pass/fail verdict or reason text.
It also runs the private repository's Python `evaluate` directly over 81 slider settings (using
`../pse-screener/.venv/bin/python` when present, otherwise `python3`) and checks how the page parses
CSV text from edge-case files (BOM, quoted commas and newlines, short rows, CRLF/LF/CR line endings).
Change the filter block and `evaluate` together. The page runs the same check on every load
against the CSV's own `pass_strict` and `pass_loose` columns, and shows a red warning if they
disagree. With a `history.csv` (passed as an argument, or `../pse-screener/results/history.csv`), it
also checks that history's rows for each results file's date equal the rows the page derives from
it, printing symbols only.

Design: `pse-screener/docs/design.md`, sections "How the dashboard reads private data" and
"Dashboard". Wireframe: `docs/wireframe.png`.
