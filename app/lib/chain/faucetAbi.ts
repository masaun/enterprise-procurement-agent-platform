import type { Address } from "viem";

/**
 * Shared, isomorphic constants for Aave's Base Sepolia test-USDC faucet —
 * imported by both the server-signed path (`faucet.ts`, `ENTERPRISE_ADMIN_PRIVATE_KEY`)
 * and the browser-signed path (`faucetBrowser.ts`, a connected wallet). See
 * agent-demo/README.md's "Base Sepolia token addresses & faucets" section
 * for how these were found and verified against bgd-labs/aave-address-book.
 */

export const DEFAULT_FAUCET_ADDRESS: Address = "0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc";
export const DEFAULT_USDC_ADDRESS: Address = "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f";
export const USDC_DECIMALS = 6;

export const FAUCET_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
