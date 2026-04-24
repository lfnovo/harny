/**
 * Probe: handleSDKEvent — 4 scenarios, zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/session/02-handle-sdk-event.ts
 */

import { handleSDKEvent } from "../../../src/harness/sessionRecorder.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario 1: system/init sets session_id and returns 'continue'
try {
  await Promise.race([
    (async () => {
      const name = "system-init-sets-session-id";
      const message = {
        type: "system",
        subtype: "init",
        session_id: "test-session-abc",
      } as unknown as SDKMessage;

      let capturedSessionId: string | null = null;
      const outcome = handleSDKEvent(message, {
        phase: "developer",
        logMode: "quiet",
        setSessionId: (id) => {
          capturedSessionId = id;
        },
        setStructuredRaw: () => {},
        setResultSubtype: () => {},
      });

      if (outcome !== "continue") {
        throw new Error(`expected 'continue', got '${outcome}'`);
      }
      if (capturedSessionId !== "test-session-abc") {
        throw new Error(
          `expected session_id 'test-session-abc', got '${capturedSessionId}'`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL system-init-sets-session-id: ${e.message}`);
  failures++;
}

// Scenario 2: result/success with structured_output sets structuredRaw and returns 'done'
try {
  await Promise.race([
    (async () => {
      const name = "result-success-sets-structured-raw";
      const message = {
        type: "result",
        subtype: "success",
        structured_output: { status: "done", summary: "test" },
      } as unknown as SDKMessage;

      let capturedRaw: unknown = undefined;
      let capturedSubtype: string | null = null;
      const outcome = handleSDKEvent(message, {
        phase: "developer",
        logMode: "quiet",
        setSessionId: () => {},
        setStructuredRaw: (v) => {
          capturedRaw = v;
        },
        setResultSubtype: (v) => {
          capturedSubtype = v;
        },
      });

      if (outcome !== "done") {
        throw new Error(`expected 'done', got '${outcome}'`);
      }
      if (capturedSubtype !== "success") {
        throw new Error(
          `expected resultSubtype 'success', got '${capturedSubtype}'`,
        );
      }
      if (typeof capturedRaw !== "object" || capturedRaw === null) {
        throw new Error(
          `expected structuredRaw to be set, got ${JSON.stringify(capturedRaw)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL result-success-sets-structured-raw: ${e.message}`);
  failures++;
}

// Scenario 3: result/error_during_execution returns 'park'
try {
  await Promise.race([
    (async () => {
      const name = "result-error-during-execution-parks";
      const message = {
        type: "result",
        subtype: "error_during_execution",
      } as unknown as SDKMessage;

      const outcome = handleSDKEvent(message, {
        phase: "developer",
        logMode: "quiet",
        setSessionId: () => {},
        setStructuredRaw: () => {},
        setResultSubtype: () => {},
      });

      if (outcome !== "park") {
        throw new Error(`expected 'park', got '${outcome}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL result-error-during-execution-parks: ${e.message}`);
  failures++;
}

// Scenario 4: unrecognised message type passes through and returns 'continue'
try {
  await Promise.race([
    (async () => {
      const name = "unrecognised-message-passes-through";
      const message = {
        type: "assistant",
      } as unknown as SDKMessage;

      const outcome = handleSDKEvent(message, {
        phase: "developer",
        logMode: "quiet",
        setSessionId: () => {},
        setStructuredRaw: () => {},
        setResultSubtype: () => {},
      });

      if (outcome !== "continue") {
        throw new Error(`expected 'continue', got '${outcome}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL unrecognised-message-passes-through: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
