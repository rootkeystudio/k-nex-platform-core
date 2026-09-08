/** Runtime ICU's ISO-4217 registry is the canonical currency authority. */
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

export function isIso4217CurrencyCode(value: unknown): value is string {
  return typeof value === "string" && supportedCurrencies.has(value);
}

/** ISO minor-unit scale used for exact reporting output; undefined rejects unknown codes. */
export function iso4217CurrencyScale(value: unknown): number | undefined {
  if (!isIso4217CurrencyCode(value)) return undefined;
  const scale = new Intl.NumberFormat("en", { style: "currency", currency: value }).resolvedOptions().maximumFractionDigits;
  return typeof scale === "number" && Number.isSafeInteger(scale) && scale >= 0 && scale <= 6 ? scale : undefined;
}
