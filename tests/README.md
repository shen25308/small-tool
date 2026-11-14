# UI tests

Scripted usability tests that drive the real `UI/` pages in a browser. `UI/` is loaded from `file://` with a fake Swift host (`fixtures/test-host.js`), the sample data in `fixtures/sample.js`, and a frozen clock (Friday 13 November 2026, 14:40, Los Angeles). The tests make no network requests and need no Swift build.

The fake host and the sample data stay outside `UI/`, so `build.py` never bundles them.

## Run

```sh
cd tests
npm install                                   # playwright-core only
node run.js                                   # every suite, Chromium (needs Google Chrome or CHROME=/path)
npx playwright install webkit
SHISHI_BROWSER=webkit node run.js             # the same suites in WebKit (Safari's engine)
node audit.js                                 # text ≥ 11px, no all-caps, no external requests, no CSP violations, no console errors
node shoot.js                                 # screenshots into shots/, then open shots/compare.html
```

`node run.js p8-inbox p9-features` runs only those suites. `VERBOSE=1` prints every step. Results are written to `results/` as JSON.

## Suites

| Suite | What it covers |
|---|---|
| `p1-pm` | Completing, undoing, deferring, clusters, stacked filters, time passing, deadlines vs. plan, writing to Workspace.json |
| `p2-dev` | AI results on the band, start–end bars only when a start time exists, quota with and without readable data, floating Today |
| `p3-morning` | Carry-over tidy-up and its bulk actions, the once-a-day reminder |
| `p4-planner` | 3-day and week views, past days read-only, All tasks, empty state, a fresh install |
| `p5-keyboard` | Focus rings and names on every control, band keys, search, task details, shortcuts |
| `p6-night` | Dark mode, crossing midnight on the real clock, Reduce Motion, Reduce Transparency, palette preference |
| `p7-panel` | Results panel v2: sizes, one sentence per result, menu, merged preview for 10 results, messages to the host |
| `p8-inbox` | AI results inbox: derived status, threads, J/K/A/E/U/X/C, bulk, undo, read/archive/accept saved by the host, focus |
| `p9-features` | Chinese quick capture, quota hint, suggested slots, defer counter, focus, local-model extraction, projects, tags |
| `p10-english` | English interface and capture, string table complete, 635×420 in both languages, v1 file, unreadable file |
| `deadclick` | Every visible control in 12 states responds or is shown disabled |

Every suite also runs a consistency check after each step: the counts on the header, chips, band, sidebar, floating Today, week columns, quota and the four unread badges are compared with the store, and the store is compared with what the host saved.
