import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { PROCUREMENT_REGISTRY_ABI, REGISTRY_STATUS_LABELS, type RegistryStatusLabel } from "./procurementAbi";

/**
 * `./app`'s own reader/administrator for `ProcurementRegistry` (./contracts,
 * Base Sepolia) — the on-chain source of truth for the dashboard's
 * activity/receipt history (replacing `lib/store.ts` in that role; see its
 * updated doc comment). Two distinct keys are involved, never conflated:
 *
 * - `CONTRACT_OWNER_PRIVATE_KEY` (used here) — the *platform's* signer,
 *   administers the on-chain `authorizedAgents` allowlist only after
 *   `lib/identity/gate.ts`'s live ERC-8004 check passes. It never touches
 *   enterprise funds and never calls `recordProcurement`.
 * - The external agent's own wallet (never held by this app) — calls
 *   `recordProcurement` itself from `agent-skills/scripts/cli/src/registry.ts`.
 */

function getRpcUrl(): string {
  return process.env.RPC_URL || "https://sepolia.base.org";
}

function getRegistryAddress(): Address {
  const address = process.env.PROCUREMENT_REGISTRY_ADDRESS;
  if (!address) throw new Error("PROCUREMENT_REGISTRY_ADDRESS is not set.");
  return address as Address;
}

function getPublicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http(getRpcUrl()) });
}

function getOwnerWalletClient() {
  const key = process.env.CONTRACT_OWNER_PRIVATE_KEY;
  if (!key) throw new Error("CONTRACT_OWNER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount(key as Hex);
  return createWalletClient({ account, chain: baseSepolia, transport: http(getRpcUrl()) });
}

export async function addAuthorizedAgentOnChain(agent: Address): Promise<Hex> {
  const wallet = getOwnerWalletClient();
  const publicClient = getPublicClient();
  const hash = await wallet.writeContract({
    address: getRegistryAddress(),
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "addAuthorizedAgent",
    args: [agent],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function revokeAuthorizedAgentOnChain(agent: Address): Promise<Hex> {
  const wallet = getOwnerWalletClient();
  const publicClient = getPublicClient();
  const hash = await wallet.writeContract({
    address: getRegistryAddress(),
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "revokeAuthorizedAgent",
    args: [agent],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function isAgentAuthorizedOnChain(agent: Address): Promise<boolean> {
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: getRegistryAddress(),
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "authorizedAgents",
    args: [agent],
  });
}

export type OnChainReceipt = {
  taskId: Hex;
  enterprise: Address;
  agent: Address;
  createdAt: number;
  status: RegistryStatusLabel;
  detailsHash: Hex;
  asset: string;
  amount: string;
  apyBps: number;
  detailsURI: string;
  transactionHash: Hex;
};

/**
 * Reads every `ProcurementRecorded` event ever emitted — the dashboard's
 * activity list. Fine at demo scale via a single `getLogs` call from genesis;
 * a real deployment would paginate by block range or use an indexer.
 */
export async function readProcurementHistory(): Promise<OnChainReceipt[]> {
  const publicClient = getPublicClient();
  const address = getRegistryAddress();

  const logs = await publicClient.getContractEvents({
    address,
    abi: PROCUREMENT_REGISTRY_ABI,
    eventName: "ProcurementRecorded",
    fromBlock: "earliest",
    toBlock: "latest",
  });

  return logs.map((log) => {
    const args = log.args as {
      taskId: Hex;
      enterprise: Address;
      agent: Address;
      status: number;
      asset: string;
      amount: bigint;
      apyBps: number;
      detailsHash: Hex;
      detailsURI: string;
    };
    return {
      taskId: args.taskId,
      enterprise: args.enterprise,
      agent: args.agent,
      createdAt: 0, // block timestamp not fetched per-log at this scale; receipts() below has the authoritative value
      status: REGISTRY_STATUS_LABELS[args.status] ?? "failed",
      detailsHash: args.detailsHash,
      asset: args.asset,
      amount: args.amount.toString(),
      apyBps: args.apyBps,
      detailsURI: args.detailsURI,
      transactionHash: log.transactionHash,
    };
  });
}

export async function readReceipt(taskId: Hex): Promise<{
  enterprise: Address;
  agent: Address;
  createdAt: number;
  status: RegistryStatusLabel;
  detailsHash: Hex;
} | null> {
  const publicClient = getPublicClient();
  const [enterprise, agent, createdAt, status, detailsHash] = (await publicClient.readContract({
    address: getRegistryAddress(),
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "receipts",
    args: [taskId],
  })) as [Address, Address, bigint, number, Hex];

  if (createdAt === 0n) return null;
  return { enterprise, agent, createdAt: Number(createdAt), status: REGISTRY_STATUS_LABELS[status] ?? "failed", detailsHash };
}

export function isRegistryConfigured(): boolean {
  return Boolean(process.env.PROCUREMENT_REGISTRY_ADDRESS);
}
