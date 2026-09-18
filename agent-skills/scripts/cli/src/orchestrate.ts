import type { Address, Hex } from "viem";
import { keccak256, toBytes } from "viem";
import type { CliConfig } from "./config.ts";
import * as api from "./api.ts";
import { evaluatePolicy, type ProcurementRequest, type Policy } from "./policy.ts";
import { checkApyAndExecuteSupply, type ProviderOfferForExecution } from "./keeperhub.ts";
import { getAccount, randomTaskId, recordProcurementOnChain } from "./registry.ts";

/**
 * The actor's own pipeline — the parts of `app/lib/lucid/orchestrate.ts`'s
 * old `runProcurement` that now run on the external agent's own machine:
 * evaluate policy, pick the best offer, execute via KeeperHub, write the
 * on-chain receipt, and report the result back to the platform. Discovery
 * and policy *values* still come from the server (platform-hosted market
 * data + admin-governed config); everything after that is this CLI's own
 * decision, using its own KeeperHub key and wallet.
 *
 * Used by both `procure submit` (human/CLI-operator-initiated) and
 * `procure act` (webhook-triggered — see agent-skills/SKILL.md).
 *
 * `requestedTaskId` — for `act`, the `taskId` the platform already assigned
 * when it recorded and dispatched this intent (`app/lib/chain/taskId.ts`,
 * embedded in the webhook payload by `app/lib/webhooks/dispatch.ts`). When
 * it's a valid bytes32 hex, it's reused as-is for both the on-chain receipt
 * and the report below, so the platform's dashboard can find and update the
 * exact task it's already showing as "dispatched" instead of this call's
 * result landing under a brand-new id the dashboard has never seen. Falls
 * back to a fresh `randomTaskId()` — the previous, always-random behavior —
 * for `submit` (no prior platform-side task to correlate to) and for any
 * payload whose `taskId` isn't in that format (e.g. an older, pre-fix
 * `./app` still sending a UUID).
 */
export async function runProcurementLocally(config: CliConfig, request: ProcurementRequest, requestedTaskId?: string) {
  const timeline: Array<{ kind: string; label: string; detail?: unknown; at: string }> = [];
  const push = (kind: string, label: string, detail?: unknown) =>
    timeline.push({ kind, label, detail, at: new Date().toISOString() });

  const discovered = await api.discoverProviders(config);
  const offers = (discovered.output?.offers ?? []) as Array<ProviderOfferForExecution & { agentId: string; name: string; protocol: string }>;
  // Carry over the platform's own discovery timeline (identity.resolved /
  // a2a.invoked per provider — discovery still runs server-side, since the
  // mock providers are platform-hosted market data) so the reported task's
  // audit trail stays complete, not just this agent's own half of it.
  for (const event of (discovered.output?.timeline ?? []) as Array<{ kind: string; label: string; detail?: unknown }>) {
    push(event.kind, event.label, event.detail);
  }
  push("a2a.discovered", `Discovered ${offers.length} candidate provider agents over A2A`, {
    providers: offers.map((o) => ({ name: o.name, protocol: o.protocol, apyBps: o.apyBps })),
  });

  const policyResult = await api.getPolicy(config);
  const policy = policyResult.output as Policy;
  const requiredApyBps = Math.max(policy.minApyBps, request.minApyBps);

  const evaluated = offers.map((offer) => ({
    offer,
    evaluation: evaluatePolicy({ ...request, minApyBps: requiredApyBps }, offer, policy),
  }));
  const eligible = evaluated.filter((e) => e.evaluation.allowed).sort((a, b) => b.offer.apyBps - a.offer.apyBps);
  push("policy.evaluated", `${eligible.length}/${offers.length} candidates satisfy enterprise policy`, {
    results: evaluated.map((e) => ({ name: e.offer.name, allowed: e.evaluation.allowed, reasons: e.evaluation.reasons })),
  });

  const account = getAccount(config);
  const taskId = requestedTaskId && /^0x[0-9a-fA-F]{64}$/.test(requestedTaskId) ? (requestedTaskId as Hex) : randomTaskId();

  if (eligible.length === 0) {
    push("task.failed", "No discovered provider satisfies the enterprise policy.");
    const task = {
      taskId,
      status: "rejected" as const,
      request,
      enterpriseAddress: account.address,
      policy: evaluated[0]?.evaluation,
      timeline,
      createdAt: timeline[0]?.at ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: "No discovered provider satisfies the enterprise policy (amount cap, asset, protocol allow-list, or APY threshold).",
    };
    await reportAndMaybeRecord(config, task, account.address, requiredApyBps);
    return task;
  }

  const chosen = eligible[0]!;
  push("a2a.selected", `Selected ${chosen.offer.name} at ${(chosen.offer.apyBps / 100).toFixed(2)}% APY`, {
    agentId: chosen.offer.agentId,
    protocol: chosen.offer.protocol,
  });
  push("ap2.mandate", "Attached AP2 commerce-role mandate: this agent = shopper, provider = merchant", {
    roles: ["shopper", "merchant"],
    extensionUri: "https://github.com/google-agentic-commerce/ap2/tree/v0.1",
  });

  const idempotencyKey = `procure:${taskId}`;
  const execution = await checkApyAndExecuteSupply(config, {
    provider: chosen.offer,
    asset: request.asset,
    amount: request.amount,
    minApyBps: requiredApyBps,
    idempotencyKey,
    // This agent's own wallet should receive the protocol's receipt token
    // (e.g. Aave's aToken) — not the provider's ERC-8004 registry identifier,
    // which isn't even a valid address (see agent-demo/README.md's
    // troubleshooting section for the "network does not support ENS" bug
    // this caused when passed straight through).
    onBehalfOf: account.address,
  });
  if (!execution.condition) {
    push(
      "keeperhub.execution_failed",
      `KeeperHub's real API returned no condition result (status: ${execution.status}) — the guarded execution likely failed before or during the action leg (e.g. the org wallet lacking funds/allowance), not because the APY threshold wasn't met.`,
      execution.raw,
    );
  } else {
    push(
      "keeperhub.condition_checked",
      execution.mode === "demo"
        ? `KeeperHub (simulated) re-checked APY on-chain: observed ${(Number(execution.condition.observedValue) / 100).toFixed(2)}% ${
            execution.condition.met ? ">=" : "<"
          } required ${(Number(execution.condition.targetValue) / 100).toFixed(2)}%`
        : `KeeperHub re-read the reserve's on-chain rate right before broadcast as a liveness guard (the ${(requiredApyBps / 100).toFixed(2)}% APY threshold was already verified off-chain during policy evaluation): observed ${
            execution.condition.observedValue
          } ${execution.condition.met ? ">=" : "<"} baseline ${execution.condition.targetValue}`,
      execution.condition,
    );
  }

  const status = execution.executed ? ("completed" as const) : ("failed" as const);
  if (execution.executed) {
    push("keeperhub.executed", `KeeperHub executed the guarded supply transaction (${execution.mode} mode)`, {
      executionId: execution.executionId,
      transactionHash: execution.transactionHash,
    });
    push("task.completed", "Procurement task completed and settled.");
  } else {
    push("task.failed", "KeeperHub declined execution: the on-chain condition was no longer met at broadcast time.");
  }

  const task = {
    taskId,
    status,
    request,
    enterpriseAddress: account.address,
    selectedProvider: chosen.offer,
    policy: chosen.evaluation,
    execution,
    timeline,
    createdAt: timeline[0]?.at ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(execution.executed ? {} : { error: "KeeperHub declined execution: the on-chain condition was no longer met at broadcast time." }),
  };

  await reportAndMaybeRecord(config, task, account.address, requiredApyBps, chosen.offer);
  return task;
}

async function reportAndMaybeRecord(
  config: CliConfig,
  task: Record<string, unknown> & { taskId: Hex; status: string; timeline: Array<{ kind: string; label: string; detail?: unknown; at: string }> },
  enterprise: Address,
  apyBps: number,
  offer?: ProviderOfferForExecution,
) {
  // Write the durable on-chain receipt first — this is the source of truth
  // the platform's dashboard reads from. Only skipped if no registry is
  // configured yet (e.g. before the contract is deployed).
  if (config.registryAddress) {
    const detailsHash = keccak256(toBytes(JSON.stringify(task)));
    // Not wrapping this used to let an unfunded or not-yet-authorized wallet's
    // revert (e.g. "gas required exceeds allowance (0)", or the contract's
    // own NotAuthorizedAgent) propagate as an uncaught exception all the way
    // out of `procure act`/`submit` — crashing the whole call instead of
    // reporting a clean, actionable failure.
    let chain: { transactionHash: Hex } | undefined;
    try {
      chain = await recordProcurementOnChain(config, {
        taskId: task.taskId,
        enterprise,
        status: task.status === "completed" ? "completed" : task.status === "rejected" ? "rejected" : "failed",
        asset: (task as { request?: ProcurementRequest }).request?.asset ?? "USDC",
        amount: BigInt((task as { request?: ProcurementRequest }).request?.amount ?? "0"),
        apyBps,
        detailsHash,
        detailsURI: "",
      });
    } catch (e) {
      task.timeline.push({
        kind: "chain.record_failed",
        label: `Failed to record on-chain receipt: ${(e as Error).message.split("\n")[0]}`,
        detail: { error: (e as Error).message },
        at: new Date().toISOString(),
      });
      process.stderr.write(`warning: on-chain receipt write failed: ${(e as Error).message.split("\n")[0]}\n`);
    }
    if (chain) {
      task.onChainTransactionHash = chain.transactionHash;
      task.timeline.push({
        kind: "chain.recorded",
        label: `Recorded receipt on-chain: ProcurementRegistry.recordProcurement() (tx ${chain.transactionHash})`,
        detail: { transactionHash: chain.transactionHash, detailsHash },
        at: new Date().toISOString(),
      });
    }
  } else {
    process.stderr.write("warning: PROCURE_REGISTRY_ADDRESS not set — skipping on-chain receipt write.\n");
  }

  // Then report the rich detail to the platform's dashboard (SIWX + ERC-8004 gated).
  try {
    await api.reportProcurement(config, task);
  } catch (e) {
    process.stderr.write(`warning: failed to report task to platform dashboard: ${(e as Error).message}\n`);
  }

  void offer; // reserved for future use (e.g. richer receipts)
}

/** Parses the JSON shape the webhook dispatcher sends (see app/lib/webhooks/dispatch.ts, "generic" platform) into a ProcurementRequest. */
export function requestFromWebhookPayload(payload: Record<string, unknown>): ProcurementRequest {
  return {
    instruction: String(payload.instruction ?? ""),
    asset: String(payload.asset ?? "USDC"),
    amount: String(payload.amount ?? "0"),
    minApyBps: Number(payload.minApyBps ?? 400),
    allowedProtocols: Array.isArray(payload.allowedProtocols) ? (payload.allowedProtocols as string[]) : undefined,
  };
}
