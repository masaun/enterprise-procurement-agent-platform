import { buildSiwxFetch } from "./siwx.ts";
import type { CliConfig } from "./config.ts";
import type { Address } from "viem";

async function asJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function getHealth(config: CliConfig): Promise<any> {
  const res = await fetch(`${config.baseUrl}/api/health`);
  return asJson(res);
}

export async function getAgentCard(config: CliConfig, providerId?: string): Promise<any> {
  const path = providerId
    ? `/api/mock-providers/${providerId}/.well-known/agent-card.json`
    : `/api/agent/.well-known/agent-card.json`;
  const res = await fetch(`${config.baseUrl}${path}`);
  return asJson(res);
}

async function invoke(
  config: CliConfig,
  key: string,
  input: Record<string, unknown> = {},
  { siwx = false }: { siwx?: boolean } = {},
): Promise<any> {
  const url = `${config.baseUrl}/api/agent/entrypoints/${key}/invoke`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  };

  let fetchImpl: typeof fetch = fetch;
  let address: Address | undefined;
  if (siwx) {
    const bound = buildSiwxFetch(config);
    fetchImpl = bound.fetch;
    address = bound.address;
  }

  const res = await fetchImpl(url, init);
  const body = await asJson(res);
  if (!res.ok) {
    const message =
      body?.body?.error?.message ||
      (typeof body?.error === "string" ? body.error : body?.error?.message) ||
      `HTTP ${res.status}`;
    throw new Error(message);
  }
  return { ...body, _signerAddress: address };
}

export async function discoverProviders(config: CliConfig): Promise<any> {
  return invoke(config, "discover");
}

export async function getPolicy(config: CliConfig): Promise<any> {
  return invoke(config, "policy");
}

export async function authenticate(config: CliConfig): Promise<any> {
  return invoke(config, "authenticate", {}, { siwx: true });
}

/**
 * Reports a procurement task this CLI already discovered, evaluated, and
 * executed (via its own KeeperHub key) back to the platform for the
 * dashboard's activity/receipt history. Gated the same way `authenticate`
 * is (SIWX) plus the platform's on-chain ERC-8004 allowlist check — see
 * `app/lib/lucid/agent.ts`'s `report` entrypoint and `app/lib/identity/gate.ts`.
 * Replaces the old `procure` entrypoint, which used to run the whole
 * pipeline server-side.
 */
export async function reportProcurement(config: CliConfig, task: Record<string, unknown>): Promise<any> {
  return invoke(config, "report", task, { siwx: true });
}

export async function getTaskStatus(config: CliConfig, taskId: string): Promise<any> {
  return invoke(config, "procurement_status", { taskId });
}

export async function callMcpTool(config: CliConfig, toolName: string, args: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (config.mcpApiKey) headers.Authorization = `Bearer ${config.mcpApiKey}`;

  const call = async (body: Record<string, unknown>): Promise<any> => {
    const res = await fetch(`${config.baseUrl}/api/agent/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    const payload = line ? JSON.parse(line.slice(5)) : JSON.parse(text);
    if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return payload.result;
  };

  await call({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "procure-cli", version: "1.0.0" } },
  });
  return call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } });
}
