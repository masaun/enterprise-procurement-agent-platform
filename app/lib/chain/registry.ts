import { createPublicClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { PROCUREMENT_REGISTRY_ABI, REGISTRY_STATUS_LABELS, type RegistryStatusLabel } from "./procurementAbi";
import { getActiveRegistryAddress } from "./activeRegistryStore";

/**
 * `./app`'s own reader for `ProcurementRegistry` (./contracts, Base
 * Sepolia) — the on-chain source of truth for the dashboard's
 * activity/receipt history (replacing `lib/store.ts` in that role; see its
 * updated doc comment) and for the inbound agent-facing allowlist gate
 * (`lib/lucid/agent.ts`'s `report` entrypoint). Read-only: this app holds no
 * `ProcurementRegistry` signing key of its own anymore. Administering the
 * on-chain `authorizedAgents` allowlist (`addAuthorizedAgent`/
 * `revokeAuthorizedAgent`) is done exclusively by whichever wallet owns that
 * registry, connected via "Connect Wallet" (see `registryBrowser.ts`) —
 * there used to be a platform-held `CONTRACT_OWNER_PRIVATE_KEY` for this,
 * removed because a registry's `Ownable` owner is always the wallet that
 * called `ProcurementRegistryFactory.createNewProcurementRegistry()`, so a
 * separate platform key could never actually administer it.
 *
 * `getRegistryAddress()` below reads `activeRegistryStore.ts`, not a static
 * env var — the dashboard keeps it in sync with whatever registry the
 * connected wallet is currently using (see that store's doc comment).
 */

function getRpcUrl(): string {
  return process.env.RPC_URL || "https://sepolia.base.org";
}

function getRegistryAddress(): Address {
  const address = getActiveRegistryAddress();
  if (!address) throw new Error("No active ProcurementRegistry — connect a wallet in the dashboard and create/select one first.");
  return address;
}

function getPublicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http(getRpcUrl()) });
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

/**
 * Live per-registry read of every wallet address the given
 * `ProcurementRegistry` has ever authorized — the dashboard's "Authorized
 * agents" table (both panels that show it). Takes the registry address
 * explicitly rather than `activeRegistryStore`'s process-wide singleton, so
 * it's always scoped to whichever registry the caller actually asked about,
 * not whichever one some other connected wallet loaded last.
 *
 * The `authorizedAgents` mapping itself isn't enumerable, so addresses are
 * discovered from `AgentAuthorized`/`AgentRevoked` logs (fine at demo scale
 * via a single `getLogs` call from genesis; a real deployment would paginate
 * or use an indexer) — but the returned `active` flag is always a fresh,
 * authoritative read of the mapping itself, not inferred from log order.
 */
export async function readAuthorizedAgentsOnChain(registryAddress: Address): Promise<Array<{ address: Address; active: boolean }>> {
  const publicClient = getPublicClient();

  const [authorizedLogs, revokedLogs] = await Promise.all([
    publicClient.getContractEvents({
      address: registryAddress,
      abi: PROCUREMENT_REGISTRY_ABI,
      eventName: "AgentAuthorized",
      fromBlock: "earliest",
      toBlock: "latest",
    }),
    publicClient.getContractEvents({
      address: registryAddress,
      abi: PROCUREMENT_REGISTRY_ABI,
      eventName: "AgentRevoked",
      fromBlock: "earliest",
      toBlock: "latest",
    }),
  ]);

  const allLogs = [...authorizedLogs, ...revokedLogs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });

  const addressesInOrder: Address[] = [];
  const seen = new Set<string>();
  for (const log of allLogs) {
    const agent = (log.args as { agent: Address }).agent;
    if (seen.has(agent.toLowerCase())) continue;
    seen.add(agent.toLowerCase());
    addressesInOrder.push(agent);
  }

  const activeFlags = await Promise.all(
    addressesInOrder.map((agent) =>
      publicClient.readContract({
        address: registryAddress,
        abi: PROCUREMENT_REGISTRY_ABI,
        functionName: "authorizedAgents",
        args: [agent],
      }),
    ),
  );

  return addressesInOrder.map((address, i) => ({ address, active: activeFlags[i] }));
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
  return Boolean(getActiveRegistryAddress());
}
