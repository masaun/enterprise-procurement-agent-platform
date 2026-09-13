import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithSIWx } from "@lucid-agents/payments";

/**
 * Real SIWX auth for the CLI: signs with the configured private key (the
 * agent operator's actual treasury signer in production) via viem, and
 * completes the same challenge/verify cycle as the browser demo — both
 * paths call the identical server-side verifier in `@lucid-agents/payments`,
 * so there's nothing CLI-specific about how auth is checked.
 */
export function buildSiwxFetch(config) {
  const key = config.privateKey || generatePrivateKey();
  if (!config.privateKey) {
    process.stderr.write(
      "warning: no PROCURE_PRIVATE_KEY / `procure config set privateKey ...` configured — using a throwaway signer for this call only.\n",
    );
  }
  const account = privateKeyToAccount(key);
  const chainId = process.env.PROCURE_CHAIN_ID || "84532";

  const signer = {
    signMessage: (message) => account.signMessage({ message }),
    getAddress: async () => account.address,
    getChainId: async () => `eip155:${chainId}`,
  };

  return { fetch: wrapFetchWithSIWx(fetch, signer), address: account.address };
}
