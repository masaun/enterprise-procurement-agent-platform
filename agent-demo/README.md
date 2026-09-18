# Demo External Agent

`./agent-skills` teaches *any* external agent how to act as the Enterprise's
procurement actor. `./agent-skills/scripts/cli` (`procure`) is a
deterministic, no-LLM reference implementation of that behavior — useful for
testing, but it doesn't actually *decide* anything; every step is hard-coded.

**This package is the missing piece: a real, LLM-driven agent that plays the
same actor/role a live Hermes Agent or OpenClaw install would.** It has no
special, hard-coded knowledge of this platform. At startup it only loads
`./agent-skills/SKILL.md`'s `name` + `description`, exactly like a real
skills-compatible runtime would; once a task (a webhook, or a human's
natural-language ask) matches, it reads the full `SKILL.md` body itself, an
LLM (reached over **[OpenRouter](https://openrouter.ai/docs/quickstart)** — <https://openrouter.ai/docs/quickstart>)
decides what to do, and it reads `references/*.md` on demand and shells out
to the bundled `procure` CLI to actually act — the same "fastest path" the
skill itself documents. `./agent-skills` and `./app` don't know or care that
this is what's on the other end of the webhook; a real Hermes Agent or
OpenClaw install slots in at exactly the same place.

```mermaid
flowchart TB
    subgraph Demo["agent-demo (this package)"]
        Trigger["webhook / instruct\n(bin/agent-demo.ts)"]
        Loader["skills.ts\nprogressive disclosure loader"]
        LLM["agent.ts\ntool-calling loop"]
        OR["openrouter.ts\nOpenRouter chat completions"]
        Tools["tools.ts\nlist/read references,\nverify webhook sig,\nrun_procure"]
    end

    Skill["agent-skills/SKILL.md\n+ references/*.md"]
    CLI["agent-skills/scripts/cli\n(procure)"]
    App["./app (management platform)"]
    Chain["ProcurementRegistry\n(Base Sepolia)"]
    OpenRouter["OpenRouter\n(any model)"]

    Trigger --> Loader
    Loader -->|"1. name+description at startup"| Skill
    Loader -->|"2. full body once task matches"| Skill
    Loader --> LLM
    LLM --> OR
    OR --> OpenRouter
    LLM -->|"tool calls"| Tools
    Tools -->|"3. read on demand"| Skill
    Tools -->|"shell out"| CLI
    CLI -->|discover / policy| App
    CLI -->|"recordProcurement()"| Chain
    CLI -->|report| App
```

## Why an LLM at all, if `procure` already does the whole pipeline?

`procure submit`/`act` already implement discovery-read, policy evaluation,
KeeperHub execution, the on-chain write, and reporting — deterministically.
What they *don't* do is decide **whether and how to act in the first
place**, which is the actual job description in `agent-skills/SKILL.md`:
verify an inbound webhook's signature before trusting it, tell apart
Hermes's flat JSON from OpenClaw's TaskFlow `goal` string (which folds
structured fields into free text — see
[`agent-skills/references/protocols.md`](../agent-skills/references/protocols.md#webhook-signing-how-you-receive-an-intent)),
parse a human's plain-English ask ("Move 2 USDC... only if APY > 1%") into
the right flags, and read the right reference doc on demand instead of
having every protocol detail hard-coded. That reasoning is what a real
Hermes Agent or OpenClaw install brings via its own LLM — this package
brings the same thing via [OpenRouter](https://openrouter.ai/docs/quickstart), so the demo shows an agent *deciding*
to run `procure`, not a script that always does.

## Install

Written in TypeScript, run directly via Node 22.6+'s native TS stripping —
no build step, same as `agent-skills/scripts/cli`.

```bash
cd agent-demo
npm install
cp .env.example .env   # fill in OPENROUTER_API_KEY at minimum
node bin/agent-demo.ts skills
```

To let `./app`'s dashboard dispatch a **live** webhook to this agent (instead
of simulating one from a local file), start its HTTP listener instead — see
[Commands](#commands) and
[Live wire](#live-wire-registering-agent-demo-as-a-webhook-subscriber) below:

```bash
node bin/agent-demo.ts serve   # or: npm run serve
# [server] agent-demo webhook listener up on http://localhost:4021
# [server] register one of these as a "Webhook subscribers" URL in ./app, matching the platform you pick there:
# [server]   hermes   -> http://localhost:4021/webhook/hermes
# [server]   openclaw -> http://localhost:4021/webhook/openclaw
# [server]   generic  -> http://localhost:4021/webhook/generic
# [server] secret must match too — this server expects: demo-secret
```

Leave it running in its own terminal; every subsequent dispatch from `./app`
triggers a fresh agent run, logged there.

## Commands

| Command | Description |
| --- | --- |
| `agent-demo skills` | Loads only `agent-skills/SKILL.md`'s `name` + `description` and prints them, plus the list of `references/*.md` available on demand — step 1 of progressive disclosure, with no LLM call. |
| `agent-demo webhook --platform <hermes\|openclaw\|generic> --payload <file\|-> [--secret <secret>]` | Simulates this agent receiving a signed webhook on the given platform's route (see `fixtures/webhook-*.json` for one example payload per platform) and reasoning over it end to end. The command signs the payload itself first, exactly the way `./app`'s dispatcher would (`app/lib/webhooks/dispatch.ts`), then hands the signed request to the agent loop, which independently re-verifies it with the same secret via its own `verify_webhook_signature` tool — reading the raw bytes/headers/secret directly from that trigger, not from anything the LLM retypes (see [the troubleshooting section below](#troubleshooting-webhook-signature-verification-always-fails-fixed)) — so the full sign/verify round trip is demonstrated without needing a live `./app` instance running the dispatch side. |
| `agent-demo serve [--port <port>] [--secret <secret>]` | Runs a real HTTP listener (`src/server.ts`) so `./app`'s dashboard can dispatch a **live** webhook to this agent instead of you simulating one from a file — see [Live wire](#live-wire-registering-agent-demo-as-a-webhook-subscriber) below. Exposes `POST /webhook/<hermes\|openclaw\|generic>`; each route hands the raw request straight to the same agent loop `webhook` uses, so verification/reasoning/`procure` are unchanged. `POST /` (the bare URL, no path) also works, with the platform inferred from whichever signature header shows up — useful since that's the most natural URL to paste into the subscriber form. |
| `agent-demo instruct "<text>"` | Simulates a human enterprise admin telling this agent directly, no webhook involved — e.g. `agent-demo instruct "Move 2 USDC to an approved lending protocol, but only if APY > 1%."` |

Every run logs each step to stdout: which skill loaded, each LLM turn, every
tool call and its result, and the LLM's final natural-language report.

### Example

```bash
node bin/agent-demo.ts webhook --platform generic --payload fixtures/webhook-generic.json --secret demo-secret
```

```
[skill] loaded at startup: "agent-skills" — Teaches an external enterprise agent...
[skill] task matches this skill's description -> activating, reading full SKILL.md body
[llm] calling openai/gpt-4o-mini via OpenRouter (turn 1/12)
[llm] requested tool call: verify_webhook_signature({})
[tool] verify_webhook_signature(platform=generic)
[llm] calling openai/gpt-4o-mini via OpenRouter (turn 2/12)
[llm] requested tool call: run_procure({"command":"act","stdin":"..."})
[tool] run_procure act
[llm] calling openai/gpt-4o-mini via OpenRouter (turn 3/12)
[llm] final report:
Verified the webhook signature, then ran the procurement pipeline via `procure act`...
```

(`run_procure`'s actual result depends on a running `./app` instance and
whatever `PROCURE_*` credentials are configured — see below. With none
configured, `procure` still runs end to end in its own graceful-degradation
modes: KeeperHub demo mode, a throwaway signer, and the on-chain write
skipped, per `agent-skills/README.md`.)

## How it works

1. **Progressive disclosure, for real.** `src/skills.ts` is a small,
   dependency-free reader for the [Agent Skills
   format](https://agentskills.io/specification) — it reads only `name` +
   `description` at "startup" (`agent-demo skills`), the full `SKILL.md`
   body once a trigger arrives, and `references/*.md` files only when the
   LLM asks for them via a tool call. Nothing about `./agent-skills`' actual
   content is hard-coded into this package's prompts.
2. **The LLM decides, via [OpenRouter](https://openrouter.ai/docs/quickstart).** `src/openrouter.ts` is a ~50-line
   client for [OpenRouter](https://openrouter.ai/docs/quickstart)'s OpenAI-compatible `/chat/completions` endpoint
   (tool calling included) — no vendor SDK, matching this repo's
   dependency-light CLI style. `src/agent.ts` runs the tool-calling loop:
   system prompt (persona + the full `SKILL.md` body) -> user message
   (the webhook or natural-language trigger) -> the LLM either calls a tool
   or gives its final report.
3. **Acting still goes through `procure`.** `src/tools.ts`'s `run_procure`
   tool shells out to `agent-skills/scripts/cli/bin/procure.ts` — discovery,
   policy evaluation, KeeperHub execution, the on-chain receipt write, and
   reporting are that CLI's job, not reimplemented here. This package's own
   job is strictly the reasoning Hermes/OpenClaw would otherwise supply:
   verifying the webhook, picking which `procure` command/flags to use, and
   narrating the outcome.
4. **Webhook signature verification is real**, per
   [`agent-skills/references/protocols.md`](../agent-skills/references/protocols.md#webhook-signing-how-you-receive-an-intent):
   Hermes's `X-Webhook-Signature-V2` + `X-Webhook-Timestamp` HMAC pair,
   OpenClaw's `Authorization: Bearer <secret>`, and the generic
   `X-Procurement-Signature-256` HMAC — `src/tools.ts`'s
   `verify_webhook_signature` tool implements all three with a
   constant-time comparison. The tool itself takes no arguments: it computes
   the HMAC over the raw body/headers/secret from the actual `AgentTrigger`
   (`src/agent.ts`, threaded into `ToolContext.trigger`), not from values the
   LLM would otherwise have to retype into its own tool call — see
   [Troubleshooting: webhook signature verification always fails](#troubleshooting-webhook-signature-verification-always-fails-fixed)
   for why that distinction matters.

## Persona

`AGENT_DEMO_PERSONA` (`hermes` | `openclaw` | `generic`) changes only the
system prompt's self-identification and the trigger's framing — the actual
behavior (read skill, decide, act via `procure`) is identical, which is the
point: this package is meant to be a drop-in stand-in for whichever real
agent runtime you're demoing against.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Required. From <https://openrouter.ai/keys>. | — |
| `OPENROUTER_MODEL` | Any model slug [OpenRouter](https://openrouter.ai/docs/quickstart) routes to (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3.7-sonnet`). | `openai/gpt-4o-mini` |
| `OPENROUTER_BASE_URL` | [OpenRouter](https://openrouter.ai/docs/quickstart) API base URL. | `https://openrouter.ai/api/v1` |
| `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` | Sent as `HTTP-Referer` / `X-Title` — [OpenRouter](https://openrouter.ai/docs/quickstart) uses these for dashboard attribution/rankings. | `http://localhost:3000` / `agent-demo` |
| `AGENT_DEMO_PERSONA` | `hermes` \| `openclaw` \| `generic` — which real agent runtime this run role-plays as. | `generic` |
| `AGENT_DEMO_NAME` | Display name used in the system prompt. | `Demo External Agent` |
| `AGENT_DEMO_MAX_TOOL_ITERATIONS` | Safety cap on the tool-calling loop. | `12` |
| `AGENT_SKILLS_DIR` | Override the path to `./agent-skills` (defaults to the sibling directory). | `../agent-skills` |
| `PROCURE_CLI_BIN` | Override the path to `procure`'s `bin/procure.ts` (defaults to the bundled one). | `../agent-skills/scripts/cli/bin/procure.ts` |
| `DEMO_WEBHOOK_SECRET` | Default `--secret` for both the `webhook` and `serve` commands — for `serve`, must match the secret typed into `./app`'s "Webhook subscribers" form. Set it in `agent-demo/.env` (not `.env.example` — that's just the committed template), and restart `serve` after changing it; see [Troubleshooting: I changed `DEMO_WEBHOOK_SECRET` but verification still fails](#troubleshooting-i-changed-demo_webhook_secret-but-verification-still-fails) if it doesn't take. | `demo-secret` |
| `AGENT_DEMO_PORT` | Default `--port` for `agent-demo serve`. | `4021` |
| `PROCURE_BASE_URL`, `PROCURE_PRIVATE_KEY`, `PROCURE_MCP_API_KEY`, `PROCURE_KEEPERHUB_API_KEY`, `PROCURE_KEEPERHUB_BASE_URL`, `PROCURE_KEEPERHUB_EXECUTION_MODE`, `PROCURE_REGISTRY_ADDRESS`, `PROCURE_RPC_URL` | Passed straight through (inherited process env) to the shelled-out `procure` CLI — same variables, same meaning as [`agent-skills/README.md#environment-variables`](../agent-skills/README.md#environment-variables). This agent never reads or holds these itself; it only launches a process that does. | see `agent-skills/README.md` |

## Wiring `./app`'s dashboard UI to this demo agent

`./app` (`http://localhost:3000`) has four panels on its dashboard for
driving a procurement intent end to end. Only two of them are live-wired to
this package as shipped; the other two need setup beyond typing a value into
a form. This section is the concrete "what do I type where" reference.

```mermaid
flowchart LR
    subgraph UI["./app dashboard (localhost:3000)"]
        P1["1 · KeeperHub policy"]
        P2["2 · Procurement intent"]
        P3["Webhook subscribers"]
        P4["Authorized agents\n(live ERC-8004 gate)"]
    end

    P1 -->|"read by"| Agent
    P2 -->|"POST /api/procurement-intents\nrecords intent, then dispatches"| P3
    P3 -->|"signed webhook POST\n(agent-demo serve listening)"| Agent["agent-demo\n(this package)"]
    Agent -.->|"recordProcurement()\nrequires prior authorization"| P4

    style P4 stroke-dasharray: 5 5
```

### Panel-by-panel

| # | Panel | Reaches `agent-demo`? | What to enter today |
| --- | --- | --- | --- |
| 1 | **KeeperHub policy** | Indirectly — this agent fetches it read-only via `GET /api/agent/entrypoints/policy/invoke` once it acts. | Already seeded from `app/.env.local`: Max USD/task `2`, Min APY `1.00`, Allowed assets `USDC`, Allowed protocols `aave-v3` only. Matches `fixtures/webhook-generic.json` — leave as-is. |
| 2 | **Procurement intent** | Only via panel 3's dispatch — doesn't execute anything itself. | Instruction `Move 2 USDC from our treasury to an approved lending protocol, but only if APY > 1%.`, Asset `USDC`, Amount `2`, Min APY `1.0` (all defaults). |
| 3 | **Webhook subscribers** | **Yes**, if `agent-demo serve` is running — see below. | Name: anything; Platform: `generic` (or `hermes`/`openclaw`); URL: `http://localhost:4021/webhook/generic` (match the port/path to your platform choice); Secret: same value as `DEMO_WEBHOOK_SECRET` (`demo-secret` by default). |
| 4 | **Authorized agents** | N/A (this is `./app` gating *incoming* on-chain writes from any agent, not something this package calls) | Needs real on-chain setup before it accepts anything meaningful — see below. |

### Why "Allowed protocols" is restricted to `aave-v3`

The policy's `allowedProtocols` seed intentionally excludes `compound-v3`
and `morpho`, even though `./app` still discovers all three as candidate
providers. This isn't a preference — it's required for a run to ever reach
a successful KeeperHub execution.

| Protocol | Seeded APY (`app/lib/lucid/mock-providers.ts`) | Contract on Base Sepolia | Included in policy? |
| --- | --- | --- | --- |
| `morpho` | 5.60% (highest) | **Fake/illustrative** address — no real deployment exists to point to | No |
| `compound-v3` | 4.80% | **Fake/illustrative** address — no usable Base Sepolia testnet deployment (confirmed against Compound's own repos/APIs) | No |
| `aave-v3` | 3.20% (lowest) | **Real, verified** Aave v3 Pool proxy (from `aave-dao/aave-address-book`) | **Yes** |

The reason this matters is the CLI's offer-selection order in
[`agent-skills/scripts/cli/src/orchestrate.ts`](../agent-skills/scripts/cli/src/orchestrate.ts) —
it sorts every *policy-eligible* offer by APY, descending, and executes
against whichever comes out on top:

```mermaid
flowchart TB
    Discover["Discover offers\n(A2A, all 3 providers)"] --> Filter["Filter to policy-eligible\n(asset + protocol + min APY)"]
    Filter --> Sort["Sort eligible offers\nby APY, descending"]
    Sort --> Pick["Pick offers[0]\n(highest APY)"]

    Pick --> Check{"Is picked protocol\naave-v3?"}
    Check -->|"morpho or compound-v3\nallowed in policy"| Fake["Fake gateway contract address\n-> KeeperHub can't fetch its ABI\n-> execution fails every time"]
    Check -->|"aave-v3\n(only protocol left when\npolicy excludes the other two)"| Real["Real, verified Aave v3 Pool\n-> KeeperHub executes for real"]

    style Fake stroke:#c0392b
    style Real stroke:#27ae60
```

Because the selection logic always prefers the highest APY among whatever
the policy allows, leaving `compound-v3`/`morpho` in `allowedProtocols`
means they win the sort (5.60% / 4.80% > Aave's 3.20%) and the run reaches
KeeperHub only to fail fetching an ABI for an address that was never a real
contract. Restricting the policy to `allowedProtocols=aave-v3` removes them
from the eligible set entirely, so the sort has only one candidate left —
the one gateway with a real, verified Base Sepolia contract — and the run
can complete the KeeperHub step instead of failing on it deterministically.

### Live wire: registering `agent-demo` as a Webhook subscriber

`agent-demo serve` runs a real HTTP listener (`src/server.ts`), so the
dashboard's "Dispatch to subscribed agents" button can wake this agent up
directly — no manual file-copying step required.

```mermaid
sequenceDiagram
    participant Admin as Human enterprise admin user
    participant UI as Enterprise Procurement management platform (./app) dashboard
    participant Sub as Webhook subscribers list
    participant Demo as agent-demo serve (this package)

    Note over Admin,Demo: One-time setup
    Admin->>Demo: node bin/agent-demo.ts serve --port 4021
    Admin->>UI: Add subscriber (platform=generic, url=http://localhost:4021/webhook/generic, secret=demo-secret)

    Note over Admin,Demo: Every dispatch from here on is live
    Admin->>UI: Fill policy + intent, click Dispatch
    UI->>Sub: POST /api/procurement-intents
    Sub->>Demo: signed webhook POST -> POST /webhook/generic
    Demo-->>Sub: 202 Accepted (immediately)
    Demo->>Demo: verify_webhook_signature, LLM decides, run_procure
```

| Step | Where | Command / action |
| --- | --- | --- |
| 1 | `agent-demo/` (separate terminal) | `node bin/agent-demo.ts serve --port 4021 --secret demo-secret` (or just `npm run serve` — both default to `AGENT_DEMO_PORT`/`DEMO_WEBHOOK_SECRET` from `.env`). Leave it running; every subsequent dispatch from `./app` triggers a fresh agent run, logged to this terminal. |
| 2 | `./app` dashboard, "Webhook subscribers" panel | Add a subscriber: Platform `generic` (or `hermes`/`openclaw` — pick whichever persona you set `AGENT_DEMO_PERSONA` to, since that shapes the signature scheme this agent expects), URL `http://localhost:4021/webhook/generic`, Secret `demo-secret` (must exactly match `DEMO_WEBHOOK_SECRET`). |
| 3 | `./app` dashboard, "Procurement intent" panel | Fill in the instruction/asset/amount/min APY, click "Dispatch to subscribed agents." The dashboard reports `Dispatched to 1/1 subscriber(s)`; watch the `agent-demo serve` terminal for the full trace (skill load, LLM turns, tool calls, final report). |

The response the dashboard sees is a `202 Accepted` sent back immediately on
receipt — `dispatchToSubscriber` (`app/lib/webhooks/dispatch.ts`) only checks
that the POST succeeded, it doesn't wait for the agent's reasoning loop to
finish, since that ([OpenRouter](https://openrouter.ai/docs/quickstart) turns + shelling out to `procure`) can run
well past a typical webhook timeout. The actual outcome shows up as a
`ProcurementRegistry` receipt on `./app`'s "Activity & receipts" panel once
`run_procure act` completes, same as the manual `webhook` command.

The manual, file-based flow (`agent-demo webhook --payload
fixtures/webhook-generic.json`) still works exactly as before and remains
useful for a scripted/deterministic run that doesn't depend on a listener
being up — the two are interchangeable front doors to the same agent loop.

### "Authorized agents (live [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) gate)" — what's required first

This panel isn't a free-text field either, and it only works with a wallet
connected in the dashboard (top of the page) — there's no server-signed
fallback, since a `ProcurementRegistry`'s owner is always the wallet that
created it via `ProcurementRegistryFactory` (see
[`contracts/README.md`](../contracts/README.md)). `POST /api/agents/verify`
runs a **live on-chain check** (`app/lib/identity/gate.ts`) that the
`agentId` you enter really resolves, on the [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) Identity Registry
(Base Sepolia), to the wallet `address` you enter; only then does the
connected wallet itself sign `addAuthorizedAgent()` on the target registry.

```mermaid
flowchart TB
    Admin["Human enterprise admin user, wallet connected\ntypes address + agentId"] --> Verify["POST /api/agents/verify"]
    Verify --> Gate["gate.ts: verifyAgentOnChain(agentId, address)"]
    Gate --> IdReg["ERC-8004 Identity Registry\n(Base Sepolia)\nowner of agentId"]
    IdReg -->|"owner != address"| Fail2["403 verification_failed"]
    IdReg -->|"owner == address"| Allow["Connected wallet signs\naddAuthorizedAgent(address)\non the Target ProcurementRegistry"]
    Allow --> Active["POST /api/procurement-registry/active\n(dashboard keeps this in sync automatically)"]
    Active --> Ready["Whichever registry is active,\nagent-demo's wallet can now recordProcurement() on it"]
```

| Requirement | Current state | Needed to unblock |
| --- | --- | --- |
| A wallet connected in the dashboard, owning a `ProcurementRegistry` | **Depends on your session** | Connect **MetaMask**/**Rabby Wallet** at the top of the dashboard, then use "New ProcurementRegistry contract creation" to deploy one via `ProcurementRegistryFactory.createNewProcurementRegistry()` (deployed at the factory address in root [`README.md`](../README.md#deployed-contracts)) if you don't already own one. |
| `PROCURE_REGISTRY_ADDRESS` in `agent-demo/.env` matching the registry you authorized the agent on | **Must be checked manually** | Copy the exact address shown in the dashboard's "Target ProcurementRegistry" field (or the "Your registries" pill you used) into `agent-demo/.env`'s `PROCURE_REGISTRY_ADDRESS` — a mismatch here is the classic cause of `recordProcurement` reverting with `NotAuthorizedAgent` even though the wallet *is* authorized, just on a different registry instance. |
| `PROCURE_PRIVATE_KEY` in `agent-demo/.env` | **Set** (a fixed EOA, not a throwaway-per-run key) | Needs Base Sepolia ETH for gas — see the troubleshooting section below; it has none yet. |
| An `agentId` registered to that wallet on the [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) Identity Registry | **Does not exist yet** | Set `ENTERPRISE_ADMIN_PRIVATE_KEY` in `app/.env.local` (any funded Base Sepolia key — it no longer has to match `PROCURE_PRIVATE_KEY`), then use the dashboard's "Authorize Agent (by Registering in the [ERC-8004](https://github.com/erc-8004/erc-8004-contracts))" panel (`POST /api/agents/identity`), entering `PROCURE_PRIVATE_KEY`'s address in the panel's **Agent Wallet Address** field, to mint the identity — it returns the `agentId` + wallet address, and a "Use below ↓" button pre-fills the "Authorized agents" form beneath it. (Previously this required running `@lucid-agents/identity`'s `createAgentIdentity`/`identity()` by hand; the panel productizes that step.) |

`ENTERPRISE_ADMIN_PRIVATE_KEY` (renamed from `AGENT_IDENTITY_PRIVATE_KEY`,
which wrongly implied it had to be a specific agent's own key) and
`PROCURE_PRIVATE_KEY` are two env vars in two different apps' env files, and
no longer need to hold the same key — the panel mints with the former and
transfers the resulting identity on-chain to whatever address is entered as
**Agent Wallet Address** (typically `PROCURE_PRIVATE_KEY`'s address):

| | `ENTERPRISE_ADMIN_PRIVATE_KEY` (`app/.env.local`) | `PROCURE_PRIVATE_KEY` (`agent-demo/.env`) |
| --- | --- | --- |
| Held by | `./app` (the enterprise's management platform) | `./agent-demo` (the external agent acting on the enterprise's behalf) |
| Used for | Signing the one-time `POST /api/agents/identity` call — mints the [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) identity NFT via `IdentityRegistryClient.register()`, then transfers it via `IdentityRegistryClient.transfer()` | Signing SIWX auth challenges, executing via KeeperHub, and writing `ProcurementRegistry.recordProcurement()` |
| Why it signs | `register()` mints the new identity to whichever wallet signs the tx — there's no "register on behalf of" option — so this key mints, then hands the identity off | It's simply the agent's own operating wallet, used for every on-chain/auth action it takes |
| Must equal | Nothing — any funded Base Sepolia key works; it only pays gas | The wallet whose identity gets registered and later authorized — enter its address in the panel's **Agent Wallet Address** field |
| In production | Would normally *not* be held here at all — the agent operator would register their own identity and just hand the platform the resulting `agentId`/address (see [`app/README.md`](../app/README.md)'s server/caller-secrets table) | Always lives with the agent, never with the platform |

Until all four rows above are done, the "Authorized agents" panel — and
therefore `agent-demo`'s (or `procure`'s) on-chain `recordProcurement()`
write and its `report/invoke` call — will fail.

## Troubleshooting: `agent-demo serve` doesn't react to a dispatch

If clicking "Dispatch to subscribed agents" in `./app` produces no output at
all in the `agent-demo serve` terminal — not even a `[server] ✗ ...` warning
line — the POST likely never reached the process:

1. **Is `agent-demo serve` actually running, on the port you registered?**
   `curl http://localhost:4021/health` should return `{"ok":true}`. If it
   hangs or refuses, the server isn't up (or is on a different port than the
   subscriber URL says).
2. **Did the app's dispatch even fire?** Check the dashboard's response after
   clicking dispatch — `Dispatched to 0/1 subscriber(s)` (vs. `1/1`) means
   the fetch itself failed (wrong host/port, or nothing listening). `no
   active webhook subscribers to dispatch to` means the subscriber list is
   empty or every entry has `active: false`.
3. **Wrong path, silently swallowed by an older build.** Both `POST /` (the
   bare URL) and `POST /webhook/<hermes|openclaw|generic>` are valid routes
   — but if you registered some other path (a typo, or a stale URL from
   before this repo added `/webhook/:platform`), the server responds `404`
   and, as of this fix, logs `[server] ✗ <method> <path> — no matching
   route`. If you don't see that line either, you're running an older build
   of `src/server.ts` that 404'd silently — restart `agent-demo serve` to
   pick up the current code.

The most common concrete cause: an admin pastes the bare origin
(`http://localhost:4021`) into the subscriber form, since that's what's
easiest to type/remember. That's intentionally supported (see the `serve`
row in [Commands](#commands)) — the platform is inferred from whichever
signature header shows up on the request — but it only works with a server
new enough to have that fallback, so restart `agent-demo serve` after
pulling this repo if you were already running it.

## Troubleshooting: webhook signature verification always fails (fixed)

Once `agent-demo serve` is correctly receiving the dispatch (see above), the
LLM's final report could still be a flat refusal, even with the *correct*
secret configured on both sides:

```
[llm] final report:
Webhook signature verification failed. The x-procurement-signature-256
header does not match the expected HMAC-SHA256 of the raw body using the
shared secret demo-secret.

Action refused — I will not process this procurement intent until a valid
signature is received.
```

This was never a secret/config mismatch — `app/lib/webhooks/dispatch.ts`
(the sender) and `src/tools.ts`'s `verifyGeneric`/`verifyHermes`/
`verifyOpenClaw` (the verifier) always agreed on the secret, the header name,
and the `sha256=<hex>` prefix format. The bug was in *how* the verifier's
inputs reached it:

```mermaid
flowchart TB
    subgraph Before["Before: LLM retypes the raw body"]
        B1["server.ts captures the exact\nraw request bytes"] --> B2["agent.ts's describeTrigger()\nsplices rawBody into a plain-text\nuser-message prompt"]
        B2 --> B3["LLM reads the prompt, then must\nretype rawBody as a JSON string\ninside its own tool-call arguments"]
        B3 --> B4["verify_webhook_signature(args.rawBody, ...)\nHMACs whatever the LLM retyped"]
        B4 --> B5["Any reformatting (whitespace,\nkey order, quoting) the LLM\nintroduces changes the HMAC entirely"]
        B5 --> BFail["verified: false\n— even for a legitimately\nsigned webhook"]
    end

    subgraph After["After: tool reads the actual trigger"]
        A1["server.ts captures the exact\nraw request bytes"] --> A2["runExternalAgent passes the\nsame AgentTrigger object into\nctx.trigger for every tool call"]
        A2 --> A3["verify_webhook_signature takes\nno arguments — executeTool reads\nrawBody/headers/secret from ctx.trigger"]
        A3 --> APass["HMAC computed over the exact\nbytes the sender signed, every time"]
    end

    style BFail stroke:#c0392b
    style APass stroke:#27ae60
```

The raw JSON body reaches the LLM only as text inside a natural-language
prompt (`describeTrigger()` in `src/agent.ts`); asking it to reproduce that
same JSON byte-for-byte inside a *different* JSON context (its own tool-call
arguments) has no such guarantee — a model commonly "cleans up" whitespace,
reorders keys, or normalizes quoting while transcribing. HMAC-SHA256 changes
completely on a single byte of drift, so any of that turned a legitimately
signed webhook into a failed verification, deterministically, every time —
not an intermittent flake.

| File | Change |
| --- | --- |
| [`src/tools.ts`](src/tools.ts) | `ToolContext` gained a `trigger?: AgentTrigger` field. `verify_webhook_signature`'s tool schema now takes **no arguments** (`properties: {}`) instead of `platform`/`rawBody`/`secret`/`signatureHeader`/`timestampHeader`. `executeTool`'s handler for it now reads `platform`, `rawBody`, `headers`, `secret` straight from `ctx.trigger` and looks up the right header per platform (`x-webhook-signature-v2`/`x-webhook-timestamp` for hermes, `authorization` for openclaw, `x-procurement-signature-256` for generic) instead of trusting any LLM-supplied argument. |
| [`src/agent.ts`](src/agent.ts) | The `executeTool(...)` call in the tool-calling loop now passes `trigger` through in its `ctx` object, so every tool call — not just this one — has access to the actual trigger data if it needs it. |

The LLM still *decides* when to call `verify_webhook_signature` (the system
prompt still tells it to, first, for a webhook trigger) and still sees the
raw body/secret/headers in its prompt for its own situational awareness —
it's just no longer the one supplying the bytes the HMAC is actually computed
over.

**If you still see the old symptom after pulling this fix**, check the tool
call the LLM actually requested in the log: `verify_webhook_signature({})`
means the fix is live; `verify_webhook_signature({"platform":"generic",
"rawBody":"...", "secret":"...", "signatureHeader":"..."})` means the running
`agent-demo serve` process was started *before* this fix — `node
bin/agent-demo.ts serve` has no hot-reload, so editing `src/tools.ts` has no
effect on an already-running process. Stop it (Ctrl+C) and start it again
(`npm run serve` or `node bin/agent-demo.ts serve`) to pick up the fix.

## Troubleshooting: I changed `DEMO_WEBHOOK_SECRET` but verification still fails

The server's own startup log is the ground truth here — it prints exactly
which secret it's checking against:

```
[server] secret must match too — this server expects: demo-secret
```

If that still says the *old* value after you thought you changed it, it's
one of these two things, in order:

1. **You edited `.env.example`, not `.env`.** `.env.example` is the
   committed template — `src/config.ts` only ever loads `.env` (via
   `loadDotenv({ path: join(PACKAGE_DIR, ".env") })`), which is gitignored
   and holds your actual local values. Editing `.env.example` changes what a
   fresh `cp .env.example .env` would produce for someone else, never the
   config this process (or any already-running one) actually reads. If
   you don't have a `.env` yet, `cp .env.example .env` first, then edit
   *that* file.
2. **You edited the right file, but didn't restart.** Same as the code fix
   above — `dotenv` loads `.env` once, at process startup, into
   `process.env`. `node bin/agent-demo.ts serve` has no config hot-reload
   either, so a running process keeps whatever `DEMO_WEBHOOK_SECRET` value
   it started with regardless of later edits to `.env`. Stop it (Ctrl+C)
   and start it again.

Once the startup log shows the value you actually intended, update the
subscriber's Secret field in `./app`'s "Webhook subscribers" panel to match
— that field shows its stored value in plaintext in the table afterward
(deliberately not redacted, precisely so a mismatch like this is visible by
eye instead of only surfacing as a rejection on this side), so the two can
be compared directly.

## Troubleshooting: a live `webhook`/`instruct` run exhausts its tool-call budget

A real run against this package's own env (a configured `PROCURE_KEEPERHUB_API_KEY`
and `PROCURE_REGISTRY_ADDRESS`, both already set in `agent-demo/.env`) can fail
with `✗ Exceeded maxToolIterations (12) without a final report from the LLM.` —
the LLM never crashes outright, but `run_procure act`/`submit` keeps handing it
an unrecoverable error, so it flails (re-checking config, retrying with
different args) instead of reporting a clean failure. This section is the
result of actually tracing that failure end to end, including two code fixes
already applied in this repo.

### It's not the wallet type

The first hypothesis was that KeeperHub's ["Agentic Wallet"](https://docs.keeperhub.com/agent/agentic-wallet)
(`@keeperhub/wallet`, Turnkey-backed) should replace `PROCURE_PRIVATE_KEY`.
Inspecting the actual package (`npm pack @keeperhub/wallet` and reading its
`dist/index.d.ts`) ruled that out:

| Fact | Detail |
| --- | --- |
| What it's actually for | Its own `package.json` description: *"auto-pay x402 and MPP 402 responses with a server-side Turnkey proxy"* — an agent-IDE hook (Claude Code/Cursor/etc.) that auto-pays HTTP `402 Payment Required` challenges, not a general contract-call signer. |
| Its exported API | `createPaymentSigner`, `parseX402Challenge`, `parseMppChallenge`, `checkBalance`, `fund()`, `createPreToolUseHook()` — nothing resembling `signTransaction`/`signMessage` for an arbitrary contract call. |
| Chains it supports | Base **mainnet** (8453) and Tempo only — **not Base Sepolia** (84532), where `ProcurementRegistry` and the Aave v3 gateway actually live. |

`ProcurementRegistry.recordProcurement()` also checks `msg.sender` directly
([`contracts/src/ProcurementRegistry.sol:87`](../contracts/src/ProcurementRegistry.sol#L87)),
so whatever wallet calls it must itself be on the allowlist — a raw EOA via
`PROCURE_PRIVATE_KEY` is the correct mechanism here, not a replacement to fix.

### The two real bugs (both fixed)

Tracing one real, non-demo-mode `procure act` call (`PROCURE_KEEPERHUB_API_KEY`
and `PROCURE_REGISTRY_ADDRESS` both set — the same env this package already
ships) surfaced two separate unhandled-exception bugs, each one enough on its
own to crash the whole pipeline and derail the LLM's tool loop:

```mermaid
flowchart TB
    Start["procure act"] --> Discover["Discover + evaluate policy"]
    Discover --> KH["checkApyAndExecuteSupply()\nKeeperHub DirectExecutor.checkAndExecute()"]
    KH --> Bug1{"result.condition\npresent?"}
    Bug1 -->|"no (real API can omit it\non a failed action leg)"| Fixed1["FIXED: keeperhub.ts + orchestrate.ts\nnow treat this as a reported failure,\nnot a crash"]
    Bug1 -->|yes| Record["recordProcurementOnChain()\nrecordProcurement() write"]
    Record --> Bug2{"wallet funded\n+ authorized?"}
    Bug2 -->|"no (today: 0 ETH,\nnot yet allowlisted)"| Fixed2["FIXED: orchestrate.ts now\ncatches this and reports\nchain.record_failed in the\ntimeline, instead of throwing"]
    Bug2 -->|yes| Done["Recorded on-chain,\nreported to dashboard"]

    style Fixed1 stroke:#27ae60
    style Fixed2 stroke:#27ae60
```

| # | Bug | Where | Symptom before the fix | Fix |
| --- | --- | --- | --- | --- |
| 1 | KeeperHub's real `checkAndExecute` can return a result with no `condition` field (e.g. the action leg errored) even though the SDK's TypeScript type declares it as always present. | [`agent-skills/scripts/cli/src/keeperhub.ts`](../agent-skills/scripts/cli/src/keeperhub.ts) (`condition: { met: result.condition.met, ... }`) and [`orchestrate.ts`](../agent-skills/scripts/cli/src/orchestrate.ts) (`execution.condition!.met`) | `{"error":"Cannot read properties of undefined (reading 'met')"}` — an uncaught `TypeError` crashing the whole `act`/`submit` call. | Both now check for a missing `condition` and report a clean `keeperhub.execution_failed` timeline entry (with the API's own `raw` error attached) instead of throwing. |
| 2 | `recordProcurementOnChain()`'s write call had no try/catch, so any revert (unfunded wallet, not-yet-authorized wallet, RPC error) propagated uncaught. | [`agent-skills/scripts/cli/src/orchestrate.ts`](../agent-skills/scripts/cli/src/orchestrate.ts) (`reportAndMaybeRecord`) | A viem revert (e.g. `gas required exceeds allowance (0)`) crashed the whole command instead of the task completing with a reported failure. | Now wrapped in try/catch; a failure is pushed as a `chain.record_failed` timeline entry and the rest of the pipeline (dashboard report attempt) still runs. |

Verified with a real (non-demo) `procure act` call after both fixes: the CLI
now returns a complete, valid JSON task instead of crashing — status
`"completed"` for the KeeperHub leg, with the on-chain write's failure
recorded cleanly in the timeline rather than throwing.

### Fix #3: the Aave v3 `supply()` ABI-overload ambiguity

Also fixed, and re-verified with a real (non-demo) `procure act` call.
Aave v3's Pool proxy exposes two functions named `supply` — the real
`supply(address,uint256,address,uint16)` and an unrelated `supply(bytes32)`
— so KeeperHub's auto-fetched explorer ABI couldn't tell which one
`aave-v3-gateway`'s config meant and refused to guess:

```
"Function 'supply' matches 2 overloads in this ABI, so the one to call cannot
be determined. Re-select the function to store its full signature:
supply(address,uint256,address,uint16), supply(bytes32)"
```

| File | Change |
| --- | --- |
| [`app/lib/types.ts`](../app/lib/types.ts) | Added an optional `abi?: string` field to `ProviderOffer["rateContract"]`/`["supplyContract"]` (a JSON ABI-fragment array). |
| [`app/lib/lucid/mock-providers.ts`](../app/lib/lucid/mock-providers.ts) | `aave-v3-gateway.supplyContract` now carries the exact `supply(address,uint256,address,uint16)` ABI fragment, pinning the overload. |
| [`agent-skills/scripts/cli/src/keeperhub.ts`](../agent-skills/scripts/cli/src/keeperhub.ts) | `checkApyAndExecuteSupply` now threads `provider.rateContract.abi`/`provider.supplyContract.abi` into both the baseline `callContract()` read and `checkAndExecute()`'s `action` call. |

Re-running `procure act` after this fix, the ABI error is gone entirely —
KeeperHub's real API now gets as far as attempting the actual gas
estimation for the `supply()` transaction, and fails only on:

```
"Insufficient BASE balance. Have: 0.0, Need: 0.000000231.
Fund 0xbc44e17797048d137b6be6aa2651af89a4248218 with at least
0.000000231 BASE on this chain and retry."
```

(`BASE` here is KeeperHub's own API wording for "this chain's native gas
currency" — Base and Base Sepolia use **ETH** as their native token, same as
Ethereum mainnet and other OP Stack chains; there is no separate "BASE"
coin. The amount needed is `0.000000231 ETH`.)

### Fix #4: `onBehalfOf` was the provider's registry identifier, not this agent's wallet

Funding past the gas error above surfaced a fourth, more fundamental bug:
`checkApyAndExecuteSupply` was filling Aave's `supply()` `onBehalfOf`
parameter — the address that receives the resulting aTokens — with
`provider.registration.agentRegistry`, e.g.
`"eip155:84532:0x2e234dae75c793f67a35089c9d99245e1c58470b"`. That's wrong on
two counts: it's the *provider's* [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) registry identifier, not this
agent's own wallet, and it's a CAIP-2 string, not a plain `0x...` address —
so when KeeperHub/viem tried to encode it as an `address`, it fell back to
ENS resolution (the standard behavior for a non-hex-address string), which
Base Sepolia doesn't support:

```
"network does not support ENS"
```

| File | Change |
| --- | --- |
| [`agent-skills/scripts/cli/src/keeperhub.ts`](../agent-skills/scripts/cli/src/keeperhub.ts) | `checkApyAndExecuteSupply` now takes an explicit `onBehalfOf` param and uses it instead of `provider.registration.agentRegistry`. |
| [`agent-skills/scripts/cli/src/orchestrate.ts`](../agent-skills/scripts/cli/src/orchestrate.ts) | Passes `onBehalfOf: account.address` — this agent's own `PROCURE_PRIVATE_KEY`-derived wallet, the correct beneficial owner of the aTokens. |

Re-verified live: the ENS error is gone, and the pipeline now gets all the
way to attempting the real `supply()` transaction, failing only on:

```
"Contract call failed: Error(ERC20: transfer amount exceeds balance)"
```

— KeeperHub's execution wallet has no USDC to supply. A pure funding gap,
one step further than before.

### Fix #5: the org wallet had a USDC balance but no allowance for Aave's Pool

Once KeeperHub's execution wallet was funded with Base Sepolia USDC, the
error above (`exceeds balance`) advanced one step, to:

```
"Contract call failed: Error(ERC20: transfer amount exceeds allowance)"
```

Aave v3's `supply()` calls `transferFrom(msg.sender, ...)` under the hood —
it moves the caller's USDC into the Pool itself, which needs the caller to
have `approve()`d the Pool as a spender first. Nothing in the pipeline ever
called `approve()`; `checkApyAndExecuteSupply` went straight from reading
the baseline rate to `checkAndExecute()`'s guarded `supply()` write. This
isn't a KeeperHub-specific problem — a raw wallet driving Aave directly
would hit the exact same revert — and confirmed against KeeperHub's own
docs (`https://docs.keeperhub.com`, Direct Execution API reference): there's
no dedicated approve endpoint; an approval is just another `contract-call`
write calling the token's own `approve(spender, amount)`.

| File | Change |
| --- | --- |
| [`app/lib/types.ts`](../app/lib/types.ts) | Added an optional `approve?: { tokenAddress, spenderAddress }` field to `ProviderOffer["supplyContract"]`. |
| [`app/lib/lucid/mock-providers.ts`](../app/lib/lucid/mock-providers.ts) | `aave-v3-gateway.supplyContract.approve` now points at the Base Sepolia USDC contract and the Aave v3 Pool proxy as spender. |
| [`agent-skills/scripts/cli/src/keeperhub.ts`](../agent-skills/scripts/cli/src/keeperhub.ts) | `checkApyAndExecuteSupply` now calls `executor.callContract()` with `approve(spenderAddress, amount)` on `tokenAddress` immediately before `checkAndExecute()`'s guarded `supply()` write, whenever `provider.supplyContract.approve` is set. |

This re-approves the exact amount being supplied on every run rather than
reading the org wallet's current allowance first — KeeperHub manages that
wallet internally and doesn't expose its address, so there's no cheap way
to read its allowance directly. An extra `approve` call when the allowance
is already sufficient is redundant but harmless (idempotent, and cheap
relative to the supply transaction itself).

### What's still open

One authorization gap remains — it requires dashboard configuration, not
further code changes:

| # | Issue | Evidence |
| --- | --- | --- |
| 1 | `PROCURE_PRIVATE_KEY`'s wallet (`test_opera_1`) isn't yet on `ProcurementRegistry`'s `authorizedAgents` allowlist, and/or lacks Base Sepolia ETH for `recordProcurement()`'s gas. | Real revert once the KeeperHub leg succeeds: the contract's own `NotAuthorizedAgent`, or `gas required exceeds allowance (0)` if unfunded. Use the "Authorize Agent (by Registering in the [ERC-8004](https://github.com/erc-8004/erc-8004-contracts))" panel, then "Authorized agents", per the section above. |

Once that wallet is funded and authorized, `procure act`/`submit` and
`agent-demo` should complete the full pipeline: KeeperHub execution, the
on-chain receipt write, and the report back to `./app`.

### Base Sepolia token addresses & faucets

There are **two different "USDC" ERC-20 contracts** in play on Base Sepolia —
sending the wrong one to KeeperHub's execution wallet
(`0xbc44e17797048d137b6be6aa2651af89a4248218`, from row 1 above) will still
leave it with `ERC20: transfer amount exceeds balance` on `supply()`:

| Token | Address (Base Sepolia) | Used for | Faucet |
| --- | --- | --- | --- |
| **Aave test USDC** (`USDC_UNDERLYING`, Aave's own Base Sepolia market) | [`0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f`](https://sepolia.basescan.org/address/0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f) | **This is the one that matters here** — hardcoded as the `asset` in the Aave v3 offer's `supplyContract.argsTemplate` (see [`app/lib/lucid/mock-providers.ts`](../app/lib/lucid/mock-providers.ts)), so it's what KeeperHub's `supply()` call on the Aave Pool (`0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27`) actually pulls from `onBehalfOf`. | Aave's Base Sepolia `Faucet` contract at [`0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc`](https://sepolia.basescan.org/address/0xd9145b5f45ad4519c7accd6e0a4a82e83bb8a6dc) — see below. |
| **Circle USDC** (Circle's official Base Sepolia deployment) | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036cbd53842c5426634e7929541ec2318f3dcf7e) | Not used by this platform's Aave path — listed here only because it's the USDC address most Base Sepolia tooling/tutorials reference, and it's easy to confuse with the one above. | [Circle faucet](https://faucet.circle.com/) — pick "Base Sepolia", paste your address. |

If KeeperHub's wallet ends up holding Circle USDC instead of Aave's test
USDC, `supply()` will still revert — they're two unrelated ERC-20 contracts,
not variants of one token, and there's no swap/bridge between them on
testnet. Use the Aave faucet below to get the right one.

**Minting Aave test USDC to a wallet you don't hold the key for** (e.g.
KeeperHub's execution wallet, `0xbc44e17797048d137b6be6aa2651af89a4248218`
above): `./app` now productizes this — its dashboard's **Faucet** panel
(`/faucet`, see [`app/README.md`](../app/README.md#module-map)) calls the
same permissionless `Faucet.mint(address token, address to, uint256 amount)`
shown above from the platform's `ENTERPRISE_ADMIN_PRIVATE_KEY` (or a
connected wallet), to any recipient address, no private key for the
recipient needed. Open `http://localhost:3000/faucet`, paste the recipient
address and an amount, and submit — no block explorer or `cast` required.

If you'd rather call the contract directly (no dashboard running), the same
values work via a block explorer's "Write Contract" tab, `cast send`, or a
one-off viem/ethers script, from any wallet funded with a little Base
Sepolia ETH for gas:

```
Faucet.mint(
  token:  0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f,  // Aave test USDC
  to:     0xBC44E17797048D137b6bE6Aa2651af89a4248218,  // recipient, e.g. KeeperHub's execution wallet
  amount: 2000000                                       // 2 USDC (6 decimals)
)
```

## Relationship to `./agent-skills/scripts/cli`

| | `agent-skills/scripts/cli` (`procure`) | `agent-demo` (this package) |
| --- | --- | --- |
| Role | The actor's mechanical implementation — discovery read, policy evaluation, KeeperHub execution, on-chain write, reporting. | The actor's *decision layer* — what a real Hermes Agent/OpenClaw install supplies around that mechanism. |
| Driven by | CLI flags / a webhook JSON file, deterministically. | An LLM (via [OpenRouter](https://openrouter.ai/docs/quickstart)), reasoning over `agent-skills/SKILL.md` at runtime. |
| Knows about `./agent-skills`' content? | No — it's the thing the skill *describes*, not a reader of the skill file. | Yes — reads `SKILL.md` + `references/*.md` itself, live, the same way a real agent would. |
| Used by | Both `agent-demo`'s `run_procure` tool, and directly by any human/automation (see `agent-skills/README.md`). | — |

See [`../agent-skills/README.md`](../agent-skills/README.md) for the skill
package and CLI this agent drives, and [`../README.md`](../README.md) for
the project-level architecture.

## DEMO Video

- Demonstrate the interaction between the Demo Agent (`./agent-demo`) and Web App (`./app`):    
  https://youtu.be/ZZuMhfOZRqs?si=etQZqzL-GYKBkl2P

- NOTE: The value, which is inputted in the `secret` field of the "Webhook subscribers" panel on the Web App (`./app`), must match with the value-stored in the `DEMO_WEBHOOK_SECRET` in the `./agent-demo/.env`