import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV_PATH, LOG_DIR, PID_PATH, STATE_PATH, loadConfig } from "./config.ts";
import { logParseError, runDaemon } from "./daemon.ts";
import { formatLine } from "./sinks/stdout.ts";
import { STORE_PATH, readCurrent } from "./sources/macos-notification-center.ts";
import { loadState } from "./state.ts";

const LABEL = "com.daniphant.notify-relay";
const REPO_DIR = join(import.meta.dir, "..");
const PLIST_TEMPLATE = join(REPO_DIR, "launchd", `${LABEL}.plist`);
const PLIST_PATH = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const LOG_FILE = join(LOG_DIR, "daemon.log");
const DOMAIN = `gui/${process.getuid?.()}`;
const SERVICE = `${DOMAIN}/${LABEL}`;

function launchctl(...args: string[]): { ok: boolean; output: string } {
  const result = Bun.spawnSync(["launchctl", ...args]);
  return { ok: result.success, output: `${result.stdout.toString()}${result.stderr.toString()}`.trim() };
}

function isLoaded(): boolean {
  return launchctl("print", SERVICE).ok;
}

function readPid(): number | undefined {
  try {
    const pid = Number(readFileSync(PID_PATH, "utf8").trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

// launchd runs this exact bun binary rather than going through mise, because Full Disk Access
// is granted per executable and launchd jobs cannot read the notification store without it.
function installPlist(): void {
  const plist = readFileSync(PLIST_TEMPLATE, "utf8")
    .replaceAll("__BUN__", process.execPath)
    .replaceAll("__ENV_FILE__", ENV_PATH)
    .replaceAll("__REPO__", REPO_DIR)
    .replaceAll("__LOG_FILE__", LOG_FILE);
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(PLIST_PATH, plist);
}

function start(): void {
  if (isLoaded()) {
    console.log(`${LABEL} is already loaded; use restart to reload it.`);
    return;
  }
  installPlist();
  const result = launchctl("bootstrap", DOMAIN, PLIST_PATH);
  if (!result.ok) throw new Error(`launchctl bootstrap failed: ${result.output}`);
  console.log(`Started ${LABEL} with ${process.execPath}. Logs: ${LOG_FILE}`);
}

function stop(): void {
  if (!isLoaded()) {
    console.log(`${LABEL} is not loaded.`);
    return;
  }
  const result = launchctl("bootout", SERVICE);
  if (!result.ok) throw new Error(`launchctl bootout failed: ${result.output}`);
  console.log(`Stopped ${LABEL}.`);
}

function status(): void {
  const pid = readPid();
  console.log(`Service: ${isLoaded() ? "loaded" : "not loaded"}`);
  console.log(`Daemon: ${pid ? `running (pid ${pid})` : "not running"}`);
  const state = loadState(STATE_PATH);
  if (!state) {
    console.log("State: none yet");
    return;
  }
  console.log(`Last event: ${state.lastEventAt ?? "never"}`);
  console.log(`Seen uuids: ${state.cursor.seen.length}`);
  for (const [name, sink] of Object.entries(state.sinks)) {
    console.log(`Sink ${name}: last success ${sink.lastSuccessAt ?? "never"}`);
    if (sink.lastError) console.log(`  last error ${sink.lastErrorAt}: ${sink.lastError}`);
  }
}

function once(): void {
  const config = loadConfig();
  const db = new Database(STORE_PATH, { readonly: true });
  const events = readCurrent(db, Object.keys(config.sources), logParseError);
  db.close();
  if (events.length === 0) console.log("No notifications from configured sources in Notification Center.");
  for (const event of events) {
    console.log(formatLine(event, config.sources[event.sourceId]?.label ?? event.sourceId));
  }
}

function tail(): void {
  Bun.spawn(["tail", "-n", "50", "-F", LOG_FILE], { stdio: ["inherit", "inherit", "inherit"] });
}

const USAGE = `Usage: notify-relay <command>

  start     Install the LaunchAgent and start the daemon
  stop      Stop the daemon and unload the LaunchAgent
  restart   Stop, then start
  status    Show daemon, cursor, and sink status
  once      Print notifications currently in Notification Center for configured sources
  daemon    Run the relay in the foreground
  tail      Follow the daemon log`;

const commands: Record<string, () => void> = {
  start,
  stop,
  restart: () => {
    stop();
    start();
  },
  status,
  once,
  daemon: () => runDaemon(loadConfig()),
  tail,
};

const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.log(USAGE);
  process.exit(process.argv[2] ? 1 : 0);
}
try {
  command();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
