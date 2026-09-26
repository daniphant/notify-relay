import { Database } from "bun:sqlite";
import { rmSync, writeFileSync } from "node:fs";
import { type Config, PID_PATH, STATE_PATH } from "./config.ts";
import type { NotificationEvent, Sink } from "./event.ts";
import { createDiscordSink } from "./sinks/discord.ts";
import { createStdoutSink } from "./sinks/stdout.ts";
import { STORE_PATH, type StoreRow, appleNow, readNew, watchStore } from "./sources/macos-notification-center.ts";
import { type State, loadState, saveState } from "./state.ts";

export const TOKEN_ENV = "NOTIFY_RELAY_DISCORD_TOKEN";

function log(message: string): void {
  console.error(`${new Date().toISOString()} ${message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logParseError(error: unknown, row: StoreRow): void {
  log(`skipping unparseable ${row.identifier} notification: ${errorMessage(error)}`);
}

function createSinks(config: Config): Sink[] {
  const sinks: Sink[] = [];
  if (config.sinks.stdout?.enabled) sinks.push(createStdoutSink());
  const discord = config.sinks.discord;
  if (discord?.enabled) {
    const token = process.env[TOKEN_ENV];
    if (!token) throw new Error(`${TOKEN_ENV} is not set; the Discord sink needs the bot token`);
    sinks.push(createDiscordSink(discord, token));
  }
  if (sinks.length === 0) throw new Error("No sink is enabled in the config");
  return sinks;
}

export function runDaemon(config: Config): void {
  const sinks = createSinks(config);
  const sourceIds = Object.keys(config.sources);
  const db = new Database(STORE_PATH, { readonly: true });

  // Without saved state, start from now: relaying whatever is still in Notification Center
  // on first boot would be noise.
  const state: State = loadState(STATE_PATH) ?? { cursor: { deliveredDate: appleNow(), seen: [] }, sinks: {} };
  const save = () => saveState(STATE_PATH, state);
  save();

  const inFlight = new Set<Promise<void>>();

  function dispatch(sink: Sink, event: NotificationEvent, label: string): void {
    const sent = sink.send(event, label).then(
      () => {
        state.sinks[sink.name] = { ...state.sinks[sink.name], lastSuccessAt: new Date().toISOString() };
        save();
      },
      (error: unknown) => {
        log(`${sink.name} dropped ${event.sourceId} ${event.id}: ${errorMessage(error)}`);
        state.sinks[sink.name] = { ...state.sinks[sink.name], lastError: errorMessage(error), lastErrorAt: new Date().toISOString() };
        save();
      },
    );
    inFlight.add(sent);
    sent.finally(() => inFlight.delete(sent));
  }

  function poll(): void {
    let result: ReturnType<typeof readNew>;
    try {
      result = readNew(db, sourceIds, state.cursor, logParseError);
    } catch (error) {
      log(`reading the notification store failed: ${errorMessage(error)}`);
      return;
    }
    state.cursor = result.cursor;
    for (const event of result.events) {
      state.lastEventAt = new Date().toISOString();
      const label = config.sources[event.sourceId]?.label ?? event.sourceId;
      for (const sink of sinks) dispatch(sink, event, label);
    }
    save();
  }

  writeFileSync(PID_PATH, `${process.pid}\n`, { mode: 0o600 });
  const stopWatching = watchStore(STORE_PATH, poll);
  poll();
  log(`watching ${sourceIds.join(", ")} (pid ${process.pid})`);

  // The cursor already covers events that are still being posted, so let them finish.
  // Posts time out well within launchd's 20 second exit timeout.
  const shutdown = async () => {
    stopWatching();
    db.close();
    await Promise.allSettled(inFlight);
    rmSync(PID_PATH, { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
