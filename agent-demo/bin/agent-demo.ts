#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { Command } from "commander";
import { loadAgentDemoConfig, type Persona } from "../src/config.ts";
import { listSkillReferences, loadSkillSummary } from "../src/skills.ts";
import { runExternalAgent } from "../src/agent.ts";

const program = new Command();

program
  .name("agent-demo")
  .description(
    "A demo external agent — behaves as the same actor/role as Hermes Agent or OpenClaw would: reads ./agent-skills itself, reasons over an OpenRouter-hosted LLM, and drives the procure CLI. See agent-demo/README.md.",
  )
  .version("1.0.0");

function readInput(fileOrDash: string): string {
  return fileOrDash === "-" ? readFileSync(0, "utf8") : readFileSync(fileOrDash, "utf8");
}

/**
 * Stands in for `./app`'s webhook dispatcher (see app/lib/webhooks/dispatch.ts)
 * so this demo is self-contained: it signs the payload exactly the way the
 * real platform would for the given `--secret`, then hands the signed
 * request to this agent, which independently verifies it with the same
 * secret via its own `verify_webhook_signature` tool.
 */
function signAsPlatformWouldFor(platform: Persona, rawBody: string, secret: string): { headers: Record<string, string> } {
  if (platform === "hermes") {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    return { headers: { "X-Webhook-Signature-V2": `sha256=${signature}`, "X-Webhook-Timestamp": timestamp } };
  }
  if (platform === "openclaw") {
    return { headers: { Authorization: `Bearer ${secret}` } };
  }
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return { headers: { "X-Procurement-Signature-256": `sha256=${signature}` } };
}

program
  .command("skills")
  .description("List Agent Skills this agent has loaded (name + description only — step 1 of progressive disclosure).")
  .action(() => {
    const config = loadAgentDemoConfig();
    const summary = loadSkillSummary(config.skillsDir);
    console.log(`✔ loaded skill: ${summary.frontmatter.name}`);
    console.log(summary.frontmatter.description);
    console.log(`\nreferences available on demand: ${listSkillReferences(config.skillsDir).join(", ")}`);
  });

program
  .command("webhook")
  .description(
    "Simulate this agent receiving a signed webhook POST from ./app (Hermes/OpenClaw/generic route) and reasoning over what to do about it.",
  )
  .option("--platform <platform>", "hermes | openclaw | generic", "generic")
  .option("--payload <fileOrDash>", "path to the JSON payload body, or '-' for stdin", "-")
  .option("--secret <secret>", "webhook secret shared with the enterprise admin", process.env.DEMO_WEBHOOK_SECRET || "demo-secret")
  .action(async (opts: { platform: Persona; payload: string; secret: string }) => {
    const config = loadAgentDemoConfig();
    const rawBody = readInput(opts.payload).trim();
    const { headers } = signAsPlatformWouldFor(opts.platform, rawBody, opts.secret);

    const log = (line: string) => console.log(line);
    try {
      await runExternalAgent(config, { kind: "webhook", platform: opts.platform, rawBody, headers, secret: opts.secret }, log);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("instruct <text>")
  .description('Simulate a human enterprise admin telling this agent directly, no webhook, e.g. "Move 1M USDC... only if APY > 4%."')
  .action(async (text: string) => {
    const config = loadAgentDemoConfig();
    const log = (line: string) => console.log(line);
    try {
      await runExternalAgent(config, { kind: "instruction", text }, log);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
