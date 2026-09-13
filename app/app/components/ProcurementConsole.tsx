"use client";

import { useEffect, useState } from "react";
import { Timeline } from "@/app/components/Timeline";
import type { Policy, ProcurementTask, ProviderOffer } from "@/lib/types";

type Auth = { address: string; chainId: string } | null;

const DEFAULT_INSTRUCTION =
  "Move 1,000,000 USDC from our treasury to an approved lending protocol, but only if APY > 4%.";

export function ProcurementConsole() {
  const [auth, setAuth] = useState<Auth>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [providers, setProviders] = useState<ProviderOffer[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);

  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [amount, setAmount] = useState("1000000");
  const [asset, setAsset] = useState("USDC");
  const [minApy, setMinApy] = useState("4.0");

  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState<ProcurementTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshProviders();
    void fetch("/api/agent/entrypoints/policy/invoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((r) => setPolicy(r.output ?? null))
      .catch(() => undefined);
  }, []);

  async function refreshProviders() {
    const res = await fetch("/api/providers").catch(() => undefined);
    if (!res?.ok) return;
    const body = await res.json();
    setProviders(body.offers ?? []);
  }

  async function connectAndAuthenticate() {
    setAuthenticating(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/authenticate", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.body?.error?.message || body?.error || "Authentication failed");
      setAuth({ address: body.output.address, chainId: body.output.chainId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthenticating(false);
    }
  }

  async function submitProcurement(e: React.FormEvent) {
    e.preventDefault();
    if (!auth) {
      setError("Authenticate the enterprise wallet first (SIWX).");
      return;
    }
    setSubmitting(true);
    setError(null);
    setTask(null);
    try {
      const minApyBps = Math.round(parseFloat(minApy || "0") * 100);
      const res = await fetch("/api/demo/procure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, asset, amount, minApyBps }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.body?.error?.message || body?.error || "Procurement failed");
      setTask(body.output as ProcurementTask);
      void refreshProviders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="grid">
        <div>
          <div className="card">
            <h2><span className="step">1</span>Enterprise wallet — SIWX</h2>
            {auth ? (
              <div className="walletbar">
                <span>
                  <span className="badge ok">authenticated</span>{" "}
                  <span className="addr mono">{auth.address}</span>
                </span>
                <span className="pill">{auth.chainId}</span>
              </div>
            ) : (
              <button className="btn full" onClick={connectAndAuthenticate} disabled={authenticating}>
                {authenticating ? <span className="spinner" /> : null}
                {authenticating ? "Signing SIWX challenge…" : "Connect & authenticate enterprise wallet"}
              </button>
            )}
            <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
              Real EIP-191 signing + a real SIWX challenge/verify round trip against{" "}
              <code>POST /api/agent/entrypoints/authenticate/invoke</code> via <code>@lucid-agents/payments</code>. The
              signer is a demo key standing in for the enterprise&apos;s real wallet — see{" "}
              <code>lib/demo/enterprise-signer.ts</code>.
            </p>
          </div>

          <div className="card">
            <h2><span className="step">2</span>Procurement request</h2>
            <form onSubmit={submitProcurement}>
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
              <button className="btn full" type="submit" disabled={submitting}>
                {submitting ? <span className="spinner" /> : null}
                {submitting ? "Running pipeline…" : "Submit to Procurement Agent"}
              </button>
            </form>
            {error ? (
              <p style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>{error}</p>
            ) : null}
          </div>

          <div className="card">
            <h2><span className="step">3</span>Pipeline timeline</h2>
            <Timeline events={task?.timeline ?? []} />
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
                        {task?.selectedProvider?.agentId === p.agentId ? (
                          <span className="badge info" style={{ marginLeft: 6 }}>
                            selected
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className={"apy" + (p.apyBps < (policy?.minApyBps ?? 0) ? " low" : "")}>
                      {(p.apyBps / 100).toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2>KeeperHub policy</h2>
            {policy ? (
              <dl className="kv">
                <dt>Max per task</dt>
                <dd>{policy.maxUsdPerTask.toLocaleString()}</dd>
                <dt>Min APY</dt>
                <dd>{(policy.minApyBps / 100).toFixed(2)}%</dd>
                <dt>Allowed assets</dt>
                <dd>{policy.allowedAssets.join(", ")}</dd>
                <dt>Allowed protocols</dt>
                <dd>{policy.allowedProtocols.join(", ")}</dd>
              </dl>
            ) : (
              <div className="empty">Loading policy…</div>
            )}
          </div>

          <div className="card">
            <h2>Result</h2>
            {!task ? (
              <div className="empty">Nothing submitted yet.</div>
            ) : (
              <>
                <p>
                  <StatusBadge status={task.status} />
                </p>
                {task.policy && task.policy.reasons.length > 0 ? (
                  <ul className="reasons">
                    {task.policy.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
                {task.execution ? (
                  <dl className="kv" style={{ marginTop: 12 }}>
                    <dt>Mode</dt>
                    <dd>{task.execution.mode}</dd>
                    <dt>Execution id</dt>
                    <dd>{task.execution.executionId}</dd>
                    {task.execution.transactionHash ? (
                      <>
                        <dt>Tx hash</dt>
                        <dd>{task.execution.transactionHash}</dd>
                      </>
                    ) : null}
                    <dt>Task id</dt>
                    <dd>{task.taskId}</dd>
                  </dl>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: ProcurementTask["status"] }) {
  const map: Record<ProcurementTask["status"], { cls: string; label: string }> = {
    authenticating: { cls: "info", label: "authenticating" },
    discovering: { cls: "info", label: "discovering" },
    evaluating_policy: { cls: "info", label: "evaluating policy" },
    executing: { cls: "warn", label: "executing" },
    completed: { cls: "ok", label: "completed" },
    rejected: { cls: "err", label: "rejected by policy" },
    failed: { cls: "err", label: "failed" },
  };
  const m = map[status];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
