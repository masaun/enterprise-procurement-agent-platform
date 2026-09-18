import type { Hex } from "viem";
import type { IdentityRegistryClient } from "@lucid-agents/identity";

/**
 * Isomorphic core of "mint an ERC-8004 identity, then optionally transfer it
 * to `agentWalletAddress`" — shared by the server-side flow (`register.ts`,
 * signed by `ENTERPRISE_ADMIN_PRIVATE_KEY`) and the browser flow
 * (`registerBrowser.ts`, signed by whatever wallet the admin connects via
 * "Connect Wallet"). Neither signer needs to be the agent's own key:
 * `register()` mints to whoever signs, then `transfer()` (signed by that same
 * signer, since it's the fresh owner) hands the identity to the named
 * `agentWalletAddress` — no private key for the target wallet is ever needed.
 */

export type IdentityRegistrationResult = {
  agentId?: string;
  agentAddress: Hex;
  transactionHash: Hex;
  transferTransactionHash?: Hex;
};

export async function mintAndMaybeTransferIdentity(
  identityRegistry: Pick<IdentityRegistryClient, "register" | "transfer">,
  signerAddress: Hex,
  agentURI?: string,
  agentWalletAddress?: Hex,
): Promise<IdentityRegistrationResult> {
  const result = await identityRegistry.register(agentURI ? { agentURI } : undefined);

  let transferTransactionHash: Hex | undefined;
  let agentAddress = result.agentAddress;
  if (agentWalletAddress && agentWalletAddress.toLowerCase() !== signerAddress.toLowerCase()) {
    if (result.agentId === undefined) {
      throw new Error("Minted the identity but could not read back its agentId, so it can't be transferred to agentWalletAddress.");
    }
    transferTransactionHash = await identityRegistry.transfer(agentWalletAddress, result.agentId);
    agentAddress = agentWalletAddress;
  }

  return {
    agentId: result.agentId !== undefined ? result.agentId.toString() : undefined,
    agentAddress,
    transactionHash: result.transactionHash,
    transferTransactionHash,
  };
}
