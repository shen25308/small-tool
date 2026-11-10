# Deliver Grok Build replies to Shishi

This connector sends each completed turn from a main Grok Build CLI session to the AI Inbox. Each message uses the working directory as its title. For the Grok Bot desktop app, open the connector settings in Shishi and copy the instructions for local delivery.

## Set up the CLI hook

Run these commands from this directory with Grok Build 1.0.63 or later.

```sh
python3 install.py status
python3 install.py install
```

Restart Grok Build or reload the configuration in `/hooks`. Finish a turn and open the message from **Grok Build** in Shishi. To disable delivery, run `python3 install.py remove` and reload the hooks in Grok Build.

The installer creates `~/.grok/hooks/shishi-inbox.json`, or `$GROK_HOME/hooks/shishi-inbox.json` when you set `GROK_HOME`. The runtime scripts are stored alongside the hook configuration, so delivery continues if you move Shishi.app. Removing the hook keeps the scripts available to callbacks that are already running.

## When a message arrives

The connector accepts main-session `Stop` events with `reason=end_turn`. It sends the reply over local standard input and uses the session and turn IDs to deduplicate retries. It skips interruptions, API errors, closed sessions, and subagent events. If another Stop hook asks Grok to continue, Grok may already have sent this hook a reply for the turn.

See the [Grok Build hook guide](https://docs.x.ai/build/features/hooks), [Stop event fields and continuation behavior](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md), and [Grok Build release notes](https://x.ai/changelog/build).
