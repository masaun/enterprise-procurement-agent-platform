"use client";

import { useEffect, useState } from "react";
import { isAddress, type Hex } from "viem";
import type { Policy, ProcurementTask, ProviderOffer, TaskStatus } from "@/lib/types";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { registerAgentIdentityWithConnectedWallet } from "@/lib/identity/registerBrowser";
import {
  createProcurementRegistryWithConnectedWallet,
  getRegistriesByCreatorWithConnectedWallet,
  isFactoryConfigured,
} from "@/lib/chain/factoryBrowser";
import { addAuthorizedAgentWithConnectedWallet, revokeAuthorizedAgentWithConnectedWallet } from "@/lib/chain/registryBrowser";

const DEFAULT_INSTRUCTION =
  "Move 2 USDC from our treasury to an approved lending protocol, but only if APY > 1%.";

type WebhookPlatform = "hermes" | "openclaw" | "generic";
type Subscriber = { id: string; name: string; platform: WebhookPlatform; url: string; secret: string; active: boolean; createdAt: string };
type AuthorizedAgent = {
  address: string;
  agentId: string;
  active: boolean;
  addedAt: string;
  verification: { verified: boolean; onChainWallet?: string; reputation?: { count: number; value: number; valueDecimals: number }; reason?: string };
};
type IdentityRegistrationResult = { agentId?: string; agentAddress: string; transactionHash: string; transferTransactionHash?: string };
type CreatedRegistry = { registryAddress: string; owner: string; transactionHash: string; createdAt: string };
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
  const wallet = useWallet();
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
  const [dispatchOk, setDispatchOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [newSub, setNewSub] = useState({ name: "", platform: "generic" as WebhookPlatform, url: "", secret: "" });
  const [addingSub, setAddingSub] = useState(false);

  const [authorizedAgents, setAuthorizedAgents] = useState<AuthorizedAgent[] | null>(null);
  const [newAgent, setNewAgent] = useState({ address: "", agentId: "" });
  const [addingAgent, setAddingAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  // No env-var default here on purpose: with a wallet connected, the target
  // registry always comes from the factory's own `getRegistryForCreator()`
  // (`refreshMyRegistry` below) — never a hardcoded address, and always kept
  // in sync with the connected wallet — so this can't drift from whatever
  // registry the connected wallet actually owns.
  const [registryAddress, setRegistryAddress] = useState("");

  const [creatingRegistry, setCreatingRegistry] = useState(false);
  const [createdRegistry, setCreatedRegistry] = useState<CreatedRegistry | null>(null);
  const [createRegistryError, setCreateRegistryError] = useState<string | null>(null);
  // Every ProcurementRegistry the connected wallet has ever created via the
  // factory's getRegistriesByCreator(), read live on-chain — not just the
  // one from this session's ephemeral `createdRegistry` above. The deployed
  // factory (as of writing) doesn't cap this at one, so this can have more
  // than one entry; the dashboard treats the most recent as the active one.
  const [ownedRegistries, setOwnedRegistries] = useState<string[] | null>(null);
  const [loadingMyRegistry, setLoadingMyRegistry] = useState(false);
  const myRegistry = ownedRegistries && ownedRegistries.length > 0 ? ownedRegistries[ownedRegistries.length - 1] : null;

  const [identityDraft, setIdentityDraft] = useState({ agentURI: "", agentWalletAddress: "" });
  const [registeringIdentity, setRegisteringIdentity] = useState(false);
  const [identityResult, setIdentityResult] = useState<IdentityRegistrationResult | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const [receipts, setReceipts] = useState<OnChainReceipt[] | null>(null);
  const [dispatchedPending, setDispatchedPending] = useState<ProcurementTask[]>([]);
  const [registryConfigured, setRegistryConfigured] = useState(true);

  useEffect(() => {
    void refreshProviders();
    void refreshPolicy();
    void refreshSubscribers();
    void refreshHistory();
  }, []);

  useEffect(() => {
    void refreshMyRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  useEffect(() => {
    // Light polling so "Activity & receipts" reflects a subscribed agent's
    // progress (dispatched -> authenticating/discovering/evaluating_policy/
    // executing -> the on-chain receipt) without a manual reload — the agent
    // reports each step asynchronously, on its own clock, with no push
    // channel back to this dashboard.
    const id = setInterval(() => void refreshHistory(), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Keeps the server's "active ProcurementRegistry" (lib/chain/activeRegistryStore.ts
    // — used for on-chain history reads and the inbound agent report gate) in
    // sync with whatever registry the connected wallet is currently using
    // here, instead of a hand-configured PROCUREMENT_REGISTRY_ADDRESS.
    if (!wallet.address || !isAddress(registryAddress)) return;
    fetch("/api/procurement-registry/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registryAddress }),
    })
      .then(() => refreshHistory())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, registryAddress]);

  useEffect(() => {
    // Both "Authorized agents" tables (the live-gate panel and the
    // "Authorize Agent" panel) always reflect whichever registry is
    // currently selected — a live on-chain read when one is, the process
    // cache otherwise (see GET /api/agents/authorized).
    void refreshAuthorizedAgents(registryAddress);
  }, [registryAddress]);

  async function refreshMyRegistry() {
    if (!wallet.address || !wallet.provider || !isFactoryConfigured()) {
      setOwnedRegistries(null);
      return;
    }
    setLoadingMyRegistry(true);
    try {
      const registries = await getRegistriesByCreatorWithConnectedWallet(wallet.provider, wallet.address);
      setOwnedRegistries(registries);
      // The connected wallet's own (most recent) registry is always the
      // default target — resync unconditionally instead of "fill only if
      // empty", so switching wallets (or reloading) never leaves a stale
      // address behind. Clicking another row in the table below can still
      // pick an older one if the wallet owns more than one.
      setRegistryAddress(registries[registries.length - 1] ?? "");
    } catch {
      setOwnedRegistries(null);
    } finally {
      setLoadingMyRegistry(false);
    }
  }

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
    const agentWalletAddress = identityDraft.agentWalletAddress.trim() || undefined;
    if (agentWalletAddress && !isAddress(agentWalletAddress)) {
      setIdentityError("Agent Wallet Address is not a valid EVM address");
      setRegisteringIdentity(false);
      return;
    }
    try {
      if (wallet.address) {
        // A wallet is connected: it signs the mint (and transfer, if
        // agentWalletAddress differs) directly in the browser, so it pays
        // its own gas instead of the platform's ENTERPRISE_ADMIN_PRIVATE_KEY.
        if (!wallet.isOnBaseSepolia) throw new Error("Connected wallet is not on Base Sepolia — use the switch-chain button above first.");
        if (!wallet.provider) throw new Error("Connected wallet has no active provider");
        const result = await registerAgentIdentityWithConnectedWallet(
          wallet.provider,
          wallet.address,
          identityDraft.agentURI || undefined,
          agentWalletAddress as Hex | undefined,
        );
        setIdentityResult(result);
        // The wallet signed this directly in the browser, so the server never
        // saw it — report it back just for the "registered agents" table.
        await fetch("/api/agents/identity", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...result, agentURI: identityDraft.agentURI || undefined }),
        }).catch(() => undefined);
      } else {
        const res = await fetch("/api/agents/identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentURI: identityDraft.agentURI, agentWalletAddress }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.message || "Registration failed");
        setIdentityResult(body as IdentityRegistrationResult);
      }
    } catch (e) {
      setIdentityError((e as Error).message);
    } finally {
      setRegisteringIdentity(false);
    }
  }

  async function refreshAuthorizedAgents(targetRegistry?: string) {
    const addr = targetRegistry ?? registryAddress;
    const url = addr && isAddress(addr) ? `/api/agents/authorized?registryAddress=${addr}` : "/api/agents/authorized";
    const res = await fetch(url).catch(() => undefined);
    if (!res?.ok) return;
    const body = await res.json();
    setAuthorizedAgents(body.agents ?? []);
  }

  async function createRegistry() {
    setCreatingRegistry(true);
    setCreateRegistryError(null);
    try {
      if (!wallet.address) throw new Error("Connect a wallet first — it becomes the new registry's owner.");
      if (!wallet.isOnBaseSepolia) throw new Error("Connected wallet is not on Base Sepolia — use the switch-chain button above first.");
      if (!wallet.provider) throw new Error("Connected wallet has no active provider");
      if (myRegistry) throw new Error("This wallet already owns a ProcurementRegistry (shown below) — one per wallet.");
      const result = await createProcurementRegistryWithConnectedWallet(wallet.provider, wallet.address);
      setCreatedRegistry({ ...result, createdAt: new Date().toISOString() });
      setRegistryAddress(result.registryAddress);
      void refreshMyRegistry();
    } catch (e) {
      setCreateRegistryError((e as Error).message);
    } finally {
      setCreatingRegistry(false);
    }
  }

  async function addAuthorizedAgent(e: React.FormEvent) {
    e.preventDefault();
    setAddingAgent(true);
    setAgentError(null);
    try {
      // A registry's Ownable owner is always the wallet that created it via
      // ProcurementRegistryFactory, so only a connected wallet can sign
      // addAuthorizedAgent() — there is no platform-key fallback.
      if (!wallet.address) throw new Error("Connect a wallet first — it must be the owner of the target registry below.");
      if (!wallet.isOnBaseSepolia) throw new Error("Connected wallet is not on Base Sepolia — use the switch-chain button above first.");
      if (!wallet.provider) throw new Error("Connected wallet has no active provider");
      if (!isAddress(registryAddress)) throw new Error("Target ProcurementRegistry address is not a valid EVM address");
      if (!isAddress(newAgent.address)) throw new Error("Agent wallet address is not a valid EVM address");

      const verifyRes = await fetch("/api/agents/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAgent),
      });
      const verifyBody = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) throw new Error(verifyBody?.verification?.reason || verifyBody?.message || "Verification failed");

      const transactionHash = await addAuthorizedAgentWithConnectedWallet(
        wallet.provider,
        wallet.address,
        registryAddress as Hex,
        newAgent.address as Hex,
      );

      await fetch("/api/agents/authorized/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newAgent, active: true, verification: verifyBody.verification, transactionHash }),
      }).catch(() => undefined);
      setNewAgent({ address: "", agentId: "" });
      void refreshAuthorizedAgents();
    } catch (e) {
      setAgentError((e as Error).message);
    } finally {
      setAddingAgent(false);
    }
  }

  async function revokeAgent(address: string) {
    setAgentError(null);
    try {
      if (!wallet.address) throw new Error("Connect a wallet first — it must be the owner of the target registry above.");
      if (!wallet.isOnBaseSepolia) throw new Error("Connected wallet is not on Base Sepolia — use the switch-chain button above first.");
      if (!wallet.provider) throw new Error("Connected wallet has no active provider");
      if (!isAddress(registryAddress)) throw new Error("Target ProcurementRegistry address is not a valid EVM address");

      await revokeAuthorizedAgentWithConnectedWallet(wallet.provider, wallet.address, registryAddress as Hex, address as Hex);
      await fetch("/api/agents/authorized/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, active: false }),
      }).catch(() => undefined);
    } catch (e) {
      setAgentError((e as Error).message);
    } finally {
      void refreshAuthorizedAgents();
    }
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
    setDispatchOk(false);
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
      setDispatchOk(total > 0 && okCount > 0);
      setDispatchSummary(
        total === 0
          ? "Intent recorded, but no active webhook subscribers to dispatch to — add one below."
          : okCount === total
            ? `Successfully dispatched to the subscribed agent${total > 1 ? "s" : ""} (${okCount}/${total}).`
            : `Dispatched to ${okCount}/${total} subscriber(s) — some deliveries failed.`,
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
            <h2>Webhook subscribers</h2>
            {subscribers === null ? (
              <div className="empty">Loading…</div>
            ) : subscribers.length === 0 ? (
              <div className="empty">No subscribers yet. Add the agent operator&apos;s webhook URL below.</div>
            ) : (
              <div className="table-wrap">
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Platform</th>
                      <th>Webhook URL</th>
                      <th>Secret</th>
                      <th>Status</th>
                      <th>Added</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>
                          <span className="badge info">{s.platform}</span>
                        </td>
                        <td className="mono">{s.url}</td>
                        <td>{s.secret}</td>
                        <td>
                          <span className={`badge ${s.active ? "ok" : "muted"}`}>{s.active ? "active" : "inactive"}</span>
                        </td>
                        <td>{new Date(s.createdAt).toLocaleString()}</td>
                        <td>
                          <button className="btn secondary" onClick={() => removeSubscriber(s.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <input
                  value={newSub.secret}
                  onChange={(e) => setNewSub({ ...newSub, secret: e.target.value })}
                  required
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="must exactly match the receiving agent's own webhook secret"
                />
                <p style={{ color: "var(--text-faint)", fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                  Shown in plaintext on purpose — this is a shared HMAC secret the receiving agent must match
                  byte-for-byte (e.g. <code>agent-demo</code>&apos;s <code>DEMO_WEBHOOK_SECRET</code>), not a login
                  password, and it&apos;s visible in the table below afterward so a mismatch is easy to spot.
                </p>
              </div>
              <button className="btn secondary" type="submit" disabled={addingSub}>
                {addingSub ? "Adding…" : "Add subscriber"}
              </button>
            </form>
          </div>

          <div className="card">
            <h2>
              <span className="step">2</span>KeeperHub policy
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
              <span className="step">3</span>Procurement intent
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
            {dispatchSummary ? (
              <p
                style={{
                  color: dispatchOk ? "var(--success)" : "var(--text-muted)",
                  fontWeight: dispatchOk ? 600 : 400,
                  fontSize: 12.5,
                  marginTop: 10,
                  marginBottom: 0,
                }}
              >
                {dispatchOk ? "✓ " : ""}
                {dispatchSummary}
              </p>
            ) : null}
            {error ? <p style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{error}</p> : null}
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
              This doesn&apos;t execute anything — it POSTs a signed webhook to every active subscriber below. The
              subscribed agent decides whether and how to act, using its own <code>agent-skills</code> CLI, KeeperHub
              key, and wallet.
            </p>
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
            <h2>
              <span className="step">4</span>Activity & receipts
            </h2>
            {!registryConfigured ? (
              <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginBottom: 12 }}>
                No active <code>ProcurementRegistry</code> yet — on-chain history is unavailable until a wallet
                connects above and creates/selects one in the &quot;Authorized agents&quot; panel.
              </p>
            ) : null}
            {receipts === null ? (
              <div className="empty">Loading…</div>
            ) : receipts.length === 0 && dispatchedPending.length === 0 ? (
              <div className="empty">Nothing recorded yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Request</th>
                      <th>Status</th>
                      <th>Agent</th>
                      <th>Tx</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatchedPending.map((t) => (
                      <tr key={t.taskId}>
                        <td className="mono">{t.taskId.slice(0, 10)}…</td>
                        <td>
                          {t.request.instruction.slice(0, 50)}
                          {t.request.instruction.length > 50 ? "…" : ""}
                          <div className="provider-meta">
                            {t.request.asset} {t.request.amount}
                          </div>
                        </td>
                        <td>
                          <PendingStatusBadge status={t.status} />
                        </td>
                        <td className="mono">—</td>
                        <td>
                          {t.onChainTransactionHash ? (
                            <a
                              className="pill link"
                              href={`https://sepolia.basescan.org/tx/${t.onChainTransactionHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              tx
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <a className="pill link" href={`/tasks/${t.taskId}`} target="_blank" rel="noreferrer">
                            view
                          </a>
                        </td>
                      </tr>
                    ))}
                    {receipts.map((r) => (
                      <tr key={r.taskId}>
                        <td className="mono">{r.taskId.slice(0, 10)}…</td>
                        <td>
                          {r.detail ? (
                            <>
                              {r.detail.request.instruction.slice(0, 50)}
                              {r.detail.request.instruction.length > 50 ? "…" : ""}
                            </>
                          ) : (
                            "—"
                          )}
                          <div className="provider-meta">
                            {r.asset} {r.amount} · {(r.apyBps / 100).toFixed(2)}% APY
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="mono">{r.agent ? `${r.agent.slice(0, 6)}…${r.agent.slice(-4)}` : "—"}</td>
                        <td>
                          {r.transactionHash ? (
                            <a className="pill link" href={`https://sepolia.basescan.org/tx/${r.transactionHash}`} target="_blank" rel="noreferrer">
                              tx
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <a className="pill link" href={`/tasks/${r.taskId}`} target="_blank" rel="noreferrer">
                            view
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>New ProcurementRegistry contract creation</h2>
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: -4, marginBottom: 12 }}>
              Deploys a brand-new <code>ProcurementRegistry</code> via <code>ProcurementRegistryFactory</code>
              &apos;s <code>createNewProcurementRegistry()</code>. Whichever wallet signs this call becomes that
              registry&apos;s owner on-chain, so it alone can <code>addAuthorizedAgent()</code>/
              <code>revokeAuthorizedAgent()</code> on it below — no platform key involved. This dashboard treats one
              registry per wallet as the norm: once your connected wallet owns one, it&apos;s shown below instead of
              creating another.{" "}
              {wallet.address ? (
                <>
                  Your connected wallet (<code>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</code>) will
                  sign, pay gas, and own the new registry.
                </>
              ) : (
                <>Connect a wallet above first — this action has no server-signed fallback, since the whole point is wallet ownership.</>
              )}
            </p>
            <button
              className="btn secondary"
              onClick={() => void createRegistry()}
              disabled={creatingRegistry || !wallet.address || !wallet.isOnBaseSepolia || !isFactoryConfigured() || Boolean(myRegistry)}
            >
              {creatingRegistry ? <span className="spinner" /> : null}
              {creatingRegistry ? "Deploying…" : "Create new ProcurementRegistry"}
            </button>
            {!isFactoryConfigured() ? (
              <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>
                <code>NEXT_PUBLIC_PROCUREMENT_REGISTRY_FACTORY_ADDRESS</code> is not set — deploy{" "}
                <code>ProcurementRegistryFactory</code> (see <code>contracts/scripts/DeployProcurementRegistryFactory.s.sol</code>)
                and set it in <code>app/.env.local</code>.
              </p>
            ) : null}
            {createRegistryError ? <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{createRegistryError}</p> : null}
            {createdRegistry ? (
              <div className="provider-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                <div className="provider-main">
                  <div className="provider-name">
                    Deployed <span className="badge ok">owner {createdRegistry.owner.slice(0, 6)}…{createdRegistry.owner.slice(-4)}</span>
                  </div>
                  <div className="provider-meta mono">{createdRegistry.registryAddress}</div>
                </div>
                <a
                  className="pill link"
                  href={`https://sepolia.basescan.org/tx/${createdRegistry.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  tx
                </a>
              </div>
            ) : null}

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
              <label style={{ marginBottom: 8 }}>Your ProcurementRegistry</label>
              {!wallet.address ? (
                <div className="empty">Connect a wallet to see the registry/registries it owns.</div>
              ) : loadingMyRegistry && !ownedRegistries ? (
                <div className="empty">Reading from the factory…</div>
              ) : !ownedRegistries || ownedRegistries.length === 0 ? (
                <div className="empty">No registry deployed yet for this wallet — create one above.</div>
              ) : (
                <div className="table-wrap">
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>Registry address</th>
                        <th>Owner (your wallet)</th>
                        <th>Active</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownedRegistries.map((addr, i) => {
                        const isActive = addr.toLowerCase() === registryAddress.toLowerCase();
                        const ownerAddress = wallet.address as string;
                        return (
                          <tr key={addr}>
                            <td className="mono">
                              {addr}
                              {i === ownedRegistries.length - 1 ? " (latest)" : ""}
                            </td>
                            <td className="mono">
                              {ownerAddress.slice(0, 6)}…{ownerAddress.slice(-4)}
                            </td>
                            <td>
                              {isActive ? (
                                <span className="badge ok">active</span>
                              ) : (
                                <button type="button" className="btn secondary" onClick={() => setRegistryAddress(addr)}>
                                  Use this one
                                </button>
                              )}
                            </td>
                            <td>
                              <a className="pill link" href={`https://sepolia.basescan.org/address/${addr}`} target="_blank" rel="noreferrer">
                                view
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Authorize Agent (by Registering in the ERC-8004)</h2>
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: -4, marginBottom: 12 }}>
              Mints a new ERC-8004 identity on the Base Sepolia Identity Registry. Enter the agent wallet address to
              register it for — the identity is minted and then transferred to that address on-chain, so this app
              never needs the agent wallet&apos;s own private key.{" "}
              {wallet.address ? (
                <>
                  Your connected wallet (<code>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</code>) will
                  sign and pay gas for this.
                </>
              ) : (
                <>
                  Signed and gas-paid by <code>ENTERPRISE_ADMIN_PRIVATE_KEY</code> since no wallet is connected —
                  use &quot;Connect Wallet&quot; above to pay from your own wallet instead.
                </>
              )}
            </p>
            <form onSubmit={registerIdentity}>
              <div className="field">
                <label>Agent Wallet Address</label>
                <input
                  value={identityDraft.agentWalletAddress}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, agentWalletAddress: e.target.value })}
                  placeholder={
                    wallet.address
                      ? "0x… (defaults to your connected wallet if left blank)"
                      : "0x… (defaults to the ENTERPRISE_ADMIN_PRIVATE_KEY wallet if left blank)"
                  }
                />
              </div>
              <div className="field">
                <label>Agent URI (optional)</label>
                <input
                  value={identityDraft.agentURI}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, agentURI: e.target.value })}
                  placeholder="https://.../.well-known/agent-registration.json"
                />
              </div>
              <button className="btn secondary" type="submit" disabled={registeringIdentity || (Boolean(wallet.address) && !wallet.isOnBaseSepolia)}>
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
                    href={`https://sepolia.basescan.org/tx/${identityResult.transferTransactionHash ?? identityResult.transactionHash}`}
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

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
              <label style={{ marginBottom: 8 }}>Authorized agents in your ProcurementRegistry (live)</label>
              {authorizedAgents === null ? (
                <div className="empty">Loading…</div>
              ) : authorizedAgents.length === 0 ? (
                <div className="empty">
                  No agents authorized yet — authorize one in the &quot;Authorized agents&quot; panel below.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>Agent Address</th>
                        <th>Agent ID</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authorizedAgents.map((a) => (
                        <tr key={a.address}>
                          <td className="mono">{a.address}</td>
                          <td>{a.agentId}</td>
                          <td>
                            <span className={`badge ${a.active ? "ok" : "muted"}`}>{a.active ? "authorized" : "revoked"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Authorized agents (live ERC-8004 gate)</h2>
            <div className="field" style={{ marginBottom: 8 }}>
              <label>Target ProcurementRegistry</label>
              <input
                value={registryAddress}
                onChange={(e) => setRegistryAddress(e.target.value)}
                placeholder="0x… (auto-filled from your connected wallet's registry)"
                className="mono"
              />
            </div>
            {wallet.address && isFactoryConfigured() ? (
              <div style={{ marginBottom: 12 }}>
                {loadingMyRegistry && !ownedRegistries ? (
                  <p style={{ color: "var(--text-faint)", fontSize: 11.5, margin: 0 }}>Reading your registries from the factory…</p>
                ) : !ownedRegistries || ownedRegistries.length === 0 ? (
                  <p style={{ color: "var(--text-faint)", fontSize: 11.5, margin: 0 }}>
                    No registry found on-chain for this wallet via <code>ProcurementRegistryFactory.getRegistriesByCreator()</code> —
                    create one in the panel above.
                  </p>
                ) : !ownedRegistries.some((addr) => addr.toLowerCase() === registryAddress.toLowerCase()) ? (
                  <p style={{ color: "var(--warning, #b58900)", fontSize: 11.5, margin: 0 }}>
                    This address isn&apos;t one of your wallet&apos;s own registries (
                    <button type="button" className="pill link" onClick={() => setRegistryAddress(myRegistry ?? "")} title={myRegistry ?? undefined}>
                      {myRegistry ? `${myRegistry.slice(0, 6)}…${myRegistry.slice(-4)}` : "use latest"}
                    </button>
                    ) — you can only sign writes on a registry you own.
                  </p>
                ) : (
                  <p style={{ color: "var(--text-faint)", fontSize: 11.5, margin: 0 }}>
                    ✓ one of your wallet&apos;s registries, per <code>ProcurementRegistryFactory.getRegistriesByCreator()</code>
                  </p>
                )}
              </div>
            ) : null}
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: -6, marginBottom: 12 }}>
              {wallet.address ? (
                <>
                  Your connected wallet signs <code>addAuthorizedAgent()</code>/<code>revokeAuthorizedAgent()</code>{" "}
                  directly on the registry above — it must be that registry&apos;s owner. No server-signed
                  fallback — a registry&apos;s owner is always the wallet that created it via the factory.
                </>
              ) : (
                <>Connect a wallet above first — this action has no server-signed fallback, since the whole point is wallet ownership.</>
              )}
            </p>
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
                      <button className="btn secondary" onClick={() => revokeAgent(a.address)} disabled={!wallet.address}>
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
              <button className="btn secondary" type="submit" disabled={addingAgent || !wallet.address}>
                {addingAgent ? "Verifying on-chain…" : "Verify & authorize"}
              </button>
              {agentError ? <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{agentError}</p> : null}
            </form>
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

/** Labels every pre-receipt `TaskStatus` a subscribed agent can report — see `ProcurementReportSchema` in lib/types.ts. */
function PendingStatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, string> = {
    dispatched: "dispatched, awaiting agent",
    authenticating: "authenticating",
    discovering: "discovering providers",
    evaluating_policy: "evaluating policy",
    executing: "executing",
    completed: "completed",
    rejected: "rejected",
    failed: "failed",
  };
  return <span className="badge warn">{map[status] ?? status}</span>;
}
