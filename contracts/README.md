# `./contracts` — on-chain procurement history (Base Sepolia)

A standalone [Foundry](https://book.getfoundry.sh/) project — separate from `./app` and `./agent-skills/scripts/cli`'s Node/TypeScript tooling, with its own `lib/` (git-ignored by the repo root; vendored via `forge install`).

## What's here

`ProcurementRegistry.sol` is the durable, on-chain source of truth for the platform's activity/receipt dashboard (see [`../plan/PLAN.md`](../plan/PLAN.md) and [`../README.md`](../README.md) for the full architecture). Two roles:

- **Owner** (`Ownable`) — the *platform* (`./app`'s own `CONTRACT_OWNER_PRIVATE_KEY`). Administers `authorizedAgents` via `addAuthorizedAgent`/`revokeAuthorizedAgent`, populated only after `./app`'s own live ERC-8004 identity/reputation check passes for an external agent's wallet. The contract deliberately doesn't encode the ERC-8004 registries' own ABI — that verification happens off-chain in `app/lib/identity/gate.ts`, and the result is what gets written here.
- **Authorized agent** — an external agent's own treasury wallet (Hermes/OpenClaw, via the `agent-skills` CLI). Calls `recordProcurement(...)` itself, with its own key, after executing a procurement via KeeperHub. The contract trusts `msg.sender` as the agent address; it doesn't custody funds or execute anything.

`recordProcurement` rejects a duplicate `taskId` and emits `ProcurementRecorded` with every field `./app`'s dashboard needs to render history straight from logs (`app/lib/chain/registry.ts` reads these via a viem public client).

## Deployed addresses

| Contract | Address (Base Sepolia) |
| --- | --- |
| [`ProcurementRegistry.sol`](./src/ProcurementRegistry.sol) | [`0xDf33FdF3360fCF1923aBb8C7e3cE3c51160c7623`](https://sepolia.basescan.org/address/0xdf33fdf3360fcf1923abb8c7e3ce3c51160c7623#code) |

## Build & test

```bash
cd contracts
forge build
forge test -vvv
```

Or run the `ProcurementRegistry` suite directly, from anywhere:

```bash
./contracts/tests/ProcurementRegistry.t.sh
```

## Deploy to Base Sepolia

```bash
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY, BASESCAN_API_KEY
./scripts/DeployProcurementRegistry.sh
```

That wraps the equivalent `forge script` call below — use it directly if you want more control
(e.g. `--resume`, `--slow`), or already have the env vars exported without a `.env` file:

```bash
source .env
forge build
forge script scripts/DeployProcurementRegistry.s.sol:DeployProcurementRegistry \
  --rpc-url base_sepolia --broadcast --verify -vvvv
```

The deployer becomes the contract's `owner`. Take the printed address and set it as:
- `PROCUREMENT_REGISTRY_ADDRESS` in `../app/.env.local`
- `PROCURE_REGISTRY_ADDRESS` in the CLI's config (`~/.procure/config.json` or `PROCURE_REGISTRY_ADDRESS` env var) — see [`../agent-skills/README.md`](../agent-skills/README.md)

### Verification on BaseScan Sepolia

`--verify` above verifies the contract automatically as part of the deploy, using the
`[etherscan.base_sepolia]` entry in [`foundry.toml`](./foundry.toml) (BaseScan Sepolia's API +
your `BASESCAN_API_KEY`). No manual step needed on the happy path — check
[sepolia.basescan.org](https://sepolia.basescan.org) for the deployed address once the script
finishes.

If verification doesn't land during the broadcast (e.g. BaseScan hasn't indexed the deploy tx
yet), the script's console output prints a ready-to-run `forge verify-contract` fallback command
with the actual deployed address and constructor args already filled in — copy it as-is to retry.

## Why Foundry, not Hardhat

The rest of this repo already depends on `viem`/`ox` (via `@lucid-agents/*`), so a Foundry contracts project keeps the Solidity toolchain (compiler, tests, deployment) independent of that Node dependency tree entirely — `forge build`/`forge test` need no `npm install` here at all.
