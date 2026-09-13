import { ProcurementConsole } from "@/app/components/ProcurementConsole";

export default function HomePage() {
  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          Enterprise Procurement Agent
        </div>
        <div className="pillrow">
          <a className="pill link" href="/api/agent/.well-known/agent-card.json" target="_blank" rel="noreferrer">
            Agent Card
          </a>
          <a className="pill link" href="/api/agent/.well-known/oasf-record.json" target="_blank" rel="noreferrer">
            OASF Record
          </a>
          <span className="pill">MCP: /api/agent/mcp</span>
          <span className="pill">Lucid Agents SDK + KeeperHub</span>
        </div>
      </div>

      <ProcurementConsole />

      <p className="footer-note">
        Lucid decides <em>who to buy from</em> (SIWX · ERC-8004 · A2A · AP2). KeeperHub decides{" "}
        <em>how to execute</em> (policy · workflow · wallet · transaction). See <code>README.md</code>,{" "}
        <code>app/README.md</code>, and <code>agent-skills/README.md</code> for the full architecture.
      </p>
    </div>
  );
}
