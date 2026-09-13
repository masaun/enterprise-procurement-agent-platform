import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithSIWx, type SIWxSigner } from "@lucid-agents/payments";

/**
 * Stands in for the enterprise's real wallet (a hardware wallet, a
 * custodian's signing API, a browser extension) for this demo. It performs
 * real EIP-191 signing via viem and a real SIWX challenge/sign/retry cycle
 * via `@lucid-agents/payments`' `wrapFetchWithSIWx` — the only thing that's
 * simulated is *where* the private key lives. Swap this module for a real
 * signer (WalletConnect, a KMS call, etc.) without touching anything else;
 * every downstream verification is genuine.
 */

function loadOrCreateDemoAccount() {
  const key = (process.env.ENTERPRISE_DEMO_PRIVATE_KEY as `0x${string}` | undefined) || generatePrivateKey();
  return privateKeyToAccount(key);
}

let cachedAccount: ReturnType<typeof loadOrCreateDemoAccount> | undefined;

export function getEnterpriseDemoAccount() {
  if (!cachedAccount) cachedAccount = loadOrCreateDemoAccount();
  return cachedAccount;
}

export function getEnterpriseSiwxFetch(): typeof fetch {
  const account = getEnterpriseDemoAccount();
  const signer: SIWxSigner = {
    signMessage: (message: string) => account.signMessage({ message }),
    getAddress: async () => account.address,
    getChainId: async () => `eip155:${process.env.CHAIN_ID || "84532"}`,
  };
  return wrapFetchWithSIWx(fetch, signer) as typeof fetch;
}
