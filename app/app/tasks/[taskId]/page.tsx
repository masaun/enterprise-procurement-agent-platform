import { resolveAppOrigin } from "@/lib/lucid/agent";
import { Timeline } from "@/app/components/Timeline";
import type { ProcurementTask } from "@/lib/types";
import type { OnChainReceipt } from "@/lib/chain/registry";

/**
 * The "embedded link of order details" target from the "Activity & receipts"
 * table (`ProcurementConsole.tsx`) — a permalink for one procurement task,
 * combining whatever off-chain detail the reporting agent POSTed
 * (`lib/store.ts`, keyed by `taskId`) with the on-chain receipt
 * (`ProcurementRegistry.ProcurementRecorded`), if one has landed yet. Fetches
 * `GET /api/procurement-history/[taskId]` rather than importing `getTask`/
 * `readProcurementHistory` directly — see that route's doc comment for why
 * (Turbopack dev doesn't reliably share `lib/store.ts`'s module-level state
 * between a Page's and a Route Handler's compiled module graphs).
 */
export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const res = await fetch(`${resolveAppOrigin()}/api/procurement-history/${taskId}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { task?: ProcurementTask | null; receipt?: OnChainReceipt | null };
  const task = body.task ?? null;
  const receipt = body.receipt ?? null;

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          Enterprise Procurement Agent — Management Platform
        </div>
        <div className="pillrow">
          <a className="pill link" href="/">
            ← Back to console
          </a>
        </div>
      </div>

      {!task && !receipt ? (
        <div className="card">
          <div className="empty">
            No task found for id <code>{taskId}</code>. It may still be in flight — this page doesn&apos;t poll, reload
            once the subscribed agent has reported.
          </div>
        </div>
      ) : (
        <TaskDetail taskId={taskId} task={task ?? null} receipt={receipt} />
      )}
    </div>
  );
}

function TaskDetail({ taskId, task, receipt }: { taskId: string; task: ProcurementTask | null; receipt: OnChainReceipt | null }) {
  const status = receipt?.status ?? task?.status ?? "unknown";
  return (
    <div className="grid">
      <div>
        <div className="card">
          <h2>Order</h2>
          <dl className="kv">
            <dt>Task id</dt>
            <dd>{taskId}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={status} />
            </dd>
            {task ? (
              <>
                <dt>Instruction</dt>
                <dd style={{ fontFamily: "var(--sans)" }}>{task.request.instruction}</dd>
                <dt>Asset</dt>
                <dd>{task.request.asset}</dd>
                <dt>Amount</dt>
                <dd>{task.request.amount}</dd>
                <dt>Min APY</dt>
                <dd>{(task.request.minApyBps / 100).toFixed(2)}%</dd>
                {task.request.allowedProtocols?.length ? (
                  <>
                    <dt>Allowed protocols</dt>
                    <dd>{task.request.allowedProtocols.join(", ")}</dd>
                  </>
                ) : null}
              </>
            ) : null}
            {task?.error ? (
              <>
                <dt>Error</dt>
                <dd style={{ color: "var(--danger)" }}>{task.error}</dd>
              </>
            ) : null}
          </dl>
        </div>

        {task?.selectedProvider ? (
          <div className="card">
            <h2>Selected provider</h2>
            <dl className="kv">
              <dt>Name</dt>
              <dd style={{ fontFamily: "var(--sans)" }}>{task.selectedProvider.name}</dd>
              <dt>Protocol</dt>
              <dd>{task.selectedProvider.protocol}</dd>
              <dt>APY</dt>
              <dd>{(task.selectedProvider.apyBps / 100).toFixed(2)}%</dd>
              <dt>Network</dt>
              <dd>{task.selectedProvider.network}</dd>
            </dl>
          </div>
        ) : null}

        {task?.policy ? (
          <div className="card">
            <h2>Policy evaluation</h2>
            <dl className="kv">
              <dt>Allowed</dt>
              <dd>
                <span className={`badge ${task.policy.allowed ? "ok" : "err"}`}>{task.policy.allowed ? "allowed" : "blocked"}</span>
              </dd>
            </dl>
            {task.policy.reasons.length > 0 ? (
              <ul className="reasons">
                {task.policy.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {task?.execution ? (
          <div className="card">
            <h2>KeeperHub execution</h2>
            <dl className="kv">
              <dt>Mode</dt>
              <dd>{task.execution.mode}</dd>
              <dt>Executed</dt>
              <dd>{task.execution.executed ? "yes" : "no"}</dd>
              <dt>Status</dt>
              <dd>{task.execution.status}</dd>
              {task.execution.condition ? (
                <>
                  <dt>Condition</dt>
                  <dd>
                    observed {(task.execution.condition.observedApyBps / 100).toFixed(2)}% vs. target{" "}
                    {(task.execution.condition.targetApyBps / 100).toFixed(2)}% —{" "}
                    {task.execution.condition.met ? "met" : "not met"}
                  </dd>
                </>
              ) : null}
              {task.execution.transactionHash ? (
                <>
                  <dt>Tx</dt>
                  <dd>
                    <a className="pill link" href={`https://sepolia.basescan.org/tx/${task.execution.transactionHash}`} target="_blank" rel="noreferrer">
                      {task.execution.transactionHash.slice(0, 10)}…
                    </a>
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>

      <div>
        {receipt ? (
          <div className="card">
            <h2>On-chain receipt</h2>
            <dl className="kv">
              <dt>Enterprise</dt>
              <dd>{receipt.enterprise}</dd>
              <dt>Agent</dt>
              <dd>{receipt.agent}</dd>
              <dt>Asset / amount</dt>
              <dd>
                {receipt.asset} {receipt.amount}
              </dd>
              <dt>APY</dt>
              <dd>{(receipt.apyBps / 100).toFixed(2)}%</dd>
              <dt>Tx</dt>
              <dd>
                <a className="pill link" href={`https://sepolia.basescan.org/tx/${receipt.transactionHash}`} target="_blank" rel="noreferrer">
                  {receipt.transactionHash.slice(0, 10)}…
                </a>
              </dd>
            </dl>
          </div>
        ) : null}

        <div className="card">
          <h2>Timeline</h2>
          <Timeline events={task?.timeline ?? []} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    completed: { cls: "ok", label: "completed" },
    rejected: { cls: "err", label: "rejected" },
    failed: { cls: "err", label: "failed" },
    dispatched: { cls: "warn", label: "dispatched, awaiting agent" },
    authenticating: { cls: "warn", label: "authenticating" },
    discovering: { cls: "warn", label: "discovering providers" },
    evaluating_policy: { cls: "warn", label: "evaluating policy" },
    executing: { cls: "warn", label: "executing" },
  };
  const m = map[status] ?? { cls: "muted", label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
