import { createPublicClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { createIdentityRegistryClient, createReputationRegistryClient, getRegistryAddress } from "@lucid-agents/identity";

/**
 * Live ERC-8004 verification for INBOUND callers — new for the management
 * platform. Everything `@lucid-agents/identity` was used for previously in
 * this codebase (`lib/lucid/agent.ts::buildIdentityConfig`) is
 * self-declaration (this app describing its own identity) or, in
 * `lib/lucid/orchestrate.ts`, resolving a *provider's* card. Neither
 * verifies who is calling in. This module composes the SDK's raw registry
 * primitives (`IdentityRegistryClient.get`/`getAgentWallet`,
 * `ReputationRegistryClient.getSummary`) into that missing "verify this
 * caller" check — no ready-made function for it exists in the SDK.
 */

export type AgentVerification = {
  verified: boolean;
  agentId: string;
  onChainWallet?: Address;
  reputation?: { count: number; value: number; valueDecimals: number };
  reason?: string;
};

function resolveChainId(): number {
  return Number(process.env.CHAIN_ID || baseSepolia.id);
}

function getPublicClient() {
  const rpcUrl = process.env.RPC_URL || "https://sepolia.base.org";
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

/**
 * Confirms that `expectedAddress` (the SIWX-authenticated caller) is the
 * on-chain wallet registered for `agentId` on the ERC-8004 Identity
 * Registry, and fetches its reputation summary for display. Read-only —
 * no wallet/private key needed here, only `RPC_URL`.
 */
export async function verifyAgentOnChain(agentId: string, expectedAddress: Address): Promise<AgentVerification> {
  const chainId = resolveChainId();
  const publicClient = getPublicClient();

  const identityAddress = (process.env.IDENTITY_REGISTRY_ADDRESS as Hex | undefined) || getRegistryAddress("identity", chainId);
  const identityRegistry = createIdentityRegistryClient({
    address: identityAddress,
    chainId,
    publicClient,
  });

  let onChainWallet: Address | undefined;
  try {
    onChainWallet = await identityRegistry.getAgentWallet(agentId);
  } catch (err) {
    return { verified: false, agentId, reason: `Identity registry lookup failed: ${(err as Error).message}` };
  }

  if (!onChainWallet || onChainWallet.toLowerCase() !== expectedAddress.toLowerCase()) {
    return {
      verified: false,
      agentId,
      onChainWallet,
      reason: `Registered wallet for agentId ${agentId} (${onChainWallet ?? "none"}) does not match the SIWX-authenticated address (${expectedAddress}).`,
    };
  }

  let reputation: AgentVerification["reputation"];
  try {
    const reputationAddress = (process.env.REPUTATION_REGISTRY_ADDRESS as Hex | undefined) || getRegistryAddress("reputation", chainId);
    const reputationRegistry = createReputationRegistryClient({
      address: reputationAddress,
      chainId,
      publicClient,
      identityRegistryAddress: identityAddress,
    });
    const summary = await reputationRegistry.getSummary(BigInt(agentId));
    reputation = { count: Number(summary.count), value: Number(summary.value), valueDecimals: summary.valueDecimals };
  } catch {
    // Reputation is informational only — a missing/unsupported reputation
    // registry on this chain must not block an otherwise-valid identity check.
  }

  return { verified: true, agentId, onChainWallet, reputation };
}
