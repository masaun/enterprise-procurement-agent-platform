/**
 * In-app record of agents minted via the "Authorize Agent (by Registering in
 * the ERC-8004)" panel — same process-local, demo-scale posture as
 * `authorizedAgentsStore.ts` and `lib/store.ts`. The source of truth for the
 * identity itself is the ERC-8004 Identity Registry on-chain (an ERC-721
 * token); this store only keeps a display-friendly log of registrations this
 * app has driven (server-signed via `register.ts`, or wallet-signed via
 * `registerBrowser.ts` and reported back through `PUT /api/agents/identity`),
 * since the Identity Registry itself exposes no "list all agents" read.
 */
export type RegisteredAgentRecord = {
  agentId?: string;
  agentAddress: string;
  agentURI?: string;
  transactionHash: string;
  transferTransactionHash?: string;
  registeredAt: string;
};

const agents = new Map<string, RegisteredAgentRecord>();

function keyFor(record: Pick<RegisteredAgentRecord, "agentId" | "agentAddress">): string {
  return record.agentId !== undefined ? `id:${record.agentId}` : `addr:${record.agentAddress.toLowerCase()}`;
}

export function upsertRegisteredAgent(record: RegisteredAgentRecord): void {
  agents.set(keyFor(record), record);
}

export function listRegisteredAgents(): RegisteredAgentRecord[] {
  return Array.from(agents.values()).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}
