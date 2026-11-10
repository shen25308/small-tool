# Shishi

Shishi is a local Mac workspace for tasks and a quiet inbox for AI results. Leave the small window beside your editor. When a task finishes, it shows the source, the time, and a one-line result. Click to read the summary, the files mentioned, and the saved reply without switching to the AI app. New receipts leave your keyboard focus where it is.

[Download the English macOS preview](https://github.com/shen25308/small-tool/releases/tag/v1.5.0) · [Data and permissions](Release/data-and-permissions.md)

![Shishi workspace with sample tasks and a completed Codex file edit](Previews/workspace.png)

[Small result panel](Previews/result-panel.png) · [Expanded result](Previews/result-expanded.png) · [Dark inbox](Previews/inbox-dark.png)

## Run on a Mac

Version 1.5 requires an Apple Silicon Mac running macOS 26 or later. Download the ZIP from the release, extract it, and open **Shishi.app**. The preview uses local ad-hoc signing and has not been notarized by Apple. The ZIP includes the offline model, inference engine, Python runtime, and third-party notices.

If you are upgrading, Shishi keeps the same local workspace, inbox, and connection preferences. If an MCP client or Grok task was configured with the previous app’s absolute path, copy its configuration again after opening Shishi.app.

## Read a result beside your editor

Open the floating results window from the workspace toolbar and drag it beside your document. The workspace, the small window, and the inbox start with a collapsed preview. Click the preview or focus it and press Space to expand it. Shishi selects sentences from the saved reply, including changes, checks, unresolved work, and file names. Use the original-reply control to read the stored text.

If a new result arrives while you are reading, a control offers to show the latest result. You can finish reading first. Use the back control to return to the summary, the workspace, or your editor. Escape goes up one level in settings. Some replies saved by earlier versions of Shishi contain only the first 4,000 characters. The interface follows the Mac's light or dark appearance. Personal tasks, project names, emails, and AI replies keep their original language.

## Connect a source

Open **Inbox** and choose **Manage connectors**.

- **Codex.** Enable the local Codex connection to read completion events and the final reply from saved sessions on this Mac. If Shishi is closed when a turn ends, it can catch up after reopening while Codex retains the corresponding records. Disconnect to stop future reads. Existing receipts remain available.
- **Gmail and Outlook.** Authorize a desktop OAuth client with the provider and choose one sender or all new mail. Cards show the subject, sender, and arrival time and can open the original message. Mail goes quietly into the inbox by default. Enable the floating-window option to see new mail beside your editor. Sync starts at first connection. Tokens are stored in macOS Keychain. Disconnecting offers to remove that account's local mail cards. This preview needs a registered Google desktop OAuth client or Microsoft Entra client ID. You can revoke access in your provider account.
- **GitHub Actions.** Enter a public repository as `owner/repo` and optionally specify a workflow. Completed runs show the conclusion, branch, and run number. The connector polls the public REST API about every five minutes and respects rate limits.
- **Grok Bot.** Copy the setup instructions from Connectors and include them in a task. Grok manages permission to run its local delivery command. The terminal client has a separate [Grok Build stop hook](GrokBuild/README.md).
- **Other MCP clients.** Copy the local stdio configuration from Connectors and ask the client to call `deliver_result` on completion with a stable event ID. The optional HTTP transport uses a loopback address and a bearer token. A cloud client requires a reachable HTTPS endpoint. [Grok custom connectors](https://docs.x.ai/grok/connectors/custom-mcp-tunneling)

## Turn messages into tasks

Paste a chat or meeting note into the task capture window. The bundled Qwen model extracts candidate tasks locally. Compare each suggestion with its source, edit its title, tag, or project, and choose which tasks to add. Drag a task into **Today** or use its Today action. The compact workspace can keep today's list above other windows.

## Build from source

Install the macOS Swift command-line tools and Python 3. Extract the release ZIP first. From this repository, run the following command with the path to that extracted app. The build copies its pinned model, native inference engine, Python runtime, and licenses, then compiles the app from the Swift and UI sources here.

```sh
python3 build.py --assets /path/to/Shishi.app --output build/Shishi.app
```

If you keep the extracted app next to the source folder, `python3 build.py` uses it by default. To inspect a build, run `python3 Release/verify-release.py build/Shishi.app`. The report distinguishes bundle integrity from Developer ID distribution readiness. A publisher can provide mail OAuth client registrations in `Contents/Resources/Mail/provider-config.json` before signing.

[Distribution and notarization guide](Release/distribution.md) · [Historical 1.3.1 release check](Release/checks-1.3.1.json)
