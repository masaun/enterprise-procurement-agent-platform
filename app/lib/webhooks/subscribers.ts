/**
 * Webhook subscriber registry — external agents (Hermes Agent, OpenClaw, or
 * any other automation) that the platform pushes procurement intents to.
 * Neither Hermes nor OpenClaw lets a remote caller register a route on their
 * side over the API — that's done by that agent's own operator, on their
 * own instance (see agent-skills/README.md for the exact steps). All this
 * store does is remember the URL/secret/platform shape *they* gave the
 * enterprise admin, so `lib/webhooks/dispatch.ts` can format a payload that
 * platform expects.
 */
export type WebhookPlatform = "hermes" | "openclaw" | "generic";

export type WebhookSubscriber = {
  id: string;
  name: string;
  platform: WebhookPlatform;
  url: string;
  secret: string;
  active: boolean;
  createdAt: string;
};

const subscribers = new Map<string, WebhookSubscriber>();

export function createSubscriber(input: Omit<WebhookSubscriber, "id" | "createdAt" | "active">): WebhookSubscriber {
  const subscriber: WebhookSubscriber = {
    ...input,
    id: crypto.randomUUID(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  subscribers.set(subscriber.id, subscriber);
  return subscriber;
}

export function listSubscribers(): WebhookSubscriber[] {
  return Array.from(subscribers.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSubscriber(id: string): WebhookSubscriber | undefined {
  return subscribers.get(id);
}

export function deleteSubscriber(id: string): boolean {
  return subscribers.delete(id);
}

export function listActiveSubscribers(): WebhookSubscriber[] {
  return listSubscribers().filter((s) => s.active);
}

/** Redacts the secret for any response that leaves the server. */
export function toPublicSubscriber(subscriber: WebhookSubscriber): Omit<WebhookSubscriber, "secret"> & { secret: "(set)" } {
  const { secret: _secret, ...rest } = subscriber;
  return { ...rest, secret: "(set)" };
}
