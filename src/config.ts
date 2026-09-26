import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EVENT_KINDS, type EventKind } from "./event.ts";

export const DATA_DIR = join(homedir(), ".notify-relay");
export const CONFIG_PATH = join(DATA_DIR, "config.json");
export const STATE_PATH = join(DATA_DIR, "state.json");
export const PID_PATH = join(DATA_DIR, "daemon.pid");
export const ENV_PATH = join(DATA_DIR, "env");
export const LOG_DIR = join(homedir(), "Library/Logs/notify-relay");

export type DiscordSinkConfig = {
  enabled: boolean;
  channelId: string;
  mentionUserId?: string;
  mentionOn: EventKind[];
};

export type Config = {
  sources: Record<string, { label: string }>;
  sinks: {
    stdout?: { enabled: boolean };
    discord?: DiscordSinkConfig;
  };
};

const SINK_KEYS = ["stdout", "discord"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${path} must be a non-empty string`);
  return value;
}

function requireEnabled(sink: Record<string, unknown>, path: string): boolean {
  if (typeof sink.enabled !== "boolean") throw new Error(`${path}.enabled must be true or false`);
  return sink.enabled;
}

function parseDiscordSink(value: unknown): DiscordSinkConfig {
  const sink = requireRecord(value, "sinks.discord");
  const mentionOnValue: unknown = sink.mentionOn ?? [];
  if (!Array.isArray(mentionOnValue)) throw new Error("sinks.discord.mentionOn must be an array");
  const mentionOn: EventKind[] = [];
  for (const kind of mentionOnValue as unknown[]) {
    const match = EVENT_KINDS.find((known) => known === kind);
    if (match === undefined) {
      throw new Error(`sinks.discord.mentionOn has ${JSON.stringify(kind)}, expected one of ${EVENT_KINDS.join(", ")}`);
    }
    mentionOn.push(match);
  }
  const mentionUserId = sink.mentionUserId === undefined ? undefined : requireString(sink.mentionUserId, "sinks.discord.mentionUserId");
  if (mentionOn.length > 0 && mentionUserId === undefined) {
    throw new Error("sinks.discord.mentionUserId is required when mentionOn is not empty");
  }
  return {
    enabled: requireEnabled(sink, "sinks.discord"),
    channelId: requireString(sink.channelId, "sinks.discord.channelId"),
    mentionUserId,
    mentionOn,
  };
}

export function parseConfig(value: unknown): Config {
  const root = requireRecord(value, "config");

  const sources: Config["sources"] = {};
  for (const [bundleId, source] of Object.entries(requireRecord(root.sources, "sources"))) {
    const label = requireString(requireRecord(source, `sources.${bundleId}`).label, `sources.${bundleId}.label`);
    // The store keeps bundle ids in whatever case the app registered with; match lowercased.
    sources[bundleId.toLowerCase()] = { label };
  }
  if (Object.keys(sources).length === 0) throw new Error("sources must list at least one bundle id");

  const sinksValue = requireRecord(root.sinks, "sinks");
  for (const key of Object.keys(sinksValue)) {
    if (!SINK_KEYS.includes(key)) throw new Error(`sinks.${key} is not a known sink (expected ${SINK_KEYS.join(", ")})`);
  }
  const sinks: Config["sinks"] = {};
  if (sinksValue.stdout !== undefined) {
    sinks.stdout = { enabled: requireEnabled(requireRecord(sinksValue.stdout, "sinks.stdout"), "sinks.stdout") };
  }
  if (sinksValue.discord !== undefined) sinks.discord = parseDiscordSink(sinksValue.discord);

  return { sources, sinks };
}

export function loadConfig(path = CONFIG_PATH): Config {
  try {
    return parseConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`Invalid config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
