import { DirectExecutor, KeeperHubClient, type DirectCheckAndExecuteResult } from "@keeperhub/sdk";
import type { KeeperHubExecutionResult, ProviderOffer } from "@/lib/types";

/**
 * "How do we execute" — the KeeperHub side of the architecture.
 *
 * KeeperHub's `DirectExecutor.checkAndExecute` is a synchronous read-then-write
 * primitive: read a value on-chain (here, the lending protocol's current
 * supply APY, in basis points, from its rate contract), evaluate it against a
 * condition (`gte 400` == "APY > 4%"), and only then broadcast the write
 * (the USDC `supply()` call into the protocol) — all inside KeeperHub's
 * managed, policy-gated execution path (Turnkey wallet, gas estimation,
 * nonce management). This is exactly the "but only if APY > 4%" clause in the
 * use case, expressed as a single guarded on-chain call instead of an
 * agent-side read + a second unguarded write.
 */

export function isKeeperHubDemoMode(): boolean {
  if (process.env.DEMO_MODE === "false") return false;
  return !process.env.KEEPERHUB_API_KEY;
}

function getClient(): KeeperHubClient {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is not set — call isKeeperHubDemoMode() first.");
  }
  return new KeeperHubClient({
    apiKey,
    baseUrl: process.env.KEEPERHUB_BASE_URL || undefined,
  });
}

const BPS = 10_000;

/**
 * Executes the guarded transfer-and-supply for a chosen provider, gated on
 * the observed APY. Basis points in, basis points out — the caller (the
 * policy engine) already re-validated the same threshold, so this is
 * belt-and-suspenders: KeeperHub will not sign anything if the on-chain
 * read disagrees with what Lucid discovered.
 */
export async function checkApyAndExecuteSupply(params: {
  provider: ProviderOffer;
  asset: string;
  amount: string;
  minApyBps: number;
  idempotencyKey: string;
}): Promise<KeeperHubExecutionResult> {
  const { provider, asset, amount, minApyBps, idempotencyKey } = params;

  if (isKeeperHubDemoMode()) {
    return simulateCheckAndExecute({ provider, asset, amount, minApyBps, idempotencyKey });
  }

  const client = getClient();
  const executor = new DirectExecutor(client);

  const result: DirectCheckAndExecuteResult = await executor.checkAndExecute({
    network: provider.network,
    contractAddress: provider.rateContract.address,
    functionName: provider.rateContract.functionName,
    functionArgs: provider.rateContract.functionArgs,
    condition: { operator: "gte", value: String(minApyBps) },
    action: {
      network: provider.network,
      contractAddress: provider.supplyContract.address,
      functionName: provider.supplyContract.functionName,
      functionArgs: buildFunctionArgs(provider.supplyContract.argsTemplate, {
        asset,
        amount,
        onBehalfOf: provider.registration.agentRegistry,
      }),
    },
  });

  return {
    mode: "direct",
    executed: result.executed,
    executionId: result.executionId,
    status: result.status ?? (result.executed ? "success" : "skipped"),
    condition: {
      met: result.condition.met,
      observedApyBps: Number(result.condition.observedValue),
      targetApyBps: Number(result.condition.targetValue),
    },
    idempotencyKey,
    raw: result,
  };
}

/** Substitutes `{{asset}}` / `{{amount}}` / `{{onBehalfOf}}` placeholders in a
 * JSON-array-shaped args template, keeping ProviderOffer plain-JSON-safe. */
function buildFunctionArgs(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

export async function getExecutionStatus(executionId: string) {
  if (isKeeperHubDemoMode()) {
    return { executionId, status: "success", demo: true };
  }
  const client = getClient();
  const executor = new DirectExecutor(client);
  return executor.getStatus(executionId);
}

function simulateCheckAndExecute(params: {
  provider: ProviderOffer;
  asset: string;
  amount: string;
  minApyBps: number;
  idempotencyKey: string;
}): KeeperHubExecutionResult {
  const { provider, minApyBps, idempotencyKey } = params;
  const met = provider.apyBps >= minApyBps;
  return {
    mode: "demo",
    executed: met,
    executionId: `demo-exec-${crypto.randomUUID()}`,
    status: met ? "success" : "skipped",
    transactionHash: met ? (`0x${cryptoRandomHex(64)}` as const) : undefined,
    condition: {
      met,
      observedApyBps: provider.apyBps,
      targetApyBps: minApyBps,
    },
    idempotencyKey,
    raw: {
      demo: true,
      note: "KEEPERHUB_API_KEY not set — this is a simulated DirectExecutor.checkAndExecute() result shaped exactly like the real @keeperhub/sdk response.",
    },
  };
}

function cryptoRandomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

export { BPS };
