import { expect, test } from "bun:test";
import type { DiscordSinkConfig } from "../src/config.ts";
import type { NotificationEvent } from "../src/event.ts";
import { formatMessage } from "../src/sinks/discord.ts";

const config: DiscordSinkConfig = { enabled: true, channelId: "1", mentionUserId: "100000000000000001", mentionOn: ["dm", "mention", "reply"] };

const dm: NotificationEvent = {
  id: "A",
  sourceId: "com.hnc.discordptb",
  title: "dani",
  body: "first line\nsecond line <@999>",
  deliveredAt: new Date(0),
  deepLink: "discord://ptb.discord.com/channels/@me/100000000000000003/100000000000000004",
};

test("a DM pings only the configured user and links to the message", () => {
  expect(formatMessage(dm, "Discord (work)", config)).toEqual({
    content: [
      "<@100000000000000001> **Discord (work)** · dani",
      "> first line",
      "> second line <@999>",
      "https://discord.com/channels/@me/100000000000000003/100000000000000004",
    ].join("\n"),
    allowed_mentions: { parse: [], users: ["100000000000000001"] },
  });
});

test("a server message that does not involve the user is relayed without a ping", () => {
  const event = { ...dm, deepLink: "discord://ptb.discord.com/channels/10/20/30", mentionsCurrentUser: false };
  const message = formatMessage(event, "Discord (work)", config);
  expect(message.content.startsWith("**Discord (work)** · dani\n")).toBe(true);
  expect(message.allowed_mentions.users).toEqual([]);
});

test("a server mention pings", () => {
  const event = { ...dm, deepLink: "discord://ptb.discord.com/channels/10/20/30", mentionsCurrentUser: true };
  expect(formatMessage(event, "Discord (work)", config).allowed_mentions.users).toEqual(["100000000000000001"]);
});

test("a long body is truncated so the message stays under Discord's limit", () => {
  const message = formatMessage({ ...dm, body: "x".repeat(5000) }, "Discord (work)", config);
  expect(message.content.length).toBeLessThan(2000);
});
