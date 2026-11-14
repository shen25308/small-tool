# Shishi

Shishi keeps a narrow Today list beside your editor. Expand it to see the workspace, with projects and tags in the sidebar and a mountain cover over the task list. Drag tasks from a project into Today. AI replies arrive separately in a quiet inbox, so you can finish typing before reading them.

[Download the English macOS preview](https://github.com/shen25308/small-tool/releases/tag/v1.6.0) · [Data and permissions](Release/data-and-permissions.md)

![Shishi workspace showing Today and project lists with sample tasks](Previews/workspace.png)

[Floating Today list](Previews/today.png) · [Tag picker](Previews/tags.png) · [Deadline editor](Previews/deadline.png) · [Small result panel](Previews/result-panel.png) · [Expanded result](Previews/result-expanded.png) · [Dark inbox](Previews/inbox-dark.png)

## Run on a Mac

Version 1.6 requires an Apple Silicon Mac running macOS 26 or later. Download the ZIP from the release, extract it, and open **Shishi.app**. The preview uses local ad-hoc signing and has not been notarized by Apple. The ZIP includes the offline model, inference engine, Python runtime, and third-party notices.

If you are upgrading, Shishi keeps the same local workspace, inbox, and connection preferences. If an MCP client or Grok task was configured with the previous app’s absolute path, copy its configuration again after opening Shishi.app.

The design reference for the Today board is [Youniverse’s work task list demo](https://v.douyin.com/qhlq-TKt314/). The English previews above show sample tasks in the running Mac app.

## Plan your day

The workspace opens on **Today**. A time band across the top runs from early morning to midnight, and its sky follows the real time of day: sunrise and sunset are worked out on this Mac from the time zone, with no location permission. Timed tasks sit on the band; crowded ones merge into a number you can open. Drag across the band to show only that stretch of the day. Finished tasks leave a small star at the moment they were done, and a task's deadline shows as its own mark, separate from when you plan to do it.

The list below follows the band: overdue, now, up next, tonight, untimed, and done. Click a circle to complete a task; every change can be undone with ⌘Z. Hover or tab to a row to defer it, schedule it in the next free slot, or open its details. Unfinished tasks from earlier days are not piled into Today. They wait under **Carried over** on the left of the band, and a tidy-up card offers to move, schedule or defer them once a day. **Plan** shows 3 days or a week; **All tasks** lists everything still open.

Press **N** to add a task in one line, for example “tomorrow 3pm send weekly report #team P1” or “明天下午3点 发周报 #团队 !”. The preview shows the date and time Shishi understood before you press Return. **Suggest slots** previews free half-hour slots for overdue tasks and moves nothing until you accept. Press **?** for every shortcut. The interface follows the Mac's language (English or Simplified Chinese), appearance, Reduce Motion and Reduce Transparency settings.

## Read a result beside your editor

**AI results** gathers Codex turns and connector deliveries in one drawer that leaves the time band visible. Results are grouped as needing you, failed, or done, based only on what each result says; several updates from the same Codex conversation share one row. Use J and K to move, Space to expand, A to accept and open the source, E to mark done, U for unread and X to select. Results that arrive together become one notice and one summary card. **Focus** (F) holds new results and delivers them together when you finish.

Choose **More (…) → Show result panel** to keep a small results panel beside your document. It shows one line until you open it, then a single-sentence summary, the points that need you, changed files, and the raw reply on request. When several results arrive at once, the panel shows one merged line instead of flashing through them.

The **AI quota** entry at the bottom of the sidebar shows only figures this Mac can read without a network request. In this version no provider's usage format is confirmed, so each one says **Not provided** and why.

## Connect a source

Open **AI results** and choose **Manage connectors**, or choose **More (…) → Connectors**.

- **Codex.** Enable the local Codex connection to read completion events and the final reply from saved sessions on this Mac. If Shishi is closed when a turn ends, it can catch up after reopening while Codex retains the corresponding records. Disconnect to stop future reads. Existing receipts remain available.
- **Gmail and Outlook.** Authorize a desktop OAuth client with the provider and choose one sender or all new mail. Cards show the subject, sender, and arrival time and can open the original message. Mail goes quietly into the inbox by default. Enable the floating-window option to see new mail beside your editor. Sync starts at first connection. Tokens are stored in macOS Keychain. Disconnecting offers to remove that account's local mail cards. This preview needs a registered Google desktop OAuth client or Microsoft Entra client ID. You can revoke access in your provider account.
- **GitHub Actions.** Enter a public repository as `owner/repo` and optionally specify a workflow. Completed runs show the conclusion, branch, and run number. The connector polls the public REST API about every five minutes and respects rate limits.
- **Grok Bot.** Copy the setup instructions from Connectors and include them in a task. Grok manages permission to run its local delivery command. The terminal client has a separate [Grok Build stop hook](GrokBuild/README.md).
- **Other MCP clients.** Copy the local stdio configuration from Connectors and ask the client to call `deliver_result` on completion with a stable event ID. The optional HTTP transport uses a loopback address and a bearer token. A cloud client requires a reachable HTTPS endpoint. [Grok custom connectors](https://docs.x.ai/grok/connectors/custom-mcp-tunneling)

## Turn messages into tasks

Choose **More (…) → Capture tasks from a message** (⌘K), then paste a chat or meeting note. The bundled Qwen model extracts candidate tasks locally. Compare each suggestion with its source, edit its title, tag, or project, and choose which tasks to add. Choose whether the tasks go into Today. The floating Today list (⌘P) can stay above other windows.

## Build from source

Install the macOS Swift command-line tools and Python 3. Extract the release ZIP first. From this repository, run the following command with the path to that extracted app. The build copies its pinned model, native inference engine, Python runtime, and licenses, then compiles the app from the Swift and UI sources here.

```sh
python3 build.py --assets /path/to/Shishi.app --output build/Shishi.app
```

If you keep the extracted app next to the source folder, `python3 build.py` uses it by default. To inspect a build, run `python3 Release/verify-release.py build/Shishi.app`. The report distinguishes bundle integrity from Developer ID distribution readiness. A publisher can provide mail OAuth client registrations in `Contents/Resources/Mail/provider-config.json` before signing.

[Distribution and notarization guide](Release/distribution.md) · [Historical 1.3.1 release check](Release/checks-1.3.1.json)

The interface tests in `tests/` run the pages in a browser against a fake host, without building the app. See [tests/README.md](tests/README.md).
