import * as z from "zod";

export function uniqueArray<T extends z.core.SomeType>(item: T) {
  return z.array(item).superRefine((values, context) => {
    const serialized = values.map((value) => JSON.stringify(value));
    if (new Set(serialized).size !== serialized.length) {
      context.addIssue({ code: "custom", message: "Array items must be unique." });
    }
  }).meta({ uniqueItems: true });
}

export const OpenObjectSchema = z.looseObject({});
