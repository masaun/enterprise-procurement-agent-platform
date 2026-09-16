import { createSubscriber, listSubscribers, toPublicSubscriber, type WebhookPlatform } from "@/lib/webhooks/subscribers";

const VALID_PLATFORMS: WebhookPlatform[] = ["hermes", "openclaw", "generic"];

export async function GET() {
  return Response.json({ subscribers: listSubscribers().map(toPublicSubscriber) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { name, platform, url, secret } = body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "invalid_request", message: "name is required" }, { status: 400 });
  }
  if (typeof platform !== "string" || !VALID_PLATFORMS.includes(platform as WebhookPlatform)) {
    return Response.json({ error: "invalid_request", message: `platform must be one of ${VALID_PLATFORMS.join(", ")}` }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "invalid_request", message: "url is required" }, { status: 400 });
  }
  if (typeof secret !== "string" || !secret.trim()) {
    return Response.json({ error: "invalid_request", message: "secret is required" }, { status: 400 });
  }

  const subscriber = createSubscriber({ name, platform: platform as WebhookPlatform, url, secret });
  return Response.json(toPublicSubscriber(subscriber), { status: 201 });
}
