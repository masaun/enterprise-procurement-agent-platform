import { isAddress, type Address } from "viem";
import { getFaucetConfig, mintTestUsdcOnChain } from "@/lib/chain/faucet";

/**
 * Admin-only platform route (not an agent-facing Lucid entrypoint) backing
 * the dashboard's "Faucet" panel — lets the enterprise admin mint Aave's
 * Base Sepolia test USDC straight to any wallet (e.g. KeeperHub's execution
 * wallet, whose private key this app never holds) via Aave's own
 * permissionless `Faucet` contract. See `lib/chain/faucet.ts`.
 */
export async function GET() {
  return Response.json(getFaucetConfig());
}

export async function POST(request: Request) {
  const config = getFaucetConfig();
  if (!config.configured) {
    return Response.json(
      { error: "faucet_not_configured", message: "ENTERPRISE_ADMIN_PRIVATE_KEY is not set" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to.trim() : undefined;
  const amount = typeof body.amount === "string" ? body.amount.trim() : typeof body.amount === "number" ? String(body.amount) : undefined;

  if (!to || !isAddress(to)) {
    return Response.json({ error: "invalid_request", message: "to must be a valid EVM address" }, { status: 400 });
  }
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return Response.json({ error: "invalid_request", message: "amount must be a positive number" }, { status: 400 });
  }

  try {
    const result = await mintTestUsdcOnChain(to as Address, amount);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: "mint_failed", message: (err as Error).message }, { status: 502 });
  }
}
