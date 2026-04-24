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
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PROBES_DIR = join(ROOT, 'scripts/probes');

const PROBE_NAME = /^\d+[a-z]?-.+\.ts$/;
const ENV_DEP_DIRS = new Set(['phoenix']);
const includeEnvDeps = process.argv.includes('--env-deps');

async function findProbes(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      if (entry === '_templates') continue;
      if (ENV_DEP_DIRS.has(entry) && !includeEnvDeps) continue;
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

const probes = await findProbes(PROBES_DIR);
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
