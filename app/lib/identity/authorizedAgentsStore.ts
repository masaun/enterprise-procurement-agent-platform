import type { AgentVerification } from "@/lib/identity/gate";

/**
 * In-app record of authorized agents — same process-local posture as
 * `lib/store.ts` (a demo-scale cache, not the source of truth). The source
 * of truth for *authorization itself* is the on-chain `authorizedAgents`
 * allowlist in `ProcurementRegistry` (see `lib/chain/registry.ts`); this
 * store only keeps the extra display context (which `agentId` an address
 * verified against, when, and its reputation snapshot) that the contract
 * itself doesn't hold.
 */
export type AuthorizedAgentRecord = {
  address: string;
  agentId: string;
  active: boolean;
  verification: AgentVerification;
  addedAt: string;
};

const agents = new Map<string, AuthorizedAgentRecord>();

export function upsertAuthorizedAgent(record: AuthorizedAgentRecord): void {
  agents.set(record.address.toLowerCase(), record);
}

export function markRevoked(address: string): void {
  const existing = agents.get(address.toLowerCase());
  if (existing) existing.active = false;
}

export function listAuthorizedAgents(): AuthorizedAgentRecord[] {
  return Array.from(agents.values()).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function getAuthorizedAgent(address: string): AuthorizedAgentRecord | undefined {
  return agents.get(address.toLowerCase());
}
