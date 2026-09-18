import { createPublicClient, createWalletClient, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { DEFAULT_FAUCET_ADDRESS, DEFAULT_USDC_ADDRESS, FAUCET_ABI, USDC_DECIMALS } from "./faucetAbi";

/**
 * Server-signed path: mints Aave's Base Sepolia test USDC to an arbitrary
 * address via Aave's own permissionless `Faucet` contract (`mint(address
 * token, address to, uint256 amount)` — callable by any gas-funded wallet,
 * minting to any recipient, no private key for the recipient needed).
 *
 * Signs with `ENTERPRISE_ADMIN_PRIVATE_KEY` — the same "enterprise admin's
 * own signer" already used for the ERC-8004 identity-registration panel
 * (`lib/identity/register.ts`) when no wallet is connected in the browser,
 * and already expected to hold a little Base Sepolia ETH for gas. Never any
 * agent's own key, and never a `ProcurementRegistry`-administration key
 * either — that allowlist has no platform key at all; it's administered
 * only by whichever connected wallet owns the registry (see
 * `lib/chain/registryBrowser.ts`). See `faucetBrowser.ts` for the
 * connected-wallet counterpart.
 */

function getRpcUrl(): string {
  return process.env.RPC_URL || "https://sepolia.base.org";
}

function getFaucetAddress(): Address {
  return (process.env.FAUCET_CONTRACT_ADDRESS as Address | undefined) || DEFAULT_FAUCET_ADDRESS;
}

function getUsdcAddress(): Address {
  return (process.env.FAUCET_USDC_ADDRESS as Address | undefined) || DEFAULT_USDC_ADDRESS;
}

function getPublicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http(getRpcUrl()) });
}

function getSignerWalletClient() {
  const key = process.env.ENTERPRISE_ADMIN_PRIVATE_KEY;
  if (!key) throw new Error("ENTERPRISE_ADMIN_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount(key as Hex);
  return createWalletClient({ account, chain: baseSepolia, transport: http(getRpcUrl()) });
}

export function isFaucetConfigured(): boolean {
  return Boolean(process.env.ENTERPRISE_ADMIN_PRIVATE_KEY);
}

export function getFaucetConfig(): { faucet: Address; token: Address; decimals: number; configured: boolean } {
  return { faucet: getFaucetAddress(), token: getUsdcAddress(), decimals: USDC_DECIMALS, configured: isFaucetConfigured() };
}

/** `amount` is a human-readable USDC amount, e.g. "2" or "2.5". */
export async function mintTestUsdcOnChain(
  to: Address,
  amount: string,
): Promise<{ transactionHash: Hex; token: Address; faucet: Address; to: Address; amount: string }> {
  const amountRaw = parseUnits(amount, USDC_DECIMALS);
  if (amountRaw <= 0n) throw new Error("amount must be greater than 0");

  const wallet = getSignerWalletClient();
  const publicClient = getPublicClient();
  const token = getUsdcAddress();
  const faucet = getFaucetAddress();

  const hash = await wallet.writeContract({
    address: faucet,
    abi: FAUCET_ABI,
    functionName: "mint",
    args: [token, to, amountRaw],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  return { transactionHash: hash, token, faucet, to, amount };
}
