import { EffectiveSettingsProvider } from "./effective-settings-provider.js";

export interface ApplicationReportingTimezone {
  readonly timezone: string;
  readonly revision: number;
}

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Reads the one application-owned reporting timezone; request/browser locale is never authority. */
export class ApplicationReportingTimezoneResolver {
  constructor(private readonly settings: EffectiveSettingsProvider) {}

  async resolve(input: Readonly<{ applicationId: string; environment: string }>): Promise<ApplicationReportingTimezone | undefined> {
    if (!isScope(input)) throw new TypeError("Application reporting timezone scope is invalid.");
    const document = await this.settings.read({ ...input, settingsId: "system.general" });
    if (document === undefined) return undefined;
    const timezone = document?.values.reportingTimezone;
    if (typeof timezone !== "string" || !canonicalIana(timezone) || !Number.isSafeInteger(document.settingsRevision) || document.settingsRevision < 1) return undefined;
    return Object.freeze({ timezone, revision: document.settingsRevision });
  }
}

export function canonicalIana(value: unknown): value is string {
  if (typeof value !== "string" || bytes(value) < 1 || bytes(value) > 120 || value.includes("\0")) return false;
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    return canonical === value && (value === "UTC" || Intl.supportedValuesOf("timeZone").includes(value));
  } catch { return false; }
}

function isScope(value: unknown): value is Readonly<{ applicationId: string; environment: string }> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join("\0") === "applicationId\0environment"
    && typeof (value as Record<string, unknown>).applicationId === "string" && typeof (value as Record<string, unknown>).environment === "string";
}
