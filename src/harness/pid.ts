export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM means the process exists but we lack permission to signal it
    if (code === "EPERM") return true;
    // Unknown error — assume alive (conservative)
    return true;
  }
}
