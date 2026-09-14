import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  baseUrl: string;
  privateKey: string | null;
  mcpApiKey: string | null;
}

const CONFIG_DIR = join(homedir(), ".procure");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS: CliConfig = {
  baseUrl: "http://localhost:3000",
  privateKey: null,
  mcpApiKey: null,
};

export function loadConfig(): CliConfig {
  let fileConfig: Partial<CliConfig> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    } catch {
      // ignore malformed config, fall back to defaults
    }
  }

  return {
    ...DEFAULTS,
    ...fileConfig,
    baseUrl: process.env.PROCURE_BASE_URL || fileConfig.baseUrl || DEFAULTS.baseUrl,
    privateKey: process.env.PROCURE_PRIVATE_KEY || fileConfig.privateKey || DEFAULTS.privateKey,
    mcpApiKey: process.env.PROCURE_MCP_API_KEY || fileConfig.mcpApiKey || DEFAULTS.mcpApiKey,
  };
}

export function setConfigValue(key: string, value: string): Record<string, unknown> {
  if (!(key in DEFAULTS)) {
    throw new Error(`Unknown config key "${key}". Valid keys: ${Object.keys(DEFAULTS).join(", ")}`);
  }
  let fileConfig: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    } catch {
      fileConfig = {};
    }
  }
  fileConfig[key] = value;
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(fileConfig, null, 2) + "\n", "utf8");
  return fileConfig;
}

export function configPath(): string {
  return CONFIG_FILE;
}
