# `./vendor`

`thirdweb-stub/` is a zero-dependency local stand-in for the real `thirdweb`
package, wired in via `overrides` in `package.json`:

```json
"overrides": { "thirdweb": "file:./vendor/thirdweb-stub" }
```

**Why:** `@lucid-agents/wallet` declares `thirdweb` as a (non-optional) peer
dependency for its optional `ThirdwebWalletConnector`. This app never
constructs that connector — `lib/lucid/agent.ts` only calls
`wallets({ config: undefined })` — but npm still auto-installs peer
dependencies, and the real `thirdweb` package drags in wagmi, WalletConnect,
Reown, Coinbase, and Sharp: ~400 extra packages, several of which vendor a
different `viem`/`ox`/`@noble/curves` than the one this app pins, which broke
`tsc`/`next build` with unrelated type errors from code this app never
executes.

`@lucid-agents/wallet` only ever reaches `thirdweb` through a **lazy**
`await import('thirdweb')` inside `ThirdwebWalletConnector`'s own
initializer (see `node_modules/@lucid-agents/wallet/dist/index.js`), so this
stub is never actually loaded at runtime. If a future change to this app
does start using thirdweb-backed wallets, delete this override and let npm
install the real package.
