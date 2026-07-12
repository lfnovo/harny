#!/usr/bin/env bun
/**
 * Probe runner — executes probes under scripts/probes/ sequentially,
 * aggregates PASS/FAIL lines, prints a per-probe summary, and exits non-zero
 * if any probe failed.
 *
 * Probe discovery: files matching scripts/probes/** /<N>[a-z]?-*.ts.
 *
 * By default, env-dependent probe subdirs are skipped (they require external
 * binaries/services like a running Phoenix collector). Pass --env-deps to
 * include them.
 */

import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PROBES_DIR = join(ROOT, 'scripts/probes');

const PROBE_NAME = /^\d+[a-z]?-.+\.ts$/;
const ENV_DEP_DIRS = new Set(['phoenix']);

type CliOptions = {
  includeEnvDeps: boolean;
  listOnly: boolean;
  subdirs: string[];
  only: string[];
};

function printHelp(): void {
  console.log(`Usage: bun scripts/run-probes.ts [options]

Options:
  --subdir <name>         Run probes in an exact subdirectory (repeatable)
  --only <dir/index,...>  Run probes selected by subdirectory and numeric index
  --list, --dry-run       Print the resolved probe list without executing it
  --env-deps              Include probes that require external services
  --help                  Show this help

Examples:
  bun scripts/run-probes.ts --subdir orchestrator
  bun scripts/run-probes.ts --subdir orchestrator --subdir viewer
  bun scripts/run-probes.ts --only orchestrator/03,viewer/01
  bun scripts/run-probes.ts --subdir viewer --list`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    includeEnvDeps: false,
    listOnly: false,
    subdirs: [],
    only: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--env-deps') {
      options.includeEnvDeps = true;
      continue;
    }
    if (arg === '--list' || arg === '--dry-run') {
      options.listOnly = true;
      continue;
    }
    if (arg === '--subdir' || arg === '--only') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--subdir') options.subdirs.push(value);
      else options.only.push(...value.split(',').filter(Boolean));
      continue;
    }
    throw new Error(`unknown option: ${arg} (see --help)`);
  }

  if (options.subdirs.length > 0 && options.only.length > 0) {
    throw new Error('--subdir and --only cannot be combined');
  }
  return options;
}

let options: CliOptions;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exit(2);
}

async function findProbes(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      if (entry === '_templates') continue;
      if (ENV_DEP_DIRS.has(entry) && !options.includeEnvDeps) continue;
      out.push(...(await findProbes(full)));
    } else if (PROBE_NAME.test(entry)) {
      out.push(full);
    }
  }
  return out.sort();
}

type Result = {
  path: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
};

function runProbe(path: string): Promise<Result> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn('bun', [path], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('close', (code) => {
      resolve({
        path,
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
        stdout,
        stderr,
      });
    });
  });
}

function probeSubdir(path: string): string {
  return relative(PROBES_DIR, path).split(sep)[0]!;
}

function availableSummary(probes: string[], subdir: string): string {
  const indices = probes
    .filter((probe) => probeSubdir(probe) === subdir)
    .map((probe) => basename(probe).match(/^(\d+[a-z]?)-/)?.[1])
    .filter((index): index is string => Boolean(index));
  return indices.length > 0 ? indices.join(', ') : '(none)';
}

function filterProbes(allProbes: string[], cli: CliOptions): string[] {
  const subdirs = [...new Set(allProbes.map(probeSubdir))].sort();
  if (cli.subdirs.length > 0) {
    for (const subdir of cli.subdirs) {
      if (!subdirs.includes(subdir)) {
        throw new Error(`unknown probe subdir "${subdir}"; available: ${subdirs.join(', ')}`);
      }
    }
    const selected = new Set(cli.subdirs);
    return allProbes.filter((probe) => selected.has(probeSubdir(probe)));
  }

  if (cli.only.length > 0) {
    const selected = new Set<string>();
    for (const selector of cli.only) {
      const match = selector.match(/^([^/]+)\/(\d+[a-z]?)$/);
      if (!match) {
        throw new Error(`invalid --only selector "${selector}"; expected <subdir>/<index>`);
      }
      const [, subdir, index] = match;
      if (!subdirs.includes(subdir!)) {
        throw new Error(`unknown probe subdir "${subdir}"; available: ${subdirs.join(', ')}`);
      }
      const matches = allProbes.filter((probe) => {
        if (probeSubdir(probe) !== subdir) return false;
        const probeIndex = basename(probe).match(/^(\d+[a-z]?)-/)?.[1];
        return probeIndex === index || probeIndex?.replace(/[a-z]$/, '') === index;
      });
      if (matches.length === 0) {
        throw new Error(
          `unknown probe index "${selector}"; available in ${subdir}: ${availableSummary(allProbes, subdir!)}`,
        );
      }
      for (const probe of matches) selected.add(probe);
    }
    return allProbes.filter((probe) => selected.has(probe));
  }

  return allProbes;
}

let probes: string[];
try {
  probes = filterProbes(await findProbes(PROBES_DIR), options);
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exit(2);
}

if (options.listOnly) {
  for (const probe of probes) console.log(relative(ROOT, probe));
  process.exit(0);
}

console.log(`running ${probes.length} probes\n`);

const results: Result[] = [];
const runStart = Date.now();

for (const probe of probes) {
  const rel = relative(ROOT, probe);
  process.stdout.write(`  ${rel} ... `);
  const r = await runProbe(probe);
  results.push(r);
  const tag = r.exitCode === 0 ? 'ok' : 'FAIL';
  console.log(`${tag} (${r.durationMs}ms)`);
  if (r.exitCode !== 0) {
    const lines = r.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
    for (const l of lines) console.log(`    ${l}`);
    if (r.stderr.trim()) console.log(`    stderr: ${r.stderr.trim().split('\n').slice(0, 3).join(' | ')}`);
  }
}

const totalMs = Date.now() - runStart;
const failed = results.filter((r) => r.exitCode !== 0);

console.log(`\ntotal ${results.length} probes in ${(totalMs / 1000).toFixed(1)}s — ${results.length - failed.length} ok, ${failed.length} failed`);

if (failed.length > 0) {
  console.log('\nfailed probes:');
  for (const r of failed) console.log(`  ${relative(ROOT, r.path)}`);
}

process.exit(failed.length > 0 ? 1 : 0);
