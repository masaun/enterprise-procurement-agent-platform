import { createPublicClient, createWalletClient, custom, parseEventLogs, zeroAddress, type Address, type EIP1193Provider, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { PROCUREMENT_REGISTRY_FACTORY_ABI } from "./factoryAbi";

/**
 * Browser-only client for `ProcurementRegistryFactory` (./contracts) —
 * backs the dashboard's "New ProcurementRegistry contract creation" panel.
 * Always signed by whichever wallet the admin connected via "Connect
 * Wallet": `createNewProcurementRegistry()` sets `msg.sender` (the signer)
 * as the new registry's `Ownable` owner, so this has no server-signed
 * fallback — the whole point is that the admin's own wallet ends up owning
 * the registry it creates, so it alone can later call
 * `addAuthorizedAgent()`/`revokeAuthorizedAgent()` on it (see
 * `registryBrowser.ts`). This never runs server-side; the only env var it
 * reads is the `NEXT_PUBLIC_`-prefixed one below, which Next.js inlines into
 * the client bundle at build time.
 */

function getFactoryAddress(): Address {
  const address = process.env.NEXT_PUBLIC_PROCUREMENT_REGISTRY_FACTORY_ADDRESS;
  if (!address) throw new Error("NEXT_PUBLIC_PROCUREMENT_REGISTRY_FACTORY_ADDRESS is not set.");
  return address as Address;
}

export function isFactoryConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PROCUREMENT_REGISTRY_FACTORY_ADDRESS);
}

export type CreateProcurementRegistryResult = {
  registryAddress: Address;
  owner: Address;
  transactionHash: Hex;
};

export async function createProcurementRegistryWithConnectedWallet(
  provider: EIP1193Provider,
  signerAddress: Hex,
): Promise<CreateProcurementRegistryResult> {
  const transport = custom(provider);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account: signerAddress, chain: baseSepolia, transport });
  const factory = getFactoryAddress();

  const hash = await walletClient.writeContract({
    address: factory,
    abi: PROCUREMENT_REGISTRY_FACTORY_ABI,
    functionName: "createNewProcurementRegistry",
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const [event] = parseEventLogs({
    abi: PROCUREMENT_REGISTRY_FACTORY_ABI,
    eventName: "ProcurementRegistryCreated",
    logs: receipt.logs,
  });
  if (!event) {
    throw new Error("Registry was created, but its address could not be read back from the transaction receipt.");
  }

  return { registryAddress: event.args.registry, owner: event.args.owner, transactionHash: hash };
}

/**
 * Reads `ProcurementRegistryFactory.getRegistriesByCreator(creator)` — the
 * on-chain list of registries a given wallet has created (and, since
 * `createNewProcurementRegistry()` sets the creator as `owner`, also owns).
 * Backs the "Authorized agents" panel's registry picker, so the admin
 * doesn't have to remember/paste a registry address by hand: it's read
 * straight from the factory's own storage, keyed by the connected wallet.
 */
export async function getRegistriesByCreatorWithConnectedWallet(provider: EIP1193Provider, creator: Address): Promise<Address[]> {
  const publicClient = createPublicClient({ chain: baseSepolia, transport: custom(provider) });
  const factory = getFactoryAddress();

  const registries = await publicClient.readContract({
    address: factory,
    abi: PROCUREMENT_REGISTRY_FACTORY_ABI,
    functionName: "getRegistriesByCreator",
    args: [creator],
  });
  return [...registries];
}

/**
 * Reads `ProcurementRegistryFactory.getRegistryForCreator(creator)` — the
 * single `ProcurementRegistry` this wallet owns (the factory now enforces
 * one per creator; see `createNewProcurementRegistry`'s `RegistryAlreadyExists`
 * revert), or `null` if it hasn't created one yet. This is the source of
 * truth the dashboard always re-syncs its selected registry address to,
 * instead of trusting whatever was last typed/left in a text field.
 */
export async function getRegistryForCreatorWithConnectedWallet(provider: EIP1193Provider, creator: Address): Promise<Address | null> {
  const publicClient = createPublicClient({ chain: baseSepolia, transport: custom(provider) });
  const factory = getFactoryAddress();

  const registry = await publicClient.readContract({
    address: factory,
    abi: PROCUREMENT_REGISTRY_FACTORY_ABI,
    functionName: "getRegistryForCreator",
    args: [creator],
  });
  return registry === zeroAddress ? null : registry;
}
