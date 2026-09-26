# notify-relay

Forwards macOS notifications from one Mac to a Discord channel.

The daemon reads the Notification Center store (`~/Library/Group Containers/group.com.apple.usernoted/db2/db`) read-only, picks up new notifications from allowlisted apps, and posts each one to a Discord channel with a bot token. It was built to surface mentions and DMs for a Discord account that is only signed in on an always-on Mac. It never talks to Discord as that account.

## Setup

```sh
mise install
bun install
mkdir -m 700 ~/.notify-relay
```

`~/.notify-relay/config.json`:

```json
{
  "sources": {
    "com.hnc.discordptb": { "label": "Discord (work)" }
  },
  "sinks": {
    "stdout": { "enabled": true },
    "discord": {
      "enabled": true,
      "channelId": "100000000000000002",
      "mentionUserId": "100000000000000001",
      "mentionOn": ["dm", "mention", "reply"]
    }
  }
}
```

- `sources` is the allowlist, keyed by bundle id (case-insensitive). The label heads each relayed message.
- `mentionOn` chooses which events ping `mentionUserId`. Discord notifications classify as `dm`, `mention`, `reply`, or `other`, and every other app classifies as `other`. The relay only ever pings `mentionUserId`, even when the relayed text contains other mentions.

`~/.notify-relay/env` (mode 600) holds the bot token:

```sh
NOTIFY_RELAY_DISCORD_TOKEN=...
```

The bot needs View Channel and Send Messages on the target channel.

## Commands

```sh
bun run src/cli.ts once      # print what is in Notification Center now for the configured sources
bun --env-file=$HOME/.notify-relay/env run src/cli.ts daemon   # run in the foreground
bun run src/cli.ts start     # install the LaunchAgent and start it
bun run src/cli.ts stop
bun run src/cli.ts restart
bun run src/cli.ts status    # daemon pid, last event, sink health
bun run src/cli.ts tail      # follow ~/Library/Logs/notify-relay/daemon.log
```

On first run the daemon starts from the current time and never relays older notifications. `~/.notify-relay/state.json` keeps the cursor across restarts.

## Full Disk Access

macOS privacy protection blocks LaunchAgents from reading another app's group container, including the Notification Center store. Terminal and SSH sessions work only because they already have Full Disk Access. `start` installs a LaunchAgent that runs the bun binary you started it with, by absolute path. `start` prints that path. Add it under System Settings → Privacy & Security → Full Disk Access, then run `restart`. When the pinned bun version in `.mise.toml` changes, the path changes too, so grant access again.

## Adding a source

1. Trigger a notification from the app and find its bundle id: `sqlite3 -readonly "$HOME/Library/Group Containers/group.com.apple.usernoted/db2/db" "select identifier from app"`.
2. Add it under `sources` with a label, then run `restart`.

The title, subtitle, and body work for any app. Mention and DM detection currently reads Discord's deep link and intent flags only.

## Rotating the token

Reset the token in the Discord developer portal, update `~/.notify-relay/env` (and OpenClaw, if the bot is shared), then run `restart`.
