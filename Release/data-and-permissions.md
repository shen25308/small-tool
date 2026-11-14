# Shishi preview: data and permissions

Shishi stores your task lists and inbox on this Mac. A result card summarizes the saved reply: changes, files, checks, and outstanding actions. You can open the original text inside the card. The bundled model extracts tasks from pasted work messages locally.

| Enabled source | What Shishi reads or receives | Your controls |
| --- | --- | --- |
| Task deadlines | The deadline and title of an unfinished task in your own workspace | On the due date or time, Shishi saves a quiet local reminder. Edit or clear a deadline on the task. |
| Local Codex | Turn-completion events, final replies, and the conversation title or working-directory name in local session records | Connect to save newly completed turns. Disconnect to stop reading. Previously saved cards remain accessible. |
| Gmail | Inbox changes, subjects, senders, arrival times, and message IDs for the authorized account | Authorize on Google's page and choose one sender or all new mail. |
| Outlook | Basic account details and basic properties of new inbox messages | Authorize on Microsoft's page and choose one sender or all new mail. |
| GitHub Actions | Workflow name, branch, conclusion, run number, and original URL from the public repository you enter | Shishi polls GitHub. Choose a single workflow or disconnect the subscription. |
| Grok Bot, MCP, and manually saved replies | Title, summary, source, and optional link supplied by the sender or selected by you | Deliver results per task. The original app opens when you select its link. |

Mail cards store metadata such as subject and sender. The requested mail scopes exclude message bodies, attachments, and sending mail. Sign-in takes place on the provider's website. OAuth tokens are stored in macOS Keychain. Account identifiers, sender filters, and sync progress are stored in the app data directory. GitHub requests include the public repository name you enter.

Saved content is under `~/Library/Application Support/ShiShiDesk` for the current macOS user. The task list is `Workspace.json`. The redesigned interface writes it in format 2, which adds an optional planned time, completion time and deferral count to each task. The first time it opens a format 1 file, Shishi keeps a copy as `Workspace.v1.backup.json`; earlier versions of Shishi cannot open a format 2 file, so restore that copy if you go back. Interface preferences such as the sky palette are stored in the app's preferences. The AI quota entry reads nothing in this version; it does not contact any provider. Cards persist across restarts. In the inbox connector settings, you can change the sender filter or disconnect an account. When disconnecting, you can also remove that account's synced mail cards from this Mac. To revoke the provider's permission, use the Google or Microsoft account permissions page.

This notice describes the local preview. Before a production release, the publisher should provide its identity, support and privacy contacts, a public privacy policy, and a way to handle rights requests in the regions served. Verify the notice against the final signed build and its actual data flows.
