import { z } from "zod";

/** Convert the workflow's JSON Schema subset into a strict provider schema. */
export function schemaFromDefinition(definition: Record<string, unknown> | undefined): z.ZodType<Record<string, unknown>> {
  if (!definition) return z.object({});
  if (definition.type !== "object") throw new Error("agent output_schema must describe an object");
  const properties = definition.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error("agent output_schema must declare object properties");
  }
  const keys = Object.keys(properties);
  const required = Array.isArray(definition.required) && definition.required.every((key) => typeof key === "string")
    ? definition.required as string[]
    : [];
  const missing = keys.filter((key) => !required.includes(key));
  const unknown = required.filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    throw new Error(`agent output_schema must require every declared property${missing.length ? ` (missing: ${missing.join(", ")})` : ""}${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
  }
  try {
    return z.fromJSONSchema({ ...definition, additionalProperties: false }) as z.ZodType<Record<string, unknown>>;
  } catch (error) {
    throw new Error(`invalid agent output_schema: ${error instanceof Error ? error.message : String(error)}`);
  }
}
