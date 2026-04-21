import { createInterface } from "node:readline";

export type ResolvedAnswer =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type AskUserQuestionOption = {
  label: string;
  description?: string;
};

export type AskUserQuestionItem = {
  question: string;
  header?: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
};

export type AskUserQuestionInput = {
  questions: AskUserQuestionItem[];
};

export type AskUserQuestionResult =
  | {
      behavior: "allow";
      updatedInput: {
        questions: AskUserQuestionItem[];
        answers: Record<string, string>;
      };
    }
  | { behavior: "deny"; message: string };

export async function runAskUserQuestionTTY(
  input: AskUserQuestionInput,
): Promise<AskUserQuestionResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) =>
    new Promise<string>((resolve) => rl.question(q, (a) => resolve(a)));

  const answers: Record<string, string> = {};

  try {
    process.stdout.write("\n");
    for (const q of input.questions) {
      const labels = q.options.map((o) => o.label);
      const headerLine = q.header
        ? `[${q.header}] ${q.question}`
        : q.question;
      const lines = [headerLine];
      q.options.forEach((o, i) => {
        const desc = o.description ? ` \u2014 ${o.description}` : "";
        lines.push(`  ${i + 1}. ${o.label}${desc}`);
      });
      const tail = q.multiSelect
        ? "Your choice (numbers comma-separated, or text): "
        : "Your choice (number or text): ";
      lines.push(tail);
      let promptText = lines.join("\n");

      let resolvedValue: string;
      while (true) {
        const raw = await ask(promptText);
        if (q.multiSelect) {
          const parts = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (parts.length === 0) {
            process.stdout.write(
              "Pick at least one option (numbers comma-separated or text).\n",
            );
            promptText = tail;
            continue;
          }
          const picked: string[] = [];
          let bad = false;
          for (const p of parts) {
            const r = resolveAnswer(labels, p);
            if (!r.ok) {
              bad = true;
              break;
            }
            picked.push(r.value);
          }
          if (bad) {
            process.stdout.write(
              `Invalid choice. Pick numbers (1..${labels.length}) comma-separated or option text.\n`,
            );
            promptText = tail;
            continue;
          }
          resolvedValue = picked.join(", ");
          break;
        }
        const r = resolveAnswer(labels, raw);
        if (r.ok) {
          resolvedValue = r.value;
          break;
        }
        process.stdout.write(`${r.error}\n`);
        promptText = tail;
      }
      process.stdout.write(
        `\u2192 ${q.header ?? "answer"}: ${resolvedValue}\n\n`,
      );
      answers[q.question] = resolvedValue;
    }
  } finally {
    rl.close();
  }

  return {
    behavior: "allow",
    updatedInput: { questions: input.questions, answers },
  };
}

export function denyAskUserQuestionHeadless(): AskUserQuestionResult {
  return {
    behavior: "deny",
    message:
      "AskUserQuestion is not supported in headless mode. Make a defensible default and document the assumption in your output.",
  };
}

export function resolveAnswer(
  options: string[] | null | undefined,
  raw: string,
): ResolvedAnswer {
  const text = raw.trim();
  if (!options || options.length === 0) {
    return { ok: true, value: text };
  }

  if (/^\d+$/.test(text)) {
    const idx = Number.parseInt(text, 10) - 1;
    const picked = options[idx];
    if (picked !== undefined) {
      return { ok: true, value: picked };
    }
  }

  const exact = options.find((o) => o === text);
  if (exact !== undefined) return { ok: true, value: exact };

  const ci = options.find((o) => o.toLowerCase() === text.toLowerCase());
  if (ci !== undefined) return { ok: true, value: ci };

  return {
    ok: false,
    error: `Invalid choice. Pick 1..${options.length} or type the option text.`,
  };
}
