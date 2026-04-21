import { z } from "zod";

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // The claude-code binary silently ignores the schema when the top-level has
  // a "$schema" key, which Zod emits by default. Strip it.
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void $schema;
  return rest;
}
