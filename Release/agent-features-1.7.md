# Agent and to-do features added after the comparison

These features close the gaps found when Shishi was compared with agent monitors (AgentPeek, CodeStatus, AgentBar,
Agent Manager X, CodeIsland, Vibe Notch) and to-do apps (Things, TickTick, Todoist, Apple Reminders, Super
Productivity). Each one has a test that fails if it breaks. Browser tests use a stand-in for the Mac app; the
macOS build workflow compiles the Swift and runs the native launch, window and data-survival checks.

| Gap | Feature | Where | Tests |
|---|---|---|---|
| Crashed sessions stayed "Working" | Hook records the Claude process; a dead process shows *Stopped*, then clears after an hour | `receive.py`, `AgentStatus.swift` | `test_tool_activity_and_process_are_recorded`; UI *agents: current tool, stopped sessions…* |
| No idea what an agent is doing | Last tool and tool count on Agents and the island | `receive.py`, `agents.js` | same |
| No global shortcut | ⌃⌥Space show/hide card, ⌃⌥N add a task (Carbon hot keys, no Accessibility) | `Hotkeys.swift` | UI *global shortcut focuses the card add field* (native hot key needs a person) |
| Mac sleeps mid-run | Optional power assertion while any agent works | `Hotkeys.swift` (`KeepAwake`) | settings check; native behaviour needs a person |
| Hard to debug hooks | Diagnostics: last 200 deliveries, no content | `receive.py`, Connections | `test_delivery_log_keeps_no_content`; UI diagnostics check |
| Approve from the app | Opt-in PermissionRequest hook; Allow/Deny on the card with a countdown; terminal fallback | `permission.py`, `Approvals.swift`, `approvals.js` | `ApprovalHook` (allow, deny, closed Shishi, no answer, answered in terminal, installer); UI *approve a permission request…* |
| A waiting agent goes unnoticed | Optional sound/banner, reminder after N minutes, quiet hours; due-task alerts | `Alerts.swift` | UI *approvals and alerts in Connections* |
| Hunting for the right tab | iTerm2 session, Terminal tab (tty), tmux pane, or editor folder window | `SessionFocus.swift` | `test_where_the_session_runs_is_recorded`; UI *open the exact terminal tab…* |
| No usage or limits | Claude tokens (5 h, today, week) from local logs; Codex rate limits from its session files | `agent_usage.py` | `UsageReport`; UI *usage and limits under Agents…* |
| Codex coverage overstated | Connections says Codex cannot report waiting for approval | `inbox.js` (Settings → Agents) | — |
| No iPhone, Siri, widgets | Two-way sync of one list with Apple Reminders (same tested sync as Notion) | `EventKitBridge.swift`, `apple.js` | node *the same sync keeps a list in step with Apple Reminders*; UI *Apple Reminders: sync a list both ways* |
| No calendar | Today's events above Today, in Upcoming, "Next" on the card (read only) | `EventKitBridge.swift`, `apple.js` | UI *calendar events in Today, Upcoming and the card* |
| No automation | `shishi://` add/open/search/show-card links (add or show only) | `main.swift`, `board.js` | UI *shishi:// links add a task or show a view…* |
| No GitHub issues | Public repo issues → tasks, closed with the issue | `github_issues.py`, `issue-sync.js` | `GitHubIssues`; node *GitHub issues become tasks…*; UI *GitHub issues become tasks* |
| Tasks and agents unconnected | Send to Claude Code/Codex in the list's folder; linked session state, report and time on the task | `AgentLaunch.swift`, `agent-tasks.js`, `receive.py` | `test_session_started_from_a_task_keeps_its_link`; UI *send a task to Claude Code and follow it back* |
| No update path | Daily check of the latest GitHub release, mentioned once; never installs | `Updates.swift` | UI *update check…* |
| No Homebrew | Cask template, usable once a release exists | `Release/homebrew/shishi.rb` | `ruby -c` |

## Not done, and why

- **Gemini CLI**: its site says it was replaced by Antigravity CLI in June 2026. **OpenCode** and **Copilot CLI**: their
  event formats could not be confirmed from their documentation. Shishi does not guess hook formats; any tool can
  still report through `Connectors/shishi_agents.py` and `shishi-send.py`.
- **Codex waiting for approval**: Codex has no event for it, so no monitor can show it through official means.
- **Claude plan limit percentage**: not stored on the Mac; reading it would mean calling Anthropic with your
  credentials, which Shishi does not do.
- **Notch view, system widget, Shortcuts actions, Sparkle auto-update, iPhone app**: these need an Xcode project or
  signing keys, which were out of scope for now. Reminders sync covers iPhone and Siri meanwhile, and `shishi://`
  links work from Shortcuts.
- **Developer ID signing and notarization**: need an Apple Developer account.

## Needs a person on a real Mac

Global shortcuts from another app; Allow/Deny reaching a real Claude Code session; the Automation prompts for
Terminal and iTerm2 and landing in the right tab; Reminders and Calendar permission prompts and a real sync;
sound and banner alerts; keep-awake (`pmset -g assertions`); starting an agent from a task in a real folder.

## Second round: design and features from Things, TickTick, Todoist and agent tools

| From | Feature | Tests |
|---|---|---|
| Design critique of generated UI | `UI/quiet.css`: neutral surfaces, one accent, colour only for meaning; no glow, gradient text, confetti or tinted cards | full UI suite; screenshots reviewed in light and dark |
| macOS System Settings | Settings in four tabs (Agents, Sync, Alerts, General), switches, ⌘, | Settings checks in the UI suite |
| Things | This Evening, Someday (⌘E, ⌘O, "this evening", "someday"), keyboard control of the list | UI *This Evening, Someday and keyboard control of the list* |
| Todoist filters, OmniFocus perspectives | Saved filters with `& | ! ( )`, #tag, @list, dates, priority | node *saved filters*; UI *saved filters in the sidebar* |
| TickTick | Priority matrix in All | UI *priority matrix in All* |
| Conductor-style review | Open changed files from a report, inside the session folder only | UI *open a changed file from the report* |

Not copied, and why:
- **Answering Claude's multiple-choice questions from the card.** Claude Code's hook answer for AskUserQuestion is undocumented, and
  open reports say a PreToolUse hook can make those questions return empty answers. Shishi does not risk that.
- **Habits, countdowns, sticky notes.** Outside a task list for agent work; the corner card already plays the sticky-note role.
- **Diff viewer and worktrees.** Shishi opens the changed files; reviewing diffs belongs to the editor or a tool like Conductor.
