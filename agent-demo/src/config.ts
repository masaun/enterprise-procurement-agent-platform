import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // agent-demo/

loadDotenv({ path: join(PACKAGE_DIR, ".env") });

export type Persona = "hermes" | "openclaw" | "generic";

export interface AgentDemoConfig {
  /** OpenRouter — https://openrouter.ai/docs/quickstart (OpenAI-compatible chat completions). */
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterBaseUrl: string;
  openRouterSiteUrl: string;
  openRouterAppName: string;

  /** Which real external agent this run role-plays as; shapes the system prompt + expected webhook scheme. */
  persona: Persona;
  agentName: string;
  maxToolIterations: number;

  /** ./agent-skills — the Agent Skills package this agent reads at runtime, same as a real Hermes/OpenClaw install would. */
  skillsDir: string;
  /** The bundled `procure` CLI this agent shells out to in order to actually act (discover/policy/execute/record/report). */
  procureCliBin: string;
}

export function loadAgentDemoConfig(): AgentDemoConfig {
  const persona = (process.env.AGENT_DEMO_PERSONA || "generic") as Persona;
  if (!["hermes", "openclaw", "generic"].includes(persona)) {
    throw new Error(`Invalid AGENT_DEMO_PERSONA "${persona}". Expected one of: hermes, openclaw, generic.`);
  }

  return {
    openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
    openRouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    openRouterSiteUrl: process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    openRouterAppName: process.env.OPENROUTER_APP_NAME || "agent-demo",

    persona,
    agentName: process.env.AGENT_DEMO_NAME || "Demo External Agent",
    maxToolIterations: Number(process.env.AGENT_DEMO_MAX_TOOL_ITERATIONS || 12),

    skillsDir: resolve(PACKAGE_DIR, process.env.AGENT_SKILLS_DIR || join("..", "agent-skills")),
    procureCliBin: resolve(
      PACKAGE_DIR,
      process.env.PROCURE_CLI_BIN || join("..", "agent-skills", "scripts", "cli", "bin", "procure.ts"),
    ),
  };
}
