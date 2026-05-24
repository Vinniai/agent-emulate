import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface UnifiedUser {
  id: string;
  role?: string;
  email: string;
  name?: string;
  token?: string;
  providers?: Record<string, Record<string, unknown> | boolean>;
}

export interface EmulateConfig {
  tokens?: Record<string, { login: string; scopes?: string[] }>;
  users?: UnifiedUser[];
  [service: string]: unknown;
}

export interface LoadedConfig {
  config: EmulateConfig;
  source: string;
}

function parseContent(content: string, source: string): EmulateConfig {
  const isJson = source.endsWith(".json");
  const parsed = isJson ? JSON.parse(content) : parseYaml(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Config at ${source} is not an object`);
  }
  return parsed as EmulateConfig;
}

export async function loadConfig(): Promise<LoadedConfig | null> {
  const explicitPath = process.env.EMULATE_CONFIG_PATH;
  if (explicitPath) {
    const full = resolve(explicitPath);
    if (!existsSync(full)) {
      throw new Error(`EMULATE_CONFIG_PATH does not exist: ${full}`);
    }
    return { config: parseContent(readFileSync(full, "utf-8"), full), source: full };
  }

  const url = process.env.EMULATE_CONFIG_URL;
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`EMULATE_CONFIG_URL fetch failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    return { config: parseContent(text, url), source: url };
  }

  const candidates = ["emulate.config.yaml", "emulate.config.yml", "emulate.config.json"];
  for (const file of candidates) {
    const full = resolve(file);
    if (existsSync(full)) {
      return { config: parseContent(readFileSync(full, "utf-8"), full), source: full };
    }
  }
  return null;
}
