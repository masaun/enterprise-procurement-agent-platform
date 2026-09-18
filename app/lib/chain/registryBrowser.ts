import { createPublicClient, createWalletClient, custom, type Address, type EIP1193Provider, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { PROCUREMENT_REGISTRY_ABI } from "./procurementAbi";

/**
 * The only place that writes to `ProcurementRegistry`'s on-chain
 * `authorizedAgents` allowlist: `addAuthorizedAgent()`/
 * `revokeAuthorizedAgent()`, signed and gas-paid directly by the enterprise
 * admin's own connected wallet — always the registry's `Ownable` owner,
 * since `ProcurementRegistryFactory.createNewProcurementRegistry()`
 * (`factoryBrowser.ts`) made that same wallet the owner when it created it.
 * `registry.ts` (server-side) has no counterpart write functions anymore —
 * this app holds no `ProcurementRegistry` signing key of its own. The
 * registry address is a caller-supplied parameter, since an admin may own
 * several; this never runs server-side.
 */

export async function readRegistryOwnerWithConnectedWallet(provider: EIP1193Provider, registryAddress: Address): Promise<Address> {
  const publicClient = createPublicClient({ chain: baseSepolia, transport: custom(provider) });
  return publicClient.readContract({
    address: registryAddress,
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "owner",
  });
}

export async function addAuthorizedAgentWithConnectedWallet(
  provider: EIP1193Provider,
  signerAddress: Hex,
  registryAddress: Address,
  agent: Address,
): Promise<Hex> {
  const transport = custom(provider);
  const walletClient = createWalletClient({ account: signerAddress, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "addAuthorizedAgent",
    args: [agent],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function revokeAuthorizedAgentWithConnectedWallet(
  provider: EIP1193Provider,
  signerAddress: Hex,
  registryAddress: Address,
  agent: Address,
): Promise<Hex> {
  const transport = custom(provider);
  const walletClient = createWalletClient({ account: signerAddress, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi: PROCUREMENT_REGISTRY_ABI,
    functionName: "revokeAuthorizedAgent",
    args: [agent],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
