import { formatEvent } from "../../../src/harness/transcripts/format.js";

const tests: Array<{
  description: string;
  sample: unknown;
  check: (result: string | null) => boolean;
}> = [
  {
    description: "tool_use block → contains tool name and input path",
    sample: {
      type: "assistant",
      timestamp: "2024-01-01T12:00:00.000Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_01",
            name: "Read",
            input: { file_path: "/foo/bar" },
          },
        ],
      },
    },
    check: (r) => r !== null && r.includes("Read") && r.includes("/foo/bar"),
  },
  {
    description: "tool_result (success) → contains ↳",
    sample: {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_01",
            content: "file contents here",
          },
        ],
      },
    },
    check: (r) => r !== null && r.includes("↳"),
  },
  {
    description: "tool_result with isError:true → contains (error:",
    sample: {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_01",
            content: "Permission denied",
            isError: true,
          },
        ],
      },
    },
    check: (r) => r !== null && r.includes("(error:"),
  },
  {
    description: "assistant text block → contains 💬",
    sample: {
      type: "assistant",
      timestamp: "2024-01-01T12:00:00.000Z",
      message: {
        content: [
          {
            type: "text",
            text: "I'll help you with that.",
          },
        ],
      },
    },
    check: (r) => r !== null && r.includes("💬"),
  },
  {
    description: "attachment type → returns null (skip)",
    sample: {
      type: "attachment",
      data: "some hook data",
    },
    check: (r) => r === null,
  },
];

async function main(): Promise<void> {
  let anyFail = false;

  for (const t of tests) {
    try {
      const result = await Promise.race([
        Promise.resolve(formatEvent(t.sample)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 1000),
        ),
      ]);
      if (t.check(result)) {
        console.log(`PASS ${t.description}`);
      } else {
        console.log(`FAIL ${t.description}: got ${JSON.stringify(result)}`);
        anyFail = true;
      }
    } catch (err) {
      console.log(`FAIL ${t.description}: ${(err as Error).message}`);
      anyFail = true;
    }
  }

  process.exit(anyFail ? 1 : 0);
}

main();
