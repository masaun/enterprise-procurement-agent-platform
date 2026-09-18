"use client";

import { useEffect, useState } from "react";
import { isAddress, type Hex } from "viem";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { mintTestUsdcWithConnectedWallet } from "@/lib/chain/faucetBrowser";

type FaucetConfig = { faucet: string; token: string; decimals: number; configured: boolean };
type FaucetMintResult = { transactionHash: string; token: string; faucet: string; to: string; amount: string };

export function FaucetPanel() {
  const wallet = useWallet();
  const [faucetConfig, setFaucetConfig] = useState<FaucetConfig | null>(null);
  const [faucetDraft, setFaucetDraft] = useState({ to: "", amount: "2" });
  const [mintingFaucet, setMintingFaucet] = useState(false);
  const [faucetResult, setFaucetResult] = useState<FaucetMintResult | null>(null);
  const [faucetError, setFaucetError] = useState<string | null>(null);

  useEffect(() => {
    void refreshFaucetConfig();
  }, []);

  async function refreshFaucetConfig() {
    const res = await fetch("/api/faucet").catch(() => undefined);
    if (!res?.ok) return;
    setFaucetConfig((await res.json()) as FaucetConfig);
  }

  async function mintFaucet(e: React.FormEvent) {
    e.preventDefault();
    setMintingFaucet(true);
    setFaucetError(null);
    setFaucetResult(null);
    const to = faucetDraft.to.trim();
    if (!isAddress(to)) {
      setFaucetError("Recipient wallet address is not a valid EVM address");
      setMintingFaucet(false);
      return;
    }
    try {
      if (wallet.address) {
        // A wallet is connected: it signs the mint directly in the browser,
        // so it pays its own gas instead of the platform's
        // ENTERPRISE_ADMIN_PRIVATE_KEY.
        if (!wallet.isOnBaseSepolia) throw new Error("Connected wallet is not on Base Sepolia — use the switch-chain button above first.");
        if (!wallet.provider) throw new Error("Connected wallet has no active provider");
        const result = await mintTestUsdcWithConnectedWallet(wallet.provider, wallet.address, to as Hex, faucetDraft.amount);
        setFaucetResult(result);
      } else {
        const res = await fetch("/api/faucet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, amount: faucetDraft.amount }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.message || "Mint failed");
        setFaucetResult(body as FaucetMintResult);
      }
    } catch (e) {
      setFaucetError((e as Error).message);
    } finally {
      setMintingFaucet(false);
    }
  }

  return (
    <div className="card">
      <h2>Faucet (Base Sepolia test USDC)</h2>
      <p style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: -4, marginBottom: 12 }}>
        Mints Aave&apos;s Base Sepolia test USDC (
        <code>{(faucetConfig?.token ?? "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f").slice(0, 10)}…</code>) straight
        to any wallet via Aave&apos;s own permissionless <code>Faucet</code> contract — useful for funding a
        wallet you don&apos;t hold the key for, e.g. KeeperHub&apos;s execution wallet before it calls Aave{" "}
        <code>supply()</code>. This is a different token from Circle&apos;s official Base Sepolia USDC — see
        agent-demo/README.md&apos;s token table.{" "}
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
      <form onSubmit={mintFaucet}>
        <div className="field">
          <label>Recipient wallet address</label>
          <input
            value={faucetDraft.to}
            onChange={(e) => setFaucetDraft({ ...faucetDraft, to: e.target.value })}
            placeholder="0x… (e.g. KeeperHub's execution wallet)"
            required
          />
        </div>
        <div className="field">
          <label>Amount (USDC)</label>
          <input
            value={faucetDraft.amount}
            onChange={(e) => setFaucetDraft({ ...faucetDraft, amount: e.target.value })}
            inputMode="decimal"
            style={{ maxWidth: 140 }}
            required
          />
        </div>
        <button
          className="btn secondary"
          type="submit"
          disabled={mintingFaucet || (!wallet.address && faucetConfig !== null && !faucetConfig.configured) || (Boolean(wallet.address) && !wallet.isOnBaseSepolia)}
        >
          {mintingFaucet ? <span className="spinner" /> : null}
          {mintingFaucet ? "Minting…" : "Mint test USDC"}
        </button>
        {!wallet.address && faucetConfig && !faucetConfig.configured ? (
          <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>
            <code>ENTERPRISE_ADMIN_PRIVATE_KEY</code> is not set — connect a wallet above instead, or set it in{" "}
            <code>app/.env.local</code>.
          </p>
        ) : null}
        {faucetError ? <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{faucetError}</p> : null}
      </form>
      {faucetResult ? (
        <div className="provider-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
          <div className="provider-main">
            <div className="provider-name">
              Minted <span className="badge ok">{faucetResult.amount} USDC</span>
            </div>
            <div className="provider-meta mono">{faucetResult.to}</div>
          </div>
          <a className="pill link" href={`https://sepolia.basescan.org/tx/${faucetResult.transactionHash}`} target="_blank" rel="noreferrer">
            tx
          </a>
        </div>
      ) : null}
    </div>
  );
}
