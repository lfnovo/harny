import type { NodeExecutor } from "./runtime.js";

export function createCommandExecutor(cwd: string): NodeExecutor {
  return async (node, { signal }) => {
    if (node.type !== "command") throw new Error("command executor received a non-command node");
    if (!node.command.length) throw new Error(`command node ${node.id} is empty`);
    const proc = Bun.spawn(node.command, { cwd, stdout: "pipe", stderr: "pipe" });
    const abort = () => proc.kill("SIGKILL"); signal.addEventListener("abort", abort, { once: true });
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (signal.aborted) throw signal.reason ?? new Error(`command ${node.id} aborted`);
      if (exitCode !== 0) throw new Error(`command ${node.id} failed (exit ${exitCode}): ${stderr.trim()}`);
      return { stdout, stderr, exit_code: exitCode };
    } finally { signal.removeEventListener("abort", abort); }
  };
}
