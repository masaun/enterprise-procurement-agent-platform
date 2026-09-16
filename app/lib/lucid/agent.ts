import { createAgent } from "@lucid-agents/core";
import { http } from "@lucid-agents/http";
import { wallets } from "@lucid-agents/wallet";
import { identity, identityFromEnv } from "@lucid-agents/identity";
import { payments, paymentsFromEnv } from "@lucid-agents/payments";
import { a2a } from "@lucid-agents/a2a";
import { ap2 } from "@lucid-agents/ap2";
import { z } from "zod";
import { ProcurementReportSchema, type ProcurementTask } from "@/lib/types";
import { discoverOffers } from "@/lib/lucid/orchestrate";
import { getTask, saveTask } from "@/lib/store";
import { getConfiguredPolicy } from "@/lib/keeperhub/policy";
import { isAgentAuthorizedOnChain, isRegistryConfigured } from "@/lib/chain/registry";
import type { Address } from "viem";

/**
 * The Procurement Agent's remaining agent-facing surface — now a
 * management-platform contract, not an execution one. `app/api/agent/[...lucid]/route.ts`
 * mounts `runtime.http.routes` directly, so every entrypoint below is
 * reachable as real A2A/HTTP:
 *
 *   GET  /api/agent/.well-known/agent-card.json   (A2A discovery + ERC-8004 + AP2)
 *   POST /api/agent/entrypoints/authenticate/invoke   (SIWX, auth-only)
 *   POST /api/agent/entrypoints/discover/invoke       (A2A preview — platform-hosted market data)
 *   GET  /api/agent/entrypoints/policy/invoke         (current policy, read-only for agents)
 *   POST /api/agent/entrypoints/report/invoke         (SIWX + on-chain ERC-8004 allowlist gated —
 *                                                       an external agent reports a procurement it
 *                                                       already executed itself; replaces the old
 *                                                       `procure` entrypoint, which used to run the
 *                                                       whole pipeline server-side)
 *   POST /api/agent/tasks, GET /api/agent/tasks/:taskId, ...  (A2A tasks)
 */

export function resolveAppOrigin(): string {
  return (
    process.env.SIWX_PUBLIC_ORIGIN ||
    process.env.PAYMENTS_PUBLIC_ORIGIN ||
    process.env.APP_PUBLIC_ORIGIN ||
    "http://localhost:3000"
  );
}

function buildIdentityConfig() {
  if (process.env.AGENT_DOMAIN && process.env.RPC_URL) {
    // Live ERC-8004 resolution against a real Identity Registry contract.
    return identityFromEnv({
      registration: {
        selectedServices: ["A2A", "web", "OASF"],
        website: `https://${process.env.AGENT_DOMAIN}`,
        oasf: {
          authors: ["Enterprise Procurement Demo"],
          skills: ["procurement", "defi-yield-sourcing"],
          domains: ["finance", "defi"],
          modules: [],
          locators: [],
        },
      },
    });
  }

  // No live registry configured: advertise a static, self-declared identity
  // so the agent card still carries ERC-8004 trust metadata out of the box.
  return {
    trust: {
      registrations: [
        {
          agentId: process.env.IDENTITY_AGENT_ID || "1",
          agentRegistry: `eip155:${process.env.CHAIN_ID || "84532"}:0x0000000000000000000000000000000000000001`,
        },
      ],
      trustModels: ["feedback", "inference-validation"],
    },
  };
}

function buildPaymentsConfig() {
  return paymentsFromEnv({
    payTo: (process.env.PAYMENTS_RECEIVABLE_ADDRESS as `0x${string}` | undefined) ?? "0x0000000000000000000000000000000000000000",
    network: (process.env.PAYMENTS_NETWORK || "eip155:84532") as `${string}:${string}`,
    facilitatorUrl: process.env.PAYMENTS_FACILITATOR_URL || "https://x402.org/facilitator",
    siwx: {
      enabled: true,
      origin: resolveAppOrigin(),
      defaultStatement: "Sign in to authorize the Enterprise Procurement Agent to act on this treasury's behalf.",
      expirationSeconds: 300,
      storage: { type: "in-memory" },
    },
  });
}

function buildRuntime() {
  return createAgent({
    name: "enterprise-procurement-agent",
    version: "1.0.0",
    description:
      'Discovers and buys blockchain services on behalf of an enterprise treasury — e.g. "Move 1M USDC to an approved lending protocol, but only if APY > 4%." Lucid decides who to buy from; KeeperHub decides how to execute.',
  })
    .use(wallets({ config: undefined }))
    .use(identity({ config: buildIdentityConfig() }))
    .use(payments({ config: buildPaymentsConfig() }))
    .use(a2a({ tasks: { maxTasks: 1_000, retentionMs: 24 * 60 * 60 * 1_000, maxRunMs: 5 * 60 * 1_000 } }))
    .use(ap2({ roles: ["shopper"], description: "Buys DeFi yield services on behalf of an enterprise treasury." }))
    .use(http({ basePath: "/api/agent", servicePage: { preset: "console" } }))
    .addEntrypoint({
      key: "authenticate",
      description: "Authenticate the enterprise wallet via SIWX. No payment, no side effects.",
      siwx: { authOnly: true },
      handler: async ({ auth }) => ({
        output: { address: auth?.address, chainId: auth?.chainId, scheme: auth?.scheme },
      }),
    })
    .addEntrypoint({
      key: "discover",
      description: 'Discover candidate service providers via A2A/Agent Cards — Lucid\'s "who should I buy from?" step, with no purchase and no KeeperHub call.',
      handler: async () => {
        const { offers, timeline } = await discoverOffers(resolveAppOrigin());
        return { output: { offers, timeline } };
      },
    })
    .addEntrypoint({
      key: "policy",
      description: "The enterprise's current KeeperHub execution policy (max amount, allowed assets/protocols, min APY).",
      handler: async () => ({ output: getConfiguredPolicy() }),
    })
    .addEntrypoint({
      key: "report",
      description:
        "Report a procurement task this agent already discovered, evaluated against policy, executed via its own KeeperHub key, and recorded on-chain (ProcurementRegistry). Gated by SIWX plus the platform's on-chain ERC-8004 allowlist — see lib/identity/gate.ts and the /api/agents/authorized admin route that populates it.",
      input: ProcurementReportSchema,
      siwx: { authOnly: true },
      handler: async ({ input, auth }) => {
        // `siwx: { authOnly: true }` above already rejects an unsigned/invalid
        // request before this handler runs, so `auth.address` is guaranteed here.
        if (!isRegistryConfigured()) {
          throw new Error("registry_not_configured: PROCUREMENT_REGISTRY_ADDRESS is not set");
        }
        const authorized = await isAgentAuthorizedOnChain(auth!.address as Address);
        if (!authorized) {
          throw new Error(`agent_not_authorized: ${auth!.address} is not on the on-chain authorizedAgents allowlist`);
        }
        const now = new Date().toISOString();
        const inputTimeline = (input as { timeline?: ProcurementTask["timeline"] }).timeline ?? [];
        const task = {
          ...input,
          enterpriseAddress: input.enterpriseAddress ?? auth!.address,
          timeline: [
            ...inputTimeline,
            { kind: "erc8004.gate_checked", label: `Verified ${auth!.address} against the on-chain authorizedAgents allowlist`, at: now },
            { kind: "report.received", label: "Platform accepted the reported task for the dashboard", at: now },
          ],
        } as unknown as ProcurementTask;
        saveTask(task);
        return { output: task };
      },
    })
    .addEntrypoint({
      key: "procurement_status",
      description: "Look up a previously submitted procurement task by id.",
      input: z.object({ taskId: z.string() }),
      handler: async ({ input }) => {
        const task = getTask(input.taskId);
        return { output: task ?? { found: false, taskId: input.taskId } };
      },
    })
    .build();
}

let runtimePromise: ReturnType<typeof buildRuntime> | undefined;

/** Module-level singleton — rebuilding on every request would re-run identity/payments bootstrap. */
export function getProcurementAgentRuntime() {
  if (!runtimePromise) {
    runtimePromise = buildRuntime();
  }
  return runtimePromise;
}
