import type { DiscordSinkConfig } from "../config.ts";
import type { NotificationEvent, Sink } from "../event.ts";
import { classify } from "../event.ts";

const API_BASE = "https://discord.com/api/v10";
const BODY_LIMIT = 1500;
const CONTENT_LIMIT = 2000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 60_000;

export type DiscordMessage = {
  content: string;
  allowed_mentions: { parse: []; users: string[] };
};

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function toWebLink(deepLink: string): string | undefined {
  const match = /^discord:\/\/[^/]+\/(channels\/.+)$/.exec(deepLink);
  return match ? `https://discord.com/${match[1]}` : undefined;
}

export function formatMessage(event: NotificationEvent, sourceLabel: string, config: DiscordSinkConfig): DiscordMessage {
  const mentionUserId = config.mentionOn.includes(classify(event)) ? config.mentionUserId : undefined;
  const heading = [`**${sourceLabel}**`, event.title, event.subtitle].filter(Boolean).join(" · ");
  const lines = [mentionUserId ? `<@${mentionUserId}> ${heading}` : heading];
  if (event.body) {
    lines.push(...truncate(event.body, BODY_LIMIT).split("\n").map((line) => `> ${line}`));
  }
  const link = event.deepLink && toWebLink(event.deepLink);
  if (link) lines.push(link);
  return {
    content: truncate(lines.join("\n"), CONTENT_LIMIT),
    // Only the configured user may be pinged; mentions inside relayed text stay inert.
    allowed_mentions: { parse: [], users: mentionUserId ? [mentionUserId] : [] },
  };
}

function retryAfterMs(response: Response, body: string): number {
  let seconds = Number(response.headers.get("retry-after") ?? 1);
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "retry_after" in parsed && typeof parsed.retry_after === "number") {
      seconds = parsed.retry_after;
    }
  } catch {}
  return Math.min(Number.isFinite(seconds) ? seconds * 1000 : 1000, MAX_RETRY_AFTER_MS);
}

async function postMessage(channelId: string, token: string, message: DiscordMessage): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return;
    const body = await response.text();
    if (response.status === 429 && attempt === 1) {
      await Bun.sleep(retryAfterMs(response, body));
      continue;
    }
    throw new Error(`Discord responded ${response.status}: ${body.slice(0, 500)}`);
  }
}

export function createDiscordSink(config: DiscordSinkConfig, token: string): Sink {
  let queue: Promise<void> = Promise.resolve();
  return {
    name: "discord",
    send(event, sourceLabel) {
      const message = formatMessage(event, sourceLabel, config);
      const sent = queue.then(() => postMessage(config.channelId, token, message));
      queue = sent.catch(() => {});
      return sent;
    },
  };
}
