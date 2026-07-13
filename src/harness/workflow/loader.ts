import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { access } from "node:fs/promises";
import { WorkflowDefinitionSchema, type NormalizedWorkflowDefinition } from "./schema.js";
import { validateWorkflow } from "./validate.js";
import type { AgentProvider } from "../providers/types.js";

export async function loadWorkflowFile(path: string, providers?: ReadonlyMap<string, AgentProvider>): Promise<NormalizedWorkflowDefinition> {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  let document: unknown;
  try { document = Bun.YAML.parse(raw); }
  catch (error) { throw new Error(`workflow YAML at ${absolute} is invalid: ${String(error)}`); }
  const parsed = WorkflowDefinitionSchema.safeParse(document);
  if (!parsed.success) throw new Error(`workflow at ${absolute} failed schema validation: ${parsed.error.message}`);
  validateWorkflow(parsed.data, providers);
  return parsed.data;
}

export interface WorkflowSearchOptions { cwd: string; home?: string; bundledDir?: string; providers?: ReadonlyMap<string, AgentProvider>; }

/** Resolve explicit paths or project > global > bundled workflow names. */
export async function loadWorkflow(spec: string, options: WorkflowSearchOptions): Promise<{ definition: NormalizedWorkflowDefinition; path: string }> {
  const path = await resolveWorkflowPath(spec, options);
  return { definition: await loadWorkflowFile(path, options.providers), path };
}

export async function resolveWorkflowPath(spec: string, options: WorkflowSearchOptions): Promise<string> {
  if (isPathSpec(spec)) {
    const path = resolve(options.cwd, spec);
    if (!(await exists(path))) throw new Error(`workflow file not found: ${path}`);
    return path;
  }
  const filename = extname(spec) ? basename(spec) : `${spec}.yaml`;
  const roots = [
    join(options.cwd, ".harny", "workflows"),
    join(options.home ?? homedir(), ".harny", "workflows"),
    options.bundledDir ?? join(import.meta.dir, "bundled"),
  ];
  for (const root of roots) { const candidate = join(root, filename); if (await exists(candidate)) return candidate; }
  throw new Error(`workflow "${spec}" not found in project, global, or bundled workflow directories`);
}

export async function resolveCommand(name: string, options: Omit<WorkflowSearchOptions, "providers">): Promise<{ path: string; content: string }> {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`invalid command name: ${name}`);
  const roots = [join(options.cwd, ".harny", "commands"), join(options.home ?? homedir(), ".harny", "commands"), options.bundledDir ? join(options.bundledDir, "commands") : join(import.meta.dir, "bundled", "commands")];
  for (const root of roots) {
    const path = join(root, `${name}.md`);
    if (await exists(path)) return { path, content: await readFile(path, "utf8") };
  }
  throw new Error(`command "${name}" not found in project, global, or bundled command directories`);
}

function isPathSpec(spec: string): boolean { return spec.startsWith(".") || spec.startsWith("/") || spec.includes("\\") || spec.endsWith(".yaml") || spec.endsWith(".yml"); }
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
