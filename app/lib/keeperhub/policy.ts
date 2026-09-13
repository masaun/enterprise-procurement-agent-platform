import type { Policy, PolicyEvaluation, ProcurementRequest } from "@/lib/types";

/**
 * The policy KeeperHub enforces before it will ever sign a transaction.
 * This is intentionally separate from the Lucid/A2A discovery step: Lucid
 * decides *who* the enterprise could buy from, but KeeperHub is the layer
 * that enterprises actually trust with treasury movement, so it re-checks
 * the same constraints independently before execution.
 */
export function getConfiguredPolicy(): Policy {
  return {
    maxUsdPerTask: Number(process.env.POLICY_MAX_USD_PER_TASK ?? 1_000_000),
    minApyBps: Number(process.env.POLICY_MIN_APY_BPS ?? 400),
    allowedAssets: (process.env.POLICY_ALLOWED_ASSETS ?? "USDC")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    allowedProtocols: (process.env.POLICY_ALLOWED_PROTOCOLS ?? "aave-v3,compound-v3,morpho")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function evaluatePolicy(
  request: ProcurementRequest,
  candidate: { protocol: string; apyBps: number },
  policy: Policy = getConfiguredPolicy(),
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
