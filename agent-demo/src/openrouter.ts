import type { AgentDemoConfig } from "./config.ts";

/**
 * Minimal OpenRouter chat-completions client — https://openrouter.ai/docs/quickstart.
 * OpenRouter exposes an OpenAI-compatible `/chat/completions` endpoint (incl.
 * tool calling), so no vendor SDK is needed — one `fetch` call, same shape
 * this repo's other CLI uses for its own dependency-light style.
 */

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export async function chatCompletion(
  config: AgentDemoConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<ChatMessage> {
  if (!config.openRouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Get one at https://openrouter.ai/keys and set it in agent-demo/.env (see .env.example).",
    );
  }

  const res = await fetch(`${config.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openRouterApiKey}`,
      // Recommended by OpenRouter so this app is attributed correctly in their dashboard/rankings.
      "HTTP-Referer": config.openRouterSiteUrl,
      "X-Title": config.openRouterAppName,
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      messages,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? "auto" : undefined,
    }),
  });

  const body: any = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message || `OpenRouter request failed: HTTP ${res.status}`;
    throw new Error(message);
  }

  const choice = body?.choices?.[0];
  if (!choice?.message) throw new Error(`Unexpected OpenRouter response shape: ${JSON.stringify(body)}`);
  return choice.message as ChatMessage;
}
