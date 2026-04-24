import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

export async function coldInstallWorktree({
  worktreePath,
  primaryCwd,
}: {
  worktreePath: string;
  primaryCwd: string;
}): Promise<void> {
  if (existsSync(join(worktreePath, "package.json"))) {
    if (existsSync(join(worktreePath, "node_modules"))) {
      console.log(`[harny:cold-install] node_modules present in ${worktreePath}, skipping`);
    } else {
      console.log(`[harny:cold-install] running bun install in ${worktreePath}`);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("bun", ["install"], {
          cwd: worktreePath,
          stdio: ["ignore", "pipe", "pipe"],
        });

        proc.stdout.on("data", (data: Buffer) => {
          for (const line of data.toString().split("\n")) {
            if (line.trim()) console.log(`[harny:cold-install] ${line}`);
          }
        });

        proc.stderr.on("data", (data: Buffer) => {
          for (const line of data.toString().split("\n")) {
            if (line.trim()) console.log(`[harny:cold-install] ${line}`);
          }
        });

        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`[harny:cold-install] bun install exited with code ${code}`));
          } else {
            console.log("[harny:cold-install] bun install completed");
            resolve();
          }
        });
      });
    }
  }

  if (existsSync(join(primaryCwd, "package.json"))) {
    if (existsSync(join(primaryCwd, "node_modules"))) {
      console.log(`[harny:cold-install] node_modules present in ${primaryCwd}, skipping`);
    } else {
      console.log(`[harny:cold-install] running bun install in ${primaryCwd}`);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("bun", ["install"], {
          cwd: primaryCwd,
          stdio: ["ignore", "pipe", "pipe"],
        });

        proc.stdout.on("data", (data: Buffer) => {
          for (const line of data.toString().split("\n")) {
            if (line.trim()) console.log(`[harny:cold-install] ${line}`);
          }
        });

        proc.stderr.on("data", (data: Buffer) => {
          for (const line of data.toString().split("\n")) {
            if (line.trim()) console.log(`[harny:cold-install] ${line}`);
          }
        });

        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`[harny:cold-install] bun install exited with code ${code}`));
          } else {
            console.log("[harny:cold-install] bun install completed");
            resolve();
          }
        });
      });
    }
  }
}
