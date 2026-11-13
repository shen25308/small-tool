# Shishi

**Free, private, and honest about what your agents did.** Shishi is a task list that also watches Claude Code and Codex. Unlike agent monitors that only say an agent stopped, it reads the session log and tells you whether checks actually ran and passed. Nothing leaves your Mac unless you connect a service yourself.

Shishi is a task list for people who work alongside AI. A small card sits in a corner of your screen, like a desktop widget: today's date, a progress ring, the tasks that are left, and a line to add one. Expand it for the full workspace, with smart lists, your own lists and tags in the sidebar. Claude Code, Codex and other agents report to a small Agents list while they work, and their finished replies wait in a quiet inbox, so a result never interrupts you while you type. The interface follows macOS: system fonts and accent color, a translucent sidebar, light and dark appearance, and a menu bar item.

[Latest published release: 1.6.0](https://github.com/shen25308/small-tool/releases/tag/v1.6.0) · [Data and permissions](Release/data-and-permissions.md) · [1.7 repair notes](Release/ux-repair-1.7.md)

> **Version note.** This branch is Shishi **1.7**, which has not been published as a release yet. The release link above is the last published build (1.6.0) and does not include the 1.7 changes described here. Until 1.7 is released, the 1.7 app comes from the **Build** workflow's artifacts (*Shishi-macOS-arm64* and *Shishi-lite-macOS-arm64*). Each build names its source commit under **Shishi → About Shishi**.

![Shishi workspace with smart lists, the Today list and two Claude Code sessions in the Agents list](Previews/workspace.png)

[Corner card](Previews/today.png) · [Brief report](Previews/report.png) · [Card on the desktop](Previews/desktop.png) · [Inbox](Previews/inbox.png) · [Planning several days](Previews/schedule.png) · [Connection colours](Previews/connections.png) · [Dark appearance](Previews/workspace-dark.png) · [Brief report in motion (video)](Previews/agent-report.mp4) · [First run and demo (video)](Previews/first-run-demo.mp4)

## Run on a Mac

Shishi needs an Apple Silicon Mac running macOS 26 or later. Extract the ZIP and open **Shishi.app**. There are two downloads:

- **Full** includes the offline model (1.1 GB), the inference engine, the Python runtime and third-party notices.
- **Light** leaves out only the model. Everything works except finding tasks in a pasted message. To add that later, choose **••• → Download Offline Model…**. Shishi downloads the exact file the full app ships from a pinned revision, checks its SHA-256 before using it, and keeps it in `~/Library/Application Support/ShiShiDesk/Models`. Nothing downloads unless you ask.

Both are previews with local ad-hoc signing. They are not signed with a Developer ID or notarized by Apple, so macOS asks you to confirm the first launch.

If you are upgrading, Shishi keeps the same local workspace, inbox, and connection preferences. If an MCP client or Grok task was configured with the previous app’s absolute path, copy its configuration again after opening Shishi.app.

The design reference for the Today board is [Youniverse’s work task list demo](https://v.douyin.com/qhlq-TKt314/). The still previews above are captured from the running Mac app by the build workflow (commit `47e84d8`), with sample tasks. The two videos come from the browser test harness and predate the 1.7 repairs.

## Plan your day

**The corner card.** Switch to the card from the title bar or with ⌘P. Drag the bar at its top to move it; drag its bottom-right corner to resize it, and it remembers the size. By default it glides into the nearest screen corner when you let go; turn off **Snap to Screen Corners** to leave it where you drop it. **Keep Above Other Windows** and **Show on All Spaces** are off until you turn them on (right-click the card, or **Settings → General → Corner card**). It never takes focus from your editor until you click into it, and there is only ever one card. Check off a task, type a new one (natural language works here too), or use a row's **•••** button. **Inbox** on the card opens every result, even when no report is showing.

**The workspace.** The sidebar has four smart lists (**Today**, **Upcoming**, **All**, **Completed**), your own lists and your tags. Press ⌘1 to ⌘4 to jump between the smart lists.

- **Add a task by typing.** Choose **New Task** (⌘N) and write naturally: `Send report friday 3pm #Finance !p1 @Work every week`. Shishi recognizes dates (today, tomorrow, friday, next week, in 3 days, Dec 3, 11/20), times, `!p0`–`!p2` priority, `#tag`, `@list` and repeats, and shows each one as a chip before you press Return. A date schedules the task. A time or the words *by* and *due* set its deadline. If Shishi reads something you meant literally, click the **×** on its chip to keep it as text, or type a backslash first (`\#123`, `\@home`, `\!p1`). A `#` followed only by digits, such as `#123`, always stays in the title.
- **Input languages.** The quick-add parser understands **English** and **Simplified Chinese**: `明天下午3点 开会`, `周五前交报告`, `下周一`, `11月20日`, `今晚8点半`, `3天后`, `每周`, `每个工作日`. Other languages are kept as plain text. The interface is in English; your tasks, notes and AI replies keep their original language.
- **Plan several days.** A task can be planned on separate days or a range: use a row's calendar button, **Choose Days…** in its **•••** menu, or **Planned** in Details. Upcoming shows it on each planned day. Completing it completes the whole task. It counts as overdue only after its last planned day passes.
- **Work through the list.** The round checkbox completes a task. Click a priority, tag or deadline to change it in place. Each row shows **Plan days**, **Details** and **More** buttons on hover or keyboard focus; **More** (or a right-click) schedules, sets priority, moves, duplicates or deletes a task (with Undo). Drag a task onto Today, a list or a day in Upcoming.
- **Details and deadlines.** Open a task for notes, subtasks, a deadline with time, and a repeat rule. Changes save as you type; closing asks only when something cannot be saved, such as a time without a date. Completing a repeating task schedules the next one, and reopening it removes that next one again if you have not touched it. A due, unfinished task creates one quiet inbox reminder when Shishi is running or reopens. Scheduling a task for Today and setting its deadline are independent.
- **Upcoming** groups the next seven days, with an Overdue section. **Completed** groups finished tasks by day and can be cleared.
- **Search and commands (⌘K).** One field finds tasks, lists and tags, jumps to a view, runs commands, or adds the text as a new task.
- **Focus timer.** Start 15, 25 or 50 minutes on the next task. Completed minutes count toward your wrap-up.
- **Wrap Up** shows what you finished, what is still open, your streak and a seven-day chart. It can move open tasks to tomorrow and copy a summary. **Copy Tasks as Markdown** in the ••• menu copies every list for sharing.
- **Back up and restore.** **••• → Back Up to File…** saves a versioned JSON file with every list, task, note, subtask, planned day, deadline, repeat and colour. **Import Backup…** checks the file first and shows what it contains; nothing changes until you choose **Replace My Data**. Shishi saves a copy of your current data in `ShiShiDesk/Backups` before replacing it, and **Undo** puts it back. Backups never contain connector tokens or account secrets; those stay in your Keychain.

## Read a result

Every finished reply waits in the **Inbox** (toolbar, or the card's **Inbox** button) until you read it. Cards start as one-line previews: click one, or focus it and press Space, to see the summary Shishi picked from the reply (changes, checks, unresolved work and file names), then **Show reply** for the full text. **Mark Read** applies only to the source you are viewing (**Mark N Claude Code Read**); **Mark All Read** asks first and says how many. Each result can be marked read or unread, or archived to the **Archived** filter, and every bulk change has **Undo**. Results unread for more than 12 hours stay in the list and in the card's count. Each connection can have its own colour (**Settings → Agents**, with presets, a custom colour and Reset). **Add Follow-up Task** turns a result into a task for today, and **Add Follow-up Task** turns a result into a task for today. Some replies saved by earlier versions of Shishi contain only the first 4,000 characters. Personal tasks, project names, emails and AI replies keep their original language.

## Connect a source

Open **Settings** with ⌘, (or **••• → Settings…**, or **Settings…** in the inbox). It has four tabs: **Agents**, **Sync**, **Alerts** and **General**.

- **Claude Code.** Choose **Connect**. Shishi adds hooks to your personal `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`). It keeps every other setting, saves a copy as `settings.json.before-shishi`, and **Disconnect** removes only its own entries. While a session works, the **Agents** list shows *Working*. If Claude asks for permission, it shows *Needs you*. When the turn ends, the final reply goes to the inbox. The hooks run in the background, never delay Claude and never ask it to continue. Subagent activity is ignored. Run `python3 ClaudeCode/install.py status` to check a connection from the terminal.
- **Codex.** Enable the local Codex connection to read completion events and the final reply from saved sessions on this Mac. Unread finished turns also appear in Agents. If Shishi is closed when a turn ends, it can catch up after reopening while Codex retains the corresponding records. Disconnect to stop future reads. Existing receipts remain available.
- **Any other tool.** `Connectors/shishi_agents.py set --source "My tool" --session run-42 --state working --title "Nightly build"` puts a row in Agents, and `shishi-send.py` leaves a result in the inbox. Both are local, write one small file, and use no network.
- **Notion.** See below.
- **Gmail and Outlook.** Authorize a desktop OAuth client with the provider and choose one sender or all new mail. Cards show the subject, sender, and arrival time and can open the original message. Mail goes quietly into the inbox by default. Enable the floating-window option to see new mail beside your editor. Sync starts at first connection. Tokens are stored in macOS Keychain. Disconnecting offers to remove that account's local mail cards. This preview needs a registered Google desktop OAuth client or Microsoft Entra client ID. You can revoke access in your provider account.
- **GitHub Actions.** Enter a public repository as `owner/repo` and optionally specify a workflow. Completed runs show the conclusion, branch, and run number. The connector polls the public REST API about every five minutes and respects rate limits.
- **Grok Bot.** Copy the setup instructions from **Settings → Agents** and include them in a task. Grok manages permission to run its local delivery command. The terminal client has a separate [Grok Build stop hook](GrokBuild/README.md).
- **Other MCP clients.** Copy the local stdio configuration from **Settings → Agents** and ask the client to call `deliver_result` on completion with a stable event ID. The optional HTTP transport uses a loopback address and a bearer token. A cloud client requires a reachable HTTPS endpoint. [Grok custom connectors](https://docs.x.ai/grok/connectors/custom-mcp-tunneling)

### A brief report when an agent finishes

When Claude Code or Codex finishes, the corner card shows a short report so you can decide whether to switch to it now:

- **A verdict.** *Needs you* (it asked for input, in English or Chinese, stopped early, or is waiting for permission), *Worth a look* (a check failed, the reply says checks pass but none ran, or something is unresolved), or *Completed*, followed by what Shishi knows about checks: *Checks passed* (it saw them run), *Checks reported passing* (only the reply says so), *No checks ran*, or *Checks not verified*. A bare “Turn finished” never reads as verified. Each report quotes the sentence or command it based the verdict on.
- **It stays put while you read.** A newer result waits behind a *Newer result* button instead of replacing the report under your pointer. **Full reply** opens the original reply in the Inbox in one step, and **Mark Read**, **Archive** and **Undo** work per result.
- **The essentials.** The main change, up to two supporting lines, the files it touched, whether checks passed, how long it took, and what you asked.
- **Facts, not just words.** The hook reads the finished turn from Claude Code's own session log: which files Claude actually edited, and which test, build or lint commands it actually ran and whether they passed. If Claude says the tests pass but never ran any, or changed code without running a single check, the report says *Worth a look* and tells you why. Reading the log happens on your Mac and needs nothing from the network.
- **One click to act.** **Open in Terminal** (or iTerm, VS Code, Cursor, Warp, Ghostty, Zed, the Claude app, or Codex) brings forward the app the session runs in. **Got it** clears the report.

On first launch the empty card offers **Connect Claude Code** and **Try a demo**. The demo plays a pretend session in about ten seconds (working, needing you, finished) without touching your files or your inbox.

A session waiting for you comes first. Other unread results wait behind it, with a count. The hook learns which app the session runs in from the bundle identifier macOS gives your terminal.

### Work with agents from your tasks

- **Send a task to Claude Code.** Give a list a project folder (right-click the list → **Set Project Folder…**), then choose **Send to Claude Code** in a task's **•••** menu or in Details. Shishi opens a new Terminal or iTerm2 window in that folder (**Settings → Agents → Start agents in**) and starts Claude Code with the task, its notes and open subtasks as the prompt. The task row then shows the session live (*Claude Code working*, *needs you*), and afterwards the verdict of its report and how long it worked, for example *Completed · Checks passed · 25 min*. Checking the task off marks the report read. **Wrap Up** counts agent minutes. **Send to Codex** starts Codex the same way; Codex has no hooks, so its runs are not linked back to the task.
- **Answer permission requests from the card** (opt-in, **Settings → Agents**). When Claude Code wants to run a command, the card shows the full command with **Allow** and **Deny**. Claude Code waits 15, 25, 45 or 90 seconds for your answer, then asks in the terminal as usual; while it waits, the terminal shows no prompt. It only waits while Shishi is open, and nothing is allowed without a click. New Claude Code sessions pick up the change.
- **Open the exact tab.** **Open in Terminal** (or iTerm2) brings forward the tab the session runs in, and selects its tmux pane. For VS Code, Cursor, Zed and Windsurf it opens the window for the session's folder. macOS asks once whether Shishi may control Terminal or iTerm2.
- **What a session is doing.** Working sessions show their last tool (*Edit billing.py · 14 tools*). A session whose process ended without a reply, for example because its terminal was closed, shows *Stopped* instead of *Working*.
- **Usage and limits** under Agents: Claude Code tokens in the last 5 hours and this week, read from its own session files, and the Codex rate limits Codex records, with reset times. Claude's plan limits are not stored on your Mac, so Shishi shows counts rather than a percentage. Turn it off in Settings.
- **Diagnostics.** **Settings → Agents → Diagnostics** lists the last hook deliveries (event, time, outcome). Prompts, replies and commands are never kept there.

### Shortcuts, alerts and links

- **Shortcuts in every app:** ⌃⌥Space shows or hides the card; ⌃⌥N brings it forward ready to add a task. They need no Accessibility permission and can be turned off in Settings.
- **Alerts** are off until you choose them in **Settings → Alerts**: a sound and/or banner when an agent needs you (and once more if it is still waiting after 2, 5 or 10 minutes), and when a task's deadline arrives. Quiet hours silence both.
- **Keep the Mac awake while an agent works** (optional); it lets the Mac sleep again when every agent has finished or is waiting for you.
- **Links for Shortcuts, Raycast and scripts:** `shishi://add?text=Call%20the%20bank%20tomorrow%203pm&list=Personal&notes=...`, `shishi://open?view=today` (also `upcoming`, `all`, `done`, `inbox`), `shishi://search?q=roadmap`, `shishi://show-card`. A link can add a task or show something, never change or delete what is there.

### Stay out of the way

Agent progress shows in three quiet places: the **agent capsule** at the top of the window and of the corner card, the **Agents** list in the sidebar, and the **menu bar item**, which counts working agents and unread results and lists each one. With the menu bar item on, Shishi keeps collecting results after you close its window. Turn it off in Settings to quit with the last window. The same section sets the appearance to follow the system, or to stay light or dark. The capsule spins while an agent works, glows orange when one needs you, and opens for a few seconds with the first line of a fresh result before it shrinks back. Click it to read the result or see every agent. Nothing here makes a sound or sends a notification unless you turn on Alerts. Open a finished result from Agents to read it, or add a follow-up task from the result.

### Apple Reminders, Calendar and GitHub issues

- **Apple Reminders** (**Settings → Sync**): keep one list in step with a Reminders list, both ways, so your tasks are on iPhone, Apple Watch and in Siri. Title, completion, deadline and priority sync every 5 minutes; if both sides changed, Reminders wins.
- **Calendar events** (**Settings → Sync**): the day's events appear above Today and in each Upcoming day, and the card shows the next one. Read only.
- **GitHub issues** (**Settings → Sync**): a public repository's open issues, optionally only those assigned to someone or with a label, become tasks. A task completes when its issue closes and reopens with it. Checking a task off does not close the issue. No GitHub account is needed.

### Notion

Open **Settings → Sync → Notion**, paste the link to a task database and choose the list to sync. Create an internal integration in Notion, add it to the database with **••• → Connections**, and paste its secret when Shishi asks. The secret is stored in your Keychain and never reaches the page. Title, completion, deadline, priority and tag stay in step in both directions: pages in the database appear in the list, tasks you add to that list are created in Notion, and the Notion page wins if both sides changed. Shishi syncs when it starts, every 15 minutes and on **Sync Now**. It never deletes Notion pages.

## Turn messages into tasks

Choose **More (…) → Capture tasks from a message**, then paste a chat or meeting note. The bundled Qwen model extracts candidate tasks locally. Compare each suggestion with its source, edit its title, tag, or project, and choose which tasks to add. Drag a task into **Today** or use its Today action. The floating Today list can stay above other windows.

## Build from source

Install the macOS Swift command-line tools and Python 3. Extract the release ZIP first. From this repository, run the following command with the path to that extracted app. The build copies its pinned model, native inference engine, Python runtime, and licenses, then compiles the app from the Swift and UI sources here.

```sh
python3 build.py --assets /path/to/Shishi.app --output build/Shishi.app
```

Add `--lite` to leave out the offline model. The build stamps the source commit into `Info.plist` (`ShishiSourceCommit`), and CI fails if it does not match the commit it built.

Run the tests with `python3 -m unittest discover -s Tests` and `node --test Tests/*.test.mjs`. `node Tests/ui/check.mjs [folder]` drives the interface in Chromium against a stand-in for the Mac app (it needs Playwright) and saves screenshots. GitHub Actions builds the app on macOS, launches it with sample data and publishes screenshots of the real window.

If you keep the extracted app next to the source folder, `python3 build.py` uses it by default. To inspect a build, run `python3 Release/verify-release.py build/Shishi.app`. The report distinguishes bundle integrity from Developer ID distribution readiness. A publisher can provide mail OAuth client registrations in `Contents/Resources/Mail/provider-config.json` before signing.

Still outside this repository: Developer ID signing and Apple notarization, and the Google and Microsoft OAuth client registrations that Gmail and Outlook need. Without them the mail connectors cannot sign in, and macOS shows a first-launch warning.

**Updates.** Once a day Shishi asks GitHub for the latest published release and mentions a newer one once (**Settings → General → Updates**). It never downloads or installs anything. A Homebrew cask template is in [Release/homebrew/shishi.rb](Release/homebrew/shishi.rb); it works once a release is published.

[Distribution and notarization guide](Release/distribution.md) · [Historical 1.3.1 release check](Release/checks-1.3.1.json)
