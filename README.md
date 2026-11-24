# pse-screener-dashboard (public)

The dashboard for the private `pse-screener` repository: `index.html` (markup and styles) and `app.js` (all
the code), with no libraries, served by GitHub Pages at https://bryllelagunda.github.io/pse-screener-dashboard/.

**This repository holds no price data and no key.** PSE EDGE allows personal, non-commercial
viewing only, so results stay in the private repository. The page reads them with a
fine-grained GitHub token kept in your browser's `localStorage`. Never commit a `.csv`, `.json` data
file or token here; `tests/static.mjs` fails CI if you do. It also allows only these files to be
committed: `index.html`, `app.js`, `.nojekyll` (empty: it stops GitHub Pages turning Markdown into pages), `README.md`, `CLAUDE.md`, `.gitignore`, `manifest.webmanifest`, `icon.png`,
`docs/wireframe.png`, `tests/*.mjs` and `.github/workflows/*.yml`. Any other file, results-shaped CSV
text or a stock row anywhere in a line of an allowed one, or a changed picture, fails the check, and every
push is checked on this computer before it leaves (see "The before-push check").

## First open on a device

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new):
   repository access **pse-screener** only, permissions **Contents: read** and
   **Actions: read and write**, expiring in 90 days.
2. Open the page, paste the token, check the date it runs out (filled in as today + 90 days), press
   **Save key**. **Key → Forget key** removes the key, its date and the saved results.

## The daily summary and plain words

Under any red bars, two lines sum up the selected set for the shown session: how many stocks pass, what is
new or dropped since the compare date, and how many missed by one filter (prefixed when the shown day is an
earlier one you picked, the data is provisional, from a session before a holiday, or not today's). The second line is the **market mood**: the
share of the whole scan above its 200-day average (weak under 35%, mixed to 65%, strong above), with the
change since the compare date; under 50 stocks with that number it says there is not enough data. It
describes the market; it is not a signal to buy or sell. The view chips and search sit under the summary,
above the filters.

Labels use plain words (Momentum, Daily swing, Company size, …). A **?** next to a label explains it
(desktop: filters, columns, chips, section titles and badges; phone: the same without the columns; the set
row has one, after Strict). **What the words mean** in the footer lists every explanation at once, Loose
and Custom included; the texts live in one `TIPS` object in `app.js`.

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

- **Days on list** (sortable, right after Stock): sessions in a row on the selected preset, today included.
  `…` while history loads, `—` when there is none yet, it can't be read, or the view is Custom
  (history covers Strict and Loose only). A **BOTH** badge marks stocks on Strict and Loose today.
- **Knocking on the door:** stocks that missed a preset by one rule 3+ sessions running (data gaps
  such as no trade or no market cap never count).
- **Search** replaces the table while the box has text: every stock in the file plus symbols found only
  in history, each with an S/L badge.
- **The stock panel** opens from any table, search or list row (`?s=SYMBOL` in the address; back, ✕ or
  Esc close it): today's status and failures, Strength per preset, the last 60 sessions as S and L
  lines (rebuilt days dimmed, "no record" days dotted), and today's numbers (on a phone, Today % shows only
  here, not in the table).
- A red bar if history's rows for the shown (final) day disagree with the file.

One bad row rejects the whole history file; the rest of the page keeps working.

## Price chart

The stock panel opens with a chart of the closing price: 3 months (**3M**, the default) or a year (**1Y**), with the
50-day and 200-day averages and your buy, cut-loss and target prices as dashed lines (a far-off one is pinned to the
edge with an arrow). Drag a finger or move the mouse along it, or use the arrow keys, Home and End, to read one day.
It reads the private `results/closes.csv` (every stock's closes for about 400 days, written by each full run) the
first time a panel opens, and once more when newer results arrive. It is kept in memory only, never saved in this
browser. The chart draws only when the file's stamp equals `closes_sha256` in the latest `index.json` entry, so it
never pairs with results from another run ("Prices are being updated: the chart comes back after the next run.").
On an earlier day it ends on that day. Prices are as traded: a stock dividend or split shows as a sudden fall.

## Saved filter sets

**Save as…** names the current checkboxes and sliders; each saved set gets its own button next to
Strict, Loose and Custom (up to 20). **Save changes**, **Rename** and **Delete** appear while a saved set
is selected. **Hide filters** folds away the checkboxes and sliders, leaving the set buttons and a one-line summary. Sets and the open/hidden
choice live only in this browser's `localStorage` (`pse.screens`, `pse.filtersOpen`); nothing is sent
anywhere, and **Forget key** leaves them in place. Shared links still carry the values, never set names.

## My list and notes

☆ at the start of a row, or in the stock panel, adds a stock to My list; ★ removes it. The **★ My list** chip
shows every starred stock, even one that passes no filter: Price, **vs my buy** (change from your buy price to
the shown day's close) and a tag: **At cut-loss** (close at or below it), **Target reached** (close at or above
it) or **Not in this day's scan**. A computer adds Today %, My buy, Cut-loss, Target and Passes.
**My notes** at the top of the stock panel hold a buy price, cut-loss, target (all optional; 0, below 0 or not
a number is refused) and a note of up to 300 characters. **Save notes** also stars the stock; removing the star
keeps the notes; **Clear notes** empties them and keeps the star. Up to 300 stocks. All of it lives only in this
browser's `localStorage` (`pse.mine`): your phone and computer keep separate lists, nothing is sent anywhere,
and **Forget key** leaves it in place.

## Pick a day

The date in the header (when more than one day is saved) opens the saved days, newest first, the latest marked.
An earlier day shows that day's full list, chips, summary, Days on list and My list prices, compared with the
last final day before it, under a blue bar with **Back to latest**; **Compare with…** then offers only earlier
days, and a refresh or **Run now** updates the latest behind it. A day whose file can't load says so and keeps
the latest on screen. When only the day it is compared with can't load, that day shows without a comparison and
a bar says why ("Couldn't load Thu, Nov 13 to compare with (no file for that day). Showing Mon, Nov 17 without a
comparison.").

## Status bar

Shown only when it needs your attention, from the private repository's `results/status.json`:
a failed run or no new PSE session yet. After **4:50pm Tuesday to Saturday** it also says "Scheduled run did not run
this morning" when the previous weekday traded, has no final results file and the 7:50am backup
has not run for it (the 5:17am run never counts as the backup). The cutoff is the backup's start plus 9 hours, because GitHub starts
scheduled runs up to about 7h40m late. A Run now hides the line only if it saves the final file.

## Try the page locally (made-up data)

`tests/demo.mjs` serves the real `index.html` and `app.js` on `127.0.0.1` with made-up `DEMO` stocks and a fake
GitHub inside the page (`fakes.js`, made in memory; nothing leaves the computer; it reads no screener file).
Node 22 or later, nothing to install.

```bash
node tests/demo.mjs --help                             # every flag
node tests/demo.mjs serve --day normal                 # then open the printed address
node tests/demo.mjs serve --day empty --key-days 3     # days: normal empty holiday stale failed no-compare no-history provisional no-closes
node tests/demo.mjs serve --key-days 30 --refuse       # GitHub refuses the key (--github 401|403|403-rate|500|offline)
node tests/demo.mjs serve --no-key --standalone --ua iphone   # the first screen inside the iPhone home-screen app
node tests/demo.mjs serve --day normal --fail-day <day> --fail-as 401   # only that day's file fails (404|timeout|401); --help names the days
node tests/demo.mjs serve --closes-fail timeout       # the chart's file fails (404|timeout|401|500), is from another run (stamp) or unreadable (bad)
node tests/demo.mjs serve --day no-closes              # no closes file yet: "The chart appears after the next daily run."
node tests/demo.mjs serve --skew                       # app.js one byte off its fingerprint: only the boot line shows, after 4 s
```

For `/qa` and `/design-review`: one server per `--day` or key state (storage is wiped once per start), at
390 × 844 and 1280 × 800; wait for the `demo ready` line. `--port 0` picks a free port. The `normal` day also
lists one past day with no file, so picking it shows the "Couldn't load" bar.

## Checks

```bash
node tests/all.mjs                                     # every check below that CI runs, with a table, and switches the before-push check on: run it before every push
node tests/stamp.mjs                                   # after every app.js edit: rewrites index.html's script tag (its ?v= and fingerprint)
node tests/static.mjs                                  # size, exact CSP, the script tag, file allowlist, the 3 <link> tags, manifest, icon, no data, rows or tokens (CI)
node tests/guards.mjs                                  # refusal tests: each guard in static.mjs refuses its crafted input (CI)
node tests/screens.mjs                                 # saved sets (storage cleaning, name rules, panel summary), My list stars and notes, Pick a day (CI)
node tests/status.mjs                                  # status bar: missed-run rule (CI)
node tests/history.mjs                                 # history file checks, Days on list, streaks, Knocking, disagreement (CI)
node tests/key.mjs                                     # key end date, reminder bars, Later, refused vs rate limit (CI)
node tests/summary.mjs                                 # the summary and mood words, the ? texts, the 10-minute reload (CI)
node tests/chart.mjs                                   # the price chart: reading closes.csv, the averages, 3M/1Y, levels, every state's words (CI)
node tests/demo.mjs check                              # the made-up data sets parse and agree with the page's filter (CI)
node tests/parity.mjs ../pse-screener ../pse-screener/results/latest.csv
```

`parity.mjs` reads the private repository's `tests/fixtures/filter_cases.json` and any results
CSVs you pass, and fails if the browser's filter logic (between `FILTER-START` and `FILTER-END`
in `app.js`) disagrees with `pse_screener.evaluate` on a pass/fail verdict or reason text.
It also runs the private repository's Python `evaluate` directly over 81 slider settings (using
`../pse-screener/.venv/bin/python` when present, otherwise `python3`) and checks how the page parses
CSV text from edge-case files (BOM, quoted commas and newlines, short rows, CRLF/LF/CR line endings).
Change the filter block and `evaluate` together. The page runs the same check on every load
against the CSV's own `pass_strict` and `pass_loose` columns, and shows a red warning if they
disagree. With a `history.csv` (passed as an argument, or `../pse-screener/results/history.csv`), it
also checks that history's rows for each results file's date equal the rows the page derives from
it, printing symbols only. With `results/closes.csv` and a `latest.csv` given, it checks the chart's 50- and
200-day averages and last close against the screener's `sma50`, `sma200` and `close` for every stock, and the
file's stamp against `index.json` (symbols and counts only).

## Changing the code

1. Branch from the current main (`git fetch origin && git checkout -b <name> origin/main`).
2. Edit `app.js` (code) or `index.html` (markup and styles).
3. After any `app.js` edit: `node tests/stamp.mjs`. It rewrites only `index.html`'s one script tag, whose
   `?v=` and `integrity` fingerprint make the browser refuse any other `app.js`.
4. Commit both files, run `node tests/all.mjs`, and push only when it is green.

A merge conflict on the script-tag line (two `app.js` changes at once): keep either side, run
`node tests/stamp.mjs`, commit. Never push with `--no-verify`: it skips the before-push check and gstack's own
hook, and nothing else would catch a leak in history or a commit message.

**A page that can't start.** If a phone holds an old `index.html` and gets a new `app.js` (or the other way
round, or `app.js` is missing), the browser refuses the code and, after 4 seconds, the page shows "Couldn't start
the page. You may be offline, or a new version just came out: Reload. If this stays, try again in 10 minutes."
GitHub Pages caches files for 10 minutes.

**Reverting this split.** Revert the PR with a PR (the owner types its merge: it loosens the checks). Before pushing
the revert branch, delete the add-on: `rm "$(git rev-parse --git-common-dir)/hooks/pre-push.local"` (while main
still has the check, a branch without it is refused). After the revert merges, the add-on only warns.

## The before-push check

gstack's pre-push hook (`.git/hooks/pre-push`, shared by every workspace of this clone) runs
`.git/hooks/pre-push.local` first; `node tests/all.mjs` and a local `node tests/static.mjs` write that add-on
(the only file they may write) and check it each run. It runs `tests/prepush.mjs` from the branch being pushed:
the leak checks on every file each new commit adds or changes (merges and first commits included), on every
commit and tag message, and the full check on each pushed tip. A push by URL instead of a remote name checks the
whole history. Success prints `pre-push: <n> commits checked, static OK`. A branch older than the check is
refused once main has it (`git fetch origin && git rebase origin/main`). It can't stop `--no-verify`, a push
from a fresh clone before its first `node tests/all.mjs`, or a commit made on github.com.

## Guard codes

Each refusal starts with its code and gives `path:line` (and the commit for history), never the matched text.

| Code | Refuses | Fix |
| --- | --- | --- |
| <a id="allowlist"></a>ALLOWLIST | a file not on the list above, or `index.html` / `app.js` missing | remove it; history: `git reset --soft $(git merge-base HEAD origin/main) && git commit` |
| <a id="size"></a>SIZE | `index.html` from 40 KB, `app.js` from 160 KB | move code to `app.js`; a raise is a plan decision |
| <a id="csp"></a>CSP | the page's security policy changed, repeated, or after the script tag | restore it from `git show origin/main:index.html` |
| <a id="script-tag"></a>SCRIPT-TAG | any script tag but the one built from `app.js`; the boot line or its CSS missing | stale: `node tests/stamp.mjs`, commit; conflict: keep either side, stamp, commit; extra: remove it |
| <a id="stamp-shape"></a>STAMP-SHAPE | `stamp.mjs` finding not exactly one script tag of the right shape (nothing written) | remove the extra tag at the line it names |
| <a id="inline-code"></a>INLINE-CODE | an `on…=` handler attribute in `index.html` | attach it in `app.js` with `addEventListener` |
| <a id="unsafe-dom"></a>UNSAFE-DOM | `innerHTML`, `eval`, script URLs, a script element made in code, `import()`, workers | build elements with `el()` and `textContent` |
| <a id="link-tags"></a>LINK-TAGS | the three `<link>` tags changed, or a `<link` in `app.js` | restore them |
| <a id="ext-load"></a>EXT-LOAD | any other script, style, image, frame or font load | remove it |
| <a id="hosts"></a>HOSTS | a host other than `github.com` / `api.github.com`, `//…` or websockets | remove it |
| <a id="page-demo"></a>PAGE-DEMO | "demo", a service worker or a cache store in the page | keep test code in `tests/` |
| <a id="key-block"></a>KEY-BLOCK | the key's end date outside its block, a request inside it, the key in the address, Forget key incomplete | keep `keyExp` inside the KEY block in `app.js` |
| <a id="key-use"></a>KEY-USE | the key used as a value, stored or sent outside its places, or a navigation call | use the key only as a yes/no check; requests go through `gh()` |
| <a id="rows"></a>ROWS | a stock row (symbol, date, numbers) anywhere in a line | not price data: drop the date or move the numbers off the line; made-up symbols: `DEMO…`, `ZZ…`, `SYN` |
| <a id="closes"></a>CLOSES | a closing-price row anywhere in a line: a symbol, then 8 or more cells in a row that are each a number or blank, 3 or more of them numbers | not price data: break the run of numbers; made-up symbols: `DEMO…`, `ZZ…`, `SYN` |
| <a id="results-shaped"></a>RESULTS-SHAPED | results CSV header text (`latest.csv`'s or `closes.csv`'s) | remove it |
| <a id="token"></a>TOKEN | a GitHub token shape | remove it; revoke the token; message on the tip: `git commit --amend -m "<new message>"` |
| <a id="demo-rows"></a>DEMO-ROWS, <a id="demo-read"></a>DEMO-READ, <a id="demo-write"></a>DEMO-WRITE, <a id="demo-listen"></a>DEMO-LISTEN | the test server holding rows or real-looking numbers, reading other files, writing, or listening beyond 127.0.0.1 | build data in code from `DEMO` symbols |
| <a id="manifest"></a>MANIFEST, <a id="icon"></a>ICON, <a id="png-chunks"></a>PNG-CHUNKS, <a id="wireframe"></a>WIREFRAME | the manifest, the icon or a picture changed | `node tests/icon.mjs`; `git checkout origin/main -- <file>` |
| <a id="md-html"></a>MD-HTML | raw HTML or a `javascript:` link in a Markdown file (GitHub Pages publishes CLAUDE.md as a page on this address) | put it in a code span, or use plain Markdown |
| <a id="nojekyll"></a>NOJEKYLL | `.nojekyll` missing or not empty | restore an empty `.nojekyll` at the top of the repo |
| <a id="tag-target"></a>TAG-TARGET | a pushed ref pointing at a tree or blob | `git tag -d <tag>`, then push again |
| <a id="pre-push"></a>pre-push | the add-on can't run (`core.hooksPath` set, a foreign add-on, a hook without the `.local` call, no input, an internal error) | the line printed with it, then `node tests/all.mjs` |

Design: `pse-screener/docs/design.md`, sections "How the dashboard reads private data" and
"Dashboard". Wireframe: `docs/wireframe.png`.
