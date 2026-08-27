import type { CreateTaskInput } from "./contracts.js";

export const salesTaskFixture = Object.freeze({
  title: "Prepare customer follow-up",
  status: "open"
} satisfies CreateTaskInput);
