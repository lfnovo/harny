import { describe, test, expect, afterEach } from "bun:test";
import { isNewer, shouldCheck } from "./updateCheck.js";

describe("isNewer", () => {
  test("detects a newer patch/minor/major", () => {
    expect(isNewer("0.4.0", "0.4.1")).toBe(true);
    expect(isNewer("0.4.0", "0.5.0")).toBe(true);
    expect(isNewer("0.4.0", "1.0.0")).toBe(true);
  });

  test("returns false for same or older versions", () => {
    expect(isNewer("0.4.0", "0.4.0")).toBe(false);
    expect(isNewer("0.4.1", "0.4.0")).toBe(false);
    expect(isNewer("1.0.0", "0.9.9")).toBe(false);
  });

  test("compares the release core, ignoring prerelease suffixes", () => {
    expect(isNewer("0.4.0-rc.1", "0.4.0")).toBe(false);
    expect(isNewer("0.4.0", "0.4.0-rc.1")).toBe(false);
    expect(isNewer("0.4.0", "0.4.1-rc.1")).toBe(true);
  });

  test("treats missing segments as zero", () => {
    expect(isNewer("0.4", "0.4.1")).toBe(true);
    expect(isNewer("1", "1.0.0")).toBe(false);
  });
});

describe("shouldCheck", () => {
  const saved = {
    optOut: process.env.HARNY_NO_UPDATE_CHECK,
    ci: process.env.CI,
    isTTY: process.stdout.isTTY,
  };

  afterEach(() => {
    if (saved.optOut === undefined) delete process.env.HARNY_NO_UPDATE_CHECK;
    else process.env.HARNY_NO_UPDATE_CHECK = saved.optOut;
    if (saved.ci === undefined) delete process.env.CI;
    else process.env.CI = saved.ci;
    Object.defineProperty(process.stdout, "isTTY", { value: saved.isTTY, configurable: true });
  });

  function setTTY(value: boolean) {
    Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  }

  test("checks on an interactive TTY with no opt-out", () => {
    delete process.env.HARNY_NO_UPDATE_CHECK;
    delete process.env.CI;
    setTTY(true);
    expect(shouldCheck("compact")).toBe(true);
  });

  test("skips when opted out", () => {
    process.env.HARNY_NO_UPDATE_CHECK = "1";
    delete process.env.CI;
    setTTY(true);
    expect(shouldCheck("compact")).toBe(false);
  });

  test("skips under CI", () => {
    delete process.env.HARNY_NO_UPDATE_CHECK;
    process.env.CI = "true";
    setTTY(true);
    expect(shouldCheck("compact")).toBe(false);
  });

  test("skips in quiet mode", () => {
    delete process.env.HARNY_NO_UPDATE_CHECK;
    delete process.env.CI;
    setTTY(true);
    expect(shouldCheck("quiet")).toBe(false);
  });

  test("skips when stdout is not a TTY", () => {
    delete process.env.HARNY_NO_UPDATE_CHECK;
    delete process.env.CI;
    setTTY(false);
    expect(shouldCheck("compact")).toBe(false);
  });
});
