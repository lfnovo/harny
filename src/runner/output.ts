/**
 * Terminal colour for the CLI.
 *
 * Dependency-free by design: harny ships three runtime deps and adding chalk to
 * paint a prompt would not earn its place. Bun and Node both emit raw SGR.
 *
 * This module decides whether the terminal *can* take colour. It deliberately
 * does not decide whether a given line *should* have it: parts of harny's stdout
 * are a contract (`show --tail` emits NDJSON, `ls` emits a parseable table) and
 * must stay clean even on a colour-capable TTY. Callers make that call.
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

const ESC = "\x1b[";
export const RESET = `${ESC}0m`;

/** Truecolor foreground/background from a #rrggbb string. */
export function fgHex(hex: string): string {
  const [r, g, b] = rgb(hex);
  return `${ESC}38;2;${r};${g};${b}m`;
}
export function bgHex(hex: string): string {
  const [r, g, b] = rgb(hex);
  return `${ESC}48;2;${r};${g};${b}m`;
}

export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

export const BOLD = `${ESC}1m`;
export const DIM = `${ESC}2m`;

/**
 * Builds a painter for a given level. At level 0 every helper is identity, so
 * call sites stay branch-free instead of sprinkling `if (color)` everywhere.
 */
export function painter(level: ColorLevel = colorLevel()) {
  const on = level > 0;
  const truecolor = level >= 3;
  return {
    level,
    /** Truecolor hex; degrades to no-op below level 3 rather than approximating. */
    hex: (text: string, hex: string) => (truecolor ? `${fgHex(hex)}${text}${RESET}` : text),
    bold: (text: string) => (on ? `${BOLD}${text}${RESET}` : text),
    dim: (text: string) => (on ? `${DIM}${text}${RESET}` : text),
  };
}
