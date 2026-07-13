import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadWorkflowFile } from "../../../src/harness/workflow/loader.js";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PLUGIN = join(ROOT, "plugin");
const DEADLINE_MS = 1500;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function json(path: string): Promise<Record<string, any>> { return JSON.parse(await readFile(path, "utf8")); }
async function files(dir: string): Promise<string[]> { const out: string[] = []; for (const entry of await readdir(dir)) { const path = join(dir, entry); if ((await stat(path)).isDirectory()) out.push(...await files(path)); else out.push(path); } return out; }
function frontmatter(markdown: string): { name: string; description: string } { const match = markdown.match(/^---\n([\s\S]*?)\n---/); assert(match, "missing frontmatter"); const name = match[1]!.match(/^name:\s*(.+)$/m)?.[1]?.trim(); const description = match[1]!.match(/^description:\s*(.+)$/m)?.[1]?.trim(); assert(name && description, "frontmatter requires name and description"); return { name, description }; }

async function validate(): Promise<void> {
  const marketplace = await json(join(ROOT, ".claude-plugin/marketplace.json"));
  const manifest = await json(join(PLUGIN, ".claude-plugin/plugin.json"));
  const index = await json(join(PLUGIN, "agent-smith-index.json"));
  const listed = marketplace.plugins?.find((item: any) => item.name === manifest.name);
  assert(listed, "plugin is missing from marketplace");
  assert(listed.source === "./plugin", "marketplace source must be ./plugin");
  assert(manifest.version === "0.3.0" && listed.version === manifest.version, "plugin versions must match 0.3.0");

  const skillDirs = (await readdir(join(PLUGIN, "skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const indexedSkills = [...index.components.skills].map((item: any) => item.name).sort();
  assert(JSON.stringify(skillDirs) === JSON.stringify(indexedSkills), "agent-smith index must list every skill exactly once");
  for (const item of index.components.skills as any[]) {
    const markdown = await readFile(join(PLUGIN, item.path), "utf8"); const meta = frontmatter(markdown);
    assert(meta.name === item.name, `skill name mismatch for ${item.path}`);
    assert(meta.description === item.description, `skill description drift for ${item.path}`);
    for (const supporting of item.supportingFiles ?? []) await stat(join(PLUGIN, supporting));
  }

  const corpus = (await Promise.all((await files(PLUGIN)).filter((path) => /\.(md|json)$/.test(path)).map((path) => readFile(path, "utf8")))).join("\n");
  const forbidden = ["state + plan + transcripts", "git reset --hard", "ANTHROPIC_API_KEY= harny", "It's a JSON map", "feature-dev-engine", "Fall back to v2"];
  for (const value of forbidden) assert(!corpus.includes(value), `stale plugin contract: ${value}`);

  const orchestrator = await readFile(join(PLUGIN, "agents/orchestrator.md"), "utf8");
  for (const value of ["feature-pr", "harny pr fix", "providers.json", "run.json", "waiting_human", "Background execution controls"]) assert(orchestrator.includes(value), `orchestrator missing ${value}`);
  const release = await readFile(join(PLUGIN, "skills/release/SKILL.md"), "utf8");
  for (const value of ["feature-pr", "harny pr fix", "provider usage", "Create the tag on the exact integrated commit"]) assert(release.includes(value), `release skill missing ${value}`);
  const recipe = join(PLUGIN, "skills/harny/feature-pr-approval.yaml");
  const workflow = await loadWorkflowFile(recipe);
  assert(workflow.name === "feature-pr-approval", "approval recipe must remain loadable");
  assert(workflow.nodes.some((node) => node.type === "human"), "approval recipe requires a human node");
  assert(workflow.nodes.some((node) => node.type === "cancel"), "approval recipe must fail closed on rejection");
}

let failures = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
try { await Promise.race([validate(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS); })]); console.log("PASS plugin-contract"); }
catch (error) { console.log(`FAIL plugin-contract: ${(error as Error).message}`); failures++; }
finally { if (timer) clearTimeout(timer); }

process.exit(failures > 0 ? 1 : 0);
