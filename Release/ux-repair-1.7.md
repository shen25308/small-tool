# Shishi 1.7 UX repair: findings, changes and regression tests

This maps each finding in the *Shishi 1.7 evidence-based UX repair brief* (audited baseline `a0962b5`) to the change that addresses it and the test that would fail if it came back. The brief referred to `report.html` and `audit-data.json`; only the brief itself was provided, so each finding was reproduced from the brief's description against `a0962b5` before it was fixed.

Work landed in four reviewable commits on `claude/charming-ride-cf9jlp`, in the order the brief asked for:

| Group | Commit | Findings |
|---|---|---|
| A. Trust and data | `4040362` | F01, F02, F03, F04, F05, F07 |
| B. Result reading | `07f174d` | F06, F09, F08, F12 |
| C. Native window | `19f204f` | F15, F16 |
| D. Scheduling and long-term data | `8abe8d8` | F11, F10, F14, F13, F17, F18 |
| E. Delivery | this document, data-survival check, native screenshots | — |

**Test suites.** `node --test Tests/*.test.mjs` (logic), `python3 -m unittest discover -s Tests` (connectors), `node Tests/ui/check.mjs` (Chromium against a stand-in host; these prove page behaviour, **not** native window behaviour), and on the macOS runner `Tests/ci/launch_check.py`, `Tests/ci/window_check.py` and `Tests/ci/data_survival.py` against the built app.

## Mapping

| ID | Finding (short) | Change | Regression test |
|---|---|---|---|
| F01 | Classification: negation read as success; bare “Turn finished” looked verified; Chinese input requests missed; no evidence shown | `UI/report.js` rewritten on three axes: execution, verification (`passed`, `failed`, `not-run`, `unverified`, each `observed` or `claimed`) and required action. Negation (“not all tests passed”, “没有通过”) outranks success words. Observed check runs from the session log decide green; reply text alone can only say *reported*. English, Chinese and mixed requests for input → *Needs you*. Each report quotes the sentence or command it used. | `report.test.mjs`: *audit cases*, *negation outranks success*, *history and zero failures*, *claims stay claims*, *missing verification*, *requests for input in English, Chinese and mixed text*, *mixed-language success claim*. UI: *brief report: decide whether to open the agent*, *brief report: worth a look* |
| F02 | Details lost drafts on close / Escape | Details autosave as you type, with a save state; closing only prompts when something cannot be saved; **Discard** reverts; drafts survive a relaunch. | UI: *details autosave survives close, escape and relaunch*, *details survive a relaunch* |
| F03 | A newer result replaced the report being read | Report locks while hovered, focused, selected or just touched; newer results wait behind **Newer result**. | UI: *report stays put while being read* |
| F04 | Read state global and irreversible; no archive | Read/unread per result, **Mark N ‹Source› Read** scoped to the current filter, **Mark All** asks with a count, **Archive** filter, **Undo** for every bulk change. Native: `CodexInbox.setState`, `ConnectorInbox.setState` (`.read` / `.archived` markers). | UI: *inbox read state is scoped and reversible*; native: `data_survival.py` checks markers and replies stay intact |
| F05 | Completing a repeating task could not be undone cleanly | Series model: completing creates the next occurrence, reopening removes it if untouched, keeps it (and asks) if edited. | UI: *repeating tasks: complete, undo, reopen, edited successor* |
| F07 | A time could be saved without a date | Closing Details with a time and no date asks: **Keep Editing**, **Use Today**, **Remove the Time**. Backup import rejects it too. | UI: *time without a deadline date asks before closing*, *backup: invalid files change nothing* |
| F06 | Inbox unreachable from the compact card; unread > 12 h hard to find | **Inbox** button on the card in every state with the unread count; old unread results stay listed and counted. | UI: *card inbox button in every state*, *corner card* |
| F09 | **Full reply** did not open the original in one action | Opens the original reply in the Inbox, expanded, keeping the card context (**Card** back button). | UI: *full reply opens the original reply*, *back to card after jumping to the workspace* |
| F08 | Card controls unreachable at 340×430 | Constrained layout: report folds, content scrolls, actions stay pinned; height follows content within the screen. | UI: *compact card at a constrained height* |
| F12 | One colour for every connection | Per-connection colour: eight presets, custom colour, Reset; tint chosen so headline contrast stays ≥ 7:1 in light and dark. | UI: *connection colours*, *connection colours, dark* (contrast computed for every preset) |
| F15 | Card could not be moved freely or resized; gestures overlapped | Separate grip bar (move) and corner handle (resize); size and position saved; corner snapping is a preference (**Snap to Screen Corners**). `CornerCard.swift`. | Native: `window_check.py` (drag, resize, relaunch placement; see acceptance below). |
| F16 | Stage Manager, focus stealing, implicit always-on-top / all-Spaces, duplicate windows | Non-activating panel that never takes focus on updates; **Keep Above Other Windows** and **Show on All Spaces** are explicit preferences, both off by default; exactly one card window. | Native: `window_check.py` (focus kept after a hook *Stop*, single window, window level, Stage Manager best-effort) |
| F11 | Only one planned day per task | `plannedDates` with a month calendar (**Pick days** / **Range**, Shift-click, remove a day, Clear). Upcoming shows the task on each day; completion completes the task once; overdue only after the last planned day. | UI: *plan a task on several days and a range*, *planned days in details, and not overdue while a day remains* |
| F10 | `#123` became a tag; no way to keep parsed text literal | Tags need a letter; parsed parts shown as chips with **×** = keep as text; `\#`, `\@`, `\!` escapes. | `task-logic.test.mjs`: *reference numbers, escapes and keep-as-text*; UI: *quick add chips can be kept as text*, *quick add parses natural language* |
| F14 | Chinese dates and times not parsed; supported languages not stated | Simplified Chinese dates, weekdays, `N月N日`, relative days, times with 上午/下午/晚上, `截止…`/`…前` deadlines and repeats. README states English and Simplified Chinese. | `task-logic.test.mjs`: *Chinese dates and times*; UI: *Chinese dates in the card* |
| F13 | No complete export / import | Versioned JSON backup (`shishi-backup` v1): validation with specific problems, preview with counts, snapshot of current data to `ShiShiDesk/Backups`, replace, **Undo**. Credential-like fields refused; secrets never in the workspace. Markdown copy kept for sharing. | UI: *backup: export, preview, import and undo*, *backup: invalid files change nothing* |
| F17 | Details / Schedule / More reachable only by right-click | Row buttons **Plan days**, **Details**, **More** on hover and keyboard focus; **Choose Days…** in More; card rows get a More button. | UI: *row actions without right-click*, *context menu: …* |
| F18 | Version, README and artifacts disagreed; light app could never get the model | README separates published 1.6.0 from this unreleased 1.7. `build.py` stamps `ShishiSourceCommit`, `ShishiSourceDirty`, `ShishiVariant`; CI fails if the stamp ≠ `GITHUB_SHA`; **About Shishi** shows it. Light build keeps the engine and downloads the pinned model only on request, verifying SHA-256 `6a1a2eb6…407e` (size 1,117,320,736 bytes) before use. | UI: *light download: no task capture*, *light download: optional verified model download*; CI: stamp check in *Build the app*, `lite_check.py` |

## Native evidence

Produced by the **Build** workflow on the `macos-26` runner for the commit named in each app's **About Shishi** panel, uploaded as the *screenshots* artifact:

- `today.png`, `report.png`, `desktop.png`: compact card, alone and on the desktop.
- `inbox.png`, `inbox-dark.png`: expanded Inbox.
- `schedule.png`: Details with a task planned on four days.
- `connections.png`: Connections with the colour picker open and custom colours applied.
- `window-check.json`: native window record (below).
- `data-survival.json`: 1.6 data before and after running this build.

## Acceptance on a real Mac

`window_check.py` records each item as *passed*, *failed* or *not verified* (when the runner does not deliver synthetic mouse input). A CI virtual machine is not a substitute for these checks by a person on a real Mac:

| Item | How to check | CI coverage |
|---|---|---|
| Stage Manager | Turn on Stage Manager, show the card, switch stages. The card must not join or reorder a stage, and must not come forward on its own. | Best-effort: one card window with Stage Manager's setting written; stage behaviour is manual. |
| Dragging | Drag the grip bar: the card follows and snaps to the nearest corner; with snapping off it stays where dropped. | Synthetic drag with snapping on; *not verified* if input is not trusted. Snapping off is manual. |
| Resizing | Drag the bottom-right corner; quit and reopen: the size is kept. | Synthetic drag + relaunch. |
| Focus preservation | Type in another app while a Claude Code turn finishes: typing must continue in that app. | Hook *Stop* while Calculator is frontmost. |
| Compact ↔ expanded | ⌘P and the expand button switch views without a second window, and the card returns to its place. | Each view is launched and captured separately; switching in place is manual. |
| Spaces / on top | Toggle **Show on All Spaces** and **Keep Above Other Windows** and switch desktops. | Default window level (not floating) checked; toggles and Spaces switching are manual. |
| VoiceOver | Rows, chips and the day calendar announce their labels. | Not covered. |

## Remaining limitations

- **Mock-only integrations.** Browser tests use a stand-in host. Notion, Gmail, Outlook and GitHub Actions are tested against fakes; a real Claude Code session is simulated by running the bundled hook with recorded events. Codex is read from local files in the same way as a real install, but no live Codex session runs in CI.
- **Not available in this repository.** Developer ID signing and notarization, and Google / Microsoft OAuth client registrations. Without them macOS warns at first launch and the mail connectors cannot sign in.
- **Model download.** The verification path (size, SHA-256, install location) is compiled and covered with a stand-in in the browser test; a full 1.1 GB download is not run in CI.
- **Language.** Quick-add parsing covers English and Simplified Chinese only. Traditional Chinese forms that differ (for example 週 for 周) and other languages are kept as text.
- **Backups** replace the whole workspace; there is no merge of two workspaces.
