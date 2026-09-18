"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EIP1193Provider, Hex } from "viem";
import { baseSepolia } from "viem/chains";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { providers?: EIP1193Provider[]; isMetaMask?: boolean; isRabby?: boolean };
  }
}

/**
 * EIP-6963 ("Multi Injected Provider Discovery") lets multiple installed
 * wallet extensions announce themselves independently, each with its own
 * isolated provider object and a stable `rdns` id — the only reliable way to
 * offer an explicit "MetaMask vs. Rabby Wallet" choice. Without it, every
 * extension fights over the single `window.ethereum` global and a dApp can't
 * tell them apart (see the legacy fallback in `resolveLegacyProvider` below,
 * which is best-effort only: some wallets set `isMetaMask: true` themselves
 * for backwards compatibility with dApps that don't support EIP-6963).
 */
type EIP6963ProviderInfo = { uuid: string; name: string; icon: string; rdns: string };
type EIP6963ProviderDetail = { info: EIP6963ProviderInfo; provider: EIP1193Provider };

export type WalletOptionId = "metamask" | "rabby";

const WALLET_OPTIONS: Array<{ id: WalletOptionId; name: string; rdns: string; downloadUrl: string }> = [
  { id: "metamask", name: "MetaMask", rdns: "io.metamask", downloadUrl: "https://metamask.io/download/" },
  { id: "rabby", name: "Rabby Wallet", rdns: "io.rabby", downloadUrl: "https://rabby.io/" },
];

const LAST_WALLET_STORAGE_KEY = "enterprise-procurement.lastWalletId";

type WalletState = {
  address: Hex | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  activeWalletId: WalletOptionId | null;
};

export type WalletOptionStatus = { id: WalletOptionId; name: string; detected: boolean; downloadUrl: string };

type WalletContextValue = WalletState & {
  isOnBaseSepolia: boolean;
  wallets: WalletOptionStatus[];
  walletName: string | null;
  connect: (walletId: WalletOptionId) => Promise<void>;
  disconnect: () => void;
  switchToBaseSepolia: () => Promise<void>;
  provider: EIP1193Provider | null;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const BASE_SEPOLIA_CHAIN_PARAMS = {
  chainId: `0x${baseSepolia.id.toString(16)}`,
  chainName: baseSepolia.name,
  nativeCurrency: baseSepolia.nativeCurrency,
  rpcUrls: [baseSepolia.rpcUrls.default.http[0]],
  blockExplorerUrls: [baseSepolia.blockExplorers.default.url],
};

function readLastWalletId(): WalletOptionId | null {
  try {
    const raw = window.localStorage.getItem(LAST_WALLET_STORAGE_KEY);
    return WALLET_OPTIONS.some((w) => w.id === raw) ? (raw as WalletOptionId) : null;
  } catch {
    return null;
  }
}

function rememberWalletId(id: WalletOptionId | null) {
  try {
    if (id) window.localStorage.setItem(LAST_WALLET_STORAGE_KEY, id);
    else window.localStorage.removeItem(LAST_WALLET_STORAGE_KEY);
  } catch {
    // best-effort only — a private window or blocked storage shouldn't break connecting
  }
}

/** Best-effort match for wallets that haven't adopted EIP-6963 yet. */
function resolveLegacyProvider(walletId: WalletOptionId): EIP1193Provider | null {
  if (typeof window === "undefined" || !window.ethereum) return null;
  const candidates = window.ethereum.providers ?? [window.ethereum];
  if (walletId === "rabby") return candidates.find((p) => (p as Window["ethereum"])?.isRabby) ?? null;
  if (walletId === "metamask") {
    return candidates.find((p) => {
      const flags = p as Window["ethereum"];
      return flags?.isMetaMask && !flags?.isRabby;
    }) ?? null;
  }
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({ address: null, chainId: null, connecting: false, error: null, activeWalletId: null });
  const [discovered, setDiscovered] = useState<Map<string, EIP6963ProviderDetail>>(new Map());
  const [activeProvider, setActiveProvider] = useState<EIP1193Provider | null>(null);
  const restoreAttempted = useRef(false);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
      setDiscovered((prev) => (prev.has(detail.info.rdns) ? prev : new Map(prev).set(detail.info.rdns, detail)));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  const resolveProvider = useCallback(
    (walletId: WalletOptionId): EIP1193Provider | null => {
      const option = WALLET_OPTIONS.find((w) => w.id === walletId);
      if (!option) return null;
      return discovered.get(option.rdns)?.provider ?? resolveLegacyProvider(walletId);
    },
    [discovered],
  );

  const readChainId = useCallback(async (p: EIP1193Provider) => {
    const hex = (await p.request({ method: "eth_chainId" })) as string;
    return parseInt(hex, 16);
  }, []);

  const connect = useCallback(
    async (walletId: WalletOptionId) => {
      const resolved = resolveProvider(walletId);
      const option = WALLET_OPTIONS.find((w) => w.id === walletId);
      if (!resolved) {
        setState((s) => ({ ...s, error: `${option?.name ?? walletId} not detected — install it and reload this page.` }));
        return;
      }
      setState((s) => ({ ...s, connecting: true, error: null }));
      try {
        const accounts = (await resolved.request({ method: "eth_requestAccounts" })) as string[];
        const chainId = await readChainId(resolved);
        setActiveProvider(resolved);
        rememberWalletId(walletId);
        setState({ address: (accounts[0] as Hex) ?? null, chainId, connecting: false, error: null, activeWalletId: walletId });
      } catch (err) {
        setState((s) => ({ ...s, connecting: false, error: (err as Error).message || `Failed to connect ${option?.name ?? walletId}` }));
      }
    },
    [resolveProvider, readChainId],
  );

  const disconnect = useCallback(() => {
    rememberWalletId(null);
    setActiveProvider(null);
    setState({ address: null, chainId: null, connecting: false, error: null, activeWalletId: null });
  }, []);

  // Silently restore the last-connected wallet on reload, without prompting,
  // as soon as it's been (re-)announced via EIP-6963 or found via the legacy
  // fallback. Runs at most once per page load.
  useEffect(() => {
    if (restoreAttempted.current || state.address) return;
    const lastWalletId = readLastWalletId();
    if (!lastWalletId) return;
    const resolved = resolveProvider(lastWalletId);
    if (!resolved) return;
    restoreAttempted.current = true;
    void (async () => {
      const accounts = (await resolved.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (!accounts[0]) return;
      const chainId = await readChainId(resolved).catch(() => null);
      setActiveProvider(resolved);
      setState((s) => ({ ...s, address: accounts[0] as Hex, chainId, activeWalletId: lastWalletId }));
    })();
  }, [discovered, resolveProvider, readChainId, state.address]);

  useEffect(() => {
    if (!activeProvider) return;
    const onAccountsChanged = (accounts: unknown) => {
      const list = accounts as string[];
      if (!list[0]) {
        disconnect();
        return;
      }
      setState((s) => ({ ...s, address: list[0] as Hex }));
    };
    const onChainChanged = (chainId: unknown) => {
      setState((s) => ({ ...s, chainId: parseInt(chainId as string, 16) }));
    };
    activeProvider.on?.("accountsChanged", onAccountsChanged);
    activeProvider.on?.("chainChanged", onChainChanged);
    return () => {
      activeProvider.removeListener?.("accountsChanged", onAccountsChanged);
      activeProvider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [activeProvider, disconnect]);

  const switchToBaseSepolia = useCallback(async () => {
    if (!activeProvider) return;
    try {
      await activeProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_SEPOLIA_CHAIN_PARAMS.chainId }] });
    } catch {
      await activeProvider.request({ method: "wallet_addEthereumChain", params: [BASE_SEPOLIA_CHAIN_PARAMS] }).catch(() => undefined);
    }
    const chainId = await readChainId(activeProvider).catch(() => null);
    setState((s) => ({ ...s, chainId }));
  }, [activeProvider, readChainId]);

  const wallets = useMemo<WalletOptionStatus[]>(
    () =>
      WALLET_OPTIONS.map((option) => ({
        id: option.id,
        name: option.name,
        downloadUrl: option.downloadUrl,
        detected: Boolean(discovered.get(option.rdns) ?? resolveLegacyProvider(option.id)),
      })),
    [discovered],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      ...state,
      isOnBaseSepolia: state.chainId === baseSepolia.id,
      wallets,
      walletName: WALLET_OPTIONS.find((w) => w.id === state.activeWalletId)?.name ?? null,
      connect,
      disconnect,
      switchToBaseSepolia,
      provider: activeProvider,
    }),
    [state, wallets, connect, disconnect, switchToBaseSepolia, activeProvider],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
