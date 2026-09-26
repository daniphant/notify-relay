export type NotificationEvent = {
  id: string;
  sourceId: string;
  title: string;
  subtitle?: string;
  body: string;
  deliveredAt: Date;
  thread?: string;
  category?: string;
  // From the app's userInfo; Discord puts a discord:// link to the message here.
  deepLink?: string;
  // From the INSendMessageIntent communication context, when the app attaches one.
  mentionsCurrentUser?: boolean;
  replyToCurrentUser?: boolean;
};

export const EVENT_KINDS = ["dm", "mention", "reply", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function classify(event: NotificationEvent): EventKind {
  if (event.deepLink?.includes("/channels/@me/")) return "dm";
  if (event.mentionsCurrentUser) return "mention";
  if (event.replyToCurrentUser) return "reply";
  return "other";
}

export type Sink = {
  name: string;
  send(event: NotificationEvent, sourceLabel: string): Promise<void>;
};
