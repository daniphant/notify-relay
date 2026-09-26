import type { NotificationEvent, Sink } from "../event.ts";
import { classify } from "../event.ts";

export function formatLine(event: NotificationEvent, sourceLabel: string): string {
  const heading = [sourceLabel, event.title, event.subtitle].filter(Boolean).join(" · ");
  const body = event.body.replaceAll("\n", " ⏎ ");
  return `${event.deliveredAt.toISOString()} [${classify(event)}] ${heading}: ${body}`;
}

export function createStdoutSink(): Sink {
  return {
    name: "stdout",
    async send(event, sourceLabel) {
      console.log(formatLine(event, sourceLabel));
    },
  };
}
