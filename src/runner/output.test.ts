import { describe, test, expect, afterEach } from "bun:test";
import { colorLevel } from "./output.js";

describe("colorLevel", () => {
  const saved = {
    noColor: process.env.NO_COLOR,
    forceColor: process.env.FORCE_COLOR,
    term: process.env.TERM,
    colorterm: process.env.COLORTERM,
    termProgram: process.env.TERM_PROGRAM,
  };

  afterEach(() => {
    for (const [name, value] of [
      ["NO_COLOR", saved.noColor],
      ["FORCE_COLOR", saved.forceColor],
      ["TERM", saved.term],
      ["COLORTERM", saved.colorterm],
      ["TERM_PROGRAM", saved.termProgram],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** Clears everything the detector reads, so a test only sees what it sets. */
  function clean() {
    delete process.env["NO_COLOR"];
    delete process.env["FORCE_COLOR"];
    delete process.env["TERM"];
    delete process.env["COLORTERM"];
    delete process.env["TERM_PROGRAM"];
  }

  const tty = { isTTY: true };
  const pipe = { isTTY: false };

  test("NO_COLOR wins over everything, for any non-empty value", () => {
    clean();
    process.env["COLORTERM"] = "truecolor";
    process.env["FORCE_COLOR"] = "3";
    process.env["NO_COLOR"] = "1";
    expect(colorLevel(tty)).toBe(0);
    // Per no-color.org the value is irrelevant; presence is the signal.
    process.env["NO_COLOR"] = "anything";
    expect(colorLevel(tty)).toBe(0);
  });

  test("FORCE_COLOR selects the level and beats a pipe", () => {
    clean();
    for (const [value, level] of [["0", 0], ["false", 0], ["1", 1], ["true", 1], ["", 1], ["2", 2], ["3", 3]] as const) {
      process.env["FORCE_COLOR"] = value;
      expect(colorLevel(pipe)).toBe(level);
    }
  });

  test("a pipe gets no colour", () => {
    clean();
    process.env["COLORTERM"] = "truecolor";
    expect(colorLevel(pipe)).toBe(0);
  });

  test("TERM=dumb gets no colour even on a TTY", () => {
    clean();
    process.env["TERM"] = "dumb";
    process.env["COLORTERM"] = "truecolor";
    expect(colorLevel(tty)).toBe(0);
  });

  test("COLORTERM advertises truecolor", () => {
    clean();
    for (const value of ["truecolor", "24bit"]) {
      process.env["COLORTERM"] = value;
      expect(colorLevel(tty)).toBe(3);
    }
  });

  test("known terminals get truecolor without advertising COLORTERM", () => {
    clean();
    for (const value of ["iTerm.app", "WezTerm", "ghostty"]) {
      process.env["TERM_PROGRAM"] = value;
      expect(colorLevel(tty)).toBe(3);
    }
  });

  test("falls back to 256 or basic from TERM", () => {
    clean();
    process.env["TERM"] = "xterm-256color";
    expect(colorLevel(tty)).toBe(2);
    process.env["TERM"] = "xterm";
    expect(colorLevel(tty)).toBe(1);
  });

  test("a TTY with no signal at all gets nothing", () => {
    clean();
    expect(colorLevel(tty)).toBe(0);
  });
});
