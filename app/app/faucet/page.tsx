import { FaucetPanel } from "@/app/components/FaucetPanel";
import { ConnectWalletButton } from "@/app/components/ConnectWalletButton";
import { WalletProvider } from "@/lib/wallet/WalletProvider";

export default function FaucetPage() {
  return (
    <WalletProvider>
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
            <ConnectWalletButton />
          </div>
        </div>

        <div className="grid">
          <FaucetPanel />
        </div>
      </div>
    </WalletProvider>
  );
}
