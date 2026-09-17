import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createIdentityRegistryClient, getRegistryAddress } from "@lucid-agents/identity";

/**
 * Mints a new ERC-8004 identity (an ERC-721 token, via the Identity
 * Registry's `register()`) for the wallet configured via
 * `AGENT_IDENTITY_PRIVATE_KEY` — backs the dashboard's "Authorize Agent (by
 * Registering in the ERC-8004)" panel, upstream of the existing "Authorized
 * agents" panel (`lib/identity/gate.ts` / `lib/chain/registry.ts`), which
 * assumes an identity already exists.
 *
 * `register()` mints the token to whichever address signs the transaction
 * (see `@lucid-agents/identity`'s implementation), so `AGENT_IDENTITY_PRIVATE_KEY`
 * is a THIRD key, distinct from the other two already in play:
 * - `CONTRACT_OWNER_PRIVATE_KEY` (`lib/chain/registry.ts`) — the platform's
 *   own signer, administers `ProcurementRegistry`'s allowlist only.
 * - The external agent's own wallet (`PROCURE_PRIVATE_KEY`, never held by
 *   this app) — executes procurements and writes receipts.
 * - `AGENT_IDENTITY_PRIVATE_KEY` (used here) must be the agent wallet being
 *   registered (e.g. the same key as `PROCURE_PRIVATE_KEY`), not the
 *   platform's — registering with the wrong key mints an identity owned by
 *   the wrong wallet.
 */

function resolveChainId(): number {
  return Number(process.env.CHAIN_ID || baseSepolia.id);
}

function getRpcUrl(): string {
  return process.env.RPC_URL || "https://sepolia.base.org";
}

function getIdentityRegistryAddress(chainId: number): Hex {
  return (process.env.IDENTITY_REGISTRY_ADDRESS as Hex | undefined) || getRegistryAddress("identity", chainId);
}

export function isIdentityRegistrationConfigured(): boolean {
  return Boolean(process.env.AGENT_IDENTITY_PRIVATE_KEY);
}

export type IdentityRegistrationResult = {
  agentId?: string;
  agentAddress: Hex;
  transactionHash: Hex;
};

export async function registerAgentIdentity(agentURI?: string): Promise<IdentityRegistrationResult> {
  const key = process.env.AGENT_IDENTITY_PRIVATE_KEY;
  if (!key) throw new Error("AGENT_IDENTITY_PRIVATE_KEY is not set.");

  const chainId = resolveChainId();
  const rpcUrl = getRpcUrl();
  const account = privateKeyToAccount(key as Hex);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

  const identityRegistry = createIdentityRegistryClient({
    address: getIdentityRegistryAddress(chainId),
    chainId,
    publicClient,
    walletClient,
  });

  const result = await identityRegistry.register(agentURI ? { agentURI } : undefined);
  return {
    agentId: result.agentId !== undefined ? result.agentId.toString() : undefined,
    agentAddress: result.agentAddress,
    transactionHash: result.transactionHash,
  };
}
