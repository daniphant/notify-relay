import type { Database } from "bun:sqlite";
import { parseBuffer } from "bplist-parser";
import { watch } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { NotificationEvent } from "../event.ts";

export const STORE_PATH = join(homedir(), "Library/Group Containers/group.com.apple.usernoted/db2/db");

// The store uses Core Data timestamps: seconds since 2001-01-01 UTC.
const APPLE_EPOCH_OFFSET_SECONDS = 978307200;
const SEEN_LIMIT = 500;
const FALLBACK_POLL_MS = 2000;

export type StoreRow = {
  uuid: Uint8Array;
  data: Uint8Array;
  delivered_date: number;
  identifier: string;
};

export type Cursor = {
  deliveredDate: number;
  // rec_id is reused after the newest row is deleted, so dedupe on uuid instead.
  seen: string[];
};

export function appleNow(): number {
  return Date.now() / 1000 - APPLE_EPOCH_OFFSET_SECONDS;
}

export function appleDateToDate(seconds: number): Date {
  return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000);
}

function uuidHex(uuid: Uint8Array): string {
  return Buffer.from(uuid).toString("hex").toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function parsePlist(data: Uint8Array): unknown {
  const [root] = parseBuffer<unknown>(Buffer.from(data));
  return root;
}

// usda and uncc are NSKeyedArchiver plists nested inside the record. Rather than unarchive
// them, pick the few values we need straight out of the flat $objects table.
function archivedObjects(value: unknown): unknown[] {
  if (!(value instanceof Uint8Array)) return [];
  const root = parsePlist(value);
  return isRecord(root) && Array.isArray(root.$objects) ? root.$objects : [];
}

function discordDeepLink(usda: unknown): string | undefined {
  return archivedObjects(usda).find((object): object is string => typeof object === "string" && object.startsWith("discord://"));
}

function intentFlags(uncc: unknown): Pick<NotificationEvent, "mentionsCurrentUser" | "replyToCurrentUser"> {
  const context = archivedObjects(uncc).find((object) => isRecord(object) && "mentionsCurrentUser" in object);
  if (!isRecord(context)) return {};
  return {
    mentionsCurrentUser: context.mentionsCurrentUser === true,
    replyToCurrentUser: context.replyToCurrentUser === true,
  };
}

export function parseRow(row: StoreRow): NotificationEvent {
  const record = parsePlist(row.data);
  if (!isRecord(record) || !isRecord(record.req)) throw new Error("record data has no req dictionary");
  const req = record.req;
  return {
    id: uuidHex(row.uuid),
    sourceId: row.identifier.toLowerCase(),
    title: optionalString(req.titl) ?? "",
    subtitle: optionalString(req.subt),
    body: optionalString(req.body) ?? "",
    deliveredAt: appleDateToDate(row.delivered_date),
    thread: optionalString(req.thre),
    category: optionalString(req.cate),
    deepLink: discordDeepLink(req.usda),
    ...intentFlags(req.uncc),
  };
}

function selectRows(db: Database, sourceIds: string[], minDeliveredDate: number): StoreRow[] {
  const placeholders = sourceIds.map(() => "?").join(", ");
  return db
    .query<StoreRow, (string | number)[]>(
      `select r.uuid, r.data, r.delivered_date, a.identifier
       from record r join app a using (app_id)
       where r.delivered_date >= ? and lower(a.identifier) in (${placeholders})
       order by r.delivered_date`,
    )
    .all(minDeliveredDate, ...sourceIds);
}

function parseRows(rows: StoreRow[], onParseError: (error: unknown, row: StoreRow) => void): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  for (const row of rows) {
    try {
      events.push(parseRow(row));
    } catch (error) {
      onParseError(error, row);
    }
  }
  return events;
}

export function readCurrent(db: Database, sourceIds: string[], onParseError: (error: unknown, row: StoreRow) => void): NotificationEvent[] {
  return parseRows(selectRows(db, sourceIds, Number.NEGATIVE_INFINITY), onParseError);
}

export function readNew(
  db: Database,
  sourceIds: string[],
  cursor: Cursor,
  onParseError: (error: unknown, row: StoreRow) => void,
): { events: NotificationEvent[]; cursor: Cursor } {
  const seen = new Set(cursor.seen);
  const rows = selectRows(db, sourceIds, cursor.deliveredDate).filter(
    (row) => !seen.has(uuidHex(row.uuid)),
  );
  let deliveredDate = cursor.deliveredDate;
  for (const row of rows) {
    seen.add(uuidHex(row.uuid));
    deliveredDate = Math.max(deliveredDate, row.delivered_date);
  }
  return {
    events: parseRows(rows, onParseError),
    cursor: { deliveredDate, seen: [...seen].slice(-SEEN_LIMIT) },
  };
}

// Every insert touches the WAL file, so a directory watch wakes us almost immediately.
// The poll covers watch events that macOS drops or coalesces.
export function watchStore(dbPath: string, onChange: () => void): () => void {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      onChange();
    }, 50);
  };
  const watcher = watch(dirname(dbPath), schedule);
  const timer = setInterval(schedule, FALLBACK_POLL_MS);
  return () => {
    watcher.close();
    clearInterval(timer);
  };
}
