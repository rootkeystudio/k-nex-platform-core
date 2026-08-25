export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export function assertJsonValue(value: unknown, path = "$", ancestors = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`${path} contains a non-finite number.`);
  }
  if (typeof value !== "object") throw new TypeError(`${path} contains unsupported ${typeof value}.`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a circular reference.`);

  ancestors.add(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) throw new TypeError(`${path} contains an unsupported array property.`);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is an array hole.`);
      assertJsonValue(value[index], `${path}[${index}]`, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} contains a non-plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${path} contains a symbol key.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${path}.${key} is not an enumerable data property.`);
    assertJsonValue(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, sortValue(child)]));
}

export function canonicalJson(value: unknown): string {
  assertJsonValue(value);
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}
