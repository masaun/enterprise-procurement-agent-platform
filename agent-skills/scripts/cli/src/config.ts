import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  baseUrl: string;
  privateKey: string | null;
  mcpApiKey: string | null;
  /** The external agent's own KeeperHub org key — execution now runs here, not on the server. */
  keeperHubApiKey: string | null;
  keeperHubBaseUrl: string | null;
  keeperHubExecutionMode: string;
  /** Deployed ProcurementRegistry address (./contracts), Base Sepolia. */
  registryAddress: string | null;
  /** Base Sepolia RPC endpoint used for both KeeperHub reads and the registry write. */
  rpcUrl: string;
}

const CONFIG_DIR = join(homedir(), ".procure");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS: CliConfig = {
  baseUrl: "http://localhost:3000",
  privateKey: null,
  mcpApiKey: null,
  keeperHubApiKey: null,
  keeperHubBaseUrl: null,
  keeperHubExecutionMode: "direct",
  registryAddress: null,
  rpcUrl: "https://sepolia.base.org",
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
    keeperHubApiKey: process.env.PROCURE_KEEPERHUB_API_KEY || fileConfig.keeperHubApiKey || DEFAULTS.keeperHubApiKey,
    keeperHubBaseUrl: process.env.PROCURE_KEEPERHUB_BASE_URL || fileConfig.keeperHubBaseUrl || DEFAULTS.keeperHubBaseUrl,
    keeperHubExecutionMode:
      process.env.PROCURE_KEEPERHUB_EXECUTION_MODE || fileConfig.keeperHubExecutionMode || DEFAULTS.keeperHubExecutionMode,
    registryAddress: process.env.PROCURE_REGISTRY_ADDRESS || fileConfig.registryAddress || DEFAULTS.registryAddress,
    rpcUrl: process.env.PROCURE_RPC_URL || fileConfig.rpcUrl || DEFAULTS.rpcUrl,
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
