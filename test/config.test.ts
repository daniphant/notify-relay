import { expect, test } from "bun:test";
import { parseConfig } from "../src/config.ts";

const valid = {
  sources: { "com.hnc.DiscordPTB": { label: "Discord (work)" } },
  sinks: {
    stdout: { enabled: true },
    discord: { enabled: true, channelId: "100000000000000002", mentionUserId: "100000000000000001", mentionOn: ["dm", "mention", "reply"] },
  },
};

test("accepts the documented config and matches bundle ids case-insensitively", () => {
  expect(parseConfig(valid).sources).toEqual({ "com.hnc.discordptb": { label: "Discord (work)" } });
});

test("rejects a Discord sink without a channelId", () => {
  const { channelId: _, ...discord } = valid.sinks.discord;
  expect(() => parseConfig({ ...valid, sinks: { discord } })).toThrow("sinks.discord.channelId must be a non-empty string");
});

test("rejects an unknown sink", () => {
  expect(() => parseConfig({ ...valid, sinks: { ...valid.sinks, slack: { enabled: true } } })).toThrow("sinks.slack is not a known sink");
});

test("rejects an unknown mention kind", () => {
  const discord = { ...valid.sinks.discord, mentionOn: ["dms"] };
  expect(() => parseConfig({ ...valid, sinks: { discord } })).toThrow('mentionOn has "dms"');
});
