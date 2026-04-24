import { test, expect } from "bun:test";
import { formatEvent } from "./format.js";

const ts = "2026-01-01T00:00:00.000Z";

function assistantEvent(blocks: unknown[]): unknown {
  return { type: "assistant", timestamp: ts, message: { content: blocks } };
}

function userEvent(blocks: unknown[]): unknown {
  return { type: "user", timestamp: ts, message: { content: blocks } };
}

test("tool_use block shows name and truncated args at 80 chars", () => {
  const longInput = { key: "x".repeat(200) };
  const line = formatEvent(assistantEvent([{ type: "tool_use", name: "Read", input: longInput }]));
  expect(line).not.toBeNull();
  const inputJson = JSON.stringify(longInput);
  expect(line).toContain("Read");
  // First 80 chars + '...' must appear
  expect(line).toContain(inputJson.slice(0, 80) + "...");
  // The full 210-char JSON must not appear (truncation happened)
  expect(line).not.toContain(inputJson);
});

test("tool_use input shorter than 80 chars is not truncated", () => {
  const input = { k: "short" };
  const line = formatEvent(assistantEvent([{ type: "tool_use", name: "Glob", input }]));
  expect(line).not.toBeNull();
  expect(line).toContain(JSON.stringify(input));
  expect(line).not.toContain("...");
});

test("tool_result of exactly 121 chars truncates to 120 + '...'", () => {
  const content = "a".repeat(121);
  const line = formatEvent(userEvent([{ type: "tool_result", content }]));
  expect(line).not.toBeNull();
  expect(line).toContain("a".repeat(120) + "...");
  expect(line).not.toContain("a".repeat(121));
});

test("tool_result of exactly 120 chars is not truncated", () => {
  const content = "b".repeat(120);
  const line = formatEvent(userEvent([{ type: "tool_result", content }]));
  expect(line).not.toBeNull();
  expect(line).toContain("b".repeat(120));
  expect(line).not.toContain("...");
});

test("tool_result shorter than 120 chars is not truncated", () => {
  const content = "short result";
  const line = formatEvent(userEvent([{ type: "tool_result", content }]));
  expect(line).not.toBeNull();
  expect(line).toContain(content);
  expect(line).not.toContain("...");
});

test("text block in assistant message is rendered with 💬 prefix", () => {
  const line = formatEvent(assistantEvent([{ type: "text", text: "hello world" }]));
  expect(line).not.toBeNull();
  expect(line).toContain("💬");
  expect(line).toContain("hello world");
});

test("tool_result with isError:true is marked '(error:' in the rendering", () => {
  const line = formatEvent(
    userEvent([
      {
        type: "tool_result",
        tool_use_id: "tu_01",
        content: "Permission denied",
        isError: true,
      },
    ]),
  );
  expect(line).not.toBeNull();
  expect(line).toContain("(error:");
});

test("unknown event type (e.g. 'attachment') returns null to skip rendering", () => {
  expect(formatEvent({ type: "attachment", data: "some hook data" })).toBeNull();
});
