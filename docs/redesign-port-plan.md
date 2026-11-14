# Redesign port plan (Task 1 · M0 inventory)

Source: `shishi-handoff/PROMPT-1-port-into-repo.md` and `prototype/DESIGN.md`, `USABILITY.md`.
Target: this repo at `685f649`. No code was changed for M0.

## 1. Where things stand

**Repo.** A Swift host (`main.swift`, class `Host`) loads `UI/index.html` in a non-persistent
WKWebView and talks to it over one message handler, `host`. A second WKWebView
(`EdgeResultsPanel.swift`) loads `UI/result-panel.html` over the handler `edge`.

- JS → Swift ops: `load`, `save`, `ready`, `syncInboxes`, `readNotice`, `codexConnection`,
  `externalProvider`, `edgeMailPreference`, `returnToEdge`, `edgeVisibility`, `openConnectorLink`,
  `copyConnectorSetup`, `openCodex`, `paste`, `latestSize`, `compact`, `extract`.
- Swift → JS calls: `hostReply`, `setInbox`, `setCompact`, `setEdgeVisible`, `setWorkspaceReturn`,
  `openInbox`, `showWorkspaceHome`, `openMessage`; in the edge panel `setEdgeInbox`,
  `forgetDisplayedResult`.
- `save` writes the JSON the page sent, byte for byte, after decoding it as `Workspace` to validate.
  Fields Swift does not know (for example `labels`) therefore survive a round trip.

**Prototype.** About 4,000 lines of JS/CSS/HTML with in-memory sample data.

- Days are integers in a hardcoded November (`st.today=13`), the clock is `st.now` in hours, and
  sunrise and sunset are fixed for Los Angeles.
- All copy is Chinese, written inline in template strings.
- The only `localStorage` use is the sky palette in `sky.js`.
- `dense.html` and `index.html` have no inline scripts. `compare.html` and `showcase.html` do, and
  are not being ported.

**Baseline here.** In this Linux container the prototype's `p1-pm`, `p8-inbox` and `p9-features`
pass (180/180, Chromium) and `audit.js` reports every page `ok` with no external requests.
WebKit is not installed here, and the app itself cannot be built (no macOS, AppKit or `xcrun`).

## 2. Feature map

| Prototype feature | Prototype source | Repo today | Port |
|---|---|---|---|
| Tokens, type scale, glass, radii | `styles.css` | `style.css` variables, `board.css`, `task-list.css` | M1: replace the variables; restyle the dialogs that stay |
| Sky and palettes (pearl default) | `sky.js` | none (mountain cover) | M1: new. Real clock, computed sunrise/sunset, palette pref over the bridge |
| Motion and springs | `motion.js`, `motion.css` | none | M1: new. Its lookups by integer id move to the store |
| Source glyphs, SF-style icons | inline SVG sprite in the HTML | `symbols.css` (CSS masks) | M1: sprite in `index.html`; drop masks that are no longer used |
| Dense band (clusters, lanes, labels, range drag) | `dense.js` `band()`, `cluster()`, `packLanes()`, `placeLabels()` | none | M3: new. Positions from `planned` + `plannedTime`; deadline markers from `dueDate`/`dueTime` |
| Today list groups (overdue, now, next, tonight, untimed, done) | `dense.js` `list()`, `row()` | `app.js` `render()`, `row()` | M3: replaces Today + project pool |
| Sidebar (Today, Plan, All, AI results, Done, projects, tags) | `dense.js` `side()` | `navButton()`, `board.js` tags | M3: counts from the store |
| Filters, search, "only these" | `dense.js` `filters()`, `constrained()` | tag filter, `openTaskSearch()`, sort menu | M3: prototype model replaces tag filter; sort menu goes (order is by time) |
| Carry-over and morning tidy-up | `dense.js` `carry()`, `review()` | `isToday()` silently pulls old unfinished tasks into Today | M3: behaviour change, see §5 |
| 3-day and week views ("Plan") | `dense.js` `week()` | none | M3: new |
| Day rollover | `dense.js` `setNow()` | 30 s timer re-renders on date change | M3: real clock drives it |
| Undo stack, toast | `dense.js` `act()`, `undo()`; `mini.js` `Toast` | one-off undo for "remove task" only | M2: every change goes through `act()`, then `save` |
| Quick capture (one line) | `features.js` `parse()`, `openCap()` | `taskForm()` dialog (⌘N) | M3: new. Chinese rules copied, English rules written; the full form stays as "details" |
| Capture from a message (local model) | none | `capture()`, `review()`, op `extract`, Services `captureWork` | Keep as is, restyled |
| Suggested slots | `features.js` `suggest()`, `acceptSuggest()` | none | M3: new |
| Defer count hint | `features.js` | none | M2: `deferCount` |
| Focus mode | `features.js` `focus()`, `inbox.js` `setQuiet()` | none | M3: new. Needs Swift to hold edge previews too, see §4 |
| AI results inbox (groups, threads, J/K/A/E/U/X, one by one, burst digest) | `inbox.js` | `UI/inbox.js` (flat list in a dialog), `result-ui.js` cards | M3: replaces the inbox dialog; `result-digest.js` kept as the summariser |
| Connector management | none | `UI/inbox.js` connectors view, `providers.js` | Keep, restyled, reached from the inbox drawer |
| Run bars on the band | `RUNS` sample data | Codex notices have an end time only | M3: end point only unless a real start time is found, see §4 |
| Quota ring and popover | `mini.js` `QUOTA`, `Quota` | none | M2: new op, real data or "not provided", see §4 |
| Quota hints in capture, reset markers on band | `features.js` `quotaHint()`, `bandExtras` | none | M3: only when real quota data exists |
| Floating Today | `dense.js` `compact()`, `mini.js` `MiniBand` | `body.compact` styling of the main page, 356×484 | M4 |
| Results panel v2 | `index.html?scene=result`, `app.js` `buildInbox()`, `result.css` | `result-panel.html`, `result-panel.js`, `panel.css` | M4 |
| Latest-result peek in the workspace | none | `#latestPeek`, op `latestSize` | Folded into the inbox drawer; `latestSize` stays for compact |
| Task details, deadline editor, tag and priority pickers, drag to Today or project, new project, new tag, Wrap up | disabled as "not available in the prototype" | `app.js`, `board.js` | Keep the behaviour, restyle with the new tokens |
| Agent Island, menu bar quota, widgets | `index.html` scenes | none | Not in Task 1 (native; Task 4 covers widgets and menu bar) |
| Fake menu bar, desktop, editor, scene and mode switches, prototype bar, `showcase.html`, `compare.html` | prototype only | none | Not ported |

## 3. Data model

Current `Entry`: `id, title, project, tag, priority, planned, source, quote, done` are all required
strings or bools; `dueDate`, `dueTime` are optional.

| Prototype | Repo field | Note |
|---|---|---|
| `day` (integer) | `planned` `"yyyy-mm-dd"` | `""` is the prototype's `null` ("later") |
| `time` (hours) | **new** `plannedTime` `"HH:mm"?` | absent = untimed group |
| `done` + star position | `done` + **new** `completedAt` ISO 8601 `?` | tasks completed before the migration get no `completedAt`, so they show in Done but get no star |
| `defers` | **new** `deferCount` `Int?` | |
| `p` 0/1/2 | `priority` `"P0"/"P1"/"P2"` | P0 `!!`, P1 `!`, P2 nothing |
| deadline marker | `dueDate`, `dueTime` | unchanged; deadline reminders unchanged |

Migration, as the prompt specifies: `validate()` accepts versions 1 and 2. On the first load of a
v1 file, Swift copies it to `Workspace.v1.backup.json`, then writes it back with `version: 2`.

**What an older app does with a v2 file: it refuses to load it.** `validate()` requires
`version == 1`, so `load` throws, `storeUnreadable` is set, and the page shows "Shishi could not
load your lists. Saving is paused to protect your data." Nothing is overwritten, but the older app
is unusable until the backup is copied back over `Workspace.json`.

The three new fields alone would not break an older app: it ignores unknown keys when decoding and
writes the page's JSON back unchanged. Only the version bump does. See decision D2.

AI result rows have no status, archive flag or start time today:

- **Status** is derived, never stored: "needs you" from `result-digest.js` sentences, "failed" from
  a GitHub Actions conclusion or a failure sentence, otherwise "done".
- **Archive, accept, unread** need storage. Codex: optional fields on `CodexNotice` in
  `CodexInbox.json`. Connectors: receipt files next to the existing `<digest>.read`
  (`.archived`, `.accepted`), and deleting `.read` for "mark unread". Each action needs its
  inverse so ⌘Z works.
- **Threads** come from the Codex `thread` id; connector rows have no thread and stay single.

## 4. Risks

1. **No Mac here.** Swift changes cannot be compiled or launched in this container. Everything in
   the acceptance list that needs `build.py`, `open build/Shishi.app`, `verify-release.py` or
   WebKit has to be run on your Mac. I can run the Chromium tests and screenshot comparison here.
2. **Fake clock in tests.** The prototype tests drive `setNow()` and `?mode=` switches, which must
   not ship. The ported tests will freeze time with Playwright's clock and feed data through the
   fake host instead, so some test steps change shape while keeping their assertions.
3. **Tests assert on Chinese copy.** The ported suites run with the fake host reporting `zh-Hans`;
   an added English pass checks that no key is missing and nothing is truncated.
4. **Hardcoded calendar.** All day arithmetic, weekday names and date labels in `dense.js` are
   rewritten for real dates and both languages. This is the largest single piece of the port.
5. **Minimum window 635×420.** The prototype was designed at 1140×800 with a sidebar; the app
   opens at 760×800. The band's label and cluster rules are width-dependent and need checking at
   635, and the sidebar has to collapse.
6. **Run spans and "running".** Shishi only learns of a Codex turn when it sees `task_complete`.
   A start time needs a start event in the rollout file, which I cannot inspect here. Without it
   the band draws end points only, and there is no running state, comet or legend entry for it.
7. **Quota.** The Codex `rate_limits` payload is undocumented and there are no session logs in
   this container to confirm it against. Claude Code needs a statusline script installed with
   consent, and Grok has no readable source. Unless the Codex format is confirmed on your Mac,
   every provider shows "not provided" and the capture hint and reset markers stay hidden.
8. **Edge panel shows one result per channel.** `EdgeResultsPanel.accept` keeps only the latest
   row, so "10 results merged into one preview" needs it to pass counts as well. That is a message
   change, not a window change, but it is more than a resize.
9. **Edge panel CSP is stricter** (`style-src 'self'`, no inline styles). The prototype's markup
   uses `style=` attributes freely, so panel v2 either sets styles from script or the panel's CSP
   is relaxed to match `index.html`.
10. **Focus mode and the edge panel.** Results are pushed to the edge panel from Swift, so holding
    them during focus needs a new op telling Swift to hold previews too.
11. **⌘Z, ⌘K, ⌘N.** The Edit menu owns ⌘Z, ⌘K is "Extract Tasks from a Message", ⌘N opens the
    task form. Whether the page receives ⌘Z outside a text field has to be checked on the Mac;
    if not, the menu item needs to forward it.
12. **Sunrise and sunset.** Computed locally from the time zone, with no location permission. The
    position is approximate (a representative point per zone), so times can be off by tens of
    minutes at the edges of a zone.
13. **Docs go stale.** `README.md`, `Previews/*.png` and `Release/data-and-permissions.md`
    describe the old UI, and the last must mention quota reading if it is built.

## 5. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Default language.** Follow the system language, falling back to English for anything other than Chinese? | Yes. User content (task titles, project names) is never translated |
| D2 | **v2 compatibility.** Bump to version 2 as the prompt says (older apps refuse to load until the backup is restored), or keep version 1 with the three optional fields (older apps keep working)? | Bump, as specified. Say so if downgrades matter to you |
| D3 | **Carry-over.** Today, unfinished tasks from earlier days appear in Today automatically. The redesign moves them to "carried over" until you act. Accept this change for existing users? | Yes; it is the design's intent |
| D4 | **Quota.** Build the Codex reader only after you confirm the `rate_limits` format from a real rollout file on your Mac; Claude Code and Grok show "not provided" in Task 1 | As stated |
| D5 | **Running agents.** Ship the band with end points only if no start event is found, with no running state | As stated |
| D6 | **Branch and push.** The prompt asks for a local branch `redesign/port-ui` and no push. This cloud session is tied to the branch `claude/festive-gates-07h0zs`, and its container is discarded when the session ends, so unpushed commits are lost | Let me push to `claude/festive-gates-07h0zs` (no PR, `main` untouched) |
| D7 | **Mac verification.** Who runs the build, launch and WebKit checks after each milestone? | You, from the pushed branch; I list the exact commands per milestone |

## 6. Milestones as they will run here

| Milestone | Verified in this container | Needs your Mac |
|---|---|---|
| M1 foundations | Chromium load check, audit | Build, launch |
| M2 bridge and data | JS store against the fake host | Swift compile, v1 → v2 migration, new ops |
| M3 main window | Ported suites, 635×420 check | Build, launch, shortcuts through the menu |
| M4 floating window and edge panel | Ported suites | Panel sizes, edge behaviour |
| M5 tests | Chromium run, audit, 404/console/CSP check | `SHISHI_BROWSER=webkit node tests/run.js` |
| M6 screenshots | `tests/shots/compare.html` | — |

The fake host goes in `tests/fixtures/`, outside `UI/`, so `build.py` never bundles it.
