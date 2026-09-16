import { z } from "zod";

/**
 * A procurement request as an enterprise (human, via the UI, or an external
 * agent such as Hermes/OpenClaw, via A2A/MCP) states it.
 *
 * `instruction` is the natural-language ask, e.g.
 * "Move 1M USDC from our treasury to an approved lending protocol, but only
 * if APY > 4%." The structured fields are the parsed/explicit form of the
 * same request and are what the policy engine and KeeperHub actually run on.
 */
export const ProcurementRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  asset: z.string().min(1).default("USDC"),
  amount: z.string().min(1),
  minApyBps: z.number().int().min(0).max(10_000).default(400),
  allowedProtocols: z.array(z.string()).optional(),
  network: z.string().optional(),
});
export type ProcurementRequest = z.infer<typeof ProcurementRequestSchema>;

export const PolicySchema = z.object({
  maxUsdPerTask: z.number().positive(),
  minApyBps: z.number().int().min(0).max(10_000),
  allowedAssets: z.array(z.string()),
  allowedProtocols: z.array(z.string()),
});
export type Policy = z.infer<typeof PolicySchema>;

export type PolicyEvaluation = {
  allowed: boolean;
  policy: Policy;
  reasons: string[];
};

/** A candidate service provider discovered via A2A / an ERC-8004 identity registry. */
export type ProviderOffer = {
  agentId: string;
  name: string;
  protocol: string;
  asset: string;
  network: string;
  apyBps: number;
  cardUrl: string;
  trustModels: string[];
  registration: {
    agentRegistry: string;
  };
  /** KeeperHub DirectExecutor.checkAndExecute() read-side: the view call reporting current APY (bps). */
  rateContract: {
    address: string;
    functionName: string;
    functionArgs?: string;
  };
  /**
   * KeeperHub DirectExecutor.checkAndExecute() write-side: the guarded
   * supply/deposit call. `argsTemplate` is a JSON-array-shaped string with
   * `{{asset}}` / `{{amount}}` / `{{onBehalfOf}}` placeholders, substituted
   * at execution time — kept as data (not a function) so a ProviderOffer
   * stays plain JSON and can round-trip through the API/task store.
   */
  supplyContract: {
    address: string;
    functionName: string;
    argsTemplate: string;
  };
};

export type TimelineEventKind =
  | "siwx.authenticated"
  | "identity.resolved"
  | "a2a.discovered"
  | "a2a.selected"
  | "a2a.invoked"
  | "ap2.mandate"
  | "policy.evaluated"
  | "keeperhub.condition_checked"
  | "keeperhub.executed"
  | "webhook.dispatched"
  | "erc8004.gate_checked"
  | "chain.recorded"
  | "report.received"
  | "task.completed"
  | "task.failed";

export type TimelineEvent = {
  kind: TimelineEventKind;
  at: string;
  label: string;
  detail?: Record<string, unknown>;
};

export type TaskStatus =
  | "dispatched"
  | "authenticating"
  | "discovering"
  | "evaluating_policy"
  | "executing"
  | "completed"
  | "rejected"
  | "failed";

export type ProcurementTask = {
  taskId: string;
  status: TaskStatus;
  request: ProcurementRequest;
  enterpriseAddress?: string;
  selectedProvider?: ProviderOffer;
  policy?: PolicyEvaluation;
  execution?: KeeperHubExecutionResult;
  timeline: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Set once the external agent has written the matching receipt on-chain (see lib/chain/registry.ts). */
  onChainTransactionHash?: string;
};

/**
 * What an external agent POSTs to `report` after executing a procurement
 * itself (discovery/policy fetched from this server, execution + on-chain
 * receipt done on its own machine — see agent-skills/scripts/cli). Loosely
 * validated and passed through: the agent is the one that knows the full
 * shape of what it did, this just guarantees the fields the dashboard and
 * the ERC-8004 gate need are present.
 */
export const ProcurementReportSchema = z
  .object({
    taskId: z.string().min(1),
    status: z.enum(["completed", "rejected", "failed", "dispatched", "authenticating", "discovering", "evaluating_policy", "executing"]),
    request: ProcurementRequestSchema,
  })
  .passthrough();
export type ProcurementReport = z.infer<typeof ProcurementReportSchema>;

export type KeeperHubExecutionResult = {
  mode: "direct" | "workflow" | "demo";
  executed: boolean;
  executionId?: string;
  status: string;
  transactionHash?: string;
  condition?: {
    met: boolean;
    observedApyBps: number;
    targetApyBps: number;
  };
  idempotencyKey?: string;
  raw?: unknown;
};
