"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet, type WalletOptionId } from "@/lib/wallet/WalletProvider";

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ConnectWalletButton() {
  const { address, connecting, error, isOnBaseSepolia, wallets, walletName, connect, disconnect, switchToBaseSepolia } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [menuOpen]);

  async function handlePick(walletId: WalletOptionId) {
    setMenuOpen(false);
    await connect(walletId);
  }

  if (address) {
    if (!isOnBaseSepolia) {
      return (
        <button className="btn" onClick={() => void switchToBaseSepolia()} title={`Connected to a different chain, needs Base Sepolia`}>
          Switch to Base Sepolia
        </button>
      );
    }
    return (
      <button
        className="btn"
        onClick={disconnect}
        title={`Connected via ${walletName ?? "wallet"} — click to disconnect (local only, the extension itself stays connected)`}
      >
        <span className="dot" style={{ marginRight: 6 }} />
        {truncate(address)}
      </button>
    );
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button className="btn" onClick={() => setMenuOpen((v) => !v)} disabled={connecting} title={error ?? undefined}>
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>
      {menuOpen ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 20,
            minWidth: 190,
            background: "var(--bg-card)",
            border: "1px solid var(--border-soft)",
            borderRadius: 8,
            padding: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {wallets.map((w) => (
            <button
              key={w.id}
              type="button"
              className="pill link"
              onClick={() => (w.detected ? void handlePick(w.id) : window.open(w.downloadUrl, "_blank", "noreferrer"))}
              style={{ display: "flex", width: "100%", justifyContent: "space-between", marginBottom: 4, textAlign: "left" }}
            >
              <span>{w.name}</span>
              <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{w.detected ? "Detected" : "Install"}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, color: "var(--danger)", fontSize: 11, whiteSpace: "nowrap" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
