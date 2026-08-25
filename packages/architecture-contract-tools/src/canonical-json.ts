export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, sortValue(child)]));
}

export function canonicalJson(value: JsonValue): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}
