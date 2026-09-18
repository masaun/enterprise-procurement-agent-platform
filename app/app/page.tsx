import { ProcurementConsole } from "@/app/components/ProcurementConsole";
import { ConnectWalletButton } from "@/app/components/ConnectWalletButton";
import { WalletProvider } from "@/lib/wallet/WalletProvider";

export default function HomePage() {
  return (
    <WalletProvider>
      <div className="shell">
        <div className="topbar">
          <div className="brand">
            <span className="dot" />
            Agentic Enterprise Procurement — Management Platform
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
            <a className="pill link" href="/faucet">
              Faucet
            </a>
            <ConnectWalletButton />
          </div>
        </div>

        <ProcurementConsole />

        <p className="footer-note">
          This dashboard sets policy and dispatches procurement intents by webhook — it doesn&apos;t execute
          anything itself. A subscribed external agent (Hermes Agent, OpenClaw, ...) discovers providers,
          evaluates policy, executes via its own KeeperHub key, and records the receipt on-chain
          (<code>ProcurementRegistry</code>, Base Sepolia). See <code>README.md</code>, <code>app/README.md</code>,
          and <code>agent-skills/README.md</code> for the full architecture.
        </p>
      </div>
    </WalletProvider>
  );
}
