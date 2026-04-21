export type ResolvedAnswer =
  | { ok: true; value: string }
  | { ok: false; error: string };

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
