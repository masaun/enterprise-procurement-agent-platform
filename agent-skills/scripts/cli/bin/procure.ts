#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { loadConfig, setConfigValue, configPath } from "../src/config.ts";
import * as api from "../src/api.ts";
import { runProcurementLocally, requestFromWebhookPayload } from "../src/orchestrate.ts";

const program = new Command();

program
  .name("procure")
  .description(
    "CLI for external agents (Hermes, OpenClaw, ...) to talk to the Enterprise Procurement Agent's ./app/api/agent surface. See agent-skills/SKILL.md.",
  )
  .version("1.0.0");

function report(label: string, data: unknown, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(data));
    return;
  }
  console.log(`✔ ${label}`);
  console.log(JSON.stringify(data, null, 2));
}

function fail(error: Error, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify({ error: error.message }));
  } else {
    console.error(`✗ ${error.message}`);
  }
  process.exitCode = 1;
}

program
  .command("status")
  .description("Check the procurement agent's health and this CLI's active configuration.")
  .option("--json", "machine-readable output")
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig();
    try {
      const health = await api.getHealth(config);
      report("agent reachable", { ...health, baseUrl: config.baseUrl, configFile: configPath() }, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

program
  .command("card [providerId]")
  .description("Fetch the procurement agent's own Agent Card, or a discovered provider's (by id).")
  .option("--json", "machine-readable output")
  .action(async (providerId: string | undefined, opts: { json?: boolean }) => {
    const config = loadConfig();
    try {
      const card = await api.getAgentCard(config, providerId);
      report(providerId ? `agent card for ${providerId}` : "procurement agent's own agent card", card, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

program
  .command("discover")
  .description('Discover candidate service providers over A2A/Agent Cards — "who should I buy from?"')
  .option("--json", "machine-readable output")
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig();
    try {
      const result = await api.discoverProviders(config);
      report("discovered providers", result.output, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

program
  .command("policy")
  .description("Show the enterprise's current KeeperHub execution policy.")
  .option("--json", "machine-readable output")
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig();
    try {
      const result = await api.getPolicy(config);
      report("current policy", result.output, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

program
  .command("auth")
  .description("Sanity-check SIWX auth: sign a challenge with the configured private key and verify it round-trips.")
  .option("--json", "machine-readable output")
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig();
    try {
      const result = await api.authenticate(config);
      report("authenticated", result.output, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

program
  .command("submit")
  .description(
    'Run a procurement request end-to-end, on THIS machine: discover providers + fetch policy from the platform, evaluate policy locally, execute via this agent\'s own KeeperHub key, write the receipt on-chain, and report the result to the platform\'s dashboard. e.g. "Move 1M USDC to an approved lending protocol, but only if APY > 4%."',
  )
  .requiredOption("--instruction <text>", "natural-language instruction")
  .requiredOption("--amount <amount>", "amount to move")
  .option("--asset <asset>", "asset symbol", "USDC")
  .option("--min-apy <percent>", "minimum required APY, in percent", "4.0")
  .option("--protocol <name...>", "restrict to specific protocols (repeatable)")
  .option("--json", "machine-readable output")
  .action(
    async (opts: {
      instruction: string;
      amount: string;
      asset: string;
      minApy: string;
      protocol?: string[];
      json?: boolean;
    }) => {
      const config = loadConfig();
      try {
        const request = {
          instruction: opts.instruction,
          asset: opts.asset,
          amount: opts.amount,
          minApyBps: Math.round(parseFloat(opts.minApy) * 100),
          ...(opts.protocol ? { allowedProtocols: opts.protocol } : {}),
        };
        const task = await runProcurementLocally(config, request);
        report("procurement task completed", task, opts.json);
      } catch (e) {
        fail(e as Error, opts.json);
      }
    },
  );

program
  .command("act")
  .description(
    "Act on a procurement intent received via webhook (Hermes prompt-triggered shell tool, OpenClaw run_task, or any automation) — reads the same JSON payload the platform's dispatcher sends and runs the identical pipeline as `submit`.",
  )
  .option("--payload <fileOrDash>", "path to a JSON file with the webhook payload, or '-' for stdin", "-")
  .option("--json", "machine-readable output")
  .action(async (opts: { payload: string; json?: boolean }) => {
    const config = loadConfig();
    try {
      const raw = opts.payload === "-" ? readFileSync(0, "utf8") : readFileSync(opts.payload, "utf8");
      const payload = JSON.parse(raw);
      const request = requestFromWebhookPayload(payload);
      const task = await runProcurementLocally(config, request);
      report("procurement task completed (from webhook payload)", task, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

program
  .command("task <taskId>")
  .description("Look up a procurement task by id.")
  .option("--json", "machine-readable output")
  .action(async (taskId: string, opts: { json?: boolean }) => {
    const config = loadConfig();
    try {
      const result = await api.getTaskStatus(config, taskId);
      report(`task ${taskId}`, result.output, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

program
  .command("mcp-call <toolName> [jsonArgs]")
  .description("Call a tool on the MCP endpoint directly (./app/api/agent/mcp), e.g. `procure mcp-call get_policy '{}'`.")
  .option("--json", "machine-readable output")
  .action(async (toolName: string, jsonArgs: string | undefined, opts: { json?: boolean }) => {
    const config = loadConfig();
    try {
      const args = jsonArgs ? JSON.parse(jsonArgs) : {};
      const result = await api.callMcpTool(config, toolName, args);
      report(`mcp tool ${toolName}`, result, opts.json);
    } catch (e) {
      fail(e as Error, opts.json);
    }
  });

const config = program.command("config").description(`Read/write ${configPath()}`);

config
  .command("get")
  .description("Print the resolved configuration (file + env overrides).")
  .option("--json", "machine-readable output")
  .action((opts: { json?: boolean }) => {
    const resolved = loadConfig();
    report("config", { ...resolved, privateKey: resolved.privateKey ? "(set)" : null }, opts.json);
  });

config
  .command("set <key> <value>")
  .description("Set baseUrl, privateKey, or mcpApiKey.")
  .action((key: string, value: string) => {
    setConfigValue(key, value);
    console.log(`✔ set ${key} in ${configPath()}`);
  });

program.parseAsync(process.argv);
