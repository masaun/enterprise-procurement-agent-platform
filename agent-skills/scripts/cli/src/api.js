import { buildSiwxFetch } from "./siwx.js";

async function asJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function getHealth(config) {
  const res = await fetch(`${config.baseUrl}/api/health`);
  return asJson(res);
}

export async function getAgentCard(config, providerId) {
  const path = providerId
    ? `/api/mock-providers/${providerId}/.well-known/agent-card.json`
    : `/api/agent/.well-known/agent-card.json`;
  const res = await fetch(`${config.baseUrl}${path}`);
  return asJson(res);
}

async function invoke(config, key, input = {}, { siwx = false } = {}) {
  const url = `${config.baseUrl}/api/agent/entrypoints/${key}/invoke`;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  };

  let fetchImpl = fetch;
  let address;
  if (siwx) {
    const bound = buildSiwxFetch(config);
    fetchImpl = bound.fetch;
    address = bound.address;
  }

  const res = await fetchImpl(url, init);
  const body = await asJson(res);
  if (!res.ok) {
    const message = body?.body?.error?.message || body?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return { ...body, _signerAddress: address };
}

export async function discoverProviders(config) {
  return invoke(config, "discover");
}

export async function getPolicy(config) {
  return invoke(config, "policy");
}

export async function authenticate(config) {
  return invoke(config, "authenticate", {}, { siwx: true });
}

export async function submitProcurement(config, request) {
  return invoke(config, "procure", request, { siwx: true });
}

export async function getTaskStatus(config, taskId) {
  return invoke(config, "procurement_status", { taskId });
}

export async function callMcpTool(config, toolName, args) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (config.mcpApiKey) headers.Authorization = `Bearer ${config.mcpApiKey}`;

  const call = async (body) => {
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
