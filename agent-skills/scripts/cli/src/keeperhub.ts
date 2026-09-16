import { DirectExecutor, KeeperHubClient, type DirectCheckAndExecuteResult } from "@keeperhub/sdk";
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
  rateContract: { address: string; functionName: string; functionArgs?: string };
  supplyContract: { address: string; functionName: string; argsTemplate: string };
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
    observedApyBps: number;
    targetApyBps: number;
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
      observedApyBps: provider.apyBps,
      targetApyBps: minApyBps,
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
