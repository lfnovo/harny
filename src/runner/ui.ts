export async function handleUi(
  cmd: { kind: "ui"; port?: number; noOpen?: boolean },
): Promise<void> {
  const { startViewer, openBrowser } = await import("../viewer/server.js");
  const { url, stop } = await startViewer({ port: cmd.port });
  console.log(`[harny ui] serving at ${url}`);
  console.log(`[harny ui] press Ctrl-C to stop`);
  if (!cmd.noOpen) openBrowser(url);
  const shutdown = () => {
    console.log("\n[harny ui] stopping…");
    stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise<void>(() => {});
}
