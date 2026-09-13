import { fetchAgentCardWithEntrypoints, invokeAgent } from "@lucid-agents/a2a";
import { checkApyAndExecuteSupply } from "@/lib/keeperhub/client";
import { evaluatePolicy, getConfiguredPolicy } from "@/lib/keeperhub/policy";
import { getTask, saveTask } from "@/lib/store";
import { MOCK_PROVIDERS } from "@/lib/lucid/mock-providers";
import type { PolicyEvaluation, ProcurementRequest, ProcurementTask, ProviderOffer, TimelineEventKind } from "@/lib/types";

/**
 * The full "Enterprise -> Procurement Agent -> KeeperHub -> Blockchain"
 * pipeline from the use case, minus the HTTP/MCP/A2A transport shell (that
 * lives in `app/api/agent`). Every caller — the UI, the Lucid `procure`
 * entrypoint, and the MCP tool — goes through this one function so all three
 * surfaces produce identical, auditable results.
 */
export async function runProcurement(params: {
  request: ProcurementRequest;
  enterpriseAddress?: string;
  origin: string;
}): Promise<ProcurementTask> {
  const taskId = crypto.randomUUID();
  const task: ProcurementTask = {
    taskId,
    status: "authenticating",
    request: params.request,
    enterpriseAddress: params.enterpriseAddress,
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveTask(task);

  if (params.enterpriseAddress) {
    pushEvent(task, "siwx.authenticated", `Enterprise wallet ${shorten(params.enterpriseAddress)} authenticated via SIWX (@lucid-agents/payments)`, {
      address: params.enterpriseAddress,
    });
  }

  // ── Lucid: "who should I buy from?" ────────────────────────────────────
  task.status = "discovering";
  touch(task);

  const offers = await discoverProviderOffers(params.origin, task);
  pushEvent(
    task,
    "a2a.discovered",
    `Discovered ${offers.length}/${MOCK_PROVIDERS.length} candidate provider agents over A2A (@lucid-agents/a2a)`,
    { providers: offers.map((o) => ({ name: o.name, protocol: o.protocol, apyBps: o.apyBps })) },
  );

  task.status = "evaluating_policy";
  touch(task);

  const policy = getConfiguredPolicy();
  const requiredApyBps = Math.max(policy.minApyBps, params.request.minApyBps);
  const evaluated = offers.map((offer) => ({
    offer,
    evaluation: evaluatePolicy({ ...params.request, minApyBps: requiredApyBps }, offer, policy),
  }));
  const eligible = evaluated.filter((e) => e.evaluation.allowed).sort((a, b) => b.offer.apyBps - a.offer.apyBps);

  pushEvent(task, "policy.evaluated", `${eligible.length}/${offers.length} candidates satisfy enterprise policy`, {
    results: evaluated.map((e) => ({ name: e.offer.name, allowed: e.evaluation.allowed, reasons: e.evaluation.reasons })),
  });

  if (eligible.length === 0) {
    task.status = "rejected";
    task.policy = evaluated[0]?.evaluation;
    task.error = "No discovered provider satisfies the enterprise policy (amount cap, asset, protocol allow-list, or APY threshold).";
    pushEvent(task, "task.failed", task.error);
    touch(task);
    saveTask(task);
    return task;
  }

  const chosen = eligible[0]!;
  task.selectedProvider = chosen.offer;
  task.policy = chosen.evaluation;
  pushEvent(
    task,
    "a2a.selected",
    `Selected ${chosen.offer.name} at ${bps(chosen.offer.apyBps)} APY — this is Lucid's "who should I buy from?" decision`,
    { agentId: chosen.offer.agentId, protocol: chosen.offer.protocol },
  );
  pushEvent(task, "ap2.mandate", "Attached AP2 commerce-role mandate: procurement agent = shopper, provider = merchant", {
    roles: ["shopper", "merchant"],
    extensionUri: "https://github.com/google-agentic-commerce/ap2/tree/v0.1",
  });

  // ── KeeperHub: "how do we execute?" ─────────────────────────────────────
  task.status = "executing";
  touch(task);

  const idempotencyKey = `procure:${taskId}`;
  const execution = await checkApyAndExecuteSupply({
    provider: chosen.offer,
    asset: params.request.asset,
    amount: params.request.amount,
    minApyBps: requiredApyBps,
    idempotencyKey,
  });
  task.execution = execution;

  pushEvent(
    task,
    "keeperhub.condition_checked",
    `KeeperHub independently re-checked the condition on-chain via DirectExecutor.checkAndExecute(): observed ${bps(execution.condition!.observedApyBps)} ${execution.condition!.met ? ">=" : "<"} required ${bps(execution.condition!.targetApyBps)}`,
    execution.condition,
  );

  if (execution.executed) {
    pushEvent(
      task,
      "keeperhub.executed",
      `KeeperHub executed the guarded supply transaction (${execution.mode} mode)`,
      { executionId: execution.executionId, transactionHash: execution.transactionHash },
    );
    task.status = "completed";
    pushEvent(task, "task.completed", "Procurement task completed and settled.");
  } else {
    task.status = "failed";
    task.error = "KeeperHub declined execution: the on-chain condition was no longer met at broadcast time.";
    pushEvent(task, "task.failed", task.error);
  }

  touch(task);
  saveTask(task);
  return task;
}

async function discoverProviderOffers(origin: string, task: ProcurementTask): Promise<ProviderOffer[]> {
  const offers: ProviderOffer[] = [];

  for (const spec of MOCK_PROVIDERS) {
    try {
      const baseUrl = `${origin}/api/mock-providers/${spec.id}`;
      const card = await fetchAgentCardWithEntrypoints(baseUrl);

      pushEvent(task, "identity.resolved", `Resolved ERC-8004 identity for ${card.name} (@lucid-agents/identity)`, {
        agentRegistry: spec.agentRegistry,
        trustModels: card.trustModels ?? spec.trustModels,
      });

      const invoked = await invokeAgent(card, "quote", {});
      const quote = invoked.output as { protocol: string; asset: string; network: string; apyBps: number };

      pushEvent(task, "a2a.invoked", `Invoked "quote" skill on ${card.name} via A2A`, { skill: "quote", output: quote });

      offers.push({
        agentId: spec.agentId,
        name: card.name,
        protocol: quote.protocol,
        asset: quote.asset,
        network: quote.network,
        apyBps: quote.apyBps,
        cardUrl: `${baseUrl}/.well-known/agent-card.json`,
        trustModels: spec.trustModels,
        registration: { agentRegistry: spec.agentRegistry },
        rateContract: spec.rateContract,
        supplyContract: spec.supplyContract,
      });
    } catch (err) {
      pushEvent(task, "a2a.invoked", `Failed to reach ${spec.name}: ${(err as Error).message}`, { providerId: spec.id, error: true });
    }
  }

  return offers;
}

/** Discovery without a purchase — lets an external agent preview candidates before committing. */
export async function discoverOffers(origin: string): Promise<{ offers: ProviderOffer[]; timeline: ProcurementTask["timeline"] }> {
  const ephemeral: ProcurementTask = {
    taskId: "ephemeral",
    status: "discovering",
    request: { instruction: "discover", asset: "USDC", amount: "0", minApyBps: 0 },
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const offers = await discoverProviderOffers(origin, ephemeral);
  return { offers, timeline: ephemeral.timeline };
}

export function reEvaluate(task: ProcurementTask): PolicyEvaluation | undefined {
  if (!task.selectedProvider) return undefined;
  return evaluatePolicy(task.request, task.selectedProvider);
}

function pushEvent(task: ProcurementTask, kind: TimelineEventKind, label: string, detail?: Record<string, unknown>) {
  task.timeline.push({ kind, label, detail, at: new Date().toISOString() });
}

function touch(task: ProcurementTask) {
  task.updatedAt = new Date().toISOString();
}

function bps(v: number): string {
  return `${(v / 100).toFixed(2)}%`;
}

function shorten(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export { getTask };
