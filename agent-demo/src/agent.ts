import type { AgentDemoConfig, Persona } from "./config.ts";
import { loadSkillBody, loadSkillSummary } from "./skills.ts";
import { chatCompletion, type ChatMessage } from "./openrouter.ts";
import { executeTool, TOOL_DEFINITIONS } from "./tools.ts";

export type AgentTrigger =
  | {
      kind: "webhook";
      platform: Persona;
      rawBody: string;
      headers: Record<string, string>;
      secret: string;
    }
  | {
      kind: "instruction";
      text: string;
    };

const PERSONA_BLURB: Record<Persona, string> = {
  hermes:
    "You are role-playing as Hermes Agent (https://hermes-agent.nousresearch.com), an autonomous agent runtime that has installed this Agent Skill and registered a `hermes webhook subscribe` route with the enterprise admin.",
  openclaw:
    "You are role-playing as OpenClaw (https://docs.openclaw.ai), a TaskFlow-based autonomous agent runtime that has installed this Agent Skill and registered a `plugins/webhooks` route with the enterprise admin.",
  generic:
    "You are a generic, Agent-Skills-compatible autonomous agent runtime (https://agentskills.io) that has installed this Agent Skill.",
};

/**
 * Runs one end-to-end turn of the demo external agent: progressive
 * disclosure over ./agent-skills (name+description already loaded at
 * "startup" -> full SKILL.md body once this trigger matches), then an
 * OpenRouter-driven tool-calling loop that decides how to act — verifying
 * the webhook, reading references on demand, and shelling out to `procure`
 * — exactly the role a real Hermes Agent or OpenClaw install plays.
 */
export async function runExternalAgent(config: AgentDemoConfig, trigger: AgentTrigger, log: (line: string) => void): Promise<string> {
  const summary = loadSkillSummary(config.skillsDir);
  log(`[skill] loaded at startup: "${summary.frontmatter.name}" — ${summary.frontmatter.description.slice(0, 120)}...`);
  log(`[skill] task matches this skill's description -> activating, reading full SKILL.md body`);
  const skillBody = loadSkillBody(config.skillsDir);

  const systemPrompt = [
    PERSONA_BLURB[config.persona],
    `Your agent name is "${config.agentName}".`,
    `You have loaded exactly one Agent Skill, "${summary.frontmatter.name}": ${summary.frontmatter.description}`,
    "Its full instructions are provided below as a second system message — follow them step by step.",
    "Use `list_skill_references` / `read_skill_reference` to pull in references/*.md on demand, exactly as the skill describes (progressive disclosure — don't assume you already know their contents).",
    "Use `run_procure` to actually act: discovery, policy, evaluation, KeeperHub execution, the on-chain receipt write, and reporting all happen inside that CLI, using this agent's own credentials from its environment. Never invent a transaction hash, task id, or execution result yourself — only report what `run_procure` actually returned.",
    "If your trigger is a webhook, call `verify_webhook_signature` first and refuse to act if it fails.",
    "When you're done, give a concise final report for the human enterprise admin: status (completed/rejected/failed), the chosen provider and APY if any, the on-chain tx hash if any, and the policy reasons if rejected. Do not call any more tools once you've reported the outcome.",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: `=== agent-skills/SKILL.md (body) ===\n\n${skillBody}` },
    { role: "user", content: describeTrigger(trigger) },
  ];

  for (let turn = 0; turn < config.maxToolIterations; turn++) {
    log(`[llm] calling ${config.openRouterModel} via OpenRouter (turn ${turn + 1}/${config.maxToolIterations})`);
    const assistantMessage = await chatCompletion(config, messages, TOOL_DEFINITIONS);
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const finalText = assistantMessage.content ?? "(no content)";
      log(`[llm] final report:\n${finalText}`);
      return finalText;
    }

    for (const call of assistantMessage.tool_calls) {
      log(`[llm] requested tool call: ${call.function.name}(${call.function.arguments})`);
      let resultContent: string;
      try {
        resultContent = executeTool(call.function.name, call.function.arguments, { config, log });
      } catch (err) {
        resultContent = JSON.stringify({ error: (err as Error).message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: resultContent });
    }
  }

  throw new Error(`Exceeded maxToolIterations (${config.maxToolIterations}) without a final report from the LLM.`);
}

function describeTrigger(trigger: AgentTrigger): string {
  if (trigger.kind === "instruction") {
    return [
      "A human enterprise admin just told you directly (no webhook involved):",
      `"${trigger.text}"`,
      "Per SKILL.md's natural-language case: parse instruction/amount/asset/APY threshold yourself and act via `run_procure` with command \"submit\".",
    ].join("\n");
  }

  return [
    `You just received an inbound webhook POST on your ${trigger.platform} route.`,
    `Headers: ${JSON.stringify(trigger.headers)}`,
    `Raw body: ${trigger.rawBody}`,
    `The webhook secret you (this agent) registered with the enterprise admin for this route is: ${trigger.secret}`,
    "Verify the signature before acting on it, per agent-skills/references/protocols.md's 'Webhook signing' table.",
    trigger.platform === "generic"
      ? "This is the generic schema `procure act` expects verbatim on stdin — once verified, call `run_procure` with command \"act\" and stdin set to the raw body."
      : "Once verified, extract the procurement intent from this platform's payload shape and act via `run_procure` with command \"act\" (pass the equivalent generic-shaped JSON as stdin) or \"submit\" with explicit flags.",
  ].join("\n");
}
