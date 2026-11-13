# Shishi 1.8: retest repairs, finding by finding

Source: *Shishi UX Retest, 2026-11-12* (report, audit data, implementation brief, prototype and design notes),
audited at `7800327` on `claude/charming-ride-cf9jlp`. The branch had moved on to `b3d865b` when this work began;
those newer commits (saved filters, priority matrix, opening changed files) were kept, and every repair was made
on top of them.

Version: **1.8, build 12** (was 1.7, build 11).

## How to read this

A finding is marked **Fixed** only when a test reproduces it on the old code, fails there, and passes on the new
code. Where the reproduction was done separately (because the old interface no longer exists in the new layout,
for example), the reproduction is described and its output quoted. **Verified where** says what ran the test:

- **Logic**: `node --test Tests/*.test.mjs` or `python3 -m unittest` against the real modules.
- **UI**: `node Tests/ui/check.mjs`, the real page in Chromium against a stand-in host (`Tests/ui/harness.mjs`).
  This is not WebKit and not the native window.
- **macOS**: the GitHub Actions macOS job, which builds `Shishi.app` from the commit and runs it
  (`Tests/ci/launch_check.py`, `window_check.py`, `data_survival.py`, `lite_check.py`).

## Commits

| Commit | Scope |
| --- | --- |
| `2e94f4e` | R1: C01–C05, UX-N01–N06, UX-N08 |
| `7ed8394` | R2: stable list IDs, connector mappings, safe migration (PROJECT-MODEL data, UX-N07) |
| `99830d0` | R3: compact card height (NATIVE-01) |
| `434b947` | R4: Inbox, Projects and Plan as main views (INBOX-LAYOUT, RETURN-STATE, INBOX-SEARCH, PROJECT-MODEL UI) |
| `83b76ed` and later | R5: tokens and contrast (READABILITY), source tints (SOURCE-TINT), version 1.8, native screenshots, Undo for Today/Evening/Someday moves, this record |

## Findings

| ID | Finding (from the audit) | Change | Test evidence | Verified where | Status |
| --- | --- | --- | --- | --- | --- |
| C01 | Echoes, `--version`, masked failures and background runs counted as "checks passed" | `receive.py` `check_run()` decides passed / failed / unclear / none from the command and its output; quoted text, `echo`/`printf`, `--version`/`--help` are not checks; `\|\| true`, `set +e`, `&`, `nohup` are "unclear"; the report shows **Checks not verified** for unclear | `test_checks_count_only_when_they_really_ran_and_passed` (12 cases; on the old code: `'passed' != 'none'`); `C01: a check that ran without showing a pass is not green` | Logic | Fixed |
| C02 | A 4,139-character command was cut at 4,000 and could still be allowed | The hook sends the whole command up to 16,000 characters with its length; longer requests go straight to the terminal; the card refuses Allow/Deny if what it received is shorter than the stated length, and shows long text in a scrolling box with its length | `test_long_requests_are_shown_whole_or_not_at_all` (4,139 characters arrive whole; 20,000 never reach the card, answered in under 3 s) | Logic | Fixed |
| C03 | GitHub read only the first page of issues | Follows `Link: rel="next"` up to 10 pages (1,000 open issues); the sheet and the message say when more remained | `GitHubIssuePages.test_follows_next_pages_and_reports_a_cut_off` (an open issue on page 2 behind 100 closed ones is imported; a cut-off read reports `complete: false`) | Logic | Fixed |
| C04 | A reopened issue undid a completion the person made | The sync remembers the completion it made (`github.closedTask` = that `completedAt`); a reopen only undoes that one | `C04: reopening an issue never undoes a completion the person made` (failed on the old code: `reopened 1, expected 0`) | Logic | Fixed |
| C05 | Send to Claude right after an edit sent the previous draft | The button saves first and sends the saved task; an invalid or failed save launches nothing; the buttons are disabled while sending | UI `C05: Send to Claude right after an edit sends the edit, and a failed save sends nothing` (failed on the old code: the prompt began with the old title) | UI | Fixed |
| UX-N01 | Backups with no task list, `2026-99-99`, `99:99` or object notes reached the confirm step | Real calendar dates and clock times, a required task list, text-only notes, boolean evening/someday; an empty but valid backup needs **Replace with Empty Backup** | UI `UX-N01/N02: malformed backups are explained; …` (failed on the old code at the missing task list) | UI | Fixed |
| UX-N02 | Import continued when the safety copy failed | No copy, no import: the sheet says why and the data stays; "no file yet" is not a failure | Same UI check (copy failure keeps all 18 tasks and claims no success) | UI | Fixed |
| UX-N03 | An untitled new task with notes or subtasks vanished on close | Leaving such a draft asks: **Keep Editing** or **Discard Draft**; a typed but unconfirmed subtask is saved | UI `UX-N03/N04: an untitled new task keeps its notes through Close, Escape, ⌘, and native Settings` (failed on the old code) | UI | Fixed |
| UX-N04 | ⌘, and the app menu's Settings bypassed the draft guard | One leave path (`leaveSheet`) for Close, Escape, ⌘,, Settings from the menu, `shishi://` links and the report link; a late `close` event no longer drops a new sheet's guard | Same UI check, four exits, plus an existing task's pending subtask saved by ⌘, | UI | Fixed |
| UX-N05 | Someday deleted the deadline | Someday clears planned days only; moves can be undone | UI `UX-N05/N08: …` (failed on the old code: `moving to Someday keeps the deadline`) | UI | Fixed |
| UX-N06 | Reopening a repeating task deleted a successor edited by planned days, evening or Someday | Those fields count as edits; a changed successor is kept and removing it is an explicit choice | UI `UX-N06: a successor moved to other days, the evening or Someday is not deleted silently` (failed on the old code) | UI | Fixed |
| UX-N07 | Renamed or deleted synced lists came back after a sync | Lists have stable IDs; connections and folders point at the ID; rename changes the name only; delete moves syncs with the tasks or stops them | Logic `PROJECT-MODEL: lists get stable IDs; …`; UI `UX-N07: renamed or deleted synced lists never come back after a sync or relaunch`. Reproduced on `2e94f4e`: after renaming "Personal" to "Home" and one sync, lists were `[… "Home", "Personal"]` and the synced tasks were in "Personal" | Logic, UI | Fixed |
| UX-N08 | Quick add in Someday made a task that was not in Someday | It is added to Someday unless a date is typed, and then a message says where it went | Same UI check as UX-N05 (the Someday part failed on the old code with the fix removed) | UI | Fixed |
| NATIVE-01 | The compact card grew itself to 760 points (266 resizes) | Stretching and scrolling parts are measured by their content, and a height is reported only after layout settles and only on a change of 2 points or more | UI `NATIVE-01: the card measures its content, settles, and shrinks again` (the fake host resizes like `CornerCard`; on the old code the card reached 760); macOS `window_check.py` **card height settles below the cap** samples the real panel for 6 s | UI, macOS | Fixed |
| READABILITY | Light metadata at about 3.98:1, 10.5–12 px | New tokens (#1D2430, #5C6573, #646C79, #EEF0F3, #F5F6F8, #0068D9), darker success and warning text, dark-mode accent as a fill; 47 declarations raised to 12 px | UI `READABILITY: text contrast and size on the main screens` (light and dark: every visible text on Today, Plan, Inbox, Projects, All Tasks ≥ 4.5:1 and ≥ 12 px) and `READABILITY: the compact card` (light and dark). On the old tokens it reported 4.11:1, 4.22:1, 3.56:1 and 10.5 px | UI | Fixed |
| RETURN-STATE | Settings and back collapsed the reply being read | The Inbox keeps the selected result, its tab and both scroll positions in its own state; nothing outside a click changes them | UI `RETURN-STATE: Settings and back keep the result, its tab and the scroll position`. Reproduced on `b3d865b`: original open before Settings `true`, after `false` | UI | Fixed |
| SOURCE-TINT | Source colours did not tint backgrounds | Default colours for Codex, Claude Code, Gmail and GitHub; a 9 % (light) / 16 % (dark) tint; **Settings → General → Source colours: Subtle Tint / Accent Only** | UI `connection colours` and `connection colours, dark`: real tinted backgrounds, every text on every tint ≥ 4.5:1 for all presets and for black, white, yellow, red and blue, and Accent Only removes the tint | UI | Fixed |
| INBOX-SEARCH | A phrase only in a reply could not be found | The Inbox search and ⌘K search every stored reply, read or archived; a match only in the reply opens on **Original Reply** | UI `INBOX-SEARCH: a phrase from an archived, read reply finds it and opens the reply`. Reproduced on `b3d865b`: ⌘K offered only "Add … as a task" | UI | Fixed |
| INBOX-LAYOUT | The Inbox was a small modal | The Inbox is a main view: list beside reader; ≤ 1000 px list → reader → Back; sidebar to 720 px, then a toolbar button | UI `INBOX-LAYOUT: list beside a reader; narrow is list, reader, back` (1280, 900 and 700 px), `Inbox: new results never replace the one being read; …` | UI | Implemented (new behaviour) |
| PROJECT-MODEL | Flat list names; no areas, goals, notes or results per project | Stable IDs (R2); Areas; Projects overview; a project's Tasks / Notes / Results; Plan as List or Week; saved views Waiting on AI and Needs review | Logic `PROJECT-MODEL: …`; UI `PROJECT-MODEL: areas, a project with a goal, notes without checkboxes, and its results`, `Plan: list or week, …`; macOS `data_survival.py` checks the upgrade of a 1.7 workspace and that an exact copy is in Backups | Logic, UI, macOS | Implemented (new behaviour) |

## The 20 functional angles

| Angle | Audit result | Now | Evidence |
| --- | --- | --- | --- |
| A01 Version, build, distribution | Pass, release pending; still 1.7/11 | 1.8 / 12; Homebrew template 1.8; still unpublished and ad-hoc signed | CI build stamps the commit; `Info.plist` |
| A02 Native save, restart, old formats | Pass | Pass, plus the 1.7 → 1.8 upgrade with an exact copy | macOS `data_survival.py` |
| A03 Drafts and autosave | Partial | Pass for the reproduced paths | UX-N03/N04 check |
| A04 Form and import validation | Fail | Pass | UX-N01/N02 check, `backup: invalid files change nothing` |
| A05 Subtasks and unconfirmed input | Partial | Pass (a typed subtask is saved on every exit) | UX-N03/N04 check |
| A06 Repeats and undo | Partial | Pass | UX-N06 check, `repeating tasks: …` |
| A07 English and Chinese quick add | Pass | Pass | logic parse tests, `quick add parses natural language` |
| A08 Multi-day and cross-month planning | Pass | Pass, plus the Week plan | `plan a task on several days and a range`, `Plan: list or week` |
| A09 Today / Evening / Someday | Fail | Pass, with Undo for moves | UX-N05/N08 check |
| A10 Lists and sync links | Fail | Pass | UX-N07 checks |
| A11 Tags, search, material | Gap / partial | Reply search fixed; Notes per project added. Still one tag per task | INBOX-SEARCH, PROJECT-MODEL checks |
| A12 Read / unread / archive / bulk undo | Pass | Pass in the new reader | `inbox read state is scoped and reversible` |
| A13 New results, old unread, long replies, paging | Pass | Pass; the list shows up to 300 results, search reaches all | `Inbox: new results never replace …` |
| A14 Facts and verdicts of AI results | Partial | Pass for the reproduced cases | C01 tests |
| A15 Full permission request | Fail | Pass | C02 test |
| A16 Sending work to an agent | Fail | Pass | C05 check |
| A17 Connector paging and two-way state | Partial | GitHub paging and reopen fixed | C03, C04 tests |
| A18 Backup, cancel, restore, failure atomicity | Partial | Pass | UX-N01/N02 check, backup checks |
| A19 Native small window, focus, lifecycle | Partial | Height fixed and checked on macOS; focus unchanged (passes) | NATIVE-01; `window_check.py` |
| A20 Scale, layout, constrained running | Scoped pass | Scoped pass, plus 1280 / 900 / 700 / 390 px layouts | INBOX-LAYOUT check, READABILITY checks |

## The 10 interaction angles

| Angle | Audit result | Now |
| --- | --- | --- |
| U01 Capture and find again | Fail | Fixed: Someday quick add, untitled drafts (UX-N08, UX-N03) |
| U02 Navigation, back, hierarchy | Partial | Inbox is first-level navigation with list and reader; narrow list → reader → Back; Settings never collapses the reader; one leave path for drafts |
| U03 Reading without interruption | Pass | Kept: new results are counted, never swapped in |
| U04 Discoverable actions | Partial | Reader actions are always visible; row actions still appear on hover or keyboard focus (unchanged) |
| U05 Projects and material | Gap | Areas, goals, Notes, Results, stable IDs |
| U06 Planning vs deadline | Partial | Someday keeps deadlines; Week plan shows "Due" rows apart from planned days |
| U07 Keyboard, undo, leave protection | Partial | ⌘, goes through the guard; Today / Evening / Someday moves have Undo |
| U08 Window sizes | Partial | Card height fixed; sidebar collapses below 720 px; toolbar stays usable at 340 px |
| U09 Colour, size, readability | Gap | Tokens, 12 px minimum, tints with contrast checks |
| U10 Feedback and trust | Fail | No false green, no truncated approvals, no import without a copy, no stale draft sent |

## Screenshots

Taken by the macOS job from the running app at commit `bb25536` (run 43396646193, `Tests/ci/launch_check.py`) and
kept in [`Previews/retest-1.8`](../Previews/retest-1.8):

- Card at 340 × 430: `card-340x430-light.png`, `card-340x430-dark.png`
- Workspace at 760 × 600: `today-760x600-{light,dark}.png`, `inbox-760x600-{light,dark}.png` (narrow Inbox: the reader with Back to Inbox)
- Wide: `inbox-wide-1024x677-{light,dark}.png`, `projects-wide-1024x677-{light,dark}.png`, `plan-week-wide-1024x677-{light,dark}.png`.
  The job asks for 1280 × 800, but the CI Mac's screen is 1024 × 768, so macOS limits the window to 1024 × 677.
  The 1280 px layout is covered by the browser check *INBOX-LAYOUT* instead.

In these captures no session log is attached to the sample result, so its verdict honestly reads *Checks reported
passing* rather than *Checks passed*.

Native facts from the same job: the card's height stayed at 535 points for the whole 6-second sample, and the
1.7 workspace upgraded with every task and list name intact and an exact copy saved as
`Workspace before upgrade <time>.json`.

## Not tested, and remaining limitations

- **Stage Manager, several displays, Spaces moves:** not run. CI has one display and no Stage Manager.
- **VoiceOver:** not tested with VoiceOver. Controls have names and roles, but no screen-reader session was recorded.
- **Physical drag and resize of the card:** synthetic input on CI is recorded as "not verified" when the machine ignores it.
- **Real provider accounts:** no real Notion, Reminders, GitHub (beyond the public API shape), Gmail/Outlook OAuth,
  Claude Code or Codex session was used; all are stand-ins. No real permission was answered.
- **WebKit:** the UI checks run in Chromium. The macOS job runs the real WebKit app but checks only launch, links,
  window placement, data survival and screenshots, not every UI flow.
- **System accent colour:** 1.8 uses a fixed blue so text links read at 4.5:1; it no longer follows the accent
  chosen in System Settings.
- **Contrast audit scope:** it checks the main screens and the card in a fixed sample state, light and dark; it is not
  a full WCAG conformance review (focus indicators, non-text contrast and every sheet were not measured).
- **Tags:** still one tag per task; cross-project dynamic views are the saved filters.
- **GitHub issues:** at most 1,000 open issues per sync, and the sheet says when more remain.
- **Release:** 1.8 is not published; builds are ad-hoc signed and not notarized.
