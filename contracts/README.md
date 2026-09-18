# `./contracts` — on-chain procurement history (Base Sepolia)

A standalone [Foundry](https://book.getfoundry.sh/) project — separate from `./app` and `./agent-skills/scripts/cli`'s Node/TypeScript tooling, with its own `lib/` (git-ignored by the repo root; vendored via `forge install`).

## What's here

`ProcurementRegistry.sol` is the durable, on-chain source of truth for the platform's activity/receipt dashboard (see [`../README.md`](../README.md) for the full architecture). Two roles:

- **Owner** (`Ownable`) — whichever wallet deployed/created the registry. Administers `authorizedAgents` via `addAuthorizedAgent`/`revokeAuthorizedAgent`, populated only after `./app`'s own live ERC-8004 identity/reputation check passes for an external agent's wallet. The contract deliberately doesn't encode the ERC-8004 registries' own ABI — that verification happens off-chain in `app/lib/identity/gate.ts`, and the result is what gets written here. `./app` itself holds no owner key of any kind — see the factory paragraph below.
- **Authorized agent** — an external agent's own treasury wallet (Hermes/OpenClaw, via the `agent-skills` CLI). Calls `recordProcurement(...)` itself, with its own key, after executing a procurement via KeeperHub. The contract trusts `msg.sender` as the agent address; it doesn't custody funds or execute anything.

`recordProcurement` rejects a duplicate `taskId` and emits `ProcurementRecorded` with every field `./app`'s dashboard needs to render history straight from logs (`app/lib/chain/registry.ts` reads these via a viem public client, against whichever registry the dashboard most recently marked "active" — see `app/lib/chain/activeRegistryStore.ts`).

`ProcurementRegistryFactory.sol` deploys new `ProcurementRegistry` instances on demand via `createNewProcurementRegistry()`. It has no owner itself — it's permissionless — and the registry it deploys is owned by whichever address calls that function: always the enterprise admin's own connected wallet (`app/lib/chain/factoryBrowser.ts`, behind the dashboard's "New ProcurementRegistry contract creation" panel), never a platform-held key. That caller then calls `addAuthorizedAgent()`/`revokeAuthorizedAgent()` directly on the registry it just created (`app/lib/chain/registryBrowser.ts`) — `./app` has no server-signed fallback for this anymore, since a fixed platform key could never actually be a factory-created registry's owner.

## Deployed addresses

| Contract | Address (Base Sepolia) |
| --- | --- |
| [`ProcurementRegistryFactory.sol`](./src/ProcurementRegistryFactory.sol) | [`0x37B32265AdD721156dA8F6192a619FBCaD4522e3`](https://sepolia.basescan.org/address/0x37b32265add721156da8f6192a619fbcad4522e3#code) |

`ProcurementRegistry.sol` itself has no single canonical deployment anymore — every enterprise admin creates and owns their own instance via the factory above (`createNewProcurementRegistry()`), so there's no one fixed address to list here. (An earlier standalone deployment, [`0xDf33FdF3360fCF1923aBb8C7e3cE3c51160c7623`](https://sepolia.basescan.org/address/0xdf33fdf3360fcf1923abb8c7e3ce3c51160c7623#code), predates the factory and is no longer what `./app` points at by default.)

## Build & test

```bash
cd contracts
forge build
forge test -vvv
```

Or run a suite directly, from anywhere:

```bash
./contracts/tests/ProcurementRegistry.t.sh
./contracts/tests/ProcurementRegistryFactory.t.sh
```

## Deploy to Base Sepolia

```bash
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY, BASESCAN_API_KEY
./scripts/DeployProcurementRegistry.sh
./scripts/DeployProcurementRegistryFactory.s.sh
```

Each wraps the equivalent `forge script` call below — use it directly if you want more control
(e.g. `--resume`, `--slow`), or already have the env vars exported without a `.env` file:

```bash
source .env
forge build
forge script scripts/DeployProcurementRegistry.s.sol:DeployProcurementRegistry \
  --rpc-url base_sepolia --broadcast --verify -vvvv
forge script scripts/DeployProcurementRegistryFactory.s.sol:DeployProcurementRegistryFactory \
  --rpc-url base_sepolia --broadcast --verify -vvvv
```

For `DeployProcurementRegistry`, the deployer becomes the contract's `owner`. Since it wasn't created via the factory, it won't appear in the dashboard's "Your registries (from the factory)" picker — paste the printed address into the "Authorized agents" panel's **Target ProcurementRegistry** field manually instead, with `DEPLOYER_PRIVATE_KEY`'s wallet connected (it must sign `addAuthorizedAgent()`/`revokeAuthorizedAgent()`, since it's the owner — `./app` has no env var for this address or a server-signed fallback key; see [`../app/README.md`](../app/README.md#environment-variables)). Also take the printed address and set it as `PROCURE_REGISTRY_ADDRESS` in the CLI's config (`~/.procure/config.json` or `PROCURE_REGISTRY_ADDRESS` env var) — see [`../agent-skills/README.md`](../agent-skills/README.md) — so the external agent writes receipts to the same registry it was authorized on.

For `DeployProcurementRegistryFactory`, the deployer only pays gas — the factory has no owner and is deployed once. Take the printed address and set it as `NEXT_PUBLIC_PROCUREMENT_REGISTRY_FACTORY_ADDRESS` in `../app/.env.local`; every registry it subsequently creates is owned by whichever wallet calls `createNewProcurementRegistry()`, not by the factory's deployer.

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
