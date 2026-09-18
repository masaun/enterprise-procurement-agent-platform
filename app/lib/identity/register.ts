import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createIdentityRegistryClient, getRegistryAddress } from "@lucid-agents/identity";
import { mintAndMaybeTransferIdentity, type IdentityRegistrationResult } from "./registerCore";

export type { IdentityRegistrationResult };

/**
 * Server-side fallback for minting a new ERC-8004 identity (an ERC-721
 * token, via the Identity Registry's `register()`) — backs the dashboard's
 * "Authorize Agent (by Registering in the ERC-8004)" panel, upstream of the
 * existing "Authorized agents" panel (`lib/identity/gate.ts` /
 * `lib/chain/registry.ts`), which assumes an identity already exists.
 *
 * Used only when the admin hasn't connected a wallet via "Connect Wallet" —
 * when one is connected, the panel instead signs and pays gas with that
 * wallet directly in the browser (`lib/identity/registerBrowser.ts`), and
 * this route/function is never called. The mint+transfer mechanics are
 * shared between both paths via `registerCore.ts`.
 *
 * `register()` mints the token to whichever address signs the transaction
 * (see `@lucid-agents/identity`'s implementation) — it has no "mint to this
 * address" parameter — so `ENTERPRISE_ADMIN_PRIVATE_KEY` always signs the mint.
 * To let an admin register an arbitrary **agent wallet address** (rather than
 * being stuck with whatever address `ENTERPRISE_ADMIN_PRIVATE_KEY` happens to
 * be), an optional `agentWalletAddress` mints as usual and then transfers the
 * freshly minted token (`safeTransferFrom`, via `IdentityRegistryClient.transfer()`)
 * from the `ENTERPRISE_ADMIN_PRIVATE_KEY` signer to that address — no private
 * key for the target wallet is ever needed by this app.
 *
 * `ENTERPRISE_ADMIN_PRIVATE_KEY` is distinct from the other keys in play
 * (named for what it actually is — the enterprise admin's own signer, not
 * any particular agent's — unlike its predecessor `AGENT_IDENTITY_PRIVATE_KEY`,
 * which implied it had to be an agent's key):
 * - `ProcurementRegistry`'s `authorizedAgents` allowlist has no platform key
 *   at all — it's administered exclusively by whichever connected wallet
 *   owns that registry (see `lib/chain/registryBrowser.ts`).
 * - The external agent's own wallet (`PROCURE_PRIVATE_KEY`, never held by
 *   this app) — executes procurements and writes receipts.
 * - `ENTERPRISE_ADMIN_PRIVATE_KEY` (used here) only mints + (when
 *   `agentWalletAddress` is given) transfers; it never needs to be the
 *   agent's own key.
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
  return Boolean(process.env.ENTERPRISE_ADMIN_PRIVATE_KEY);
}

export async function registerAgentIdentity(agentURI?: string, agentWalletAddress?: Hex): Promise<IdentityRegistrationResult> {
  const key = process.env.ENTERPRISE_ADMIN_PRIVATE_KEY;
  if (!key) throw new Error("ENTERPRISE_ADMIN_PRIVATE_KEY is not set.");

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

  return mintAndMaybeTransferIdentity(identityRegistry, account.address, agentURI, agentWalletAddress);
}
