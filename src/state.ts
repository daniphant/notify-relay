import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Cursor } from "./sources/macos-notification-center.ts";

export type SinkStatus = {
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorAt?: string;
};

export type State = {
  cursor: Cursor;
  lastEventAt?: string;
  sinks: Record<string, SinkStatus>;
};

// Fail loudly on a malformed file: silently resetting the cursor would skip notifications.
export function loadState(path: string): State | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const state: State = JSON.parse(raw);
  if (typeof state.cursor?.deliveredDate !== "number" || !Array.isArray(state.cursor.seen)) {
    throw new Error(`${path} has no valid cursor; delete it to start from now`);
  }
  return { ...state, sinks: state.sinks ?? {} };
}

export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
