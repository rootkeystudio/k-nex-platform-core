export const outputContracts = [
  "metric.scalar@1",
  "metric.scalar@2",
  "table.records@1",
  "series.category@1",
  "series.time@1",
  "options.list@1",
  "record.summary@1"
] as const;

export type CanonicalOutputContract = (typeof outputContracts)[number];
