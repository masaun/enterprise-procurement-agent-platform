import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { CliConfig } from "./config.ts";
import { PROCUREMENT_REGISTRY_ABI, REGISTRY_STATUS, type RegistryStatusLabel } from "./procurementAbi.ts";

/**
 * Writes the on-chain receipt for a completed procurement to
 * `ProcurementRegistry` (./contracts) on Base Sepolia. Reuses
 * `PROCURE_PRIVATE_KEY` — the same key `siwx.ts` uses to sign SIWX
 * challenges — as the agent's on-chain treasury/write key, per that file's
 * own doc comment anticipating this exact dual use. The server never sees
 * this key; the external agent's own wallet is what `msg.sender` resolves
 * to on-chain, and it must already be on `ProcurementRegistry`'s
 * `authorizedAgents` allowlist (added by the platform after its own
 * live ERC-8004 verification — see `app/lib/identity/gate.ts`).
 */

export function getAccount(config: CliConfig) {
  const key = (config.privateKey as Hex | null) || generatePrivateKey();
  if (!config.privateKey) {
    process.stderr.write(
      "warning: no PROCURE_PRIVATE_KEY configured — using a throwaway signer that will not be authorized on-chain.\n",
    );
  }
  return privateKeyToAccount(key);
}

function getClients(config: CliConfig) {
  const transport = http(config.rpcUrl);
  const account = getAccount(config);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });
  return { account, publicClient, walletClient };
}

/** Deterministic, collision-resistant taskId shared between the on-chain record and the off-chain report. */
export function randomTaskId(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

export async function recordProcurementOnChain(
  config: CliConfig,
  params: {
    taskId: Hex;
    enterprise: Address;
    status: RegistryStatusLabel;
    asset: string;
    amount: bigint;
    apyBps: number;
    detailsHash: Hex;
    detailsURI: string;
  },
): Promise<{ transactionHash: Hex }> {
  if (!config.registryAddress) {
    throw new Error("PROCURE_REGISTRY_ADDRESS is not set — cannot write the on-chain receipt.");
  }
  const { walletClient, publicClient } = getClients(config);

  const hash = await walletClient.writeContract({
    address: config.registryAddress as Address,
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "recordProcurement",
    args: [
      params.taskId,
      params.enterprise,
      REGISTRY_STATUS[params.status],
      params.asset,
      params.amount,
      params.apyBps,
      params.detailsHash,
      params.detailsURI,
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash };
}
