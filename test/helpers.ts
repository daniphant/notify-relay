import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function fixture(name: string): Uint8Array {
  return readFileSync(join(import.meta.dir, "fixtures", name));
}

export function createStore(): Database {
  const db = new Database(":memory:");
  db.run("create table app (app_id integer primary key, identifier varchar, badge integer null)");
  db.run(`create table record (rec_id integer primary key, app_id integer, uuid blob, data blob,
    request_date real, request_last_date real, delivered_date real, presented bool,
    style integer, snooze_fire_date real)`);
  db.run("insert into app (app_id, identifier) values (122, 'com.hnc.discordptb'), (87, 'net.whatsapp.whatsapp')");
  return db;
}

export function insertRecord(db: Database, row: { recId?: number; appId?: number; uuid: string; deliveredDate: number; data: Uint8Array }): void {
  db.query("insert into record (rec_id, app_id, uuid, data, delivered_date, presented) values (?, ?, ?, ?, ?, 0)").run(
    row.recId ?? null,
    row.appId ?? 122,
    Buffer.from(row.uuid, "hex"),
    row.data,
    row.deliveredDate,
  );
}
