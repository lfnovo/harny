import { describe, test, expect } from "bun:test";
import { getWorkflow, registry } from "./index.js";

describe("getWorkflow: canonical ids are registered", () => {
  for (const id of ["feature-dev", "echo-commit", "auto"] as const) {
    test(`getWorkflow("${id}") returns a WorkflowDefinition with .machine`, () => {
      const wf = getWorkflow(id);
      expect(wf).toBeDefined();
      expect(wf.id).toBe(id);
      expect("machine" in wf).toBe(true);
    });
  }
});

describe("getWorkflow: unknown ids", () => {
  test("unknown id throws and lists the available workflows", () => {
    let caught: unknown = null;
    try {
      getWorkflow("nonexistent-workflow");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toContain("Unknown workflow");
    expect(msg).toContain("feature-dev");
    expect(msg).toContain("echo-commit");
    expect(msg).toContain("auto");
  });

  test("legacy 'feature-dev-engine' id is no longer registered", () => {
    expect(() => getWorkflow("feature-dev-engine")).toThrow();
  });
});

describe("registry: export surface", () => {
  test("exposes a Map keyed by workflow id", () => {
    expect(registry).toBeInstanceOf(Map);
    expect(registry.has("feature-dev")).toBe(true);
    expect(registry.has("echo-commit")).toBe(true);
    expect(registry.has("auto")).toBe(true);
  });
});
