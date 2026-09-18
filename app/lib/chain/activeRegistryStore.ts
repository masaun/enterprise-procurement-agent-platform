import type { Address } from "viem";

/**
 * The `ProcurementRegistry` the platform currently reads/gates against —
 * process-local, demo-scale state (same posture as
 * `lib/identity/authorizedAgentsStore.ts`; resets on server restart), never
 * a hardcoded `PROCUREMENT_REGISTRY_ADDRESS` env var.
 *
 * There is no platform-owned registry anymore: `ProcurementRegistryFactory.
 * createNewProcurementRegistry()` makes whichever wallet calls it the new
 * registry's `Ownable` owner (see `lib/chain/factoryBrowser.ts`), so only
 * that connected wallet can administer it. `POST /api/procurement-registry/
 * active` is called by the dashboard (`ProcurementConsole.tsx`) every time
 * the connected wallet resolves, creates, or picks a registry via the
 * factory, keeping this in sync with the actual on-chain ownership — instead
 * of the platform declaring a registry address up front in `.env.local`.
 */
let activeRegistryAddress: Address | null = null;

export function setActiveRegistryAddress(address: Address): void {
  activeRegistryAddress = address;
}

export function getActiveRegistryAddress(): Address | null {
  return activeRegistryAddress;
}
