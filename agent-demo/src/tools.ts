import { createHmac, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { AgentDemoConfig } from "./config.ts";
import { listSkillReferences, readSkillReference } from "./skills.ts";
import type { ToolDefinition } from "./openrouter.ts";
import type { AgentTrigger } from "./agent.ts";

/**
 * The tool surface this demo agent's LLM (via OpenRouter) can call. It
 * deliberately mirrors the two things `agent-skills/SKILL.md` tells a real
 * external agent to do: read `references/*` on demand (progressive
 * disclosure), and act through the bundled `procure` CLI — the "fastest
 * path" per SKILL.md's "Three ways to act" table. This agent does not
 * reimplement discovery/policy/KeeperHub/on-chain logic itself; it decides,
 * via the LLM, *when* and *how* to invoke it, exactly like Hermes Agent or
 * OpenClaw would decide when to run a shell tool or TaskFlow action.
 */

export interface ToolContext {
  config: AgentDemoConfig;
  log: (line: string) => void;
  /**
   * The actual trigger this agent run was started from. `verify_webhook_signature`
   * reads its raw body/headers/secret from here — not from LLM-supplied tool-call
   * arguments — because those values reach the LLM only as text spliced into a
   * prompt (see `agent.ts`'s `describeTrigger`), and an LLM asked to retype a raw
   * JSON blob into a new JSON tool call is not guaranteed to reproduce it
   * byte-for-byte (reformatted whitespace, reordered keys, normalized quoting,
   * etc.). Since HMAC-SHA256 changes completely on any single byte of drift, that
   * retyping step made every verification fail even for a legitimately signed
   * webhook. Keeping the tool's inputs and the verification's actual inputs
   * decoupled makes verification correct regardless of what the LLM types.
   */
  trigger?: AgentTrigger;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_skill_references",
      description:
        "List the reference documents available under ./agent-skills (protocols, api-reference, mcp-tools, examples, the CLI's own README) without reading them yet. Use this before read_skill_reference.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_skill_reference",
      description:
        "Read one reference document from ./agent-skills by its relative path (as returned by list_skill_references), e.g. 'references/protocols.md'.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path returned by list_skill_references" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verify_webhook_signature",
      description:
        "Verify the inbound webhook this run was triggered by actually came from ./app, per agent-skills/references/protocols.md's 'Webhook signing' table (hermes: X-Webhook-Signature-V2 + X-Webhook-Timestamp; openclaw: Authorization: Bearer; generic: X-Procurement-Signature-256). Takes no arguments — the raw body, headers, and shared secret are read directly from the actual trigger, not from your own recollection of them, since retyping a raw JSON body byte-for-byte isn't something you can guarantee and any drift would break the signature check.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "run_procure",
      description:
        "Shell out to the bundled `procure` CLI (agent-skills/scripts/cli) — this agent's own actor: discovers providers, reads policy, evaluates it, executes via this agent's own KeeperHub key, writes the on-chain receipt, and reports back. Commands: status, card [providerId], discover, policy, auth, submit, act, task <taskId>, mcp-call <toolName> [jsonArgs], config get.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: ["status", "card", "discover", "policy", "auth", "submit", "act", "task", "mcp-call", "config"],
          },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              "Extra positional args / flags, e.g. [\"--instruction\", \"Move 1M USDC...\", \"--amount\", \"1000000\", \"--min-apy\", \"4.0\"] for submit, or [\"get\"] for config.",
          },
          stdin: {
            type: "string",
            description: "For `act`: the raw webhook payload JSON to pipe in via --payload -.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
];

function verifyHermes(rawBody: string, secret: string, signatureHeader: string, timestampHeader?: string): boolean {
  if (!timestampHeader) throw new Error("hermes verification requires timestampHeader (X-Webhook-Timestamp)");
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestampHeader}.${rawBody}`).digest("hex");
  return safeEqual(expected, signatureHeader);
}

function verifyOpenClaw(secret: string, signatureHeader: string): boolean {
  return safeEqual(`Bearer ${secret}`, signatureHeader);
}

function verifyGeneric(rawBody: string, secret: string, signatureHeader: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signatureHeader);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function runProcure(config: AgentDemoConfig, command: string, args: string[], stdin?: string): unknown {
  const fullArgs = [config.procureCliBin, command, ...args];
  if (command === "act" && !args.includes("--payload")) fullArgs.push("--payload", "-");
  if (!fullArgs.includes("--json")) fullArgs.push("--json");

  try {
    const stdout = execFileSync("node", fullArgs, {
      input: stdin,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout.trim() || "{}");
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout.trim());
      } catch {
        // fall through
      }
    }
    return { error: e.stderr?.trim() || e.message };
  }
}

export function executeTool(name: string, argsJson: string, ctx: ToolContext): string {
  const args = argsJson ? JSON.parse(argsJson) : {};

  switch (name) {
    case "list_skill_references": {
      const refs = listSkillReferences(ctx.config.skillsDir);
      ctx.log(`[tool] list_skill_references -> ${refs.length} file(s)`);
      return JSON.stringify({ references: refs });
    }

    case "read_skill_reference": {
      ctx.log(`[tool] read_skill_reference(${args.path})`);
      const content = readSkillReference(ctx.config.skillsDir, args.path);
      return JSON.stringify({ path: args.path, content });
    }

    case "verify_webhook_signature": {
      if (!ctx.trigger || ctx.trigger.kind !== "webhook") {
        return JSON.stringify({ verified: false, error: "This run has no inbound webhook to verify (its trigger was a direct instruction)." });
      }
      const { platform, rawBody, headers, secret } = ctx.trigger;
      ctx.log(`[tool] verify_webhook_signature(platform=${platform})`);
      let verified: boolean;
      if (platform === "hermes") {
        verified = verifyHermes(rawBody, secret, headers["x-webhook-signature-v2"] ?? "", headers["x-webhook-timestamp"]);
      } else if (platform === "openclaw") {
        verified = verifyOpenClaw(secret, headers["authorization"] ?? "");
      } else {
        verified = verifyGeneric(rawBody, secret, headers["x-procurement-signature-256"] ?? "");
      }
      return JSON.stringify({ verified });
    }

    case "run_procure": {
      const cliArgs: string[] = Array.isArray(args.args) ? args.args : [];
      ctx.log(`[tool] run_procure ${args.command} ${cliArgs.join(" ")}`.trim());
      const result = runProcure(ctx.config, args.command, cliArgs, args.stdin);
      return JSON.stringify(result);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
