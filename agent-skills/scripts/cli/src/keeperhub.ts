import { DirectExecutor, KeeperHubClient, isReadResult, type DirectCheckAndExecuteResult } from "@keeperhub/sdk";
import type { CliConfig } from "./config.ts";

/**
 * "How do we execute" — ported from `app/lib/keeperhub/client.ts`. This now
 * runs on the external agent's own machine, using the agent's own KeeperHub
 * org key (`PROCURE_KEEPERHUB_API_KEY`) and its own treasury wallet
 * (`PROCURE_PRIVATE_KEY`, reused from `siwx.ts`) — the server never sees
 * these credentials or this call. See `agent-skills/references/protocols.md`
 * for the read-then-guarded-write mechanics of `checkAndExecute`.
 */

export type ProviderOfferForExecution = {
  network: string;
  apyBps: number;
  rateContract: { address: string; functionName: string; functionArgs?: string; abi?: string };
  supplyContract: { address: string; functionName: string; argsTemplate: string; abi?: string };
  registration: { agentRegistry: string };
};

export type KeeperHubExecutionResult = {
  mode: "direct" | "demo";
  executed: boolean;
  executionId?: string;
  status: string;
  transactionHash?: string;
  condition?: {
    met: boolean;
    /** Kept as strings — a real on-chain read (e.g. a ray-scaled index) can exceed Number's safe integer range. */
    observedValue: string;
    targetValue: string;
  };
  idempotencyKey?: string;
  raw?: unknown;
};

export function isKeeperHubDemoMode(config: CliConfig): boolean {
  return !config.keeperHubApiKey;
}

function getClient(config: CliConfig): KeeperHubClient {
  if (!config.keeperHubApiKey) {
    throw new Error("PROCURE_KEEPERHUB_API_KEY is not set — call isKeeperHubDemoMode() first.");
  }
  return new KeeperHubClient({
    apiKey: config.keeperHubApiKey,
    baseUrl: config.keeperHubBaseUrl || undefined,
  });
}

export async function checkApyAndExecuteSupply(
  config: CliConfig,
  params: {
    provider: ProviderOfferForExecution;
    asset: string;
    amount: string;
    minApyBps: number;
    idempotencyKey: string;
  },
): Promise<KeeperHubExecutionResult> {
  const { provider, asset, amount, minApyBps, idempotencyKey } = params;

  if (isKeeperHubDemoMode(config)) {
    return simulateCheckAndExecute({ provider, minApyBps, idempotencyKey });
  }

  const client = getClient(config);
  const executor = new DirectExecutor(client);
  const network = toKeeperHubNetwork(provider.network);

  // Real lending-protocol contracts don't expose "current APY in bps" as a single
  // on-chain scalar — that's normally computed off-chain from a rate curve, which is
  // exactly what already happened above the CLI's own policy evaluation (offer.apyBps
  // vs minApyBps). So the on-chain condition here isn't re-checking the APY threshold;
  // it's a liveness guard — read the same rate function once now for a baseline, then
  // require it hasn't gone backwards by the time checkAndExecute re-reads it right
  // before broadcast, so the guarded write only fires against contract state we've
  // just observed as live and responsive.
  const baseline = await executor.callContract({
    network,
    contractAddress: provider.rateContract.address,
    functionName: provider.rateContract.functionName,
    functionArgs: provider.rateContract.functionArgs,
    abi: provider.rateContract.abi,
  });
  if (!isReadResult(baseline) || typeof baseline.result !== "string") {
    throw new Error(
      `Expected a scalar read from ${provider.rateContract.functionName}, got: ${JSON.stringify(baseline)}`,
    );
  }

  const result: DirectCheckAndExecuteResult = await executor.checkAndExecute({
    network,
    contractAddress: provider.rateContract.address,
    functionName: provider.rateContract.functionName,
    functionArgs: provider.rateContract.functionArgs,
    abi: provider.rateContract.abi,
    condition: { operator: "gte", value: baseline.result },
    action: {
      network,
      contractAddress: provider.supplyContract.address,
      functionName: provider.supplyContract.functionName,
      functionArgs: buildFunctionArgs(provider.supplyContract.argsTemplate, {
        asset,
        amount,
        onBehalfOf: provider.registration.agentRegistry,
      }),
      // Pins the exact overload (see ProviderOffer["supplyContract"]["abi"]'s
      // doc comment) — without this, KeeperHub's auto-fetched explorer ABI
      // can match more than one function of the same name and refuses to
      // guess which one to call.
      abi: provider.supplyContract.abi,
    },
  });

  // KeeperHub's real `checkAndExecute` omits `condition` on some failed/errored
  // executions (e.g. the org wallet lacking funds/allowance for the action
  // leg) even though the SDK's type declares it as always present. Treat a
  // missing condition as "not executed" with the API's own status/error
  // surfaced, instead of throwing — an uncaught TypeError here previously
  // propagated all the way up through orchestrate.ts uncaught, crashing the
  // whole `procure act`/`submit` call with no useful message.
  return {
    mode: "direct",
    executed: result.executed,
    executionId: result.executionId,
    status: result.status ?? (result.executed ? "success" : result.condition ? "skipped" : "error"),
    condition: result.condition
      ? {
          met: result.condition.met,
          observedValue: String(result.condition.observedValue),
          targetValue: String(result.condition.targetValue),
        }
      : undefined,
    idempotencyKey,
    raw: result,
  };
}

/**
 * `provider.network` is CAIP-2 (`"eip155:84532"`) per `references/api-reference.md`,
 * since that's what SIWX chain-ID matching needs. The KeeperHub SDK's `network`
 * param wants a bare chain id or its own alias instead (its docs example: "base",
 * "ethereum", "8453") — so translate only at this SDK call boundary.
 */
function toKeeperHubNetwork(network: string): string {
  const eip155Match = network.match(/^eip155:(\d+)$/);
  return eip155Match ? eip155Match[1] : network;
}

function buildFunctionArgs(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function simulateCheckAndExecute(params: {
  provider: ProviderOfferForExecution;
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
      observedValue: String(provider.apyBps),
      targetValue: String(minApyBps),
    },
    idempotencyKey,
    raw: {
      demo: true,
      note: "PROCURE_KEEPERHUB_API_KEY not set — this is a simulated DirectExecutor.checkAndExecute() result shaped exactly like the real @keeperhub/sdk response.",
    },
  };
}

function cryptoRandomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}
