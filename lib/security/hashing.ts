import { createHash } from "node:crypto";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortValue(nested)]));
  }
  return value;
}

export function hashRecord(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");
}
