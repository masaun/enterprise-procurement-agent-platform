import { createPublicClient, createWalletClient, custom, parseUnits, type Address, type EIP1193Provider, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { DEFAULT_FAUCET_ADDRESS, DEFAULT_USDC_ADDRESS, FAUCET_ABI, USDC_DECIMALS } from "./faucetAbi";

/**
 * Browser counterpart to `faucet.ts`: mints Aave's Base Sepolia test USDC via
 * whatever wallet the admin connected via "Connect Wallet" — that wallet
 * pays its own gas, instead of the platform's `ENTERPRISE_ADMIN_PRIVATE_KEY`.
 * This never runs server-side and never touches `process.env`'s server-only
 * secrets; the only env vars it reads are the `NEXT_PUBLIC_`-prefixed
 * overrides below, which Next.js inlines into the client bundle at build
 * time.
 */

function getFaucetAddress(): Address {
  return (process.env.NEXT_PUBLIC_FAUCET_CONTRACT_ADDRESS as Address | undefined) || DEFAULT_FAUCET_ADDRESS;
}

function getUsdcAddress(): Address {
  return (process.env.NEXT_PUBLIC_FAUCET_USDC_ADDRESS as Address | undefined) || DEFAULT_USDC_ADDRESS;
}

export async function mintTestUsdcWithConnectedWallet(
  provider: EIP1193Provider,
  signerAddress: Hex,
  to: Address,
  amount: string,
): Promise<{ transactionHash: Hex; token: Address; faucet: Address; to: Address; amount: string }> {
  const amountRaw = parseUnits(amount, USDC_DECIMALS);
  if (amountRaw <= 0n) throw new Error("amount must be greater than 0");

  const transport = custom(provider);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account: signerAddress, chain: baseSepolia, transport });
  const token = getUsdcAddress();
  const faucet = getFaucetAddress();

  const hash = await walletClient.writeContract({
    address: faucet,
    abi: FAUCET_ABI,
    functionName: "mint",
    args: [token, to, amountRaw],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  return { transactionHash: hash, token, faucet, to, amount };
}
