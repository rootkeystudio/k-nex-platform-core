import * as z from "zod";

const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const unitPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;

export const metricRoundingModes = ["half-up", "half-even", "toward-zero", "away-from-zero"] as const;
export const durationUnits = ["milliseconds", "seconds", "minutes", "hours", "days"] as const;
export const metricSentiments = ["positive", "neutral", "negative"] as const;

export const CanonicalDecimalSchema = z.string().min(1).max(128).regex(decimalPattern);

export const IntegerSchema = z.number().int();
export const NumberSchema = z.number().finite();
export const DecimalSchema = CanonicalDecimalSchema;
export const MoneySchema = CanonicalDecimalSchema;
export const TextSchema = z.string().min(1).max(512);

const scaleSchema = z.number().int().min(0).max(18);
const unitSchema = z.string().min(1).max(32).regex(unitPattern);
const roundingSchema = z.enum(metricRoundingModes);

export const MetricIntegerValueSchema = z.strictObject({
  kind: z.literal("integer"),
  value: IntegerSchema
});

export const MetricNumberValueSchema = z.strictObject({
  kind: z.literal("number"),
  value: NumberSchema
});

export const MetricDecimalValueSchema = z.strictObject({
  kind: z.literal("decimal"),
  value: DecimalSchema,
  unit: unitSchema.optional(),
  scale: scaleSchema,
  rounding: roundingSchema.optional()
});

export const MetricMoneyValueSchema = z.strictObject({
  kind: z.literal("money"),
  value: MoneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  scale: scaleSchema,
  rounding: roundingSchema.optional()
});

export const MetricPercentageValueSchema = z.strictObject({
  kind: z.literal("percentage"),
  value: DecimalSchema
});

export const MetricDurationValueSchema = z.strictObject({
  kind: z.literal("duration"),
  value: DecimalSchema,
  unit: z.enum(durationUnits)
});

export const MetricTextValueSchema = z.strictObject({
  kind: z.literal("text"),
  value: TextSchema
});

export const MetricScalarValueSchema = z.discriminatedUnion("kind", [
  MetricIntegerValueSchema,
  MetricNumberValueSchema,
  MetricDecimalValueSchema,
  MetricMoneyValueSchema,
  MetricPercentageValueSchema,
  MetricDurationValueSchema,
  MetricTextValueSchema
]);

export const MetricScalarComparisonSchema = z.strictObject({
  value: MetricScalarValueSchema,
  sentiment: z.enum(metricSentiments)
});

export const MetricScalarSchema = z.strictObject({
  value: MetricScalarValueSchema,
  comparison: MetricScalarComparisonSchema.optional()
}).superRefine((metric, context) => {
  const comparison = metric.comparison?.value;
  if (comparison === undefined || metric.value.kind !== comparison.kind) {
    if (comparison !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "value", "kind"],
        message: "A comparison must use the same scalar kind as the metric value."
      });
    }
    return;
  }

  if (metric.value.kind === "money" && "currency" in comparison && metric.value.currency !== comparison.currency) {
    context.addIssue({
      code: "custom",
      path: ["comparison", "value", "currency"],
      message: "Money comparisons must use the same currency."
    });
  }

  if (
    (metric.value.kind === "decimal" || metric.value.kind === "duration")
    && "unit" in comparison
    && metric.value.unit !== comparison.unit
  ) {
    context.addIssue({
      code: "custom",
      path: ["comparison", "value", "unit"],
      message: "Unit-bearing comparisons must use the same unit."
    });
  }
}).meta({
  $id: "https://schemas.k-nex.dev/metric-scalar/v1.json",
  title: "K-Nex metric.scalar@1"
});

export type MetricIntegerValue = z.infer<typeof MetricIntegerValueSchema>;
export type MetricNumberValue = z.infer<typeof MetricNumberValueSchema>;
export type MetricDecimalValue = z.infer<typeof MetricDecimalValueSchema>;
export type MetricMoneyValue = z.infer<typeof MetricMoneyValueSchema>;
export type MetricPercentageValue = z.infer<typeof MetricPercentageValueSchema>;
export type MetricDurationValue = z.infer<typeof MetricDurationValueSchema>;
export type MetricTextValue = z.infer<typeof MetricTextValueSchema>;
export type MetricScalarValue = z.infer<typeof MetricScalarValueSchema>;
export type MetricScalarComparison = z.infer<typeof MetricScalarComparisonSchema>;
export type MetricScalar = z.infer<typeof MetricScalarSchema>;
export type MetricRoundingMode = (typeof metricRoundingModes)[number];
export type DurationUnit = (typeof durationUnits)[number];
export type MetricSentiment = (typeof metricSentiments)[number];
