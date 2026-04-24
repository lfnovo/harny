import { describe, test, expect } from "bun:test";
import { handleSDKEvent } from "./sessionRecorder.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

function emptyHandlers() {
  return {
    phase: "developer",
    logMode: "quiet" as const,
    setSessionId: () => {},
    setStructuredRaw: () => {},
    setResultSubtype: () => {},
  };
}

describe("handleSDKEvent: system/init", () => {
  test("sets session_id via setSessionId and returns 'continue'", () => {
    const message = {
      type: "system",
      subtype: "init",
      session_id: "test-session-abc",
    } as unknown as SDKMessage;
    let captured: string | null = null as string | null;
    const outcome = handleSDKEvent(message, {
      ...emptyHandlers(),
      setSessionId: (id) => {
        captured = id;
      },
    });
    expect(outcome).toBe("continue");
    expect(captured).toBe("test-session-abc");
  });
});

describe("handleSDKEvent: result/success", () => {
  test("sets structuredRaw + resultSubtype and returns 'done'", () => {
    const message = {
      type: "result",
      subtype: "success",
      structured_output: { status: "done", summary: "test" },
    } as unknown as SDKMessage;
    let raw: unknown = undefined;
    let subtype: string | null = null as string | null;
    const outcome = handleSDKEvent(message, {
      ...emptyHandlers(),
      setStructuredRaw: (v) => {
        raw = v;
      },
      setResultSubtype: (v) => {
        subtype = v;
      },
    });
    expect(outcome).toBe("done");
    expect(subtype).toBe("success");
    expect(typeof raw).toBe("object");
    expect(raw).not.toBeNull();
  });
});

describe("handleSDKEvent: result/error_during_execution", () => {
  test("returns 'park'", () => {
    const message = {
      type: "result",
      subtype: "error_during_execution",
    } as unknown as SDKMessage;
    expect(handleSDKEvent(message, emptyHandlers())).toBe("park");
  });
});

describe("handleSDKEvent: unrecognised messages", () => {
  test("pass through with 'continue'", () => {
    const message = { type: "assistant" } as unknown as SDKMessage;
    expect(handleSDKEvent(message, emptyHandlers())).toBe("continue");
  });
});
