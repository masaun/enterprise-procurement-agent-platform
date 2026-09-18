import { createPublicClient, createWalletClient, custom, type EIP1193Provider, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { createIdentityRegistryClient, getRegistryAddress } from "@lucid-agents/identity";
import { mintAndMaybeTransferIdentity, type IdentityRegistrationResult } from "./registerCore";

export type { IdentityRegistrationResult };

/**
 * Browser counterpart to `register.ts`: mints the ERC-8004 identity (and
 * transfers it to `agentWalletAddress`, if given) signed by whatever wallet
 * the admin connected via "Connect Wallet" — that wallet pays its own gas,
 * instead of the platform's `ENTERPRISE_ADMIN_PRIVATE_KEY`. This never runs
 * server-side and never touches `process.env`'s server-only secrets; the
 * only env var it reads is the `NEXT_PUBLIC_`-prefixed override below, which
 * Next.js inlines into the client bundle at build time.
 */
function resolveChainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID;
  return raw ? Number(raw) : baseSepolia.id;
}

function getIdentityRegistryAddress(chainId: number): Hex {
  return (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS as Hex | undefined) || getRegistryAddress("identity", chainId);
}

export async function registerAgentIdentityWithConnectedWallet(
  provider: EIP1193Provider,
  signerAddress: Hex,
  agentURI?: string,
  agentWalletAddress?: Hex,
): Promise<IdentityRegistrationResult> {
  const chainId = resolveChainId();
  const transport = custom(provider);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account: signerAddress, chain: baseSepolia, transport });

  const identityRegistry = createIdentityRegistryClient({
    address: getIdentityRegistryAddress(chainId),
    chainId,
    publicClient,
    walletClient,
  });

  return mintAndMaybeTransferIdentity(identityRegistry, signerAddress, agentURI, agentWalletAddress);
}
