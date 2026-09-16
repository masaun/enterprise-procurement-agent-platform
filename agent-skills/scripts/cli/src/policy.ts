/**
 * The enterprise's treasury-risk policy check — ported from
 * `app/lib/keeperhub/policy.ts`. Duplicated rather than shared: this CLI and
 * the Next.js server are two independent npm projects with no workspace
 * linkage. The server still owns and serves the *policy values themselves*
 * (fetched via `procure policy` / `api.getPolicy`, editable by the human
 * admin on the dashboard) — this module only evaluates a candidate offer
 * against whatever policy the server returned, which is the actual buy/no-buy
 * decision this CLI (the actor) now makes locally.
 */

export type ProcurementRequest = {
  instruction: string;
  asset: string;
  amount: string;
  minApyBps: number;
  allowedProtocols?: string[];
};

export type Policy = {
  maxUsdPerTask: number;
  minApyBps: number;
  allowedAssets: string[];
  allowedProtocols: string[];
};

export type PolicyEvaluation = {
  allowed: boolean;
  policy: Policy;
  reasons: string[];
};

export function evaluatePolicy(
  request: ProcurementRequest,
  candidate: { protocol: string; apyBps: number },
  policy: Policy,
): PolicyEvaluation {
  const reasons: string[] = [];

  const amount = Number(request.amount);
  if (Number.isFinite(amount) && amount > policy.maxUsdPerTask) {
    reasons.push(
      `Requested amount ${amount.toLocaleString()} ${request.asset} exceeds the policy cap of ${policy.maxUsdPerTask.toLocaleString()} per task.`,
    );
  }

  if (!policy.allowedAssets.includes(request.asset.toUpperCase())) {
    reasons.push(`Asset ${request.asset} is not on the allowed-assets list (${policy.allowedAssets.join(", ")}).`);
  }

  if (!policy.allowedProtocols.includes(candidate.protocol.toLowerCase())) {
    reasons.push(
      `Protocol ${candidate.protocol} is not on the approved-protocol list (${policy.allowedProtocols.join(", ")}).`,
    );
  }

  const requiredApyBps = Math.max(policy.minApyBps, request.minApyBps);
  if (candidate.apyBps < requiredApyBps) {
    reasons.push(
      `Observed APY ${(candidate.apyBps / 100).toFixed(2)}% is below the required ${(requiredApyBps / 100).toFixed(2)}%.`,
    );
  }

  return { allowed: reasons.length === 0, policy, reasons };
}
