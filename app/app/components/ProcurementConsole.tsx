"use client";

import { useEffect, useState } from "react";
import { Timeline } from "@/app/components/Timeline";
import type { Policy, ProcurementTask, ProviderOffer } from "@/lib/types";

const DEFAULT_INSTRUCTION =
  "Move 2 USDC from our treasury to an approved lending protocol, but only if APY > 1%.";

type WebhookPlatform = "hermes" | "openclaw" | "generic";
type Subscriber = { id: string; name: string; platform: WebhookPlatform; url: string; secret: "(set)"; active: boolean; createdAt: string };
type AuthorizedAgent = {
  address: string;
  agentId: string;
  active: boolean;
  addedAt: string;
  verification: { verified: boolean; onChainWallet?: string; reputation?: { count: number; value: number; valueDecimals: number }; reason?: string };
};
type IdentityRegistrationResult = { agentId?: string; agentAddress: string; transactionHash: string };
type OnChainReceipt = {
  taskId: string;
  enterprise: string;
  agent: string;
  status: "completed" | "rejected" | "failed";
  asset: string;
  amount: string;
  apyBps: number;
  transactionHash: string;
  detail: ProcurementTask | null;
};

export function ProcurementConsole() {
  const [providers, setProviders] = useState<ProviderOffer[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyDraft, setPolicyDraft] = useState<{ maxUsdPerTask: string; minApyBps: string; allowedAssets: string; allowedProtocols: string } | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [amount, setAmount] = useState("2");
  const [asset, setAsset] = useState("USDC");
  const [minApy, setMinApy] = useState("1.0");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchSummary, setDispatchSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [newSub, setNewSub] = useState({ name: "", platform: "generic" as WebhookPlatform, url: "", secret: "" });
  const [addingSub, setAddingSub] = useState(false);

  const [authorizedAgents, setAuthorizedAgents] = useState<AuthorizedAgent[] | null>(null);
  const [newAgent, setNewAgent] = useState({ address: "", agentId: "" });
  const [addingAgent, setAddingAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [identityDraft, setIdentityDraft] = useState({ agentURI: "" });
  const [registeringIdentity, setRegisteringIdentity] = useState(false);
  const [identityResult, setIdentityResult] = useState<IdentityRegistrationResult | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const [receipts, setReceipts] = useState<OnChainReceipt[] | null>(null);
  const [dispatchedPending, setDispatchedPending] = useState<ProcurementTask[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [registryConfigured, setRegistryConfigured] = useState(true);

  useEffect(() => {
    void refreshProviders();
    void refreshPolicy();
    void refreshSubscribers();
    void refreshAuthorizedAgents();
    void refreshHistory();
  }, []);

  async function refreshProviders() {
    const res = await fetch("/api/providers").catch(() => undefined);
    if (!res?.ok) return;
    const body = await res.json();
    setProviders(body.offers ?? []);
  }

  async function refreshPolicy() {
    const res = await fetch("/api/policy").catch(() => undefined);
    if (!res?.ok) return;
    const body = (await res.json()) as Policy;
    setPolicy(body);
    setPolicyDraft({
      maxUsdPerTask: String(body.maxUsdPerTask),
      minApyBps: (body.minApyBps / 100).toFixed(2),
      allowedAssets: body.allowedAssets.join(", "),
      allowedProtocols: body.allowedProtocols.join(", "),
    });
  }

  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!policyDraft) return;
    setSavingPolicy(true);
    try {
      const res = await fetch("/api/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxUsdPerTask: Number(policyDraft.maxUsdPerTask),
          minApyBps: Math.round(parseFloat(policyDraft.minApyBps || "0") * 100),
          allowedAssets: policyDraft.allowedAssets.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
          allowedProtocols: policyDraft.allowedProtocols.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
        }),
      });
      if (res.ok) setPolicy(await res.json());
    } finally {
      setSavingPolicy(false);
    }
  }

  async function refreshSubscribers() {
    const res = await fetch("/api/webhooks/subscribers").catch(() => undefined);
    if (!res?.ok) return;
    const body = await res.json();
    setSubscribers(body.subscribers ?? []);
  }

  async function addSubscriber(e: React.FormEvent) {
    e.preventDefault();
    setAddingSub(true);
    try {
      const res = await fetch("/api/webhooks/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSub),
      });
      if (res.ok) {
        setNewSub({ name: "", platform: "generic", url: "", secret: "" });
        void refreshSubscribers();
      }
    } finally {
      setAddingSub(false);
    }
  }

  async function removeSubscriber(id: string) {
    await fetch(`/api/webhooks/subscribers/${id}`, { method: "DELETE" }).catch(() => undefined);
    void refreshSubscribers();
  }

  async function registerIdentity(e: React.FormEvent) {
    e.preventDefault();
    setRegisteringIdentity(true);
    setIdentityError(null);
    setIdentityResult(null);
    try {
      const res = await fetch("/api/agents/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentURI: identityDraft.agentURI }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Registration failed");
      setIdentityResult(body as IdentityRegistrationResult);
    } catch (e) {
      setIdentityError((e as Error).message);
    } finally {
      setRegisteringIdentity(false);
    }
  }

  async function refreshAuthorizedAgents() {
    const res = await fetch("/api/agents/authorized").catch(() => undefined);
    if (!res?.ok) return;
    const body = await res.json();
    setAuthorizedAgents(body.agents ?? []);
  }

  async function addAuthorizedAgent(e: React.FormEvent) {
    e.preventDefault();
    setAddingAgent(true);
    setAgentError(null);
    try {
      const res = await fetch("/api/agents/authorized", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAgent),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.verification?.reason || body?.message || "Verification failed");
      setNewAgent({ address: "", agentId: "" });
      void refreshAuthorizedAgents();
    } catch (e) {
      setAgentError((e as Error).message);
    } finally {
      setAddingAgent(false);
    }
  }

  async function revokeAgent(address: string) {
    await fetch(`/api/agents/authorized/${address}`, { method: "DELETE" }).catch(() => undefined);
    void refreshAuthorizedAgents();
  }

  async function refreshHistory() {
    const res = await fetch("/api/procurement-history").catch(() => undefined);
    if (!res?.ok) return;
    const body = await res.json();
    setRegistryConfigured(Boolean(body.registryConfigured));
    setReceipts(body.receipts ?? []);
    setDispatchedPending(body.dispatched ?? []);
  }

  async function dispatchIntent(e: React.FormEvent) {
    e.preventDefault();
    setDispatching(true);
    setError(null);
    setDispatchSummary(null);
    try {
      const minApyBps = Math.round(parseFloat(minApy || "0") * 100);
      const res = await fetch("/api/procurement-intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, asset, amount, minApyBps }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Failed to dispatch procurement intent");
      const okCount = (body.dispatch ?? []).filter((d: { ok: boolean }) => d.ok).length;
      const total = (body.dispatch ?? []).length;
      setDispatchSummary(
        total === 0
          ? "Intent recorded, but no active webhook subscribers to dispatch to — add one below."
          : `Dispatched to ${okCount}/${total} subscriber(s).`,
      );
      void refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDispatching(false);
    }
  }

  return (
    <>
      <div className="grid">
        <div>
          <div className="card">
            <h2>
              <span className="step">1</span>KeeperHub policy
            </h2>
            {policyDraft ? (
              <form onSubmit={savePolicy}>
                <div className="field-row">
                  <div className="field">
                    <label>Max USD per task</label>
                    <input
                      value={policyDraft.maxUsdPerTask}
                      onChange={(e) => setPolicyDraft({ ...policyDraft, maxUsdPerTask: e.target.value })}
                      inputMode="decimal"
                    />
                  </div>
                  <div className="field">
                    <label>Min APY (%)</label>
                    <input
                      value={policyDraft.minApyBps}
                      onChange={(e) => setPolicyDraft({ ...policyDraft, minApyBps: e.target.value })}
                      inputMode="decimal"
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Allowed assets (comma-separated)</label>
                  <input value={policyDraft.allowedAssets} onChange={(e) => setPolicyDraft({ ...policyDraft, allowedAssets: e.target.value })} />
                </div>
                <div className="field">
                  <label>Allowed protocols (comma-separated)</label>
                  <input
                    value={policyDraft.allowedProtocols}
                    onChange={(e) => setPolicyDraft({ ...policyDraft, allowedProtocols: e.target.value })}
                  />
                </div>
                <button className="btn" type="submit" disabled={savingPolicy}>
                  {savingPolicy ? <span className="spinner" /> : null}
                  {savingPolicy ? "Saving…" : "Save policy"}
                </button>
              </form>
            ) : (
              <div className="empty">Loading policy…</div>
            )}
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
              This is the policy a subscribed external agent fetches (read-only, via{" "}
              <code>GET /api/agent/entrypoints/policy/invoke</code>) and is expected to honor before executing.
            </p>
          </div>

          <div className="card">
            <h2>
              <span className="step">2</span>Procurement intent
            </h2>
            <form onSubmit={dispatchIntent}>
              <div className="field">
                <label>Instruction</label>
                <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Asset</label>
                  <input value={asset} onChange={(e) => setAsset(e.target.value)} />
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                </div>
              </div>
              <div className="field">
                <label>Minimum APY (%)</label>
                <input value={minApy} onChange={(e) => setMinApy(e.target.value)} inputMode="decimal" style={{ maxWidth: 140 }} />
              </div>
              <button className="btn full" type="submit" disabled={dispatching}>
                {dispatching ? <span className="spinner" /> : null}
                {dispatching ? "Dispatching…" : "Dispatch to subscribed agents"}
              </button>
            </form>
            {dispatchSummary ? <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{dispatchSummary}</p> : null}
            {error ? <p style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{error}</p> : null}
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
              This doesn&apos;t execute anything — it POSTs a signed webhook to every active subscriber below. The
              subscribed agent decides whether and how to act, using its own <code>agent-skills</code> CLI, KeeperHub
              key, and wallet.
            </p>
          </div>

          <div className="card">
            <h2>Webhook subscribers</h2>
            {subscribers === null ? (
              <div className="empty">Loading…</div>
            ) : subscribers.length === 0 ? (
              <div className="empty">No subscribers yet. Add the agent operator&apos;s webhook URL below.</div>
            ) : (
              <div>
                {subscribers.map((s) => (
                  <div className="provider-row" key={s.id}>
                    <div className="provider-main">
                      <div className="provider-name">
                        {s.name} <span className="badge info">{s.platform}</span>
                      </div>
                      <div className="provider-meta mono">{s.url}</div>
                    </div>
                    <button className="btn secondary" onClick={() => removeSubscriber(s.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={addSubscriber} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
              <div className="field-row">
                <div className="field">
                  <label>Name</label>
                  <input value={newSub.name} onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Platform</label>
                  <select value={newSub.platform} onChange={(e) => setNewSub({ ...newSub, platform: e.target.value as WebhookPlatform })}>
                    <option value="hermes">Hermes Agent</option>
                    <option value="openclaw">OpenClaw</option>
                    <option value="generic">Generic</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Webhook URL</label>
                <input value={newSub.url} onChange={(e) => setNewSub({ ...newSub, url: e.target.value })} required />
              </div>
              <div className="field">
                <label>Secret</label>
                <input value={newSub.secret} onChange={(e) => setNewSub({ ...newSub, secret: e.target.value })} required type="password" />
              </div>
              <button className="btn secondary" type="submit" disabled={addingSub}>
                {addingSub ? "Adding…" : "Add subscriber"}
              </button>
            </form>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Discovered providers (A2A / ERC-8004)</h2>
            {providers === null ? (
              <div className="empty">Discovering…</div>
            ) : providers.length === 0 ? (
              <div className="empty">No providers discovered.</div>
            ) : (
              <div>
                {providers.map((p) => (
                  <div className="provider-row" key={p.agentId}>
                    <div className="provider-main">
                      <div className="provider-name">{p.name}</div>
                      <div className="provider-meta">
                        {p.protocol} · {p.asset} · {p.network}
                      </div>
                    </div>
                    <div className={"apy" + (p.apyBps < (policy?.minApyBps ?? 0) ? " low" : "")}>{(p.apyBps / 100).toFixed(2)}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2>Authorize Agent (by Registering in the ERC-8004)</h2>
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: -4, marginBottom: 12 }}>
              Mints a new ERC-8004 identity on the Base Sepolia Identity Registry for the wallet configured via{" "}
              <code>AGENT_IDENTITY_PRIVATE_KEY</code>. Do this once per agent wallet — the resulting agentId + address
              are what &quot;Authorized agents&quot; below needs.
            </p>
            <form onSubmit={registerIdentity}>
              <div className="field">
                <label>Agent URI (optional)</label>
                <input
                  value={identityDraft.agentURI}
                  onChange={(e) => setIdentityDraft({ agentURI: e.target.value })}
                  placeholder="https://.../.well-known/agent-registration.json"
                />
              </div>
              <button className="btn secondary" type="submit" disabled={registeringIdentity}>
                {registeringIdentity ? <span className="spinner" /> : null}
                {registeringIdentity ? "Registering on-chain…" : "Register in ERC-8004"}
              </button>
              {identityError ? <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{identityError}</p> : null}
            </form>
            {identityResult ? (
              <div className="provider-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                <div className="provider-main">
                  <div className="provider-name">
                    Registered <span className="badge ok">agentId {identityResult.agentId ?? "unknown"}</span>
                  </div>
                  <div className="provider-meta mono">{identityResult.agentAddress}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a
                    className="pill link"
                    href={`https://sepolia.basescan.org/tx/${identityResult.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    tx
                  </a>
                  <button
                    className="btn secondary"
                    onClick={() => setNewAgent({ address: identityResult.agentAddress, agentId: identityResult.agentId ?? "" })}
                  >
                    Use below ↓
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="card">
            <h2>Authorized agents (live ERC-8004 gate)</h2>
            {authorizedAgents === null ? (
              <div className="empty">Loading…</div>
            ) : authorizedAgents.length === 0 ? (
              <div className="empty">No agents authorized yet — external agents cannot report procurements until added here.</div>
            ) : (
              <div>
                {authorizedAgents.map((a) => (
                  <div className="provider-row" key={a.address}>
                    <div className="provider-main">
                      <div className="provider-name mono">{a.address}</div>
                      <div className="provider-meta">
                        agentId {a.agentId}
                        {a.verification.reputation ? ` · reputation: ${a.verification.reputation.count} feedback` : ""}
                        {" · "}
                        <span className={`badge ${a.active ? "ok" : "muted"}`}>{a.active ? "authorized" : "revoked"}</span>
                      </div>
                    </div>
                    {a.active ? (
                      <button className="btn secondary" onClick={() => revokeAgent(a.address)}>
                        Revoke
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={addAuthorizedAgent} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
              <div className="field">
                <label>Agent wallet address</label>
                <input value={newAgent.address} onChange={(e) => setNewAgent({ ...newAgent, address: e.target.value })} required />
              </div>
              <div className="field">
                <label>ERC-8004 agentId</label>
                <input value={newAgent.agentId} onChange={(e) => setNewAgent({ ...newAgent, agentId: e.target.value })} required />
              </div>
              <button className="btn secondary" type="submit" disabled={addingAgent}>
                {addingAgent ? "Verifying on-chain…" : "Verify & authorize"}
              </button>
              {agentError ? <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{agentError}</p> : null}
            </form>
          </div>

          <div className="card">
            <h2>
              <span className="step">3</span>Activity & receipts
            </h2>
            {!registryConfigured ? (
              <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginBottom: 12 }}>
                <code>PROCUREMENT_REGISTRY_ADDRESS</code> not set — on-chain history unavailable until{" "}
                <code>./contracts</code> is deployed.
              </p>
            ) : null}
            {dispatchedPending.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                {dispatchedPending.map((t) => (
                  <div className="provider-row" key={t.taskId}>
                    <div className="provider-main">
                      <div className="provider-name">{t.request.instruction.slice(0, 60)}</div>
                      <div className="provider-meta">
                        {t.request.asset} {t.request.amount} · <span className="badge warn">dispatched, awaiting agent</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {receipts === null ? (
              <div className="empty">Loading…</div>
            ) : receipts.length === 0 && dispatchedPending.length === 0 ? (
              <div className="empty">Nothing recorded yet.</div>
            ) : (
              receipts.map((r) => (
                <div key={r.taskId}>
                  <div className="provider-row" style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === r.taskId ? null : r.taskId)}>
                    <div className="provider-main">
                      <div className="provider-name mono">{r.taskId.slice(0, 10)}…</div>
                      <div className="provider-meta">
                        {r.asset} {r.amount} · agent {r.agent.slice(0, 8)}… ·{" "}
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                    <a
                      className="pill link"
                      href={`https://sepolia.basescan.org/tx/${r.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      tx
                    </a>
                  </div>
                  {expanded === r.taskId && r.detail ? (
                    <div style={{ paddingBottom: 14 }}>
                      <Timeline events={r.detail.timeline} />
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: "completed" | "rejected" | "failed" }) {
  const map: Record<string, { cls: string; label: string }> = {
    completed: { cls: "ok", label: "completed" },
    rejected: { cls: "err", label: "rejected" },
    failed: { cls: "err", label: "failed" },
  };
  const m = map[status] ?? { cls: "muted", label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
