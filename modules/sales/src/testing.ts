import { salesReferenceMetadata, type CreateTaskInput } from "./contracts.js";

export const salesTaskFixture = Object.freeze({
  title: "Prepare customer follow-up",
  status: "open"
} satisfies CreateTaskInput);

export const salesOpportunityFixture = Object.freeze({ name: "Platform rollout", stage: "qualified", value: "1200.50" });
export const salesConformanceMetadata = salesReferenceMetadata.testing;
