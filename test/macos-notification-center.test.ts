import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify } from "../src/event.ts";
import { type Cursor, type StoreRow, parseRow, readNew } from "../src/sources/macos-notification-center.ts";
import { loadState, saveState } from "../src/state.ts";
import { createStore, fixture, insertRecord } from "./helpers.ts";

const DISCORD = ["com.hnc.discordptb"];
const UUID_A = "33B7CD2C59FF4C0F8C095EB2BCC0B4F9";
const UUID_B = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const UUID_C = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function failOnParseError(error: unknown): never {
  throw error;
}

describe("parseRow", () => {
  test("Discord PTB direct message", () => {
    const row: StoreRow = { uuid: Buffer.from(UUID_A, "hex"), data: fixture("discord-ptb-dm.plist"), delivered_date: 812078492.59825, identifier: "com.hnc.discordptb" };
    const event = parseRow(row);
    expect(event).toEqual({
      id: UUID_A,
      sourceId: "com.hnc.discordptb",
      title: "dani",
      subtitle: undefined,
      body: "oi oi oi",
      deliveredAt: new Date("2026-09-26T01:21:32.598Z"),
      thread: "100000000000000003",
      category: undefined,
      deepLink: "discord://ptb.discord.com/channels/@me/100000000000000003/100000000000000004",
      mentionsCurrentUser: false,
      replyToCurrentUser: false,
    });
    expect(classify(event)).toBe("dm");
  });

  test("an app without a Discord deep link classifies as other", () => {
    const row: StoreRow = { uuid: Buffer.from(UUID_B, "hex"), data: fixture("whatsapp-psa.plist"), delivered_date: 0, identifier: "net.whatsapp.whatsapp" };
    const event = parseRow(row);
    expect(event.deepLink).toBeUndefined();
    expect(event.category).toBe("psa");
    expect(classify(event)).toBe("other");
  });
});

describe("readNew", () => {
  const start: Cursor = { deliveredDate: 100, seen: [] };

  test("ignores rows before the cursor and from sources outside the allowlist", () => {
    const db = createStore();
    insertRecord(db, { uuid: UUID_A, deliveredDate: 50, data: fixture("discord-ptb-dm.plist") });
    insertRecord(db, { uuid: UUID_B, appId: 87, deliveredDate: 150, data: fixture("whatsapp-psa.plist") });
    expect(readNew(db, DISCORD, start, failOnParseError).events).toEqual([]);
  });

  test("a new row after the cursor emits once", () => {
    const db = createStore();
    insertRecord(db, { uuid: UUID_A, deliveredDate: 150, data: fixture("discord-ptb-dm.plist") });
    const first = readNew(db, DISCORD, start, failOnParseError);
    expect(first.events.map((event) => event.id)).toEqual([UUID_A]);
    expect(first.cursor).toEqual({ deliveredDate: 150, seen: [UUID_A] });
    expect(readNew(db, DISCORD, first.cursor, failOnParseError).events).toEqual([]);
  });

  test("a rec_id reused after delete emits only the new notification", () => {
    const db = createStore();
    insertRecord(db, { recId: 4, uuid: UUID_A, deliveredDate: 150, data: fixture("discord-ptb-dm.plist") });
    const first = readNew(db, DISCORD, start, failOnParseError);
    db.run("delete from record where rec_id = 4");
    insertRecord(db, { recId: 4, uuid: UUID_B, deliveredDate: 150, data: fixture("discord-ptb-dm.plist") });
    expect(readNew(db, DISCORD, first.cursor, failOnParseError).events.map((event) => event.id)).toEqual([UUID_B]);
  });

  describe("across a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "notify-relay-"));
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    test("does not replay notifications already relayed", () => {
      const db = createStore();
      const statePath = join(dir, "state.json");
      insertRecord(db, { uuid: UUID_A, deliveredDate: 150, data: fixture("discord-ptb-dm.plist") });
      saveState(statePath, { cursor: readNew(db, DISCORD, start, failOnParseError).cursor, sinks: {} });

      insertRecord(db, { uuid: UUID_C, deliveredDate: 200, data: fixture("discord-ptb-dm.plist") });
      const restored = loadState(statePath);
      if (!restored) throw new Error("state was not saved");
      expect(readNew(db, DISCORD, restored.cursor, failOnParseError).events.map((event) => event.id)).toEqual([UUID_C]);
    });
  });

  test("skips an unparseable row without dropping the rest of the batch", () => {
    const db = createStore();
    insertRecord(db, { uuid: UUID_A, deliveredDate: 150, data: new Uint8Array([1, 2, 3]) });
    insertRecord(db, { uuid: UUID_B, deliveredDate: 160, data: fixture("discord-ptb-dm.plist") });
    const skipped: string[] = [];
    const result = readNew(db, DISCORD, start, (_error, row) => skipped.push(row.identifier));
    expect(result.events.map((event) => event.id)).toEqual([UUID_B]);
    expect(skipped).toEqual(["com.hnc.discordptb"]);
    expect(result.cursor.seen).toEqual([UUID_A, UUID_B]);
  });
});
