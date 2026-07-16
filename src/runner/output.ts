/**
 * Terminal colour detection for the CLI.
 *
 * This module decides whether the terminal *can* take colour, and nothing else.
 * It deliberately does not decide whether a given line *should* have it: parts of
 * harny's stdout are a contract (`show --tail` emits NDJSON, `ls` emits a
 * parseable table) and must stay clean even on a colour-capable TTY. Callers make
 * that call.
 *
 * It also does not paint. An earlier version shipped fgHex/bgHex/bold/dim and a
 * painter() to wrap them, and not one of them was ever called -- the only place
 * that paints is the banner, which writes its own SGR in a per-pixel loop where a
 * helper would just allocate. Colour helpers are cheap to write and easy to leave
 * behind; write them when a second caller exists.
 */

/** 0 none, 1 basic 16, 2 xterm-256, 3 truecolor. */
export type ColorLevel = 0 | 1 | 2 | 3;

/**
 * Follows the same gating as `updateCheck.shouldCheck`, plus the informal
 * NO_COLOR / FORCE_COLOR contract that no-color.org and chalk both honour.
 */
export function colorLevel(stream: { isTTY?: boolean } = process.stdout): ColorLevel {
  const env = process.env;
  // NO_COLOR wins over everything, per spec: any non-empty value disables.
  if (env["NO_COLOR"]) return 0;
  const forced = env["FORCE_COLOR"];
  if (forced !== undefined) {
    if (forced === "0" || forced === "false") return 0;
    if (forced === "1" || forced === "true" || forced === "") return 1;
    if (forced === "2") return 2;
    if (forced === "3") return 3;
  }
  if (!stream.isTTY) return 0;
  if (env["TERM"] === "dumb") return 0;
  const colorterm = env["COLORTERM"] ?? "";
  if (colorterm === "truecolor" || colorterm === "24bit") return 3;
  // Terminals that support truecolor without advertising COLORTERM.
  if (env["TERM_PROGRAM"] === "iTerm.app" || env["TERM_PROGRAM"] === "WezTerm" || env["TERM_PROGRAM"] === "ghostty") return 3;
  const term = env["TERM"] ?? "";
  if (term.includes("256color")) return 2;
  if (term) return 1;
  return 0;
}
