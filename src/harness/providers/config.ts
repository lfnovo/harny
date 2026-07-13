import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CodexOptions } from "@openai/codex-sdk";
import { z } from "zod";
import type { LogMode, RunMode } from "../types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import type { AgentProvider } from "./types.js";

const ConnectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  type: z.enum(["claude", "codex"]),
  base_url: z.url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), "base_url must use http or https").optional(),
  api_key_env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  model: z.string().min(1).optional(),
}).strict();

const ProvidersFileSchema = z.object({ version: z.literal(1), providers: z.array(ConnectionSchema).default([]) }).strict();
export type ProviderConnection = z.infer<typeof ConnectionSchema>;

export interface ProviderMetadata {
  workflowId: string; runId: string; taskSlug: string; primaryCwd: string; mode: RunMode; logMode: LogMode;
}

export async function createConfiguredProviders(metadata: ProviderMetadata, options: { path?: string; env?: NodeJS.ProcessEnv } = {}): Promise<Map<string, AgentProvider>> {
  const env = options.env ?? process.env;
  const configured = await loadConnections(options.path);
  const connections = new Map<string, ProviderConnection>([
    ["claude", { id: "claude", type: "claude" }],
    ["codex", { id: "codex", type: "codex" }],
  ]);
  for (const connection of configured) {
    if (connections.has(connection.id) && connection.id !== "claude" && connection.id !== "codex") throw new Error(`duplicate provider id: ${connection.id}`);
    connections.set(connection.id, connection);
  }
  const providers = new Map<string, AgentProvider>();
  for (const connection of connections.values()) providers.set(connection.id, createProvider(connection, metadata, env));
  return providers;
}

export async function loadConnections(path = join(homedir(), ".harny", "providers.json")): Promise<ProviderConnection[]> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error(`could not read ${path}: ${String(error)}`); }
  let document: unknown;
  try { document = JSON.parse(raw); } catch (error) { throw new Error(`provider config at ${path} is invalid JSON: ${String(error)}`); }
  const parsed = ProvidersFileSchema.safeParse(document);
  if (!parsed.success) throw new Error(`provider config at ${path} failed validation: ${parsed.error.message}`);
  const seen = new Set<string>();
  for (const connection of parsed.data.providers) { if (seen.has(connection.id)) throw new Error(`duplicate provider id: ${connection.id}`); seen.add(connection.id); }
  return parsed.data.providers;
}

function createProvider(connection: ProviderConnection, metadata: ProviderMetadata, env: NodeJS.ProcessEnv): AgentProvider {
  const apiKey = connection.api_key_env ? requiredEnv(connection.api_key_env, env, connection.id) : undefined;
  const connectionFingerprint = fingerprint(connection);
  if (connection.type === "claude") {
    const providerEnv = connection.base_url || apiKey ? { ...env, ...(connection.base_url ? { ANTHROPIC_BASE_URL: connection.base_url } : {}), ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}) } : undefined;
    return new ClaudeProvider({ ...metadata, id: connection.id, connectionFingerprint, defaultModel: connection.model, env: providerEnv });
  }
  return new CodexProvider({ id: connection.id, connectionFingerprint, defaultModel: connection.model, sdk: codexOptions(connection, apiKey, env) });
}

function codexOptions(connection: ProviderConnection, apiKey: string | undefined, env: NodeJS.ProcessEnv): CodexOptions {
  if (!connection.base_url && !apiKey) return {};
  return { ...(connection.base_url ? { baseUrl: connection.base_url } : {}), ...(apiKey ? { apiKey } : {}), env: cleanEnv(env) };
}

function requiredEnv(name: string, env: NodeJS.ProcessEnv, provider: string): string {
  const value = env[name]; if (!value) throw new Error(`provider ${provider} requires environment variable ${name}`); return value;
}
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> { return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)); }
function fingerprint(connection: ProviderConnection): string { return createHash("sha256").update(JSON.stringify(connection)).digest("hex"); }
