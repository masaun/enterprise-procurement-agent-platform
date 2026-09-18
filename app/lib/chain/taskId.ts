import { randomBytes } from "node:crypto";
import type { Hex } from "viem";

/**
 * Generates a fresh bytes32 taskId — the same identifier space
 * `ProcurementRegistry.recordProcurement()` expects on-chain. Embedded in
 * every webhook dispatch (`lib/webhooks/dispatch.ts`) so an external agent's
 * `procure act` can adopt this exact taskId for both its on-chain receipt
 * and its report back, instead of minting its own random one — which the
 * dashboard could never correlate to the task it originally dispatched (see
 * `agent-skills/scripts/cli/src/orchestrate.ts`'s `runProcurementLocally`).
 * Mirrors `agent-skills/scripts/cli/src/registry.ts`'s `randomTaskId()`
 * byte-for-byte so the two stay format-compatible without sharing code
 * across these two independent projects.
 */
export function randomTaskId(): Hex {
  return `0x${randomBytes(32).toString("hex")}` as Hex;
}
