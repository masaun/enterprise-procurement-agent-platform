import type { ProviderOffer } from "@/lib/types";

/**
 * Seed data for the lending-protocol "gateway agents" this demo discovers.
 *
 * Each entry backs a tiny, real Lucid Agent runtime mounted at
 * `/api/mock-providers/<id>/...` (see `lib/lucid/mock-provider-agent.ts`).
 * The procurement agent talks to them with the exact same
 * `@lucid-agents/a2a` client calls (`fetchAgentCardWithEntrypoints`,
 * `invokeAgent`) it would use against a real external counterparty — these
 * three are simply this repo playing the "provider" role too, so the whole
 * A2A round trip is real and not mocked at the network boundary. Only the
 * economics (protocol, APY) are illustrative.
 */
export type MockProviderSpec = {
  id: string;
  name: string;
  description: string;
  protocol: string;
  asset: string;
  network: string;
  baseApyBps: number;
  jitterBps: number;
  trustModels: string[];
  agentRegistry: string;
  agentId: string;
  rateContract: ProviderOffer["rateContract"];
  supplyContract: ProviderOffer["supplyContract"];
};

export const MOCK_PROVIDERS: MockProviderSpec[] = [
  {
    id: "aave-v3-gateway",
    name: "Aave v3 Gateway Agent",
    description: "ERC-8004 registered gateway agent quoting Aave v3 USDC supply APY on Base Sepolia.",
    protocol: "aave-v3",
    asset: "USDC",
    network: "eip155:84532",
    baseApyBps: 320,
    jitterBps: 15,
    trustModels: ["feedback"],
    agentRegistry: "eip155:84532:0x2e234dae75c793f67a35089c9d99245e1c58470b",
    agentId: "1001",
    rateContract: {
      address: "0x6ae43d3271ff6888e7fc43fd7321a503ff738951",
      functionName: "getReserveAPY",
      functionArgs: '["0xUSDC"]',
    },
    supplyContract: {
      address: "0x6ae43d3271ff6888e7fc43fd7321a503ff738951",
      functionName: "supply",
      argsTemplate: '["{{asset}}", "{{amount}}", "{{onBehalfOf}}", 0]',
    },
  },
  {
    id: "compound-v3-gateway",
    name: "Compound v3 Gateway Agent",
    description: "ERC-8004 registered gateway agent quoting Compound v3 (Comet) USDC supply APY on Base Sepolia.",
    protocol: "compound-v3",
    asset: "USDC",
    network: "eip155:84532",
    baseApyBps: 480,
    jitterBps: 25,
    trustModels: ["feedback", "inference-validation"],
    agentRegistry: "eip155:84532:0x3af6d3271ff6888e7fc43fd7321a503ff738a12",
    agentId: "1002",
    rateContract: {
      address: "0x9a1e2271ff6888e7fc43fd7321a503ff738b455",
      functionName: "getSupplyRate",
      functionArgs: '["0xUSDC"]',
    },
    supplyContract: {
      address: "0x9a1e2271ff6888e7fc43fd7321a503ff738b455",
      functionName: "supply",
      argsTemplate: '["{{asset}}", "{{amount}}"]',
    },
  },
  {
    id: "morpho-gateway",
    name: "Morpho Gateway Agent",
    description: "ERC-8004 registered gateway agent quoting a Morpho USDC vault APY on Base Sepolia.",
    protocol: "morpho",
    asset: "USDC",
    network: "eip155:84532",
    baseApyBps: 560,
    jitterBps: 30,
    trustModels: ["feedback", "tee-attestation"],
    agentRegistry: "eip155:84532:0x71b4d3271ff6888e7fc43fd7321a503ff738c99",
    agentId: "1003",
    rateContract: {
      address: "0x84c2e271ff6888e7fc43fd7321a503ff738d221",
      functionName: "convertToAssets",
      functionArgs: '["1000000000000000000"]',
    },
    supplyContract: {
      address: "0x84c2e271ff6888e7fc43fd7321a503ff738d221",
      functionName: "deposit",
      argsTemplate: '["{{amount}}", "{{onBehalfOf}}"]',
    },
  },
  {
    id: "yearn-unlisted-gateway",
    name: "Yearn Gateway Agent (unlisted)",
    description: "A yield gateway agent that is discoverable via A2A but is NOT on this enterprise's approved-protocol policy list — demonstrates policy rejection even when APY looks attractive.",
    protocol: "yearn",
    asset: "USDC",
    network: "eip155:84532",
    baseApyBps: 910,
    jitterBps: 40,
    trustModels: ["feedback"],
    agentRegistry: "eip155:84532:0x55f6d3271ff6888e7fc43fd7321a503ff738e33",
    agentId: "1004",
    rateContract: {
      address: "0x12a3e271ff6888e7fc43fd7321a503ff738f110",
      functionName: "pricePerShare",
      functionArgs: "[]",
    },
    supplyContract: {
      address: "0x12a3e271ff6888e7fc43fd7321a503ff738f110",
      functionName: "deposit",
      argsTemplate: '["{{amount}}", "{{onBehalfOf}}"]',
    },
  },
];

/** Deterministic-ish small jitter so repeated quotes look "live" without a real oracle. */
export function liveApyBps(spec: MockProviderSpec, seed: number = Date.now()): number {
  const wave = Math.sin(seed / 45_000 + spec.baseApyBps) * spec.jitterBps;
  return Math.max(0, Math.round(spec.baseApyBps + wave));
}
