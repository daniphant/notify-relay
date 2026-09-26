# Notification shapes

Captured from `~/Library/Group Containers/group.com.apple.usernoted/db2/db` on Vector (macOS 26.6.2). Raw blobs live in `test/fixtures/`.

Each `record.data` is a binary plist with top-level keys `styl, app, uuid, date, srce, req, orig`. `app` is the bundle id with its original casing; the `app` table stores it lowercased. `delivered_date` and `date` are seconds since 2001-01-01 UTC.

The `req` dictionary holds the notification content. `usda` (the app's userInfo) and `uncc` (an `INSendMessageIntent` communication context) are nested NSKeyedArchiver plists.

## Discord PTB (`com.hnc.DiscordPTB`)

### Direct message: `discord-ptb-dm.plist`

| Key | Value |
|---|---|
| `titl` | sender display name (`dani`) |
| `body` | message text |
| `iden` | Discord message id |
| `thre` | Discord channel id (the DM channel) |
| `unct` | `UNNotificationContentTypeMessagingDirect` |
| `soun.nam` | `discord_message1` |
| `usda` | NSDictionary `{ fallbackDeepLink: "discord://ptb.discord.com/channels/@me/<channelId>/<messageId>" }` |
| `uncc` | root object has inline booleans `mentionsCurrentUser`, `replyToCurrentUser`, `notifyRecipientAnyway`, `businessCorrespondence` and an integer `recipientCount`. The sender contact's `handle` is the sender's Discord user id. |

There is no `subt` and no `cate`.

### Server mention and server reply

Not captured yet.

## WhatsApp (`net.whatsapp.WhatsApp`)

### Service announcement: `whatsapp-psa.plist`

`titl` is `‎WhatsApp ✅`, `cate` is `psa`, `thre` is the sender JID (`0@s.whatsapp.net`), and `atta` holds a JPEG attachment path. `uncc` has the same communication-context shape as Discord, with `handleType: 2` and a phone-number handle. `usda` carries WhatsApp's own keys (`jid`, `type`, `WAMessageNotificationProtobuf`, and others) and has no deep link.
