import { createHmac } from "node:crypto";
import type { Policy, ProcurementRequest } from "@/lib/types";
import { listActiveSubscribers, type WebhookSubscriber } from "@/lib/webhooks/subscribers";

/**
 * Pushes a procurement intent out to every active subscriber, one
 * platform-specific payload per subscriber — see
 * `agent-skills/references/protocols.md` for the fetched, confirmed wire
 * formats this mirrors. Both Hermes and OpenClaw are INBOUND webhook
 * receivers (we POST to them; they never call us), and neither lets a
 * remote caller register a route — the admin pastes in a URL/secret that
 * platform's own operator already configured.
 */

export type ProcurementIntentEvent = {
  taskId: string;
  request: ProcurementRequest;
  policy: Policy;
  enterpriseId: string;
};

export type DispatchResult = {
  subscriberId: string;
  platform: WebhookSubscriber["platform"];
  ok: boolean;
  status?: number;
  error?: string;
};

export async function dispatchProcurementIntent(event: ProcurementIntentEvent): Promise<DispatchResult[]> {
  const subscribers = listActiveSubscribers();
  return Promise.all(subscribers.map((subscriber) => dispatchToSubscriber(subscriber, event)));
}

async function dispatchToSubscriber(subscriber: WebhookSubscriber, event: ProcurementIntentEvent): Promise<DispatchResult> {
  try {
    const { body, headers } = buildPayload(subscriber, event);
    const res = await fetch(subscriber.url, { method: "POST", headers, body });
    return { subscriberId: subscriber.id, platform: subscriber.platform, ok: res.ok, status: res.status };
  } catch (err) {
    return { subscriberId: subscriber.id, platform: subscriber.platform, ok: false, error: (err as Error).message };
  }
}

function buildPayload(subscriber: WebhookSubscriber, event: ProcurementIntentEvent): { body: string; headers: Record<string, string> } {
  switch (subscriber.platform) {
    case "hermes":
      return buildHermesPayload(subscriber, event);
    case "openclaw":
      return buildOpenClawPayload(subscriber, event);
    case "generic":
    default:
      return buildGenericPayload(subscriber, event);
  }
}

/**
 * Hermes renders its operator's own prompt template against this JSON via
 * dot-notation (`{instruction}`, `{asset}`, ...) — see
 * https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks.
 * Auth: the "Generic V2" scheme it documents, `X-Webhook-Signature-V2` +
 * `X-Webhook-Timestamp`, HMAC-SHA256 over `${timestamp}.${rawBody}`.
 */
function buildHermesPayload(subscriber: WebhookSubscriber, event: ProcurementIntentEvent) {
  const body = JSON.stringify({
    event_type: "procurement_intent",
    taskId: event.taskId,
    instruction: event.request.instruction,
    asset: event.request.asset,
    amount: event.request.amount,
    minApyBps: event.request.minApyBps,
    allowedProtocols: event.request.allowedProtocols ?? [],
    policy: event.policy,
    enterpriseId: event.enterpriseId,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", subscriber.secret).update(`${timestamp}.${body}`).digest("hex");
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature-V2": `sha256=${signature}`,
      "X-Webhook-Timestamp": timestamp,
    },
  };
}

/**
 * OpenClaw's plugin endpoint accepts only its own TaskFlow action schemas —
 * unknown fields are rejected — so the procurement intent has to be
 * flattened into a `goal` string rather than sent as structured custom
 * fields. See https://docs.openclaw.ai/plugins/webhooks. Auth: Bearer token.
 */
function buildOpenClawPayload(subscriber: WebhookSubscriber, event: ProcurementIntentEvent) {
  const goal = [
    event.request.instruction,
    `(taskId=${event.taskId}, asset=${event.request.asset}, amount=${event.request.amount}, minApyBps=${event.request.minApyBps})`,
  ].join(" ");
  const body = JSON.stringify({
    action: "create_flow",
    goal,
    status: "queued",
    notifyPolicy: "done_only",
  });
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${subscriber.secret}`,
    },
  };
}

/** Our own documented schema — for the `procure act` CLI command or any other integration. GitHub-style signature convention. */
function buildGenericPayload(subscriber: WebhookSubscriber, event: ProcurementIntentEvent) {
  const body = JSON.stringify({
    taskId: event.taskId,
    instruction: event.request.instruction,
    asset: event.request.asset,
    amount: event.request.amount,
    minApyBps: event.request.minApyBps,
    allowedProtocols: event.request.allowedProtocols ?? [],
    policy: event.policy,
    enterpriseId: event.enterpriseId,
  });
  const signature = createHmac("sha256", subscriber.secret).update(body).digest("hex");
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Procurement-Signature-256": `sha256=${signature}`,
    },
  };
}
